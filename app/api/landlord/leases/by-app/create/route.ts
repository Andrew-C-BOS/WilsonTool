// app/api/landlord/unit_leases/by-app/create/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { ObjectId } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------------- utils ---------------- */
function toStringId(v: any) {
  if (!v) return "";
  if (typeof v === "string") return v;
  try {
    return v?.toHexString ? v.toHexString() : String(v);
  } catch {
    return String(v);
  }
}
function newLeaseId() {
  return (
    "lease_" +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}
function idEq(field: string, raw: any) {
  if (ObjectId.isValid(String(raw))) {
    const oid = new ObjectId(String(raw));
    return { $or: [{ [field]: oid }, { [field]: String(raw) }] } as any;
  }
  return { [field]: String(raw) } as any;
}
function isYYYYMMDD(s: string | null | undefined) {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function at10Z(dateYmd: string) {
  // Build a 10:00:00.000Z timestamp for a YYYY-MM-DD
  const [y, m, d] = dateYmd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 10, 0, 0, 0));
}
function addMonthsSameDay(ymd: string, months: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/* ---------- minimal firm resolution (keeps your behavior) ---------- */
function buildUserMatch(user: any) {
  const emailLc = String(user?.email || "").toLowerCase();
  const uidStr = String(user?._id || user?.id || user?.userId || "");
  const uidObj = ObjectId.isValid(uidStr) ? new ObjectId(uidStr) : null;

  const or: any[] = [];
  if (uidObj) or.push({ userId: uidObj });
  if (uidStr) or.push({ userId: uidStr });
  if (emailLc) or.push({ email: emailLc }, { email: user?.email });
  return { or, debug: { uidStr, uidObj: !!uidObj, emailLc } };
}

async function loadFirmDoc(db: any, firmId: string) {
  const proj = { _id: 1, name: 1, slug: 1 };
  const a = await db.collection("FirmDoc").findOne(idEq("_id", firmId), { projection: proj });
  if (a) return a;
  const b = await db.collection("firms").findOne?.(idEq("_id", firmId), { projection: proj }).catch?.(() => null);
  return b || null;
}

async function resolveFirmForUser(
  db: any,
  user: any,
  opts: { firmIdParam?: string; appId?: string; debug?: boolean }
) {
  const memCol = db.collection("firm_memberships");
  const { or: userOr, debug: udbg } = buildUserMatch(user);

  const mems = await memCol.find({ active: true, $or: userOr }, { projection: { firmId: 1 } }).toArray();
  const membershipFirmIds = new Set<string>(mems.map((m: any) => String(m.firmId)));
  const hasMembership = (fid: string) => membershipFirmIds.has(String(fid));

  if (opts.firmIdParam) {
    const ok = hasMembership(opts.firmIdParam);
    const firmDoc = ok ? await loadFirmDoc(db, String(opts.firmIdParam)) : null;
    return {
      ok,
      firmId: ok && firmDoc ? toStringId(firmDoc._id) : null,
      reason: ok ? "param_ok" : "param_no_membership",
      debug: opts.debug ? { usedCollection: memCol.collectionName, membershipFirmIds: [...membershipFirmIds], ...udbg } : undefined,
    };
  }

  // derive from application → form
  let derivedFirmId: string | null = null;
  if (opts.appId) {
    const apps = db.collection("applications");
    const forms = db.collection("application_forms");
    const app = await apps.findOne(idEq("_id", opts.appId), { projection: { firmId: 1, formId: 1 } });
    if (app?.firmId) derivedFirmId = String(app.firmId);
    else if (app?.formId) {
      const form = await forms.findOne(idEq("_id", app.formId), { projection: { firmId: 1 } });
      if (form?.firmId) derivedFirmId = String(form.firmId);
    }
  }

  if (derivedFirmId) {
    const ok = hasMembership(derivedFirmId);
    const firmDoc = ok ? await loadFirmDoc(db, derivedFirmId) : null;
    return {
      ok,
      firmId: ok && firmDoc ? toStringId(firmDoc._id) : null,
      reason: ok ? "derived_ok" : "derived_no_membership",
      debug: opts.debug
        ? { usedCollection: memCol.collectionName, membershipFirmIds: [...membershipFirmIds], derivedFirmId, ...udbg }
        : undefined,
    };
  }

  if (membershipFirmIds.size === 1) {
    const onlyFirmId = [...membershipFirmIds][0];
    const firmDoc = await loadFirmDoc(db, onlyFirmId);
    return {
      ok: !!firmDoc,
      firmId: firmDoc ? toStringId(firmDoc._id) : null,
      reason: "single_membership_fallback",
      debug: opts.debug ? { usedCollection: memCol.collectionName, membershipFirmIds: [...membershipFirmIds], ...udbg } : undefined,
    };
  }

  return {
    ok: false,
    firmId: null,
    reason: membershipFirmIds.size === 0 ? "no_memberships" : "ambiguous_memberships",
    debug: opts.debug ? { usedCollection: memCol.collectionName, membershipFirmIds: [...membershipFirmIds], ...udbg } : undefined,
  };
}

/* ---------------- checklist seed ---------------- */
function buildDefaultChecklist(moveInYmd: string | null, createdAt: Date) {
  // In your example, most items are due the day before move-in at 10:00Z,
  // while the payment items are due ~creation time. We mirror that behavior.
  const baseDue =
    moveInYmd && isYYYYMMDD(moveInYmd)
      ? new Date(at10Z(moveInYmd).getTime() - 24 * 60 * 60 * 1000) // day before at 10:00Z
      : createdAt;

  const asIso = (d: Date | null) => (d ? d.toISOString() : null);

  const items = [
    { key: "id_upload",        label: "Upload government ID",           dueAt: baseDue, completedAt: null, notes: null },
    { key: "renter_insurance", label: "Provide renter’s insurance",     dueAt: baseDue, completedAt: null, notes: null },
    { key: "schedule_walkthrough", label: "Schedule walkthrough",       dueAt: baseDue, completedAt: null, notes: null },
    { key: "keys",             label: "Pick up keys / access fobs",     dueAt: baseDue, completedAt: null, notes: null },
    { key: "rent_autopay",     label: "Set up rent autopay",            dueAt: baseDue, completedAt: null, notes: null },
    // Payment items due at creation time (matches your sample semantics)
    { key: "pay_upfront",      label: "Pay remaining up-front charges", dueAt: createdAt, completedAt: null, notes: null },
    { key: "pay_deposit",      label: "Pay security deposit",           dueAt: createdAt, completedAt: null, notes: null },
  ];

  return items.map((it) => ({
    key: it.key,
    label: it.label,
    dueAt: asIso(it.dueAt),
    completedAt: asIso(it.completedAt),
    notes: it.notes,
  }));
}

/* ---------------- handler ---------------- */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const url = new URL(req.url);
  const debugMode = url.searchParams.get("debug") === "1";

  const db = await getDb();
  const body = await req.json().catch(() => ({}));

  const appId = String(body?.appId || "");
  const firmIdInput = body?.firmId ? String(body.firmId) : undefined;

  if (!appId) return NextResponse.json({ ok: false, error: "missing_appId" }, { status: 400 });

  // Resolve firm and authorize
  const resolved = await resolveFirmForUser(db, user, { firmIdParam: firmIdInput, appId, debug: debugMode });
  if (!resolved.ok || !resolved.firmId) {
    return NextResponse.json(
      { ok: false, error: "not_in_firm", reason: resolved.reason, ...(resolved.debug ? { debug: resolved.debug } : {}) },
      { status: 403 }
    );
  }
  const firmId = resolved.firmId;

  const apps = db.collection("applications");
  const unitLeases = db.collection("unit_leases");

  // Idempotency: if a lease for this app already exists, return it.
  const existing = await unitLeases.findOne(idEq("appId", appId));
  if (existing) {
    return NextResponse.json({ ok: true, lease: existing, idempotent: true });
  }

  // Load application + (optional) paymentPlan to prefill fields
  const app = await apps.findOne(idEq("_id", appId));
  if (!app) return NextResponse.json({ ok: false, error: "app_not_found" }, { status: 404 });

  const now = new Date();

  // Building / Unit from body -> fallback to application
  const building = {
    addressLine1: String(body?.building?.addressLine1 || app?.building?.addressLine1 || ""),
    addressLine2: body?.building?.addressLine2 ?? app?.building?.addressLine2 ?? null,
    city: String(body?.building?.city || app?.building?.city || ""),
    state: String((body?.building?.state || app?.building?.state || "")).toUpperCase(),
    postalCode: String(body?.building?.postalCode || app?.building?.postalCode || ""),
    country: String(body?.building?.country || app?.building?.country || "US"),
  };

  const unitNumber = String(body?.unitNumber ?? app?.unit?.unitNumber ?? "") || null;

  // Prefer server plan; fallback to body
  const plan = app?.paymentPlan || null;
  const monthlyRent = Number(
    body?.monthlyRent ??
      plan?.monthlyRentCents ??
      app?.protoLease?.monthlyRent ??
      0
  );
  const moveInDate =
    String(body?.moveInDate || plan?.startDate || app?.protoLease?.moveInDate || "") || null;

  // Compute moveOut if not provided: same-day + termMonths (common in your samples)
  let moveOutDate: string | null = body?.moveOutDate ? String(body.moveOutDate) : null;
  if (!moveOutDate && moveInDate && isYYYYMMDD(moveInDate)) {
    const term = Number(plan?.termMonths ?? app?.protoLease?.termMonths ?? 12);
    if (Number.isFinite(term) && term > 0) moveOutDate = addMonthsSameDay(moveInDate, term);
  }

  const signed = !!body?.signed;

  // Basic validation (matching your legacy checks)
  if (!building.addressLine1 || !building.city || !building.state || building.state.length < 2 || !building.postalCode) {
    return NextResponse.json({ ok: false, error: "invalid_address" }, { status: 400 });
  }
  if (!(monthlyRent > 0)) return NextResponse.json({ ok: false, error: "invalid_rent" }, { status: 400 });
  if (!isYYYYMMDD(moveInDate || "")) return NextResponse.json({ ok: false, error: "invalid_move_in" }, { status: 400 });

  // Build the lease document exactly as you need it
  const leaseDoc = {
    _id: newLeaseId(),
    firmId,
    appId: toStringId(app._id),
    building,
    createdAt: now,
    updatedAt: now,
    householdId: toStringId(app.householdId ?? ""),
    monthlyRent,           // cents
    moveInDate,            // YYYY-MM-DD
    moveOutDate: moveOutDate ?? null,
    propertyId: null,
    signed,
    signedAt: signed ? now : null,
    status: "scheduled",
    unitId: null,
    unitNumber,
    checklist: Array.isArray(body?.checklist)
      ? body.checklist.map((c: any) => ({
          key: String(c.key),
          label: String(c.label),
          dueAt: c.dueAt ? new Date(c.dueAt).toISOString() : null,
          completedAt: c.completedAt ? new Date(c.completedAt).toISOString() : null,
          notes: c.notes ? String(c.notes) : null,
        }))
      : buildDefaultChecklist(moveInDate, now),
  };

  await unitLeases.insertOne(leaseDoc);

  // ---------- Mark the application and push timeline events ----------
  const FINAL_STATUS = process.env.APP_FINAL_LEASE_STATUS || "leased";
  const timelineEvents: any[] = [
    {
      at: now,
      by: String(user._id ?? user.id ?? "system"),
      event: "lease.created",
      meta: {
        leaseId: leaseDoc._id,
        monthlyRent,
        moveInDate,
        moveOutDate: leaseDoc.moveOutDate,
      },
    },
  ];

  const hadHoldingLock = !!app?.locks?.holding?.active;
  if (hadHoldingLock) {
    timelineEvents.push({
      at: now,
      by: "system",
      event: "lock.cleared",
      meta: { kind: "holding" },
    });
  }

  await apps.updateOne(idEq("_id", appId), {
    $set: {
      status: FINAL_STATUS,
      nextStep: null,
      updatedAt: now,
      "locks.holding.active": false,
      resolvedAt: now,
    },
    $push: {
      timeline: { $each: timelineEvents },
    },
  });

  return NextResponse.json({ ok: true, lease: leaseDoc });
}
