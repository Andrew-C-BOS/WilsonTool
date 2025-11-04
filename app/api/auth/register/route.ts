// app/api/register/route.ts
import { NextResponse } from "next/server";
import { createUser, createSession } from "@/lib/auth";
import { ensureSoloHousehold } from "@/lib/households"; // <-- new

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { email, password, role } = await req.json();
    if (!email || !password || !["tenant", "landlord"].includes(role)) {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }

    // 1) create the user
    const user = await createUser(email, password, role);

    // 2) if tenant, ensure they have a solo household immediately
    //    this guarantees your invariant, one active household per user, always,
    let householdId: string | undefined;
    if (role === "tenant") {
      const hh = await ensureSoloHousehold({ _id: user._id, email: user.email });
      householdId = hh.householdId;
    }

    // 3) start a session
    await createSession(user);

    // 4) never return password fields, keep response simple, forward-compatible,
    const { passwordHash, ...safeUser } = user as any;

    return NextResponse.json({ ok: true, user: safeUser, householdId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Error" }, { status: 400 });
  }
}
