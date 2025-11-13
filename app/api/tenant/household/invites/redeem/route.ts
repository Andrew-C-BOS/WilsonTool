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

/* ---------- utils ---------- */
function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}
function toStringId(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (v instanceof ObjectId) return v.toHexString();
  return String(v);
}
function toMaybeObjectId(s: string | null | undefined): ObjectId | null {
  if (!s) return null;
  return ObjectId.isValid(s) ? new ObjectId(s) : null;
}

/* Try all likely membership collection names, return the first that exists. */
async function getMembershipsCol(db: any) {
  const candidates = [
    "household_memberhsips",   // original typo referenced earlier
    "households_memberhsips",  // plural households + same typo
    "household_memberships",   // corrected spelling
    "households_memberships",  // plural + corrected
    "households_membership",   // matches latest sample
  ];
  const existing: Set<string> = new Set(
    (await db.listCollections().toArray()).map((c: any) => c.name)
  );
  for (const name of candidates) {
    if (existing.has(name)) return db.collection(name);
  }
  // Fall back to the most likely one
  return db.collection("households_membership");
}

/* ============================================================
   POST /api/tenant/household/invites/redeem
   Body options:
     - { code: string, name?: string }
       (from email link / "Join with code" UI)
     - { inviteId: string, name?: string }
       (from "Join from invite" UI; skips code/hash)

   Both paths:
     - require a logged-in user
     - verify invite email matches user email / aliases
     - ensure invite is active & not expired
     - upsert membership and deactivate other households
============================================================ */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 }
    );
  }

  const db = await getDb();
  const invitesCol = db.collection("household_invites");
  const membershipsCol = await getMembershipsCol(db);

  const body = await req.json().catch(() => null);

  const rawCode = body?.code ? String(body.code).trim() : "";
  const rawInviteId = body?.inviteId ? String(body.inviteId).trim() : "";
  const displayName = body?.name ? String(body.name).trim() : null;

  if (!rawCode && !rawInviteId) {
    return NextResponse.json(
      { ok: false, error: "missing_code_or_inviteId" },
      { status: 400 }
    );
  }

  const primaryEmail = String(user.email ?? "").toLowerCase();
  const emailAliases: string[] = Array.isArray((user as any)?.emails)
    ? ((user as any).emails as string[]).map((e) => String(e).toLowerCase())
    : [];
  const allowedEmails = new Set([primaryEmail, ...emailAliases].filter(Boolean));

  const userId =
    toStringId((user as any).id) ||
    toStringId((user as any)._id) ||
    toStringId((user as any).userId) ||
    primaryEmail;

  const now = new Date();

  let invite: any | null = null;

  /* ---------- Path 1: code-based redeem (email link / "Join with code") ---------- */
  if (rawCode) {
    const codeHash = sha256Hex(rawCode);

    invite = await invitesCol.findOne({
      codeHash,
      state: "active",
      expiresAt: { $gt: now },
    });

    if (!invite) {
      return NextResponse.json(
        { ok: false, error: "invalid_or_expired" },
        { status: 400 }
      );
    }
  }

  /* ---------- Path 2: inviteId-based redeem (Join from invite UI) ---------- */
  if (!rawCode && rawInviteId) {
    const inviteObjId = toMaybeObjectId(rawInviteId);
    if (!inviteObjId) {
      return NextResponse.json(
        { ok: false, error: "invalid_invite" },
        { status: 400 }
      );
    }

    invite = await invitesCol.findOne({
      _id: inviteObjId,
      state: "active",
      expiresAt: { $gt: now },
    });

    if (!invite) {
      return NextResponse.json(
        { ok: false, error: "invalid_or_expired" },
        { status: 400 }
      );
    }
  }

  if (!invite) {
    // Shouldn’t be reachable, but just in case,
    return NextResponse.json(
      { ok: false, error: "invite_not_found" },
      { status: 404 }
    );
  }

  // Enforce that the logged-in user owns the invited email (primary or alias)
  const inviteEmail = String(invite.email ?? "").toLowerCase();
  if (!allowedEmails.has(inviteEmail)) {
    return NextResponse.json(
      { ok: false, error: "wrong_email" },
      { status: 403 }
    );
  }

  const role: MemberRole = (invite.role as MemberRole) ?? "co_applicant";
  const householdIdStr = toStringId(invite.householdId);

  // Ensure only one active household at a time,
  // mark other memberships for this user as inactive,
  await membershipsCol.updateMany(
    {
      userId,
      active: { $ne: false },
      householdId: { $ne: householdIdStr },
    },
    {
      $set: {
        active: false,
        leftAt: now,
      },
    }
  );

  // Upsert membership into the invited household
  await membershipsCol.updateOne(
    {
      householdId: householdIdStr,
      $or: [{ userId }, { email: inviteEmail }],
    },
    {
      $setOnInsert: {
        userId,
        email: inviteEmail,
        joinedAt: now,
      },
      $set: {
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
    {
      $set: {
        state: "redeemed",
        redeemedAt: now,
        redeemedBy: userId,
      },
    }
  );

  return NextResponse.json({
    ok: true,
    membership: {
      householdId: householdIdStr,
      userId,
      email: inviteEmail,
      role,
      name: displayName ?? (user as any).name ?? null,
      state: "active",
      joinedAt: now.toISOString(),
    },
  });
}
