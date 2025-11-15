// app/api/register/route.ts
import { NextResponse } from "next/server";
import { createUser, createSession } from "@/lib/auth";
import { ensureSoloHousehold } from "@/lib/households";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      email,
      password,
      role,
      fullName,
      loginAfterRegister = true, // 👈 NEW, default true
    } = body;

    if (!email || !password || !["tenant", "landlord"].includes(role)) {
      return NextResponse.json(
        { ok: false, error: "Invalid body" },
        { status: 400 }
      );
    }

    // Tenants must provide a normalized legal name
    let legalName: string | undefined;
    if (role === "tenant") {
      legalName = (fullName ?? "").trim();
      if (!legalName) {
        return NextResponse.json(
          { ok: false, error: "fullName_required_for_tenant" },
          { status: 400 }
        );
      }
    }

    // 1) Create the user
    const user = await createUser(email, password, role, legalName);

    // 2) If tenant, ensure they have a solo household
    let householdId: string | undefined;
    if (role === "tenant") {
      const hh = await ensureSoloHousehold({ _id: user._id, email: user.email });
      householdId = hh.householdId;
    }

    // 3) Optionally create a session
    if (loginAfterRegister) {
      await createSession(user);
    }

    // 4) Return safe user
    const { passwordHash, ...safeUser } = user as any;

    return NextResponse.json({
      ok: true,
      user: safeUser,
      householdId,
      loginAfterRegister,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Error" },
      { status: 400 }
    );
  }
}
