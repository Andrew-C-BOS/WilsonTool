// app/api/tenant/household/cluster/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ObjectId, WithId, Document } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------- small helpers ---------- */
function toStringId(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (v instanceof ObjectId) return v.toHexString();
  return String(v);
}
function toMaybeObjectId(s: string | undefined | null): ObjectId | null {
  if (!s) return null;
  return ObjectId.isValid(s) ? new ObjectId(s) : null;
}
function inferState(m: any): "invited" | "active" | "left" {
  if (m.active === true) return "active";
  if (m.active === false && !m.name) return "invited";
  return "left";
}
function lc(s: unknown) {
  return typeof s === "string" ? s.toLowerCase() : "";
}

/**
 * Try the legacy-typo collection name first (to read existing data),
 * then fall back to the correct name. For writes, prefer the correct name.
 */
async function getMembershipCollections(db: any) {
  const typo = db.collection("household_memberhsips");       // legacy/typo
  const correct = db.collection("household_memberships");    // canonical
  return { typo, correct };
}

export async function GET(req: NextRequest) {
  try {
    // 1) Auth
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
    }

    const userEmail = lc((user as any).email);
    const userId = toStringId((user as any)._id ?? (user as any).id ?? (user as any).userId ?? userEmail);
    if (!userId) {
      return NextResponse.json({ ok: false, error: "no_user_id" }, { status: 400 });
    }

    const db = await getDb();
    const householdsCol = db.collection("households");
    const { typo: membershipsTypoCol, correct: membershipsCol } = await getMembershipCollections(db);

    // 2) Find active membership in either collection
    const queryActive = {
      active: true,
      $or: [{ userId }, { email: userEmail }, { email: (user as any).email }],
    };

    let myMembership: WithId<Document> | null =
      (await membershipsTypoCol.findOne(queryActive)) ||
      (await membershipsCol.findOne(queryActive));

    // 2a) If no membership at all → provision household + membership
    if (!myMembership) {
      const now = new Date();

      // Create new household (ObjectId _id)
      const householdInsert = await householdsCol.insertOne({
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
        displayName: null,
        archived: false,
      });
      const newHouseholdId = householdInsert.insertedId as ObjectId;

      // Create membership in the canonical collection
      await membershipsCol.insertOne({
        householdId: newHouseholdId, // store as ObjectId going forward
        userId,
        role: "primary",
        active: true,
        joinedAt: now,
        email: userEmail || (user as any).email || "",
        name: null,
      });

      // Build response cluster with the single member (self)
      const origin = new URL(req.url).origin;
      const cluster = {
        householdId: toStringId(newHouseholdId),
        displayName: null,
        inviteCode: "",
        inviteUrl: "",
        members: [
          {
            id: userId,
            name: null,
            email: userEmail || (user as any).email || "",
            role: "primary" as const,
            state: "active" as const,
          },
        ],
        pendingRequests: [] as any[],
      };

      return NextResponse.json({ ok: true, cluster });
    }

    // 3) Resolve household id (rows may have stored string or ObjectId)
    const householdIdStr = toStringId(myMembership.householdId);
    const householdIdObj = toMaybeObjectId(householdIdStr);

    // 4) Load household document; if missing, self-heal by creating a new one and rewiring membership
    let household =
      (householdIdObj && (await householdsCol.findOne({ _id: householdIdObj }))) ||
      (await householdsCol.findOne({ _id: householdIdStr as any }));

    if (!household) {
      const now = new Date();
      const newHouseholdInsert = await householdsCol.insertOne({
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
        displayName: null,
        archived: false,
      });
      const newId = newHouseholdInsert.insertedId as ObjectId;

      // Update whichever collection this membership came from
      const srcCol =
        myMembership && (await membershipsTypoCol.findOne({ _id: myMembership._id }))
          ? membershipsTypoCol
          : membershipsCol;

      await srcCol.updateOne(
        { _id: myMembership._id },
        { $set: { householdId: newId } }
      );

      household = await householdsCol.findOne({ _id: newId });
    }

    // 5) Fetch all memberships for this household (from BOTH collections)
    const householdMatch = [
      { householdId: toStringId(household._id) },
      { householdId: household._id }, // ObjectId form
    ];

    const [membersA, membersB] = await Promise.all([
      membershipsTypoCol
        .find({ $or: householdMatch, active: { $in: [true, false] } })
        .toArray(),
      membershipsCol
        .find({ $or: householdMatch, active: { $in: [true, false] } })
        .toArray(),
    ]);

    // Merge + de-dupe on userId/email
    const seen = new Set<string>();
    const merged = [...membersA, ...membersB].filter((m) => {
      const key = (m.userId ? String(m.userId) : "") + "|" + lc(m.email);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const members = merged.map((m) => ({
      id: toStringId(m.userId),
      name: m.name ?? null,
      email: m.email ?? "",
      role: (m.role ?? "co_applicant") as "primary" | "co_applicant" | "cosigner",
      state: inferState(m),
    }));

    // 6) Guarantee the caller is present in the members list (defensive)
    if (!members.some((m) => m.id === userId || lc(m.email) === userEmail)) {
      members.unshift({
        id: userId,
        name: null,
        email: userEmail || (user as any).email || "",
        role: "primary",
        state: "active",
      });
    }

    // 7) Invite link (optional fields, safe defaults)
    const inviteCode = household.inviteCode ?? "";
    const origin = new URL(req.url).origin;
    const inviteUrl = inviteCode ? `${origin}/join/${inviteCode}` : "";

    const cluster = {
      householdId: toStringId(household._id),
      displayName: household.displayName ?? null,
      inviteCode,
      inviteUrl,
      members,
      pendingRequests: [] as any[], // wire real source when available
    };

    return NextResponse.json({ ok: true, cluster });
  } catch (err: any) {
    console.error("[household cluster] error:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
