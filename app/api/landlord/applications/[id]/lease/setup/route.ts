// app/api/landlord/applications/[id]/lease/setup/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ─────────────────────────────────────────────────────────────
   Types (minimal + loose on purpose for Mongo driver)
───────────────────────────────────────────────────────────── */
type IdLike = string | import("mongodb").ObjectId;

type ApplicationDoc = {
  _id: IdLike;
  formId: IdLike;
  status?: string;
  building?: any;
  unit?: any;
  protoLease?: {
    monthlyRent: number;
    termMonths: number | null;
    moveInDate: string | null;
  } | null;
  paymentPlan?: any;
};

type LeaseDoc = {
  _id?: IdLike;
  appId: string;
  firmId: string;
  unitLabel?: string | null;
  rentCents: number;
  termMonths: number | null;
  startDate: string;   // YYYY-MM-DD
  endDate: string | null;
  parties: { landlordSigned: boolean; tenantSigned: boolean };
  createdAt: Date; updatedAt: Date;
};

type PaymentDoc = {
  _id?: IdLike;
  appId: string; firmId: string; leaseId?: string | null;
  kind: "holding" | "upfront" | "deposit" | "rent" | "fee" | "refund" | "adjustment" | "scheduled";
  status: "requires_action" | "scheduled" | "succeeded" | "failed" | "refunded" | "canceled" | "processing";
  amountCents: number; currency: "USD";
  dueDate?: string | null; // YYYY-MM-DD
  provider: "stripe" | "offline" | "none";
  providerIds?: Record<string, string>;
  createdAt: Date; updatedAt: Date;
  meta?: Record<string, any>;
};

type ObligationDoc = {
  _id?: IdLike;
  appId: string; firmId: string; leaseId?: string | null;
  key: string;                // "first" | "last" | "key_fee" | "security" | rent:YYYY:MM
  label: string;              // user-facing label
  group: "upfront" | "deposit" | "rent" | "fee";
  amountCents: number;
  dueOn?: string | null;      // YYYY-MM-DD (required for rent)
  priority: number;           // lower first for allocation
  preSignGate?: boolean;      // contributes to countersign gate
  mustBeFullyPaid?: boolean;  // if gating requires fully paid
  paidCents: number;          // materialized by allocation (starts 0)
  status: "due" | "partial" | "paid";
  createdAt: Date; updatedAt: Date;
};

type ScheduledPaymentDoc = {
  _id?: IdLike;
  appId: string; firmId: string; leaseId?: string | null;
  obligationId: string;
  dueDate: string;            // YYYY-MM-DD
  amountCents: number; currency: "USD";
  label: string;              // e.g. "First month", "Rent Feb 2026"
  bucket: "standard" | "deposit";
  status: "scheduled" | "voided";
  createdAt: Date; updatedAt: Date;
};

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */
function toStr(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  try { return v?.toHexString ? v.toHexString() : String(v); } catch { return String(v); }
}
function isHex24(s: string) { return /^[0-9a-fA-F]{24}$/.test(s); }

