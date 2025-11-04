import { col } from "./collections";
import { getDb } from "./db";
import { ObjectId } from "mongodb";
import type { Id, HouseholdDoc, HouseholdMembershipDoc } from "@/lib/models";

function isTxnUnsupported(err: any) {
  const msg = String(err?.message || err);
  return msg.includes("Transaction numbers are only allowed");
}

/** Idempotent: returns existing active household if present; else creates a solo one. */
export async function ensureSoloHousehold(user: { _id: Id; email?: string; name?: string }) {
  const db = await getDb();

  // ⬇⬇⬇ Use db.collection with explicit types instead of `col()` (avoids keyof NameMap error)
  const memberships = db.collection<HouseholdMembershipDoc>("household_memberships" as any);
  const households  = db.collection<HouseholdDoc>("households" as any);

  // First, a fast path: most users won’t have one yet at register time.
  const already = await memberships.findOne({ userId: user._id, active: true });
  if (already) return { householdId: already.householdId };

  // Try transactional path (works on Atlas / local replica set)
  const session = db.client.startSession();
  try {
    let out: { householdId: Id } | null = null;
    try {
      await session.withTransaction(async () => {
        const again = await memberships.findOne({ userId: user._id, active: true }, { session });
        if (again) { out = { householdId: again.householdId }; return; }

        const hh: HouseholdDoc = {
          _id: new ObjectId().toString(),
          createdBy: user._id,
          createdAt: new Date(),
          updatedAt: new Date(),
          displayName: null,
          archived: false,
        };
        await households.insertOne(hh as any, { session });

        const m: HouseholdMembershipDoc = {
          _id: new ObjectId().toString(),
          householdId: hh._id,
          userId: user._id,
          role: "primary",
          active: true,
          joinedAt: new Date(),
          email: user.email,
          name: (user as any).name,
        };
        await memberships.insertOne(m as any, { session });

        out = { householdId: hh._id };
      });
      if (out) return out;
    } catch (e) {
      if (!isTxnUnsupported(e)) throw e;
      // fall through to non-transactional path
    }
  } finally {
    await session.endSession();
  }

  // Non-transaction fallback (standalone mongod):
  const again = await memberships.findOne({ userId: user._id, active: true });
  if (again) return { householdId: again.householdId };

  const hhId = new ObjectId().toString();
  const hh: HouseholdDoc = {
    _id: hhId, createdBy: user._id, createdAt: new Date(), updatedAt: new Date(), displayName: null, archived: false,
  };
  await households.insertOne(hh as any);

  try {
    const m: HouseholdMembershipDoc = {
      _id: new ObjectId().toString(),
      householdId: hhId,
      userId: user._id,
      role: "primary",
      active: true,
      joinedAt: new Date(),
      email: user.email,
      name: (user as any).name,
    };
    await memberships.insertOne(m as any);
    return { householdId: hhId };
  } catch (e: any) {
    const dup = String(e?.code) === "11000" || String(e?.message || "").includes("E11000");
    if (dup) {
      const winner = await memberships.findOne({ userId: user._id, active: true });
      if (winner) {
        await households.updateOne({ _id: hhId }, { $set: { archived: true, updatedAt: new Date() } });
        return { householdId: winner.householdId };
      }
    }
    throw e;
  }
}
