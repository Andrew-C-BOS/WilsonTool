import { NextResponse } from "next/server";
import { createUser, createSession } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const { email, password, role } = await req.json();
    if (!email || !password || !["tenant", "landlord"].includes(role)) {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }
    const user = await createUser(email, password, role);
    await createSession(user);
    return NextResponse.json({ ok: true, user });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message ?? "Error" }, { status: 400 });
  }
}
