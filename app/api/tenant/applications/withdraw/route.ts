// app/api/tenant/applications/withdraw/route.ts
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AppStatus =
  | "draft"
  | "submitted"
  | "admin_screened"
  | "approved_high"
  | "terms_set"
  | "min_due"
  | "min_paid"
  | "countersigned"
  | "occupied"
  | "rejected"
  | "withdrawn";

const NOT_WITHDRAWABLE: AppStatus[] = [
  "countersigned",
  "occupied",
  "rejected",
  "withdrawn",
];

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "tenant") {
      return NextResponse.json(
        { ok: false, error: "not_authenticated" },
        { status: 401 },
      );
    }

    const db = await getDb();
    const { appId } = (await req.json().catch(() => ({}))) as {
      appId?: string;
    };

    if (!appId || typeof appId !== "string") {
      return NextResponse.json(
        { ok: false, error: "missing_appId" },
        { status: 400 },
      );
    }

    if (!ObjectId.isValid(appId)) {
      return NextResponse.json(
        { ok: false, error: "invalid_appId" },
        { status: 400 },
      );
    }

    const userId = String(user._id);
    const memberships = db.collection("household_memberships" as any);
    const applications = db.collection("applications" as any);

    // Find the tenant's active household
    const membership = await memberships.findOne({
      userId,
      active: true,
    });

    if (!membership || !membership.householdId) {
      return NextResponse.json(
        { ok: false, error: "no_active_household" },
        { status: 403 },
      );
    }

    const householdId = membership.householdId;

    // Fetch the application, ensuring it belongs to this household
    const app = await applications.findOne({
      _id: new ObjectId(appId),
      householdId,
      archived: { $ne: true },
    });

    if (!app) {
      return NextResponse.json(
        { ok: false, error: "application_not_found" },
        { status: 404 },
      );
    }

    const currentStatus = (app.status ?? app.state ?? "draft") as AppStatus;

    if (NOT_WITHDRAWABLE.includes(currentStatus)) {
      return NextResponse.json(
        {
          ok: false,
          error: "not_withdrawable",
          status: currentStatus,
        },
        { status: 409 },
      );
    }

    // Mark as withdrawn; also update updatedAt so the list re-sorts naturally
    const now = new Date();

	const updateResult = await applications.updateOne(
	  {
		_id: new ObjectId(appId),
		householdId,
	  },
	  {
		$set: {
		  status: "withdrawn",
		  state: "withdrawn",
		  updatedAt: now.toISOString().slice(0, 10),
		},
	  },
	);

	if (!updateResult.acknowledged) {
	  return NextResponse.json(
		{ ok: false, error: "update_not_acknowledged" },
		{ status: 500 },
	  );
	}

	// If nothing matched, something is off (race condition / wrong household)
	if (updateResult.matchedCount === 0) {
	  return NextResponse.json(
		{ ok: false, error: "application_not_found_for_household" },
		{ status: 404 },
	  );
	}

	// If matched but modifiedCount is 0, it was probably already withdrawn.
	// You can treat that as success.
	return NextResponse.json({
	  ok: true,
	  appId,
	  status: "withdrawn",
	});

    // Optionally you could append a timeline event here if you have a timeline array
    // e.g. $push: { timeline: { event: "tenant_withdrew", at: now, by: userId } }

    return NextResponse.json({
      ok: true,
      appId,
      status: "withdrawn",
    });
  } catch (err) {
    console.error("[tenant/applications/withdraw] error", err);
    return NextResponse.json(
      { ok: false, error: "server_error" },
      { status: 500 },
    );
  }
}