function addMonthsSameDayUTC(startISO: string, months: number) {
  const [y, m, d] = startISO.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
function addMonthsEndMinusOneDayUTC(startISO: string, months: number) {
  const [y, m, d] = startISO.split("-").map(Number);
  if (!y || !m || !d) return "";
  const end = new Date(Date.UTC(y, m - 1, d));
  end.setUTCMonth(end.getUTCMonth() + months);
  end.setUTCDate(end.getUTCDate() - 1);
  const yy = end.getUTCFullYear();
  const mm = String(end.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(end.getUTCDate()).toString().padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

async function resolveFirmIdForApp(db: any, formId: IdLike): Promise<string> {
  const { ObjectId } = await import("mongodb");
  const forms = db.collection("application_forms");
  const formKey = toStr(formId);
  const form = await forms.findOne(
    isHex24(formKey) ? { _id: new ObjectId(formKey) } : { _id: formKey },
    { projection: { firmId: 1 } }
  );
  return toStr(form?.firmId || "");
}

/* ─────────────────────────────────────────────────────────────
   Route
───────────────────────────────────────────────────────────── */
/**
 * POST body (cents unless noted)
 * {
 *   building?: {...}, unit?: { unitNumber?: string|null },
 *   lease: { monthlyRent: number, termMonths: number|null, moveInDate: "YYYY-MM-DD" },
 *   securityCents: number,
 *   keyFeeCents: number,
 *   requireFirstBeforeMoveIn: boolean,
 *   requireLastBeforeMoveIn: boolean,
 *   countersignUpfrontThresholdCents: number,
 *   countersignDepositThresholdCents: number,
 *   holding?: { amountCents: number, provider?: "stripe"|"offline"|"none", token?: string|null }
 * }
 */
 
 export async function POST() {
  return NextResponse.json(
    { ok: false, error: "deprecated_endpoint" },
    { status: 410 } // Gone
  );
}
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const db = await getDb();
  const { ObjectId } = await import("mongodb");
  const apps = db.collection<ApplicationDoc>("applications");
  const fms = db.collection("firm_memberships");
  const leases = db.collection<LeaseDoc>("leases");
  const payments = db.collection<PaymentDoc>("payments");
  const obligations = db.collection<ObligationDoc>("obligations");
  const scheduled = db.collection<ScheduledPaymentDoc>("scheduled_payments");

  const appId = String(params?.id || "");
  if (!appId) return NextResponse.json({ ok: false, error: "bad_application_id" }, { status: 400 });

  const appFilter = isHex24(appId) ? { _id: new ObjectId(appId) } : { _id: appId };
  const app = await apps.findOne(appFilter);
  if (!app) return NextResponse.json({ ok: false, error: "application_not_found" }, { status: 404 });

  const firmId = await resolveFirmIdForApp(db, app.formId);
  if (!firmId) return NextResponse.json({ ok: false, error: "form_or_firm_missing" }, { status: 400 });

  // Auth: firm membership
  const uid = toStr((user as any)?._id ?? (user as any)?.id ?? (user as any)?.userId ?? (user as any)?.sub ?? "");
  const uidOid = ObjectId.isValid(uid) ? new ObjectId(uid) : null;
  const membership = await fms.findOne(
    { firmId, active: true, $or: uidOid ? [{ userId: uid }, { userId: uidOid }] : [{ userId: uid }] },
    { projection: { role: 1 } }
  );
  if (!membership?.role) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({} as any));
  const now = new Date();

  // Lease inputs
  const monthlyRent = Number(body?.lease?.monthlyRent ?? 0);
  const termMonths  = body?.lease?.termMonths == null ? null : Number(body?.lease?.termMonths);
  const moveInDate  = String(body?.lease?.moveInDate || "");

  if (!(monthlyRent > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(moveInDate)) {
    return NextResponse.json({ ok: false, error: "bad_lease_inputs" }, { status: 400 });
  }
  if (termMonths !== null && (!(Number.isFinite(termMonths)) || termMonths <= 0)) {
    return NextResponse.json({ ok: false, error: "bad_termMonths" }, { status: 400 });
  }

  // Plan inputs
  const securityCents = Math.max(0, Number(body?.securityCents || 0));
  const keyFeeCents   = Math.max(0, Number(body?.keyFeeCents || 0));
  const reqFirst      = !!body?.requireFirstBeforeMoveIn;
  const reqLast       = !!body?.requireLastBeforeMoveIn;

  // Countersign thresholds (split)
  const csUpfront = Math.max(0, Number(body?.countersignUpfrontThresholdCents || 0));
  const csDeposit = Math.max(0, Number(body?.countersignDepositThresholdCents || 0));

  if (securityCents > monthlyRent) {
    return NextResponse.json({ ok: false, error: "security_gt_monthly" }, { status: 400 });
  }

  // Clamp countersign minimums to their maxes
  const upfrontMax = (reqFirst ? monthlyRent : 0) + (reqLast ? monthlyRent : 0) + keyFeeCents;
  const depositMax = securityCents;
  const csUpfrontClamped = Math.min(csUpfront, upfrontMax);
  const csDepositClamped = Math.min(csDeposit, depositMax);

  // Optional building/unit
  const setBuilding = body?.building ? {
    building: {
      addressLine1: body.building.addressLine1,
      addressLine2: body.building.addressLine2 ?? null,
      city: body.building.city,
      state: String(body.building.state || "").toUpperCase(),
      postalCode: body.building.postalCode,
      country: body.building.country ?? "US",
    }
  } : {};
  const setUnit = body?.unit ? { unit: { unitNumber: body.unit.unitNumber ?? null } } : {};

  // Build & persist paymentPlan + status
  const endDate = termMonths ? addMonthsEndMinusOneDayUTC(moveInDate, termMonths) : null;

  const paymentPlan = {
    monthlyRentCents: monthlyRent,
    termMonths,
    startDate: moveInDate,
    securityCents,
    keyFeeCents,
    requireFirstBeforeMoveIn: reqFirst,
    requireLastBeforeMoveIn : reqLast,
    countersignUpfrontThresholdCents: csUpfrontClamped,
    countersignDepositThresholdCents: csDepositClamped,
    upfrontTotals: {
      firstCents: reqFirst ? monthlyRent : 0,
      lastCents : reqLast ? monthlyRent : 0,
      keyCents  : keyFeeCents,
      securityCents,
      otherUpfrontCents:
        (reqFirst ? monthlyRent : 0) + (reqLast ? monthlyRent : 0) + keyFeeCents,
      totalUpfrontCents:
        (reqFirst ? monthlyRent : 0) + (reqLast ? monthlyRent : 0) + keyFeeCents + securityCents,
    },
    priority: [
      ...(reqLast ? ["last_month"] : []),
      ...(reqFirst ? ["first_month"] : []),
      ...(keyFeeCents > 0 ? ["key_fee"] : []),
      ...(securityCents > 0 ? ["security_deposit"] : []),
    ],
  };

  const hasAnyUpfront = paymentPlan.upfrontTotals.totalUpfrontCents > 0;
  const needsThreshold = (csUpfrontClamped > 0) || (csDepositClamped > 0);
  const nextStatus = (hasAnyUpfront || needsThreshold) ? "approved_pending_payment" : "approved_pending_lease";

  await apps.updateOne(appFilter, {
    $set: {
      ...setBuilding,
      ...setUnit,
      protoLease: { monthlyRent, termMonths, moveInDate },
      paymentPlan,
      status: nextStatus,
      countersign: {
        allowed: false,
        upfrontMinCents: csUpfrontClamped,
        depositMinCents: csDepositClamped,
      },
      updatedAt: now,
    },
    $push: {
      timeline: {
        at: now,
        by: toStr((user as any)?._id ?? (user as any)?.email ?? "system"),
        event: "lease.setup.hybrid",
        meta: { set: ["protoLease","paymentPlan","status", ...(body?.building?["building"]:[]), ...(body?.unit?["unit"]:[])] }
      }
    }
  });

  // Create unsigned lease
  const lease: LeaseDoc = {
    appId: toStr(app._id),
    firmId,
    unitLabel: body?.unit?.unitNumber ?? app?.unit?.unitNumber ?? null,
    rentCents: monthlyRent,
    termMonths,
    startDate: moveInDate,
    endDate,
    parties: { landlordSigned: false, tenantSigned: false },
    createdAt: now, updatedAt: now,
  };
  const leaseInsert = await leases.insertOne(lease);
  const leaseId = toStr(leaseInsert.insertedId);

  /* ─────────────────────────────────────────────────────────────
     Obligations (truth) + Scheduled payments (UX)
  ───────────────────────────────────────────────────────────── */
  const obls: ObligationDoc[] = [];

  // Upfront obligations
  if (reqFirst) {
    obls.push({
      appId: toStr(app._id), firmId, leaseId,
      key: "first", label: "First month", group: "upfront",
      amountCents: monthlyRent, dueOn: moveInDate,
      priority: 20, preSignGate: true, mustBeFullyPaid: false,
      paidCents: 0, status: "due",
      createdAt: now, updatedAt: now,
    });
  }
  if (reqLast) {
    obls.push({
      appId: toStr(app._id), firmId, leaseId,
      key: "last", label: "Last month", group: "upfront",
      amountCents: monthlyRent, dueOn: moveInDate,
      priority: 10, preSignGate: true, mustBeFullyPaid: false,
      paidCents: 0, status: "due",
      createdAt: now, updatedAt: now,
    });
  }
  if (keyFeeCents > 0) {
    obls.push({
      appId: toStr(app._id), firmId, leaseId,
      key: "key_fee", label: "Key fee", group: "fee",
      amountCents: keyFeeCents, dueOn: moveInDate,
      priority: 30, preSignGate: true, mustBeFullyPaid: false,
      paidCents: 0, status: "due",
      createdAt: now, updatedAt: now,
    });
  }
  if (securityCents > 0) {
    obls.push({
      appId: toStr(app._id), firmId, leaseId,
      key: "security", label: "Security deposit", group: "deposit",
      amountCents: securityCents, dueOn: moveInDate,
      priority: 40, preSignGate: true, mustBeFullyPaid: false,
      paidCents: 0, status: "due",
      createdAt: now, updatedAt: now,
    });
  }

  // Rent obligations
  if (termMonths && termMonths > 0) {
    for (let i = 0; i < termMonths; i++) {
      const ymd = addMonthsSameDayUTC(moveInDate, i);         // YYYY-MM-01 style
      const [Y, M] = ymd.split("-").map(Number);
      obls.push({
        appId: toStr(app._id), firmId, leaseId,
        key: `rent:${Y}:${String(M).padStart(2,"0")}`,
        label: `Rent ${Y}-${String(M).padStart(2,"0")}`,
        group: "rent",
        amountCents: monthlyRent,
        dueOn: ymd,
        priority: 1000 + i, preSignGate: false, mustBeFullyPaid: false,
        paidCents: 0, status: "due",
        createdAt: now, updatedAt: now,
      });
    }
  }

  // Persist obligations
  let insertedOblIds: string[] = [];
  if (obls.length) {
    const ins = await obligations.insertMany(obls);
    insertedOblIds = Object.values(ins.insertedIds).map(toStr);
  }

  // Build scheduled payments view from obligations
  const schedRows: ScheduledPaymentDoc[] = [];
  for (const [idx, o] of obls.entries()) {
    if (!o.dueOn) continue; // only calendar items with a due date
    const bucket = o.group === "deposit" ? "deposit" : "standard";
    schedRows.push({
      appId: o.appId, firmId: o.firmId, leaseId,
      obligationId: toStr(insertedOblIds[idx] ?? ""), // best effort
      dueDate: o.dueOn,
      amountCents: o.amountCents,
      currency: "USD",
      label: o.label,
      bucket,
      status: "scheduled",
      createdAt: now, updatedAt: now,
    });
  }
  if (schedRows.length) await scheduled.insertMany(schedRows);

  // Optional holding payment
  const paymentRows: PaymentDoc[] = [];
  const holdingAmt = Math.max(0, Number(body?.holding?.amountCents || 0));
  if (holdingAmt > 0) {
    paymentRows.push({
      appId: toStr(app._id), firmId, leaseId,
      kind: "holding",
      status: body?.holding?.provider === "offline" ? "processing" : "requires_action",
      amountCents: holdingAmt, currency: "USD",
      provider: (body?.holding?.provider || "stripe") as "stripe"|"offline"|"none",
      providerIds: body?.holding?.token ? { token: String(body.holding.token) } : undefined,
      createdAt: now, updatedAt: now,
      meta: { source: "lease.setup" },
    });
  }
  if (paymentRows.length) await payments.insertMany(paymentRows);

  // Respond
  return NextResponse.json({
    ok: true,
    application: { id: appId, status: nextStatus },
    lease: { id: leaseId, startDate: moveInDate, endDate },
    countersign: {
      upfrontMinCents: csUpfrontClamped,
      depositMinCents: csDepositClamped,
      upfrontMaxCents: upfrontMax,
      depositMaxCents: depositMax,
    },
    counts: {
      obligations: obls.length,
      scheduledPayments: schedRows.length,
      holdingCreated: holdingAmt > 0 ? 1 : 0,
    },
  });
}
