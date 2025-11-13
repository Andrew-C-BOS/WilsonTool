// app/api/tenant/payments/session/route.ts
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import Stripe from "stripe";
import { ObjectId } from "mongodb";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

/* ─────────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────────── */
type Bucket = "operating" | "deposit" | "rent" | "fee"; // operating = everything non-deposit
type Status = "created" | "processing" | "succeeded" | "failed" | "canceled" | "returned";

type Body = {
  appId?: string;
  firmId?: string | null;
  // Back-compat: "upfront" maps to "operating"
  type?: "operating" | "upfront" | "deposit";
  amountCents?: number;          // requested amount (controlled by server policy)
  reason?: string | null;        // e.g., "operating_top_up", "deposit_minimum"
  requestId?: string | null;     // optional idempotency token for client-side retries
};

type ChargeRow = {
  chargeKey: string; // `${appId}:${bucket}:${code}`
  bucket: Bucket;
  code:
    | "key_fee"
    | "first_month"
    | "last_month"
    | "security_deposit"
    | `rent:${string}`; // rent:YYYY-MM
  amountCents: number;
  priorityIndex: number;
};

type PaymentLite = {
  kind: Bucket | "upfront"; // tolerate legacy "upfront" rows
  status: Status;
  amountCents: number;
  createdAt: Date;
};

const CONFIRMABLE = new Set<Stripe.PaymentIntent.Status>([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
]);

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */
function isObjectIdLike(s?: string | null) {
  return !!s && /^[a-f\d]{24}$/i.test(String(s));
}
function toObjectIdOrString(v: string) {
  return isObjectIdLike(v) ? new ObjectId(v) : v;
}
function i32(n: any) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x) : NaN;
}
function safeNum(x: any, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}
function dollarsWhole(n: number) {
  // Round to whole dollars (ACH-friendly UX)
  return Math.round(n / 100) * 100;
}
function newIdemKey(tag: string, requestId?: string | null) {
  return requestId
    ? `${tag}:${requestId}`
    : `${tag}:${Date.now().toString(36)}:${crypto.randomUUID()}`;
}

/** Build addressable Operating + Deposit charges.
 * Operating = one pot that waterfalls:
 *   key_fee → first_month → last_month → then monthly rent in order.
 * Deposit = security_deposit (escrowed).
 */
