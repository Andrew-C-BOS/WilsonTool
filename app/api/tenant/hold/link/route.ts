// app/api/tenant/hold/link/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------------- helpers ---------------- */
function toStringId(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  try {
    return v?.toHexString ? v.toHexString() : String(v);
  } catch {
    return String(v);
  }
}
const isHex24 = (s: string) => /^[0-9a-fA-F]{24}$/.test(s);

/** Try to locate the user's household via any of the common membership collection names. */
async function resolveMyHouseholdId(db: any, user: any): Promise<string | null> {
  const names = [
    "households_membership",
    "household_memberhsips",
    "households_memberhsips",
    "household_memberships",
    "households_memberships",
  ];
  const existing = new Set((await db.listCollections().toArray()).map((c: any) => c.name));
  let colName = "households_membership";
  for (const n of names) if (existing.has(n)) { colName = n; break; }
  const memberships = db.collection(colName);

  const emailLc = String(user?.email ?? "").toLowerCase();
  const uid = toStringId((user as any).id ?? (user as any)._id ?? (user as any).userId ?? emailLc);

  const row = await memberships
    .find({ $or: [{ userId: uid }, { email: emailLc }, { email: (user as any).email }] })
    .sort({ active: -1, joinedAt: -1 })
    .limit(1)
    .next();

  return row ? toStringId(row.householdId) : null;
}

/* ---------------- GET /api/tenant/hold/link?appId=... ---------------- */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  const appId = url.searchParams.get("appId") || "";
  if (!appId) {
    return NextResponse.json({ ok: false, error: "missing_appId" }, { status: 400 });
  }

  const db = await getDb();
  const { ObjectId } = await import("mongodb");

  // 1) Load application with minimal projection
  const appFilter = isHex24(appId) ? { _id: new ObjectId(appId) } : ({ _id: appId } as any);
  const app = await db.collection("applications").findOne(appFilter, {
    projection: { _id: 1, householdId: 1, formId: 1, status: 1 },
  });

  if (!app) {
    return NextResponse.json({ ok: false, error: "application_not_found" }, { status: 404 });
  }

  // 2) Authorize tenant: application household must match user's household
  const myHouseholdId = await resolveMyHouseholdId(db, user);
  const appHousehold = app.householdId ? String(app.householdId) : "";
  if (!myHouseholdId || !appHousehold || myHouseholdId !== appHousehold) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // 3) Find the most recent pending/paid hold for this application
  const holds = db.collection("holding_requests");
  const active = await holds
    .find(
      { appId: String(app._id), status: { $in: ["pending", "paid"] } },
      { projection: { token: 1, status: 1, updatedAt: 1, createdAt: 1 } }
    )
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(1)
    .next();

  if (!active || !active.token) {
    return NextResponse.json({ ok: false, error: "no_active_hold" }, { status: 404 });
  }

  // 4) Return the tenant payment page path
  const href = `/tenant/hold/${encodeURIComponent(active.token)}`;
  return NextResponse.json({ ok: true, url: href, status: active.status });
}
