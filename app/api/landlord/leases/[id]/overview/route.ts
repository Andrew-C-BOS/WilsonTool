// app/api/landlord/leases/[id]/overview/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { ObjectId } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ─────────────────────────────────────────────────────────────
   Tiny helpers
───────────────────────────────────────────────────────────── */
const toStringId = (v: any) => {
  try {
    return typeof v === "string" ? v : v?.toHexString?.() ?? String(v);
  } catch {
    return String(v);
  }
};

const idEq = (field: string, raw: any) => {
  const s = String(raw ?? "");
  if (ObjectId.isValid(s)) {
    const oid = new ObjectId(s);
    return { $or: [{ [field]: oid }, { [field]: s }] } as any;
  }
  return { [field]: s } as any;
};

function buildingLabel(b?: any | null) {
  if (!b) return "Unknown address";
  const line1 = (b.addressLine1 || "").trim();
  const line2 = (b.addressLine2 || "").trim();
  const citySt = [b.city, b.state].filter(Boolean).join(", ");
  const zip = (b.postalCode || "").trim();
  return [line1, line2, citySt, zip].filter(Boolean).join(" • ");
}

function householdNameFromApp(app?: any | null): string | null {
  if (!app) return null;
  const pri = app?.answers?.primary?.q_name || app?.answers?.primary?.name;
  if (pri && String(pri).trim()) return String(pri).trim();

  const abm = app?.answersByMember;
  if (abm && typeof abm === "object") {
    const roles = ["primary", "co_applicant", "cosigner"];
    const names: string[] = [];
    for (const bucket of Object.values<any>(abm)) {
      const nm = bucket?.answers?.q_name || bucket?.answers?.name;
      const role = String(bucket?.role || "").toLowerCase();
      if (nm && roles.includes(role)) names.push(String(nm));
    }
    const uniq = Array.from(
      new Set(names.map((s) => s.trim()).filter(Boolean))
    );
    if (uniq.length) return uniq.join(" & ");
  }

  const members = Array.isArray(app?.members) ? app.members : [];
  const mnames = members
    .map((m: any) => String(m?.name || ""))
    .filter((s: string) => s.trim());
  if (mnames.length) return mnames.join(" & ");

  const anyEmail =
    (abm && Object.values<any>(abm).map((b) => b?.email).find(Boolean)) ||
    members.map((m: any) => m?.email).find(Boolean) ||
    app?.email;
  if (anyEmail) {
    const front = String(anyEmail).split("@")[0];
    if (front) return front;
  }

  return null;
}

/* ─────────────────────────────────────────────────────────────
   GET /api/landlord/leases/[id]/overview
   Returns: { ok, lease: {...}, buildingLabel, householdName }
───────────────────────────────────────────────────────────── */

type RouteParams = { id: string };

export async function GET(
  req: NextRequest,
  context: { params: Promise<RouteParams> }
) {
  const { id } = await context.params; // ← match Next's expected type
  const leaseId = id ? String(id) : "";

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 }
    );
  }

  if (!leaseId) {
    return NextResponse.json(
      { ok: false, error: "missing_lease_id" },
      { status: 400 }
    );
  }

  const firmIdParam = new URL(req.url).searchParams.get("firmId") || undefined;

  const db = await getDb();

  // Load lease
  const lease = await db.collection("unit_leases").findOne(idEq("_id", leaseId));
  if (!lease) {
    return NextResponse.json(
      { ok: false, error: "lease_not_found" },
      { status: 404 }
    );
  }

  // Optional firm check if firmId passed
  if (firmIdParam && String(lease.firmId) !== String(firmIdParam)) {
    return NextResponse.json(
      { ok: false, error: "wrong_firm" },
      { status: 403 }
    );
  }

  // Load application minimally for household name
  const appId = toStringId(lease.appId);
  let app: any = null;
  if (appId) {
    app = await db.collection("applications").findOne(idEq("_id", appId), {
      projection: { _id: 1, answers: 1, answersByMember: 1, members: 1 },
    });
  }

  const payload = {
    ...lease,
    buildingLabel: buildingLabel(lease.building),
    householdName: householdNameFromApp(app),
  };

  return NextResponse.json({ ok: true, lease: payload });
}
