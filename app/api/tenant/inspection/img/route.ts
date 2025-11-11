import { NextResponse } from "next/server";
import { s3, S3_BUCKET, S3_PUBLIC_BASE_URL } from "@/lib/aws/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Extract the S3 object key from a URL or return null. */
function extractKey(u: string): string | null {
  if (!u || u.startsWith("data:")) return null;
  try {
    // If it starts with our configured public base, strip it
    if (S3_PUBLIC_BASE_URL && u.startsWith(S3_PUBLIC_BASE_URL + "/")) {
      return decodeURIComponent(u.slice(S3_PUBLIC_BASE_URL.length + 1));
    }
    const url = new URL(u);

    // Virtual-hosted style: <bucket>.s3.<region>.amazonaws.com/<key>
    const vh = url.hostname.match(/^([^.]+)\.s3[.-][a-z0-9-]+\.amazonaws\.com$/i);
    if (vh && vh[1] === S3_BUCKET) {
      return decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    }

    // Path-style: s3.<region>.amazonaws.com/<bucket>/<key>
    const ps = url.hostname.match(/^s3[.-][a-z0-9-]+\.amazonaws\.com$/i);
    if (ps) {
      const parts = url.pathname.replace(/^\/+/, "").split("/");
      const bucket = parts.shift();
      if (bucket === S3_BUCKET) return decodeURIComponent(parts.join("/"));
    }

    // If the client sends the raw key in ?key=..., allow that too.
    return null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const u = searchParams.get("u") || "";
    const keyParam = searchParams.get("key") || "";

    const key = keyParam || extractKey(u);
    if (!key) {
      return NextResponse.json({ ok: false, error: "missing_or_invalid_key" }, { status: 400 });
    }

    const cmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
    // Short-lived signed GET
    const signed = await getSignedUrl(s3, cmd, { expiresIn: 60 * 5 });

    // Redirect the browser to the signed URL
    const res = NextResponse.redirect(signed, 302);
    // Cache in the browser a bit to avoid re-sign on quick back/forward
    res.headers.set("Cache-Control", "private, max-age=120");
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "server_error", detail: e?.message }, { status: 500 });
  }
}
