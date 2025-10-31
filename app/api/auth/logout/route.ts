// app/api/auth/logout/route.ts
import { NextResponse } from "next/server";

const COOKIE = "milo_auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });

  // Overwrite the cookie with an immediate expiry (authoritative way to clear)
  res.cookies.set({
    name: COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });

  // Optional: delete by name (no options param in Next 16)
  // This is safe to keep or remove — the set() above already clears it.
  res.cookies.delete(COOKIE);

  return res;
}
