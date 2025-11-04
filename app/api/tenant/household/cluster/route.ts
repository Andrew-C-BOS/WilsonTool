// app/api/tenant/household/cluster/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
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

function toMaybeObjectId(s: string): ObjectId | null {
  return ObjectId.isValid(s) ? new ObjectId(s) : null;
}

function inferState(m: any): "invited" | "active" | "left" {
  if (m.active === true) return "active";
  if (m.active === false && !m.name) return "invited";
  return "left";
}

export async function GET(req: NextRequest) {
  try {
    // 1) real auth, no querystring hacks
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
    }

    const userEmail = String(user.email ?? "").toLowerCase();
    const userId =
      toStringId((user as any).id) ||
      toStringId((user as any)._id) ||
      toStringId((user as any).userId) ||
      userEmail;

    const db = await getDb();
    // NOTE: you said this collection is spelled like this in your DB
    const membershipsCol = db.collection("household_memberhsips");
    const householdsCol = db.collection("households");

    // 2) find the caller’s membership by userId or email, while active
    const myMembership = await membershipsCol.findOne({
      active: true,
      $or: [
        { userId }, // string user id
        { email: userEmail },
        { email: (user as any).email }, // belt-and-suspenders if historical rows weren’t lowercased
      ],
    });

    // If no membership yet, return an empty cluster stub the UI can render
    if (!myMembership) {
      return NextResponse.json({
        ok: true,
        cluster: {
          householdId: "",
          displayName: "Untitled household",
          inviteCode: "",
          inviteUrl: "",
          members: [] as any[],
          pendingRequests: [] as any[],
        },
      });
    }

    const householdIdStr = toStringId(myMembership.householdId);
    const householdIdObj = toMaybeObjectId(householdIdStr);

    // 3) load household by _id, trying ObjectId first, then string
    const household =
      (householdIdObj &&
        (await householdsCol.findOne({ _id: householdIdObj }))) ||
      (await householdsCol.findOne({ _id: householdIdStr as any }));

    if (!household) {
      return NextResponse.json({ ok: false, error: "household_not_found" }, { status: 404 });
    }

    // 4) fetch all memberships for this household, include invited/left as needed
    const allMemberships = await membershipsCol
      .find({
        $or: [
          { householdId: householdIdStr },
          // if some rows stored householdId as ObjectId, include those too
          ...(householdIdObj ? [{ householdId: householdIdObj as any }] : []),
        ],
        // if you want only current+invited, include both true/false; adjust if you track explicit states
        active: { $in: [true, false] },
      })
      .toArray();

    const members = allMemberships.map((m) => ({
      id: toStringId(m.userId),
      name: m.name ?? null,
      email: m.email ?? "",
      role: (m.role ?? "co_applicant") as "primary" | "co_applicant" | "cosigner",
      state: inferState(m),
    }));

    // 5) pending requests — wire up your real source when you have it
    const pendingRequests: {
      id: string;
      email: string;
      requestedRole: "primary" | "co_applicant" | "cosigner";
      at: string;
    }[] = [];

    // 6) invite link fields, if present
    const inviteCode = household.inviteCode ?? "";
    const origin = new URL(req.url).origin;
    const inviteUrl = inviteCode ? `${origin}/join/${inviteCode}` : "";

    const cluster = {
      householdId: householdIdStr,
      displayName: household.displayName ?? null,
      inviteCode,
      inviteUrl,
      members,
      pendingRequests,
    };

    return NextResponse.json({ ok: true, cluster });
  } catch (err: any) {
    console.error("[household cluster] error:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
