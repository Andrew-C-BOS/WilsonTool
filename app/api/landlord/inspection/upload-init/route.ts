// app/api/landlord/inspection/upload-init/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, S3_BUCKET, S3_PUBLIC_BASE_URL } from "@/lib/aws/s3";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tiny random id helper for filenames */
function randomId(len = 12) {
  return Math.random().toString(36).slice(2, 2 + len);
}

/** Build a stable-ish S3 key for landlord inspection images */
function buildKey(opts: {
  firmId?: string | null;
  inspectorId: string;
  ext?: string | null;
}) {
  const { firmId, inspectorId, ext } = opts;

  const safeExt = (ext || "jpg").replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "jpg";

  const parts = [
    "inspection",
    "landlord",
    firmId || "no_firm",
    inspectorId,
    `${Date.now()}-${randomId()}.${safeExt}`,
  ];

  return parts.join("/");
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "landlord") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (!S3_BUCKET) {
    console.error("[landlord inspection] upload-init: S3_BUCKET is not configured");
    return NextResponse.json(
      { ok: false, error: "missing_s3_bucket" },
      { status: 500 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const contentType =
    typeof body?.contentType === "string" && body.contentType.trim()
      ? body.contentType.trim()
      : "application/octet-stream";

  const ext =
    typeof body?.ext === "string" && body.ext.trim()
      ? body.ext.trim()
      : null;

  try {
    const firmId = user.landlordFirm?.firmId ?? null;
    const inspectorId = String(user._id);

    const key = buildKey({ firmId, inspectorId, ext });

    // Signed PUT URL for direct upload from the client
    const putCmd = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const putUrl = await getSignedUrl(s3, putCmd, { expiresIn: 60 * 10 }); // 10 minutes

    // Public (or at least stable) GET URL, same pattern as your tenant side
    const base =
      S3_PUBLIC_BASE_URL && S3_PUBLIC_BASE_URL.length > 0
        ? S3_PUBLIC_BASE_URL
        : `https://${S3_BUCKET}.s3.amazonaws.com`;

    const getUrl = `${base}/${encodeURIComponent(key)}`;

    return NextResponse.json({
      ok: true,
      putUrl,
      getUrl,
    });
  } catch (err: any) {
    console.error("[landlord inspection] upload-init failed,", err);
    return NextResponse.json(
      { ok: false, error: "server_error", detail: err?.message },
      { status: 500 },
    );
  }
}
