// app/api/tenant/household/invites/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> } // ⟵ params is a Promise in newer Next
) {
  const { id: inviteId } = await ctx.params; // ⟵ await it

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  if (!ObjectId.isValid(inviteId)) {
    return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  }

  const db = await getDb();

  // NOTE: if your actual collection name is intentionally misspelled, keep it;
  // otherwise, fix the name in your DB and here to "household_memberships".
  const membershipsCol = db.collection("household_memberhsips");
  const invitesCol = db.collection("household_invites");

  const userEmail = String(user.email ?? "").toLowerCase();
  const userId = String(
    (user as any).id ?? (user as any)._id ?? (user as any).userId ?? userEmail
  );

  // Find an active membership for this user (by userId or email)
  const myMembership = await membershipsCol.findOne({
    active: true,
    $or: [{ userId }, { email: userEmail }],
  });

  if (!myMembership) {
    return NextResponse.json({ ok: false, error: "no_household" }, { status: 400 });
  }

  // Household id can be stored as string or ObjectId; support both
  const householdIdStr = String(myMembership.householdId);
  const householdIdObj = ObjectId.isValid(householdIdStr) ? new ObjectId(householdIdStr) : null;

  const matchByHousehold =
    householdIdObj
      ? { $or: [{ householdId: householdIdStr }, { householdId: householdIdObj }] }
      : { householdId: householdIdStr };

  const res = await invitesCol.updateOne(
    { _id: new ObjectId(inviteId), state: "active", ...matchByHousehold },
    { $set: { state: "revoked", revokedAt: new Date() } }
  );

  if (!res.matchedCount) {
    return NextResponse.json(
      { ok: false, error: "not_found_or_already_consumed" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
