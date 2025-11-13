// app/api/landlord/documents/upload/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const s3Region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
const s3Bucket = process.env.AWS_S3_BUCKET;

if (!s3Region || !s3Bucket) {
  // eslint-disable-next-line no-console
  console.warn(
    "[landlord/documents] AWS_REGION or AWS_S3_BUCKET not configured; upload route will fail until set."
  );
}

function toStr(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  try {
    return v?.toHexString ? v.toHexString() : String(v);
  } catch {
    return String(v);
  }
}

/* reuse the same firm resolver style as in list route */
async function resolveFirmForUser(req: NextRequest, user: { _id: any }) {
  const db = await getDb();
  const firmIdParam = req.nextUrl.searchParams.get("firmId") ?? undefined;
  const { ObjectId } = await import("mongodb");

  const userIdCandidates = (() => {
    const out: any[] = [];
    if (user?._id != null) out.push(user._id);
    const asOid = ObjectId.isValid(String(user?._id))
      ? new ObjectId(String(user._id))
      : null;
    if (asOid) out.push(asOid);
    if (user?._id instanceof ObjectId) out.push(String(user._id));
    return Array.from(new Set(out.map(String))).map((s) =>
      ObjectId.isValid(s) ? new ObjectId(s) : s
    );
  })();

  const firms = db.collection<any>("FirmDoc");

  if (firmIdParam) {
    const m = await db
      .collection("firm_memberships")
      .findOne(
        { firmId: firmIdParam, userId: { $in: userIdCandidates }, active: true },
        { projection: { firmId: 1 } }
      );
    if (!m) throw new Error("not_in_firm");

    const firmFilter: { _id: any } = ObjectId.isValid(firmIdParam)
      ? { _id: new ObjectId(firmIdParam) }
      : { _id: firmIdParam };

    const firm = await firms.findOne(firmFilter, {
      projection: { _id: 1, name: 1, slug: 1 },
    });
    if (!firm) throw new Error("invalid_firmId");
    return {
      firmId: toStr(firm._id),
      firmName: String(firm.name || "—"),
      firmSlug: firm.slug,
    };
  }

  const memberships = await db
    .collection("firm_memberships")
    .find(
      { userId: { $in: userIdCandidates }, active: true },
      { projection: { firmId: 1 } }
    )
    .limit(5)
    .toArray();

  if (memberships.length === 0) throw new Error("no_firm_membership");
  if (memberships.length > 1) throw new Error("ambiguous_firm");

  const firmId = memberships[0].firmId;
  const firmFilter2: { _id: any } = ObjectId.isValid(String(firmId))
    ? { _id: new ObjectId(String(firmId)) }
    : { _id: String(firmId) };

  const firm = await firms.findOne(firmFilter2, {
    projection: { _id: 1, name: 1, slug: 1 },
  });
  if (!firm) throw new Error("invalid_membership");

  return {
    firmId: toStr(firm._id),
    firmName: String(firm.name || "—"),
    firmSlug: firm.slug,
  };
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_");
}

function rand(n = 16) {
  return Array.from({ length: n }, () =>
    Math.floor(Math.random() * 36).toString(36)
  ).join("");
}

/* ───────────────────────────────────────────────────────────
   POST /api/landlord/documents/upload
   Body:
   {
     title: string,
     internalDescription?: string,
     externalDescription?: string,
     fileName: string,
     contentType: string
   }

   Returns:
   {
     ok: true,
     uploadUrl: string,
     objectKey: string,
     document: { ... }
   }
─────────────────────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 }
    );
  }

  if (!s3Region || !s3Bucket) {
    return NextResponse.json(
      { ok: false, error: "s3_not_configured" },
      { status: 500 }
    );
  }

  const db = await getDb();

  try {
    const firm = await resolveFirmForUser(req, user as any);

    const body = await req.json().catch(() => ({} as any));
    const title = String(body.title || "").trim();
    const internalDescription = String(body.internalDescription || "").trim();
    const externalDescription = String(body.externalDescription || "").trim();
    const fileNameRaw = String(body.fileName || "").trim();
    const contentType = String(
      body.contentType || "application/octet-stream"
    );

    if (!title) {
      return NextResponse.json(
        { ok: false, error: "missing_title" },
        { status: 400 }
      );
    }
    if (!fileNameRaw) {
      return NextResponse.json(
        { ok: false, error: "missing_fileName" },
        { status: 400 }
      );
    }

    const safeName = sanitizeFileName(fileNameRaw);
    const objectKey = `firms/${firm.firmId}/documents/${Date.now()}_${rand()}_${safeName}`;
    const now = new Date();

    // Insert document metadata first
    const insertRes = await db.collection("landlord_documents").insertOne({
      firmId: firm.firmId,
      title,
      internalDescription: internalDescription || null,
      externalDescription: externalDescription || null,
      objectKey,
      fileName: safeName,
      contentType,
      createdAt: now,
      updatedAt: now,
      createdBy: toStr(
        (user as any)?._id ?? (user as any)?.email ?? "system"
      ),
    });

    const docId = insertRes.insertedId;

    // Prepare S3 client & presigned URL
    const s3 = new S3Client({ region: s3Region });
    const cmd = new PutObjectCommand({
      Bucket: s3Bucket,
      Key: objectKey,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 900 }); // 15 minutes

    const document = {
      id: toStr(docId),
      firmId: firm.firmId,
      title,
      internalDescription: internalDescription || null,
      externalDescription: externalDescription || null,
      objectKey,
      fileName: safeName,
      contentType,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    return NextResponse.json({
      ok: true,
      uploadUrl,
      objectKey,
      document,
    });
  } catch (err: any) {
    const msg = err?.message || "server_error";
    const status =
      msg === "not_in_firm" ||
      msg === "no_firm_membership" ||
      msg === "ambiguous_firm" ||
      msg === "invalid_firmId" ||
      msg === "invalid_membership"
        ? 403
        : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
