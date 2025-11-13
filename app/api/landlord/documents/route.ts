// app/api/landlord/documents/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FirmMeta = {
  firmId: string;
  firmName: string;
  firmSlug?: string;
};

type LandlordDocument = {
  _id: any;
  firmId: string;
  title: string;
  internalDescription?: string | null;
  externalDescription?: string | null;
  objectKey: string;
  fileName?: string | null;
  contentType?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

function toStr(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  try {
    return v?.toHexString ? v.toHexString() : String(v);
  } catch {
    return String(v);
  }
}

async function resolveFirmForUser(
  req: NextRequest,
  user: { _id: any }
): Promise<FirmMeta> {
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

  // If firmId is explicitly provided, verify membership
  if (firmIdParam) {
    const m = await db
      .collection("firm_memberships")
      .findOne(
        { firmId: firmIdParam, userId: { $in: userIdCandidates }, active: true },
        { projection: { firmId: 1 } }
      );
    if (!m) {
      throw new Error("not_in_firm");
    }

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
      firmSlug: firm.slug ? String(firm.slug) : undefined,
    };
  }

  // Otherwise, infer from memberships
  const memberships = await db
    .collection("firm_memberships")
    .find(
      { userId: { $in: userIdCandidates }, active: true },
      { projection: { firmId: 1 } }
    )
    .limit(5)
    .toArray();

  if (memberships.length === 0) throw new Error("no_firm_membership");
  if (memberships.length > 1) {
    throw new Error("ambiguous_firm");
  }

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
    firmSlug: firm.slug ? String(firm.slug) : undefined,
  };
}

/* ───────────────────────────────────────────────────────────
   GET /api/landlord/documents
   Returns: { ok: true, firm, documents: [...] }
─────────────────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 }
    );
  }

  try {
    const db = await getDb();
    const firm = await resolveFirmForUser(req, user as any);

    const docs = (await db
      .collection<LandlordDocument>("landlord_documents")
      .find({ firmId: firm.firmId })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray()) as LandlordDocument[];

    const documents = docs.map((d) => ({
      id: toStr(d._id),
      firmId: d.firmId,
      title: d.title,
      internalDescription: d.internalDescription ?? null,
      externalDescription: d.externalDescription ?? null,
      objectKey: d.objectKey,
      fileName: d.fileName ?? null,
      contentType: d.contentType ?? null,
      createdAt: d.createdAt
        ? new Date(d.createdAt as any).toISOString()
        : null,
      updatedAt: d.updatedAt
        ? new Date(d.updatedAt as any).toISOString()
        : null,
      url: (d as any).url ?? null, // optional, in case you store a public URL
    }));

    return NextResponse.json({ ok: true, firm, documents });
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
