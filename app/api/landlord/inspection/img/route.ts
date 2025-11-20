// app/api/landlord/inspection/img/route.ts
import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3, S3_BUCKET } from "@/lib/aws/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Given a full S3 URL like:
 *   https://mini-milo-bucket.s3.us-east-2.amazonaws.com/inspection%2Flandlord%2F...
 * extract the object key, decoding the path component once.
 */
function extractKeyFromUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    // u.pathname is like "/inspection%2Flandlord%2Ffirm_...%2Ffile.png"
    const encodedPath = u.pathname.startsWith("/")
      ? u.pathname.slice(1)
      : u.pathname;

    // decode once to turn %2F into "/"
    const key = decodeURIComponent(encodedPath);
    return key || null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const search = new URL(req.url).searchParams;
  const raw = search.get("u");

  if (!raw) {
    return NextResponse.json(
      { ok: false, error: "missing_u" },
      { status: 400 },
    );
  }

  if (!S3_BUCKET) {
    console.error("[landlord inspection img] S3_BUCKET not configured");
    return NextResponse.json(
      { ok: false, error: "missing_s3_bucket" },
      { status: 500 },
    );
  }

  // u is encodeURIComponent(getUrl) from the client
  let decodedUrl = raw;
  try {
    decodedUrl = decodeURIComponent(raw);
  } catch {
    // if decode fails, we just use raw
  }

  const key = extractKeyFromUrl(decodedUrl);
  if (!key) {
    console.warn("[landlord inspection img] invalid key from u:", decodedUrl);
    return NextResponse.json(
      { ok: false, error: "invalid_key" },
      { status: 400 },
    );
  }

  try {
    const cmd = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    });

    const data = await s3.send(cmd);

    if (!data.Body) {
      return NextResponse.json(
        { ok: false, error: "no_body" },
        { status: 500 },
      );
    }

    // Node.js stream is fine as body in the Node runtime
    const body = data.Body as any;

    const headers = new Headers();
    headers.set("Content-Type", data.ContentType || "image/*");
    headers.set("Cache-Control", "public, max-age=31536000, immutable");

    return new NextResponse(body, { status: 200, headers });
  } catch (err: any) {
    console.error("[landlord inspection img] GetObject failed:", err?.message || err);
    // 404 if it doesn't exist / not allowed, to avoid leaking details
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  }
}
