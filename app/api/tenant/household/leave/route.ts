// app/api/tenant/household/leave/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toStringId(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (v instanceof ObjectId) return v.toHexString();
  return String(v);
}
function toMaybeObjectId(s: string) {
  return ObjectId.isValid(s) ? new ObjectId(s) : null;
}

// Try likely collection names, return the first that exists.
async function getMembershipsCol(db: any) {
  const candidates = [
    "household_memberhsips",   // legacy typo
    "households_memberhsips",  // legacy + plural
    "household_memberships",   // corrected
    "households_memberships",  // corrected + plural
    "households_membership",   // seen in your samples
  ];
  const names = new Set((await db.listCollections().toArray()).map((c: any) => c.name));
  for (const name of candidates) if (names.has(name)) return db.collection(name);
  return db.collection("households_membership");
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
    }

    const db = await getDb();
    const membershipsCol = await getMembershipsCol(db);
    const householdsCol = db.collection("households");

    // Optional: allow client to specify which household to leave, otherwise leave the active one.
    const body = await req.json().catch(() => ({} as any));
    const householdIdParam: string | null = body?.householdId ? String(body.householdId) : null;

    const userEmail = String((user as any)?.email ?? "").toLowerCase();
    const userId =
      String((user as any).id ?? (user as any)._id ?? (user as any).userId ?? userEmail);

    // 1) Find active membership row for this user (optionally constrained to householdId)
    const activeFilter: any = {
      active: true,
      $or: [{ userId }, { email: userEmail }],
    };
    if (householdIdParam) {
      const hidObj = toMaybeObjectId(householdIdParam);
      activeFilter.$and = [
        { $or: [{ householdId: householdIdParam }, ...(hidObj ? [{ householdId: hidObj as any }] : [])] },
      ];
    }

    const myMembership = await membershipsCol.findOne(activeFilter);
    if (!myMembership) {
      return NextResponse.json({ ok: false, error: "no_active_membership" }, { status: 400 });
    }

    const now = new Date();
    const householdIdStr = toStringId(myMembership.householdId);
    const hidObj = toMaybeObjectId(householdIdStr);

    // 2) Soft-leave in the memberships collection
    await membershipsCol.updateOne(
      {
        $and: [
          { $or: [{ userId }, { email: userEmail }] },
          { $or: [{ householdId: householdIdStr }, ...(hidObj ? [{ householdId: hidObj as any }] : [])] },
        ],
        active: true,
      },
      { $set: { active: false, leftAt: now, updatedAt: now } }
    );

    // 3) Best-effort: if legacy households.members exists, mark that row inactive too
    await householdsCol.updateOne(
      { _id: (hidObj ?? (householdIdStr as any)), "members": { $exists: true } },
      {
        $set: {
          "members.$[m].active": false,
          "members.$[m].leftAt": now,
        },
      },
      {
        arrayFilters: [
          {
            $or: [
              { "m.userId": userId },
              ...(toMaybeObjectId(userId) ? [{ "m.userId": toMaybeObjectId(userId) as any }] : []),
              { "m.email": userEmail },
            ],
          },
        ],
      }
    );

    // 4) Optionally: TODO — if you enforce ownership/primary semantics, you could:
    //    - prevent the last member from leaving without deleting/archiving the household
    //    - or transfer "primary" to another member; skipped here by design to keep flow simple.

    return NextResponse.json({ ok: true, householdId: householdIdStr, leftAt: now.toISOString() });
  } catch (e: any) {
    console.error("[household.leave] error", { message: e?.message, stack: e?.stack });
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
