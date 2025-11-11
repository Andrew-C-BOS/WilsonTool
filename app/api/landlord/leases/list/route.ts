// app/api/landlord/leases/list/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ─────────────────────────────────────────────────────────────
   Tiny helpers
───────────────────────────────────────────────────────────── */
function toStringId(v: any) {
  try { return typeof v === "string" ? v : v?.toHexString?.() ?? String(v); }
  catch { return String(v); }
}
function canonAddr(b: any) {
  if (!b) return "";
  const parts = [
    (b.addressLine1 || "").trim(),
    (b.city || "").trim(),
    (b.state || "").trim(),
    (b.postalCode || "").trim(),
    (b.country || "").trim(),
  ].filter(Boolean);
  return parts.join(" · ").toUpperCase();
}
function labelAddr(b: any) {
  if (!b) return "Unknown address";
  const line1 = (b.addressLine1 || "").trim();
  const city = (b.city || "").trim();
  const st = (b.state || "").trim();
  const zip = (b.postalCode || "").trim();
  const parts = [line1, [city, st].filter(Boolean).join(", "), zip].filter(Boolean);
  return parts.join(" • ");
}
function guessHouseholdNameFromApp(app: any): string | null {
  // Try structured answers first (primary q_name), then members, then emails.
  const a = app?.answers || {};
  const primaryName = a?.primary?.q_name || a?.primary?.name;
  if (primaryName && String(primaryName).trim()) return String(primaryName).trim();

  const abm = app?.answersByMember;
  if (abm && typeof abm === "object") {
    // Prefer primary -> co_applicant -> cosigner, then join unique names
    const roles = ["primary", "co_applicant", "cosigner"];
    const names: string[] = [];
    for (const [_, bucket] of Object.entries<any>(abm)) {
      const nm = bucket?.answers?.q_name || bucket?.answers?.name;
      const role = String(bucket?.role || "").toLowerCase();
      if (nm && roles.includes(role)) names.push(String(nm));
    }
    const uniq = Array.from(new Set(names.map((s) => s.trim()).filter(Boolean)));
    if (uniq.length) return uniq.join(" & ");
  }

  // Members array
  const mems = Array.isArray(app?.members) ? app.members : [];
  const memNames = mems.map((m: any) => String(m?.name || "")).filter((s: string) => s.trim());
  if (memNames.length) return memNames.join(" & ");

  // Last resort: email front part
  const anyEmail =
    (abm && Object.values<any>(abm).map((b) => b?.email).find(Boolean)) ||
    (mems.map((m: any) => m?.email).find(Boolean)) ||
    app?.email;
  if (anyEmail) {
    const front = String(anyEmail).split("@")[0];
    if (front) return front;
  }

  return null;
}

/* ─────────────────────────────────────────────────────────────
   GET /api/landlord/leases/list
   Adds: buildingKey, buildingLabel, householdName
───────────────────────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const url = new URL(req.url);
  let firmId = url.searchParams.get("firmId") || "";
  const status = url.searchParams.get("status") || ""; // scheduled|active|ended|canceled|all
  const limit = Math.min(Number(url.searchParams.get("limit") || 100), 200);

  const db = await getDb();

  // Infer firmId when not provided
  if (!firmId) {
    const fms = db.collection("firm_memberships");
    const uid = toStringId((user as any)._id ?? (user as any).id ?? (user as any).userId ?? (user as any).email);
    const { ObjectId } = await import("mongodb");
    const uidOid = ObjectId.isValid(uid) ? new ObjectId(uid) : null;

    const memberships = await fms
      .find(
        { active: true, $or: uidOid ? [{ userId: uid }, { userId: uidOid }] : [{ userId: uid }] },
        { projection: { firmId: 1 }, limit: 10 }
      )
      .toArray();

    const uniqFirms = Array.from(new Set(memberships.map((m: any) => String(m.firmId))));
    if (uniqFirms.length === 0) {
      return NextResponse.json({ ok: false, error: "no_firm_membership" }, { status: 400 });
    }
    if (uniqFirms.length > 1) {
      return NextResponse.json({ ok: false, error: "multiple_firms", firms: uniqFirms }, { status: 400 });
    }
    firmId = uniqFirms[0];
  }

  const q: any = { firmId };
  if (status && status !== "all") q.status = status;

  const leases = await db
    .collection("unit_leases")
    .find(q, { projection: { meta: 0 } })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray();

  // Enrich with application-derived household names in one batch
  const appIds = Array.from(new Set(leases.map((l: any) => toStringId(l.appId)).filter(Boolean)));
  const appsById = new Map<string, any>();
  if (appIds.length) {
    const { ObjectId } = await import("mongodb");
    const ors: any[] = appIds.map((id) =>
      ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id }
    );
    const apps = await db
      .collection("applications")
      .find({ $or: ors }, { projection: { _id: 1, answers: 1, answersByMember: 1, members: 1, householdId: 1 } })
      .toArray();
    for (const a of apps) appsById.set(toStringId(a._id), a);
  }

  const enriched = leases.map((l: any) => {
    const app = appsById.get(toStringId(l.appId));
    const householdName =
      guessHouseholdNameFromApp(app) ||
      (l.householdId ? `Household ${String(l.householdId).slice(-6)}` : "Household");

    const buildingKey = canonAddr(l.building);
    const buildingLabel = labelAddr(l.building);

    return {
      ...l,
      buildingKey,
      buildingLabel,
      householdName,
    };
  });

  return NextResponse.json({ ok: true, leases: enriched, nextCursor: null, firmId });
}
