import { NextResponse } from "next/server";

const COOKIE = "milo_auth";

export async function POST() {
  // Build a response and clear the cookie on that response
  const res = NextResponse.json({ ok: true });

  // Overwrite with an immediate-expiry cookie (most robust)
  res.cookies.set({
    name: COOKIE,
    value: "",
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,                 // expire now
    expires: new Date(0),      // belt-and-suspenders
  });

  // Also call delete (handles some edge cases with duplicates)
  res.cookies.delete(COOKIE, { path: "/" });

  return res;
}
