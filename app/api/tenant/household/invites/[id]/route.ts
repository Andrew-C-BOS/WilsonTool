// app/api/tenant/household/invites/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Helper: resolve Next 15+ Promise params or plain object params
async function resolveParams(
  p: { id: string } | Promise<{ id: string }>
): Promise<{ id: string }> {
  return typeof (p as any)?.then === "function" ? await p : (p as any);
}

// Helper: build $or filter that matches either ObjectId or string forms
function idOrStringFilter(field: string, value: string) {
  const parts: any[] = [{ [field]: value }];
  if (ObjectId.isValid(value)) parts.push({ [field]: new ObjectId(value) });
  return { $or: parts };
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: { id: string } } | { params: Promise<{ id: string }> }
) {
  try {
    const { id: inviteId } = await resolveParams((ctx as any).params);

    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
    }

    if (!inviteId || (!ObjectId.isValid(inviteId) && inviteId.length < 8)) {
      // allow non-ObjectId strings, but guard against obvious garbage
      return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
    }

    const db = await getDb();
    // Note: keep legacy misspelling if that’s what exists in your DB
    const membershipsNew = db.collection("household_memberships");
    const membershipsLegacy = db.collection("household_memberhsips");
    const invitesCol = db.collection("household_invites");

    const userEmail = String(user.email ?? "").toLowerCase();
    const userId =
      String((user as any).id ?? (user as any)._id ?? (user as any).userId ?? userEmail);

    // Find an active membership for this user (check both collections)
    const myMembership =
      (await membershipsNew.findOne({ active: true, $or: [{ userId }, { email: userEmail }] })) ||
      (await membershipsLegacy.findOne({
        active: true,
        $or: [{ userId }, { email: userEmail }],
      }));

    if (!myMembership) {
      return NextResponse.json({ ok: false, error: "no_household" }, { status: 400 });
    }

    // Household may be stored as string or ObjectId
    const householdIdStr = String(myMembership.householdId);
    const matchByHousehold = idOrStringFilter("householdId", householdIdStr);

    // Invite _id may be string or ObjectId — support both
    const matchByInviteId = idOrStringFilter("_id", inviteId);

    const res = await invitesCol.updateOne(
      {
        ...matchByInviteId,
        ...matchByHousehold,
        state: "active",
      },
      {
        $set: { state: "revoked", revokedAt: new Date() },
      }
    );

    if (!res.matchedCount) {
      return NextResponse.json(
        { ok: false, error: "not_found_or_already_consumed" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, modified: res.modifiedCount });
  } catch (e: any) {
    console.error("[household.invites.delete] error", { message: e?.message, stack: e?.stack });
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
