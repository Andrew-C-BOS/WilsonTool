// app/api/tenant/household/rename/route.ts
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
function lc(s: unknown) {
  return typeof s === "string" ? s.toLowerCase() : "";
}

async function getMembershipCollections(db: any) {
  const typo = db.collection("household_memberhsips");       // legacy/typo
  const correct = db.collection("household_memberships");    // canonical
  return { typo, correct };
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
    }

    // Body validation
    const body = await req.json().catch(() => ({}));
    let name = typeof body?.displayName === "string" ? body.displayName.trim() : "";
    if (!name) {
      return NextResponse.json(
        { ok: false, error: "display_name_required" },
        { status: 400 }
      );
    }
    if (name.length > 100) {
      return NextResponse.json(
        { ok: false, error: "display_name_too_long", max: 100 },
        { status: 400 }
      );
    }

    const userEmail = lc((user as any).email);
    const userId = toStringId((user as any)._id ?? (user as any).id ?? (user as any).userId ?? userEmail);
    if (!userId) {
      return NextResponse.json({ ok: false, error: "no_user_id" }, { status: 400 });
    }

    const db = await getDb();
    const householdsCol = db.collection("households");
    const { typo: membershipsTypoCol, correct: membershipsCol } = await getMembershipCollections(db);

    // Find active membership in either collection
    const queryActive = {
      active: true,
      $or: [{ userId }, { email: userEmail }, { email: (user as any).email }],
    };

    let myMembership: WithId<Document> | null =
      (await membershipsTypoCol.findOne(queryActive)) ||
      (await membershipsCol.findOne(queryActive));

    // If no membership exists, auto-provision a new household + membership
    if (!myMembership) {
      const now = new Date();
      const newHousehold = await householdsCol.insertOne({
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
        displayName: null,
        archived: false,
      });
      const newHouseholdId = newHousehold.insertedId as ObjectId;

      await membershipsCol.insertOne({
        householdId: newHouseholdId,
        userId,
        role: "primary",
        active: true,
        joinedAt: now,
        email: userEmail || (user as any).email || "",
        name: null,
      });

      // now we can rename this freshly created household
      await householdsCol.updateOne(
        { _id: newHouseholdId },
        { $set: { displayName: name, updatedAt: new Date() } }
      );

      return NextResponse.json({ ok: true, displayName: name });
    }

    // Resolve household id (can be string or ObjectId)
    const householdIdStr = toStringId(myMembership.householdId);
    const householdIdObj = toMaybeObjectId(householdIdStr);

    // Load the household or self-heal if missing
    let household =
      (householdIdObj && (await householdsCol.findOne({ _id: householdIdObj }))) ||
      (await householdsCol.findOne({ _id: householdIdStr as any }));

    if (!household) {
      // self-heal: create a new household and rewrite membership to it
      const now = new Date();
      const newHousehold = await householdsCol.insertOne({
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
        displayName: null,
        archived: false,
      });
      const newId = newHousehold.insertedId as ObjectId;

      const srcCol =
        myMembership && (await membershipsTypoCol.findOne({ _id: myMembership._id }))
          ? membershipsTypoCol
          : membershipsCol;

      await srcCol.updateOne({ _id: myMembership._id }, { $set: { householdId: newId } });
      household = await householdsCol.findOne({ _id: newId });
    }

    // Finally, rename
    await householdsCol.updateOne(
      { _id: household!._id },
      { $set: { displayName: name, updatedAt: new Date() } }
    );

    return NextResponse.json({ ok: true, displayName: name });
  } catch (err: any) {
    console.error("[household rename] error:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
