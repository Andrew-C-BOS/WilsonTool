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

  // Use explicit collections to avoid NameMap typing issues
  const memberships = db.collection<HouseholdMembershipDoc>("household_memberships" as any);
  const households  = db.collection<HouseholdDoc>("households" as any);

  const userId = String(user._id);
  const emailLC = (user.email ?? "").toLowerCase() || undefined;
  const now = new Date();

  // Pre-generate a household id that we'll use only if we INSERT (i.e., we "win" the upsert)
  const proposedHid = new ObjectId().toString();

  // Atomic claim: if an active membership exists, we get it; otherwise we insert one with our proposed household id.
  // This collapses "check then insert" into a single round trip and prevents two winners.
let m: HouseholdMembershipDoc | null = null;

try {
  const result = await memberships.findOneAndUpdate(
    {
      active: true,
      $or: [{ userId }, ...(emailLC ? [{ email: emailLC }] as any[] : [])],
    },
    {
      $setOnInsert: {
        _id: new ObjectId().toString(),
        householdId: proposedHid,
        userId,
        role: "primary",
        active: true,
        joinedAt: now,
        email: emailLC,
        name: (user as any).name ?? null,
      } satisfies Partial<HouseholdMembershipDoc>,
      $set: { updatedAt: now } as any,
    },
    { upsert: true, returnDocument: "after" }
  );

  // result is already the doc (or null)
  m = (result as any) ?? null;
} catch (e: any) {
  // If a unique index rejects the second concurrent writer, re-read the winner.
  const isDup =
    e?.code === 11000 || String(e?.message || "").includes("E11000");
  if (!isDup) throw e;

  m = (await memberships.findOne({
    active: true,
    $or: [{ userId }, ...(emailLC ? [{ email: emailLC }] as any[] : [])],
  })) as any;
}

  if (!m) {
    // Extremely rare: retry a read; if still missing, bail.
    m = (await memberships.findOne({
      active: true,
      $or: [{ userId }, ...(emailLC ? [{ email: emailLC }] as any[] : [])],
    })) as any;
    if (!m) throw new Error("failed_to_establish_household");
  }

  const hid = String(m.householdId);

  // Ensure the households doc exists (idempotent). If another request created it, this is a no-op.
  await households.updateOne(
    { _id: hid as any }, // your HouseholdDoc._id is a string in your codebase
    {
      $setOnInsert: {
        _id: hid as any,
        createdBy: userId,
        createdAt: now,
        displayName: null,
        archived: false,
      } satisfies Partial<HouseholdDoc>,
      $set: { updatedAt: now } as any,
    },
    { upsert: true }
  );

  return { householdId: hid as Id };
}