import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, S3_BUCKET, S3_PUBLIC_BASE_URL } from "@/lib/aws/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function nowKey() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

export async function POST(req: Request) {
  try {
    const { contentType, ext } = await req.json();
    if (!contentType) {
      return NextResponse.json({ ok: false, error: "missing_content_type" }, { status: 400 });
    }

    const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic"];
    if (!allowed.includes(contentType)) {
      return NextResponse.json({ ok: false, error: "unsupported_type" }, { status: 400 });
    }

    const key = `inspections/${nowKey()}/${crypto.randomUUID()}.${ext || "jpg"}`;

    const putCmd = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const putUrl = await getSignedUrl(s3, putCmd, { expiresIn: 60 * 5 });
    const getUrl = `${S3_PUBLIC_BASE_URL}/${encodeURIComponent(key)}`;

    return NextResponse.json({ ok: true, key, putUrl, getUrl });
  } catch (e: any) {
    console.error("upload-init error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "server_error" }, { status: 500 });
  }
}
