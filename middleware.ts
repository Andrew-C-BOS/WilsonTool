// middleware.ts
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

function isBypassed(pathname: string) {
  // Never gate API or static assets with middleware
  if (pathname.startsWith("/api/")) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico") return true;

  // Allow auth pages themselves
  if (pathname === "/login" || pathname === "/register") return true;

  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Skip routes we should never protect here
  if (isBypassed(pathname)) return NextResponse.next();

  // Only protect app pages under these prefixes
  const isProtectedPage =
    pathname.startsWith("/tenant") || pathname.startsWith("/landlord");
  if (!isProtectedPage) return NextResponse.next();

  const token = req.cookies.get(COOKIE)?.value;
  if (!token) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  try {
    await jwtVerify(token, key(), { algorithms: [ALG] });
    return NextResponse.next();
  } catch {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
}

// Broad matcher, but we still explicitly skip /api/* above.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
