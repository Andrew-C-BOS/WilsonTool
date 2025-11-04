// app/api/tenant/household/invites/redeem/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import crypto from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MemberRole = "primary" | "co_applicant" | "cosigner";
function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}
function toStringId(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (v instanceof ObjectId) return v.toHexString();
  return String(v);
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const db = await getDb();
  const invitesCol = db.collection("household_invites");
  const membershipsCol = db.collection("household_memberhsips");

  const body = await req.json().catch(() => null);
  const code = String(body?.code ?? "").trim();
  const displayName = body?.name ? String(body.name).trim() : null;
  if (!code) {
    return NextResponse.json({ ok: false, error: "missing_code" }, { status: 400 });
  }

  const userEmail = String(user.email ?? "").toLowerCase();
  const userId =
    toStringId((user as any).id) ||
    toStringId((user as any)._id) ||
    toStringId((user as any).userId) ||
    userEmail;

  const codeHash = sha256Hex(code);
  const now = new Date();

  // Find a live invite by hash
  const invite = await invitesCol.findOne({
    codeHash,
    state: "active",
    expiresAt: { $gt: now },
  });

  if (!invite) {
    return NextResponse.json({ ok: false, error: "invalid_or_expired" }, { status: 400 });
  }

  // Enforce that the logged-in user owns the invited email
  if (String(invite.email).toLowerCase() !== userEmail) {
    return NextResponse.json({ ok: false, error: "wrong_email" }, { status: 403 });
  }

  // Upsert membership: idempotent without multi-document transactions
  const role: MemberRole = (invite.role as MemberRole) ?? "co_applicant";
  const householdIdStr = toStringId(invite.householdId);

  await membershipsCol.updateOne(
    {
      householdId: householdIdStr,
      $or: [{ userId }, { email: userEmail }],
    },
    {
      $setOnInsert: {
        // Insert path
        userId,
        email: userEmail,
        joinedAt: now,
      },
      $set: {
        // Insert + Update path
        active: true,
        role,
        name: displayName ?? (user as any).name ?? null,
      },
    },
    { upsert: true }
  );

  // Mark invite as redeemed
  await invitesCol.updateOne(
    { _id: invite._id, state: "active" },
    { $set: { state: "redeemed", redeemedAt: now, redeemedBy: userId } }
  );

  return NextResponse.json({
    ok: true,
    membership: {
      householdId: householdIdStr,
      userId,
      email: userEmail,
      role,
      name: displayName ?? (user as any).name ?? null,
      state: "active",
      joinedAt: now.toISOString(),
    },
  });
}
