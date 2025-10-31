import { NextResponse } from "next/server";
import { findUserByEmail, verifyPassword, createSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export async function POST(req: Request) {
  const { email, password } = await req.json();
  if (!email || !password) return NextResponse.json({ ok: false, error: "Missing credentials" }, { status: 400 });

  const user = await findUserByEmail(email);
  if (!user) return NextResponse.json({ ok: false, error: "Invalid login" }, { status: 401 });

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return NextResponse.json({ ok: false, error: "Invalid login" }, { status: 401 });

  const sessionUser = { _id: String(user._id), email: user.email, role: user.role };
  await createSession(sessionUser);
  return NextResponse.json({ ok: true, user: sessionUser });
}
