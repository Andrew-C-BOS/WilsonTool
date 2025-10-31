import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const COOKIE = "milo_auth";
const ALG = "HS256";

function key() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("Missing JWT_SECRET");
  return new TextEncoder().encode(s);
}

export async function middleware(req: NextRequest) {
  const p = req.nextUrl.pathname;
  if (!(p.startsWith("/tenant") || p.startsWith("/landlord"))) return NextResponse.next();

  const token = req.cookies.get(COOKIE)?.value;
  if (!token) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", p);
    return NextResponse.redirect(url);
  }
  try {
    await jwtVerify(token, key(), { algorithms: [ALG] });
    return NextResponse.next();
  } catch {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", p);
    return NextResponse.redirect(url);
  }
}

export const config = { matcher: ["/tenant/:path*", "/landlord/:path*"] };
