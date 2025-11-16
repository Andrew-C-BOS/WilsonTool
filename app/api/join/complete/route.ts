// app/api/join/complete/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sha256(s: string) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
function toStringId(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (v instanceof ObjectId) return v.toHexString();
  return String(v);
}
function lc(s: unknown) {
  return typeof s === "string" ? s.toLowerCase() : "";
}
function toMaybeObjectId(v: any): ObjectId | null {
  try {
    return ObjectId.isValid(v) ? new ObjectId(v) : null;
  } catch {
    return null;
  }
}

/** Unified “user-ish” shape that can represent both Mongo docs and SessionUser */
type UserDocLike = {
  _id?: any;
  id?: any;
  userId?: any;
  email?: string;
  preferredName?: string | null;
  [key: string]: any;
};

function userIdString(u: UserDocLike): string {
  return toStringId(u._id ?? u.id ?? u.userId);
}
function userEmailLower(u: UserDocLike): string {
  return lc(u.email ?? "");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const code = String(body?.code || "");
    const otpRaw = body?.otp;
    const otp = typeof otpRaw === "string" ? otpRaw.trim() : "";

    if (!code) {
      return NextResponse.json(
        { ok: false, error: "missing_code" },
        { status: 400 },
      );
    }

    const db = await getDb();
    const invites = db.collection("household_invites");
    const memberships = db.collection("household_memberships");
    const membershipsLegacy = db.collection("household_memberhsips");
    const households = db.collection("households");

    const codeHash = sha256(code);
    const inv = await invites.findOne({ codeHash, state: "active" as const });
    if (!inv) {
      return NextResponse.json(
        { ok: false, error: "invalid_or_used" },
        { status: 404 },
      );
    }

    const now = new Date();
    const nowISO = now.toISOString();
    const expiresAt = inv.expiresAt ? new Date(inv.expiresAt) : null;

    if (expiresAt && expiresAt < now) {
      return NextResponse.json(
        {
          ok: false,
          error: "expired",
          expiredAtISO: expiresAt.toISOString(),
          nowISO,
        },
        { status: 410 },
      );
    }

    // ✅ Require logged-in user
    const sessionUser = (await getSessionUser()) as UserDocLike | null;
    if (!sessionUser) {
      return NextResponse.json(
        { ok: false, error: "not_logged_in" },
        { status: 403 },
      );
    }

    const suId = userIdString(sessionUser);
    const suEmail = userEmailLower(sessionUser);
    const joinEmail = lc(inv.email || "");

    // Normalize householdId to a STRING for membership docs
    const targetHIdStr = toStringId(inv.householdId);
    const targetHIdObj = toMaybeObjectId(targetHIdStr);
    const household =
      (targetHIdObj &&
        (await households.findOne({ _id: targetHIdObj }))) ||
      (await households.findOne({ _id: targetHIdStr as any }));
    if (!household) {
      return NextResponse.json(
        { ok: false, error: "household_not_found" },
        { status: 404 },
      );
    }

    const sameEmail = suEmail === joinEmail;

    // Only require OTP if user is logged in with a different email than invite email
    if (!sameEmail) {
      const verifyExpiresAt = inv.verifyExpiresAt
        ? new Date(inv.verifyExpiresAt)
        : null;

      if (!inv.verifyCodeHash || !verifyExpiresAt) {
        return NextResponse.json(
          { ok: false, error: "not_started" },
          { status: 400 },
        );
      }
      if (verifyExpiresAt < now) {
        return NextResponse.json(
          {
            ok: false,
            error: "otp_expired",
            otpExpiredAtISO: verifyExpiresAt.toISOString(),
            nowISO,
          },
          { status: 410 },
        );
      }
      if (!otp) {
        return NextResponse.json(
          { ok: false, error: "missing_otp" },
          { status: 400 },
        );
      }
      if (sha256(otp) !== inv.verifyCodeHash) {
        await invites.updateOne(
          { _id: inv._id },
          { $inc: { verifyAttempts: 1 } },
        );
        return NextResponse.json(
          { ok: false, error: "otp_invalid" },
          { status: 401 },
        );
      }
    }

    // Helper: mark invite redeemed with audit, leave `email` untouched
    async function markInviteRedeemed(
      redeemedByUserId: string,
      redeemedByEmail: string,
      extras?: Record<string, any>,
    ) {
      await invites.updateOne(
        { _id: inv._id },
        {
          $set: {
            state: "redeemed",
            redeemedAt: now,
            redeemedBy: redeemedByUserId,
            redeemedByEmail: redeemedByEmail,
            redeemedToAlternate: !sameEmail,
            ...(extras || {}),
          },
        },
      );
    }

    // Helper: upsert membership in string-ID shape
    async function upsertMembership(
      userIdStr: string,
      emailLower: string,
      preferredName: string | null,
      role: string,
    ) {
      const doc = {
        userId: userIdStr,
        email: emailLower,
        householdId: targetHIdStr,
        role: role || "co_applicant",
        active: true,
        updatedAt: now,
      };

      await memberships.updateOne(
        {
          userId: userIdStr,
          householdId: targetHIdStr,
        },
        {
          $set: doc,
          $setOnInsert: {
            _id: new ObjectId().toHexString(), // string _id
            joinedAt: now,
            name: preferredName,
          },
        },
        { upsert: true },
      );
    }

    // Helper: find all active memberships for this user across households
    async function getActiveMembershipsForUser() {
      const query = { userId: suId, active: true };
      const [m1, m2] = await Promise.all([
        memberships.find(query).toArray(),
        membershipsLegacy.find(query).toArray(),
      ]);
      return [...m1, ...m2];
    }

    // 1) Gather active memberships for this user
    const activeMems = await getActiveMembershipsForUser();

    const activeInTarget = activeMems.filter(
      (m: any) => String(m.householdId) === targetHIdStr,
    );
    const activeInOtherHouseholds = activeMems.filter(
      (m: any) => String(m.householdId) !== targetHIdStr,
    );

    // 2) If already active in the target household, just redeem invite and return
    if (activeInTarget.length > 0) {
      await markInviteRedeemed(suId, suEmail, { alreadyMember: true });
      return NextResponse.json({
        ok: true,
        joined: false,
        alreadyMember: true,
      });
    }

    // 3) If user has active membership(s) in other households, check if those
    //    households have any other active members. If yes, we must block.
    if (activeInOtherHouseholds.length > 0) {
      // we’ll treat any other active household as a reason to block
      for (const mem of activeInOtherHouseholds) {
        const hIdStr = String(mem.householdId);

        const otherActiveQuery = {
          householdId: hIdStr,
          active: true,
          userId: { $ne: suId },
        };

        const [other1, other2] = await Promise.all([
          memberships.findOne(otherActiveQuery),
          membershipsLegacy.findOne(otherActiveQuery),
        ]);

        if (other1 || other2) {
          // Found another active member on the user's current household
          return NextResponse.json(
            {
              ok: false,
              error: "existing_household_multi_member_block",
              householdId: hIdStr,
            },
            { status: 409 },
          );
        }
      }

      // If we reach here, the user has active memberships in other households,
      // but they are the only active member in each. We can safely deactivate them.
      await memberships.updateMany(
        {
          userId: suId,
          active: true,
          householdId: { $nin: [targetHIdStr] },
        },
        { $set: { active: false, updatedAt: now } },
      );
      await membershipsLegacy.updateMany(
        {
          userId: suId,
          active: true,
          householdId: { $nin: [targetHIdStr] },
        },
        { $set: { active: false, updatedAt: now } },
      );
    }

    // 4) At this point, there are no conflicting active households or they've been deactivated.
    //    Proceed to create/upsert membership in the target household.
    await upsertMembership(
      suId,
      suEmail,
      (sessionUser as any).preferredName ?? null,
      inv.role || "co_applicant",
    );

    await markInviteRedeemed(suId, suEmail);

    return NextResponse.json({
      ok: true,
      joined: true,
      createdAccount: false,
      redeemedToAlternate: !sameEmail,
    });
  } catch (e) {
    console.error("[join.complete] error", e);
    return NextResponse.json(
      { ok: false, error: "server_error" },
      { status: 500 },
    );
  }
}