function buildCharges(appId: string, app: any): ChargeRow[] {
  const rows: ChargeRow[] = [];
  const push = (bucket: Bucket, code: ChargeRow["code"], amt: number, prio: number) => {
    const amountCents = Math.max(0, safeNum(amt));
    if (amountCents <= 0) return;
    rows.push({
      chargeKey: `${appId}:${bucket}:${code}`,
      bucket,
      code,
      amountCents,
      priorityIndex: prio,
    });
  };

  const plan = app?.paymentPlan ?? null;

  // Helper: add YYYY-MM rent charges strictly after upfront items
  function addMonthlyRentCharges(startISO?: string | null, termMonths?: number | null, monthly?: number, basePrio = 2000) {
    const rent = Math.max(0, safeNum(monthly));
    const months = Math.max(0, safeNum(termMonths));
    if (!startISO || !months || !rent) return;

    const parts = String(startISO).split("-");
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (!y || !m) return;

    let year = y, month = m; // 1..12
    for (let i = 0; i < months; i++) {
      const ym = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}`;
      push("operating", `rent:${ym}` as ChargeRow["code"], rent, basePrio + i);
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
  }

  if (plan?.upfrontTotals) {
    const first = safeNum(plan.upfrontTotals.firstCents);
    const last  = safeNum(plan.upfrontTotals.lastCents);
    const key   = safeNum(plan.upfrontTotals.keyCents);
    const sec   = safeNum(plan.securityCents);

    // Respect provided priority for upfront items; rent follows after with high priority
    const prioList =
      Array.isArray(plan.priority) && plan.priority.length
        ? (plan.priority as string[])
        : ["key_fee", "first_month", "last_month", "security_deposit"];

    const prio = (code: string) => {
      const idx = prioList.indexOf(code);
      return idx >= 0 ? idx : 999;
    };

    // Upfront items in OPERATING
    push("operating", "key_fee",     key,   prio("key_fee"));
    push("operating", "first_month", first, prio("first_month"));
    push("operating", "last_month",  last,  prio("last_month"));

    // Monthly rent after upfronts
    addMonthlyRentCharges(plan.startDate, plan.termMonths, plan.monthlyRentCents, 2000);

    // DEPOSIT (escrow)
    push("deposit", "security_deposit", sec, prio("security_deposit"));
    return rows;
  }

  // Legacy fallback (application.upfronts)
  const u = app?.upfronts ?? {};
  push("operating", "key_fee",     safeNum(u.key),   0);
  push("operating", "first_month", safeNum(u.first), 1);
  push("operating", "last_month",  safeNum(u.last),  2);
  push("deposit",  "security_deposit", safeNum(u.security), 3);

  return rows;
}

function allocateAcrossCharges(charges: ChargeRow[], payments: PaymentLite[]) {
  const orderedCharges = [...charges].sort(
    (a, b) => a.priorityIndex - b.priorityIndex || a.code.localeCompare(b.code)
  );
  const postedByKey = new Map<string, number>();
  const pendingByKey = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  const orderedPayments = [...payments].sort(
    (a, b) => (a.createdAt?.getTime?.() ?? 0) - (b.createdAt?.getTime?.() ?? 0)
  );

  for (const p of orderedPayments) {
    // Legacy normalization: "upfront" rows should be treated as "operating"
    const bucket = (p.kind === "upfront" ? "operating" : p.kind) as Bucket;

    if (bucket !== "operating" && bucket !== "deposit") continue;
    if (p.status !== "succeeded" && p.status !== "processing") continue;

    let remaining = Math.max(0, p.amountCents);
    if (remaining <= 0) continue;

    for (const c of orderedCharges) {
      if (c.bucket !== bucket) continue;
      if (remaining <= 0) break;

      const posted = postedByKey.get(c.chargeKey) ?? 0;
      const pending = pendingByKey.get(c.chargeKey) ?? 0;
      const open = Math.max(0, c.amountCents - posted - pending);
      const take = Math.min(open, remaining);
      if (take <= 0) continue;

      if (p.status === "succeeded") add(postedByKey, c.chargeKey, take);
      else add(pendingByKey, c.chargeKey, take);
      remaining -= take;
    }
  }

  return { postedByKey, pendingByKey };
}

function sumRemainingByBucket(
  charges: ChargeRow[],
  posted: Map<string, number>,
  pending: Map<string, number>,
  bucket: Bucket
) {
  return charges
    .filter((c) => c.bucket === bucket)
    .reduce((s, c) => {
      const paid = (posted.get(c.chargeKey) ?? 0) + (pending.get(c.chargeKey) ?? 0);
      return s + Math.max(0, c.amountCents - paid);
    }, 0);
}

/* ─────────────────────────────────────────────────────────────
   Route
───────────────────────────────────────────────────────────── */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const debugMode = url.searchParams.get("debug") === "1";
  const debug: Record<string, any> = {
    step: "init",
    input: {},
    resolved: {},
    amounts: {},
    stripe: {},
    decision: {},
  };
  const done = (status: number, payload: any) => {
    if (debugMode) payload.debug = debug;
    return NextResponse.json(payload, { status });
  };

  try {
    const user = await getSessionUser();
    debug.user = user
      ? { id: (user as any)?.id ?? (user as any)?._id, email: (user as any)?.email ?? null }
      : null;
    if (!user) return done(401, { error: "not_authenticated" });

    const body = (await req.json().catch(() => ({}))) as Body;
    let { appId, firmId: firmIdRaw, type, amountCents, reason, requestId } = body;
    debug.input.body = body;

    if (!appId) {
      debug.step = "validate_input_failed";
      return done(400, { error: "bad_request" });
    }

    // Normalize type: "upfront" -> "operating"
    let bucket: "operating" | "deposit" | null =
      type === "deposit" ? "deposit" : "operating";

    const db = await getDb();
    const paymentsCol = db.collection("payments");
    const applications = db.collection("applications");
    const applicationForms = db.collection("application_forms");
    const leases = db.collection("leases");
    const memberships = db.collection("household_memberships");
    const firms = db.collection("firms");
    const households = db.collection("households");

    /* ---------- load application ---------- */
	const appLookupId = toObjectIdOrString(appId);
	const appDoc = await applications.findOne(
	  { _id: appLookupId as any },
	  {
		projection: {
		  _id: 1,
		  formId: 1,
		  firmId: 1,
		  householdId: 1,
		  countersign: 1,
		  paymentPlan: 1,
		  upfronts: 1,
		  answersByMember: 1,
		},
	  }
	);
    debug.resolved.appProjection = appDoc ?? null;
    if (!appDoc) {
      debug.step = "app_not_found";
      return done(404, { error: "app_not_found" });
    }

    /* ---------- permission: user ∈ household (tolerate string/ObjectId) ---------- */
    const hhId = String(appDoc.householdId || "");
    const userId = String((user as any)?.id ?? (user as any)?._id ?? "");
    if (hhId && userId) {
      const hhIdObj = isObjectIdLike(hhId) ? new ObjectId(hhId) : null;
      const membership = await memberships.findOne(
        {
          userId,
          active: true,
          householdId: hhIdObj ? { $in: [hhId, hhIdObj] } : hhId,
        },
        { projection: { _id: 1 } }
      );
      debug.resolved.membershipFound = !!membership;
      if (!membership) {
        debug.step = "forbidden_not_in_household";
        return done(403, { error: "forbidden" });
      }
    }

    /* ---------- resolve firmId ---------- */
    let firmId: string | null | undefined = firmIdRaw ?? null;
    if (!firmId && appDoc.firmId) firmId = String(appDoc.firmId);
	if (!firmId && appDoc.formId) {
	  const formIdLookup =
		isObjectIdLike(appDoc.formId)
		  ? new ObjectId(String(appDoc.formId))
		  : String(appDoc.formId);

	  const form = await applicationForms.findOne(
		{ _id: formIdLookup as any },
		{ projection: { firmId: 1, firmName: 1, firmSlug: 1 } }
	  );

	  if (form?.firmId) firmId = String(form.firmId);
	  debug.resolved.formBridge = form
		? { firmId: form.firmId, firmName: form.firmName, firmSlug: form.firmSlug }
		: null;
	}
    if (!firmId) {
      const leaseByApp = await leases.findOne(
        { appId },
        { projection: { firmId: 1, _id: 1, status: 1, createdAt: 1 } }
      );
      if (leaseByApp?.firmId) firmId = String(leaseByApp.firmId);
      debug.resolved.leaseByApp = leaseByApp
        ? { _id: leaseByApp._id, firmId: leaseByApp.firmId, status: leaseByApp.status }
        : null;
    }
    debug.resolved.firmId = firmId ?? null;
    if (!firmId) {
      debug.step = "resolve_firm_failed";
      return done(400, { error: "missing_firm" });
    }

    /* ---------- routing accounts ---------- */
    const firm = await firms.findOne(
	  { _id: firmId as any },
	  { projection: { stripe: 1, name: 1, _id: 1 } }
	);
    debug.resolved.firmDoc = {
      _id: firm?._id ?? null,
      name: firm?.name ?? null,
      hasStripe: !!firm?.stripe,
      escrowAccountId: firm?.stripe?.escrowAccountId ?? null,
      operatingAccountId: firm?.stripe?.operatingAccountId ?? null,
    };
    if (!firm?.stripe) {
      debug.step = "firm_missing_stripe";
      return done(400, { error: "firm_missing_stripe" });
    }
    const escrowAccountId = firm.stripe.escrowAccountId as string | undefined;
    const operatingAccountId = firm.stripe.operatingAccountId as string | undefined;
    const destination = bucket === "deposit" ? escrowAccountId : operatingAccountId;
    if (!destination) {
      debug.step = "missing_destination";
      return done(400, {
        error: bucket === "deposit" ? "missing_escrow_account" : "missing_operating_account",
      });
    }

    /* ---------- derive charges & current remaining (net of posted+pending) ---------- */
    const charges = buildCharges(appId, appDoc);

    // Pull payments and allocate to compute posted & pending per charge
    const rawPays = await paymentsCol
      .find({ appId, firmId }, { projection: { kind: 1, status: 1, amountCents: 1, createdAt: 1 } })
      .toArray();

    const payments: PaymentLite[] = rawPays.map((p: any) => ({
      kind: (p.kind ?? "operating") as Bucket | "upfront",
      status: (p.status ?? "created") as Status,
      amountCents: safeNum(p.amountCents),
      createdAt: p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt ?? Date.now()),
    }));

    const { postedByKey, pendingByKey } = allocateAcrossCharges(charges, payments);

    // Remaining by bucket (net of posted+pending)
    const operatingRemainingNet = sumRemainingByBucket(charges, postedByKey, pendingByKey, "operating");
    const depositRemainingNet   = sumRemainingByBucket(charges, postedByKey, pendingByKey, "deposit");

    // Countersign thresholds
    const opMinThreshold = Number(
      appDoc?.countersign?.upfrontMinCents ??
      appDoc?.paymentPlan?.countersignUpfrontThresholdCents ??
      NaN
    );
    const depMinThreshold = Number(
      appDoc?.countersign?.depositMinCents ??
      appDoc?.paymentPlan?.countersignDepositThresholdCents ??
      NaN
    );

    // Operating line-item exact remainders (includes rent:YYYY-MM)
    const operatingLineItemRemains: number[] = charges
      .filter(c => c.bucket === "operating")
      .map(c => Math.max(0,
        c.amountCents - (postedByKey.get(c.chargeKey) ?? 0) - (pendingByKey.get(c.chargeKey) ?? 0)
      ))
      .filter(v => v > 0);

    // Operating top-up policy
    const opMax = Math.max(0, operatingRemainingNet);
    const opMin = Math.min(opMax, 100000); // $1,000 cap for minimum top-up
    const minTopUpCents = dollarsWhole(opMin);
    const maxTopUpCents = dollarsWhole(opMax);

    // Deposit policy:
    // - If a positive gate exists, require at least that minimum (capped by remaining).
    // - If gate is 0 or not set, allow the full remaining deposit.
    const hasDepGate = Number.isFinite(depMinThreshold) && Number(depMinThreshold) > 0;
    const depRequired = hasDepGate
      ? Math.max(0, Math.min(depositRemainingNet, Number(depMinThreshold)))
      : Math.max(0, depositRemainingNet);
    const depRemaining = depositRemainingNet;

    debug.amounts = {
      operatingRemainingNet,
      depositRemainingNet,
      minTopUpCents,
      maxTopUpCents,
      operatingLineItemRemains,
      opMinThreshold: Number.isFinite(opMinThreshold) ? opMinThreshold : undefined,
      depMinThreshold: Number.isFinite(depMinThreshold) ? depMinThreshold : undefined,
      depRequired,
      depRemaining,
    };

    /* ---------- validate requested amount against policy ---------- */
    const requested = i32(amountCents);
    if (!Number.isFinite(requested) || requested <= 0) {
      debug.step = "invalid_amount";
      return done(400, { error: "invalid_amount" });
    }

    let valid = false;
    if (bucket === "operating") {
      const isWholeDollar = requested % 100 === 0;
      const inRange = requested >= minTopUpCents && requested <= maxTopUpCents;
      const isLineItemExact = operatingLineItemRemains.includes(requested);
      valid = isWholeDollar && (inRange || isLineItemExact);
    } else {
      // accept either the gate minimum (if any) OR the full remaining deposit
      valid = requested > 0 && (requested === depRequired || requested === depRemaining);
    }

    debug.amounts.requested = requested;
    debug.amounts.valid = valid;

    if (!valid) {
      debug.step = "amount_not_allowed";
      if (bucket === "operating") {
        return done(400, {
          error: "amount_not_allowed",
          detail: {
            bucket,
            requested,
            minTopUpCents,
            maxTopUpCents,
            lineItemExacts: operatingLineItemRemains,
          },
        });
      } else {
        return done(400, {
          error: "amount_not_allowed",
          detail: { bucket, requested, required: depRequired, remaining: depRemaining }
        });
      }
    }

    /* ---------- infer payer (billing_details) ---------- */
    const answers = (appDoc as any)?.answersByMember ?? {};
    const mine = answers?.[userId] ?? null;
    const formName = (mine?.answers?.q_name as string) ?? (mine?.answers?.name as string) ?? null;
    const payerName =
      (formName && String(formName).trim()) ||
      (user as any)?.preferredName ||
      (user as any)?.name ||
      ((user as any)?.email ? String((user as any).email).split("@")[0].replace(/[._]/g, " ") : "Tenant");
    const payerEmail = (user as any)?.email || undefined;

    // Reuse saved bank if available (off_session)
    let stripeCustomerId: string | null = null;
    let defaultUsBankPmId: string | null = null;
	if (hhId) {
	  const hhLookupId =
		isObjectIdLike(hhId) ? new ObjectId(hhId) : hhId;

	  const hh = await households.findOne(
		{ _id: hhLookupId as any },
		{ projection: { stripeCustomerId: 1, defaultUsBankPaymentMethodId: 1 } }
	  );

	  stripeCustomerId = (hh as any)?.stripeCustomerId ?? null;
	  defaultUsBankPmId = (hh as any)?.defaultUsBankPaymentMethodId ?? null;
	  debug.resolved.householdStripe = {
		stripeCustomerId,
		defaultUsBankPaymentMethodId: defaultUsBankPmId,
	  };
	}

    /* ---------- reuse/cancel existing PI (confirmable) ---------- */
    const existing = await paymentsCol.findOne(
      {
        appId,
        firmId,
        kind: bucket, // legacy "upfront" already normalized in read path
        status: "requires_action",
        amountCents: requested,
        "providerIds.paymentIntentId": { $exists: true, $type: "string" },
      },
      { projection: { _id: 1, providerIds: 1 } }
    );
    debug.decision.reuseCandidate = existing?.providerIds?.paymentIntentId ?? null;

    if (existing?.providerIds?.paymentIntentId) {
      try {
        const pi0 = await stripe.paymentIntents.retrieve(existing.providerIds.paymentIntentId);
        const achOnly =
          Array.isArray(pi0.payment_method_types) &&
          pi0.payment_method_types.length === 1 &&
          pi0.payment_method_types[0] === "us_bank_account";
        const confirmable = CONFIRMABLE.has(pi0.status);
        const sameAmount = Number(pi0.amount) === requested;

        if (achOnly && confirmable && sameAmount) {
          await paymentsCol.updateOne(
            { _id: existing._id },
            { $set: { updatedAt: new Date(), "meta.reused": true } }
          );
          debug.step = "reuse_existing_pi";
          return done(200, {
            ok: true,
            clientSecret: pi0.client_secret,
            returnUrl: `/tenant/payments/result?appId=${encodeURIComponent(appId)}&key=${encodeURIComponent(pi0.id)}`,
            payer: { name: payerName, email: payerEmail ?? null },
          });
        }
        if (confirmable && (!achOnly || !sameAmount)) {
          try { await stripe.paymentIntents.cancel(pi0.id); } catch {}
          debug.stripe.canceledPI = pi0.id;
        }
      } catch (e: any) {
        debug.stripe.reuseError = e?.message || "pi_retrieve_failed";
      }
    }

    /* ---------- create PI (off_session if saved PM; else client secret) ---------- */
    const idemKey = newIdemKey(`pay:${appId}:${bucket}`, requestId ?? null);

    const description =
      bucket === "deposit"
        ? `Security deposit for application ${appId}`
        : `Operating top-up for application ${appId}`;

    let pi: Stripe.PaymentIntent | null = null;
    let requiresClientSide = true;

    if (stripeCustomerId && defaultUsBankPmId) {
      try {
        pi = await stripe.paymentIntents.create(
          {
            amount: requested,
            currency: "usd",
            description,
            customer: stripeCustomerId,
            payment_method: defaultUsBankPmId,
            confirm: true,
            off_session: true,
            payment_method_types: ["us_bank_account"],
            transfer_data: { destination },
            receipt_email: payerEmail,
            metadata: {
              appId, firmId, type: bucket, reason: reason || (bucket === "deposit" ? "deposit_minimum" : "operating_top_up"),
              initiatedBy: String((user as any)?.email || (user as any)?._id || ""),
            },
          },
          { idempotencyKey: idemKey }
        );
        requiresClientSide = false;
        debug.stripe.createdPI = { id: pi.id, status: pi.status, off_session: true };
      } catch (e: any) {
        debug.stripe.offSessionError = e?.message || "off_session_failed";
      }
    }

    if (!pi) {
      pi = await stripe.paymentIntents.create(
        {
          amount: requested,
          currency: "usd",
          description,
          payment_method_types: ["us_bank_account"],
          payment_method_options: { us_bank_account: { verification_method: "automatic" } },
          transfer_data: { destination },
          receipt_email: payerEmail,
          customer: stripeCustomerId ?? undefined,
          setup_future_usage: "off_session",
          metadata: {
            appId, firmId, type: bucket, reason: reason || (bucket === "deposit" ? "deposit_minimum" : "operating_top_up"),
            initiatedBy: String((user as any)?.email || (user as any)?._id || ""),
          },
        },
        { idempotencyKey: idemKey }
      );
      requiresClientSide = true;
      debug.stripe.createdPI = { id: pi.id, status: pi.status, off_session: false };
    }

    if (!pi?.id) {
      debug.step = "pi_create_failed";
      return done(500, { error: "pi_create_failed" });
    }

    // Audit row
    const now = new Date();
    await paymentsCol.insertOne({
      appId,
      firmId: firmId || "",
      leaseId: null,
      kind: bucket, // "operating" | "deposit"
      status: requiresClientSide ? "requires_action" : (pi.status as Status),
      amountCents: requested,
      currency: "USD",
      provider: "stripe",
      providerIds: { paymentIntentId: pi.id },
      createdAt: now,
      updatedAt: now,
      meta: {
        session: "tenant.start",
        by: String((user as any)?.email || (user as any)?._id || "user"),
        reason: reason || (bucket === "deposit" ? "deposit_minimum" : "operating_top_up"),
        destinationAccount: destination,
        rails: "ach",
        idempotencyKey: idemKey,
      },
    });

    debug.step = "ok";
    if (requiresClientSide) {
      return done(200, {
        ok: true,
        clientSecret: pi.client_secret!,
        // pass the PI id as key (works with your result API)
        returnUrl: `/tenant/payments/result?appId=${encodeURIComponent(appId)}&key=${encodeURIComponent(pi.id)}`,
        payer: { name: payerName, email: payerEmail ?? null },
      });
    } else {
      return done(200, { ok: true, status: pi.status, paymentIntentId: pi.id });
    }
  } catch (e: any) {
    const msg = e?.message || "server_error";
    const url = new URL(req.url);
    return NextResponse.json(
      { error: msg, ...(url.searchParams.get("debug") === "1" ? { debug: { error: msg } } : {}) },
      { status: 500 }
    );
  }
}
