// app/api/join/complete/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUser, createSession, createUser } from "@/lib/auth";

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
    const otp = String(body?.otp || "");
    const doSwitch = body?.switch === true; // ← allow explicit switch to invited account

    if (!code || !otp) {
      return NextResponse.json(
        { ok: false, error: "missing_params" },
        { status: 400 }
      );
    }

    const db = await getDb();
    const invites = db.collection("household_invites");
    const memberships = db.collection("household_memberships");
    const membershipsLegacy = db.collection("household_memberhsips"); // legacy typo
    const usersCol = db.collection("users");
    const households = db.collection("households");

    const codeHash = sha256(code);
    const inv = await invites.findOne({ codeHash, state: "active" as const });
    if (!inv) {
      return NextResponse.json(
        { ok: false, error: "invalid_or_used" },
        { status: 404 }
      );
    }

    const now = new Date();
    if (inv.expiresAt && new Date(inv.expiresAt) < now) {
      return NextResponse.json(
        { ok: false, error: "expired" },
        { status: 410 }
      );
    }

    // OTP checks
    if (!inv.verifyCodeHash || !inv.verifyExpiresAt) {
      return NextResponse.json(
        { ok: false, error: "not_started" },
        { status: 400 }
      );
    }
    if (new Date(inv.verifyExpiresAt) < now) {
      return NextResponse.json(
        { ok: false, error: "otp_expired" },
        { status: 410 }
      );
    }
    if (sha256(otp.trim()) !== inv.verifyCodeHash) {
      await invites.updateOne(
        { _id: inv._id },
        { $inc: { verifyAttempts: 1 } }
      );
      return NextResponse.json(
        { ok: false, error: "otp_invalid" },
        { status: 401 }
      );
    }

    // Verified email (via OTP) is the invite's email
    const joinEmail = lc(inv.email || "");
    let sessionUser = await getSessionUser(); // may be null

    // Household lookup (string/ObjectId tolerant)
    const targetHIdStr = toStringId(inv.householdId);
    const targetHIdObj = toMaybeObjectId(targetHIdStr);
    const household =
      (targetHIdObj &&
        (await households.findOne({ _id: targetHIdObj }))) ||
      (await households.findOne({ _id: targetHIdStr as any }));
    if (!household) {
      return NextResponse.json(
        { ok: false, error: "household_not_found" },
        { status: 404 }
      );
    }

    if (sessionUser) {
      // Logged-in flow
      const suId = toStringId(
        (sessionUser as any)._id ??
          (sessionUser as any).id ??
          (sessionUser as any).userId
      );
      const suEmail = lc((sessionUser as any).email);

      if (suEmail !== joinEmail) {
        // If emails don't match and client didn't request a switch, hint the client UI
        if (!doSwitch) {
          return NextResponse.json(
            { ok: false, error: "wrong_email", suggest: ["switch_account"] },
            { status: 403 }
          );
        }

        // ✅ Switch to invited account:
        // create/reuse invited user, replace session, upsert membership, redeem invite
        let userDoc =
          (await usersCol.findOne({
            email: joinEmail,
          })) as UserDocLike | null;

        if (!userDoc) {
          const tempPassword = randomBytes(16).toString("hex");
          const created = await createUser(joinEmail, tempPassword, "tenant");
          userDoc = created as UserDocLike;
        }

        await createSession(userDoc as any); // overwrite cookie → effectively logs out prior user

        const uId = userIdString(userDoc);

        await memberships.updateOne(
          {
            userId: uId,
            householdId: targetHIdObj ?? targetHIdStr,
          },
          {
            $set: {
              userId: uId,
              email: joinEmail,
              householdId: targetHIdObj ?? targetHIdStr,
              role: inv.role || "co_applicant",
              active: true,
              updatedAt: now,
            },
            $setOnInsert: {
              joinedAt: now,
              name: userDoc.preferredName ?? null,
            },
          },
          { upsert: true }
        );

        await invites.updateOne(
          { _id: inv._id },
          {
            $set: {
              state: "redeemed",
              redeemedAt: now,
              redeemedBy: uId,
              switchedAccount: true, // small audit flag
            },
          }
        );

        return NextResponse.json({
          ok: true,
          joined: true,
          createdAccount: false,
          switchedAccount: true,
        });
      }

      // Same-email, normal logged-in flow
      const activeMem =
        (await memberships.findOne({
          active: true,
          $or: [{ userId: suId }, { email: suEmail }],
        })) ||
        (await membershipsLegacy.findOne({
          active: true,
          $or: [{ userId: suId }, { email: suEmail }],
        }));

      if (activeMem) {
        const hId = activeMem.householdId;
        const [cntA, cntB] = await Promise.all([
          memberships.countDocuments({
            householdId: hId,
            active: { $in: [true, false] },
          }),
          membershipsLegacy.countDocuments({
            householdId: hId,
            active: { $in: [true, false] },
          }),
        ]);
        if (cntA + cntB > 1) {
          return NextResponse.json(
            { ok: false, error: "household_multi_member_block" },
            { status: 409 }
          );
        }
      }

      await memberships.updateOne(
        {
          userId: suId,
          householdId: targetHIdObj ?? targetHIdStr,
        },
        {
          $set: {
            userId: suId,
            email: suEmail,
            householdId: targetHIdObj ?? targetHIdStr,
            role: inv.role || "co_applicant",
            active: true,
            updatedAt: now,
          },
          $setOnInsert: {
            joinedAt: now,
            name: (sessionUser as any).preferredName ?? null,
          },
        },
        { upsert: true }
      );

      await invites.updateOne(
        { _id: inv._id },
        {
          $set: {
            state: "redeemed",
            redeemedAt: now,
            redeemedBy: suId,
          },
        }
      );

      return NextResponse.json({
        ok: true,
        joined: true,
        createdAccount: false,
      });
    }

    // Logged-out flow → create or reuse user by invite email, then session, then membership
    let userDoc =
      (await usersCol.findOne({
        email: inv.email,
      })) as UserDocLike | null;

    if (!userDoc) {
      const tempPassword = randomBytes(16).toString("hex");
      const created = await createUser(String(inv.email), tempPassword, "tenant");
      userDoc = created as UserDocLike;
    }

    await createSession(userDoc as any);

    const uId = userIdString(userDoc);
    const uEmail = userEmailLower(userDoc);

    await memberships.updateOne(
      { userId: uId, householdId: targetHIdObj ?? targetHIdStr },
      {
        $set: {
          userId: uId,
          email: uEmail,
          householdId: targetHIdObj ?? targetHIdStr,
          role: inv.role || "co_applicant",
          active: true,
          updatedAt: now,
        },
        $setOnInsert: {
          joinedAt: now,
          name: userDoc.preferredName ?? null,
        },
      },
      { upsert: true }
    );

    await invites.updateOne(
      { _id: inv._id },
      {
        $set: {
          state: "redeemed",
          redeemedAt: now,
          redeemedBy: uId,
        },
      }
    );

    return NextResponse.json({
      ok: true,
      joined: true,
      createdAccount: true,
    });
  } catch (e) {
    console.error("[join.complete] error", e);
    return NextResponse.json(
      { ok: false, error: "server_error" },
      { status: 500 }
    );
  }
}
