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

type Bucket = "operating" | "deposit" | "rent" | "fee";
type Status =
  | "created"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled"
  | "returned";

type Body = {
  appId?: string;
  firmId?: string | null;
  // Back-compat: "upfront" maps to "operating"
  type?: "operating" | "upfront" | "deposit";
  amountCents?: number;
  reason?: string | null; // "signing_combined" | "movein_combined" | ...
  requestId?: string | null;
  paymentMethodId?: string | null;
  splitHint?: {
    operatingCents?: number | null;
    depositCents?: number | null;
  } | null;
};

type PaymentLite = {
  kind: Bucket | "upfront";
  status: Status;
  amountCents: number;
  createdAt: Date;
};

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
function newIdemKey(tag: string, requestId?: string | null) {
  return requestId
    ? `${tag}:${requestId}`
    : `${tag}:${Date.now().toString(36)}:${crypto.randomUUID()}`;
}

/**
 * Compute Step 1 / Step 2 plan totals from application.paymentPlan + countersign.
 * Mirrors the /summary logic.
 */
function computePlanTotals(appDoc: any) {
  const plan = appDoc.paymentPlan || {};
  const cs = appDoc.countersign || {};
  const totals = plan.upfrontTotals || {};

  const firstCents = Number(totals.firstCents || 0);
  const lastCents = Number(totals.lastCents || 0);
  const keyCents = Number(totals.keyCents || 0);
  const securityCents = Number(
    totals.securityCents ?? plan.securityCents ?? 0,
  );

  const upfrontMinCentsRaw =
    cs.upfrontMinCents ?? plan.countersignUpfrontThresholdCents ?? 0;
  const depositMinCentsRaw =
    cs.depositMinCents ?? plan.countersignDepositThresholdCents ?? 0;

  const step1OpTotal = Math.max(0, Number(upfrontMinCentsRaw || 0));
  const step1DepTotal = Math.max(0, Number(depositMinCentsRaw || 0));

  const step2OpTotal = Math.max(
    0,
    firstCents + lastCents + keyCents - step1OpTotal,
  );
  const step2DepTotal = Math.max(
    0,
    securityCents - step1DepTotal,
  );

  return {
    plan,
    cs,
    firstCents,
    lastCents,
    keyCents,
    securityCents,
    step1OpTotal,
    step1DepTotal,
    step2OpTotal,
    step2DepTotal,
  };
}

/**
 * Aggregate payments for this app + firm, and allocate into Step 1 then Step 2.
 * Same allocator as the /summary progress.
 */
function computeStepProgress(
  payments: PaymentLite[],
  step1OpTotal: number,
  step1DepTotal: number,
  step2OpTotal: number,
  step2DepTotal: number,
) {
  const paidStatuses = new Set<Status>(["processing", "succeeded"]);

  let operatingPaidCents = 0;
  let depositPaidCents = 0;

  for (const p of payments) {
    if (!paidStatuses.has(p.status)) continue;
    const amt = Number(p.amountCents || 0);
    if (!Number.isFinite(amt) || amt <= 0) continue;

    const kind = p.kind;
    if (kind === "deposit") {
      depositPaidCents += amt;
    } else if (kind === "upfront" || kind === "operating") {
      operatingPaidCents += amt;
    }
  }

  let opAvail = operatingPaidCents;
  let depAvail = depositPaidCents;

  // Step 1 allocation
  const step1OpPaid = Math.min(step1OpTotal, opAvail);
  opAvail -= step1OpPaid;
  const step1DepPaid = Math.min(step1DepTotal, depAvail);
  depAvail -= step1DepPaid;

  const step1OpRem = step1OpTotal - step1OpPaid;
  const step1DepRem = step1DepTotal - step1DepPaid;
  const step1RemTotal = step1OpRem + step1DepRem;
  const step1Met = step1OpRem <= 0 && step1DepRem <= 0;

  // Step 2 allocation
  const step2OpPaid = Math.min(step2OpTotal, opAvail);
  opAvail -= step2OpPaid;
  const step2DepPaid = Math.min(step2DepTotal, depAvail);
  depAvail -= step2DepPaid;

  const step2OpRem = step2OpTotal - step2OpPaid;
  const step2DepRem = step2DepTotal - step2DepPaid;
  const step2RemTotal = step2OpRem + step2DepRem;
  const step2Met = step2OpRem <= 0 && step2DepRem <= 0;

  const currentStep =
    step1RemTotal > 0 ? 1 : step2RemTotal > 0 ? 2 : 3;

  return {
    operatingPaidCents,
    depositPaidCents,
    step1: {
      operatingTotal: step1OpTotal,
      depositTotal: step1DepTotal,
      operatingPaid: step1OpPaid,
      depositPaid: step1DepPaid,
      operatingRemaining: step1OpRem,
      depositRemaining: step1DepRem,
      remainingTotal: step1RemTotal,
      met: step1Met,
    },
    step2: {
      operatingTotal: step2OpTotal,
      depositTotal: step2DepTotal,
      operatingPaid: step2OpPaid,
      depositPaid: step2DepPaid,
      operatingRemaining: step2OpRem,
      depositRemaining: step2DepRem,
      remainingTotal: step2RemTotal,
      met: step2Met,
    },
    currentStep,
  };
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
    stripe: {
      customer: {},
      paymentIntent: {},
      flows: {},
      errors: {},
    },
    decision: {},
    flags: {},
  };

  const done = (status: number, payload: any) => {
    if (debugMode) payload.debug = debug;
    return NextResponse.json(payload, { status });
  };

  try {
    const user = await getSessionUser();
    debug.user = user
      ? {
          id: (user as any)?.id ?? (user as any)?._id,
          email: (user as any)?.email ?? null,
          role: (user as any)?.role ?? null,
        }
      : null;
    if (!user) {
      debug.step = "not_authenticated";
      return done(401, { error: "not_authenticated" });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    let {
      appId,
      firmId: firmIdRaw,
      type,
      amountCents,
      reason,
      requestId,
      paymentMethodId,
      splitHint,
    } = body;
    debug.input.body = body;

    if (!appId) {
      debug.step = "validate_input_failed";
      return done(400, { error: "bad_request" });
    }

    const db = await getDb();
    const paymentsCol = db.collection("payments");
    const applications = db.collection("applications");
    const applicationForms = db.collection("application_forms");
    const leases = db.collection("leases");
    const memberships = db.collection("household_memberships");
    const firms = db.collection("firms");
    const users = db.collection("users");

    const bucket: "operating" | "deposit" =
      type === "deposit" ? "deposit" : "operating";
    debug.input.bucket = bucket;

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
      },
    );
    debug.resolved.appProjection = appDoc ?? null;
    if (!appDoc) {
      debug.step = "app_not_found";
      return done(404, { error: "app_not_found" });
    }

    /* ---------- permission: user ∈ household ---------- */
    const hhId = String(appDoc.householdId || "");
    const userId = String(
      (user as any)?.id ?? (user as any)?._id ?? "",
    );
    debug.resolved.householdId = hhId || null;
    debug.resolved.userId = userId || null;

    if (hhId && userId) {
      const hhIdObj = isObjectIdLike(hhId) ? new ObjectId(hhId) : null;
      const membership = await memberships.findOne(
        {
          userId,
          active: true,
          householdId: hhIdObj ? { $in: [hhId, hhIdObj] } : hhId,
        },
        { projection: { _id: 1 } },
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
      const formIdLookup = isObjectIdLike(appDoc.formId)
        ? new ObjectId(String(appDoc.formId))
        : String(appDoc.formId);

      const form = await applicationForms.findOne(
        { _id: formIdLookup as any },
        { projection: { firmId: 1, firmName: 1, firmSlug: 1 } },
      );

      if (form?.firmId) firmId = String(form.firmId);
      debug.resolved.formBridge = form
        ? {
            firmId: form.firmId,
            firmName: form.firmName,
            firmSlug: form.firmSlug,
          }
        : null;
    }
    if (!firmId) {
      const leaseByApp = await leases.findOne(
        { appId },
        { projection: { firmId: 1, _id: 1, status: 1 } },
      );
      if (leaseByApp?.firmId) firmId = String(leaseByApp.firmId);
      debug.resolved.leaseByApp = leaseByApp
        ? {
            _id: leaseByApp._id,
            firmId: leaseByApp.firmId,
            status: leaseByApp.status,
          }
        : null;
    }
    debug.resolved.firmId = firmId ?? null;
    if (!firmId) {
      debug.step = "resolve_firm_failed";
      return done(400, { error: "missing_firm" });
    }

    /* ---------- idempotency on requestId: no overrides ---------- */
    if (requestId && requestId.trim()) {
      const existingForRequest = await paymentsCol
        .find({
          appId,
          firmId,
          "meta.requestId": requestId.trim(),
        })
        .toArray();

      if (existingForRequest.length > 0) {
        debug.step = "request_already_processed";
        debug.decision.idempotent = existingForRequest.map((p) => ({
          kind: p.kind,
          amountCents: p.amountCents,
          status: p.status,
        }));
        return done(409, {
          error: "request_already_processed",
          detail: {
            requestId: requestId.trim(),
          },
        });
      }
    }

    /* ---------- routing accounts ---------- */
    const firmDoc = await firms.findOne(
      { _id: firmId as any },
      { projection: { stripe: 1, name: 1, _id: 1 } },
    );
    debug.resolved.firmDoc = {
      _id: firmDoc?._id ?? null,
      name: firmDoc?.name ?? null,
      hasStripe: !!firmDoc?.stripe,
      escrowAccountId: firmDoc?.stripe?.escrowAccountId ?? null,
      operatingAccountId: firmDoc?.stripe?.operatingAccountId ?? null,
    };
    if (!firmDoc?.stripe) {
      debug.step = "firm_missing_stripe";
      return done(400, { error: "firm_missing_stripe" });
    }
    const escrowAccountId = firmDoc.stripe.escrowAccountId as
      | string
      | undefined;
    const operatingAccountId = firmDoc.stripe.operatingAccountId as
      | string
      | undefined;

    /* ---------- plan totals + payments progress ---------- */
    const {
      plan,
      firstCents,
      lastCents,
      step1OpTotal,
      step1DepTotal,
      step2OpTotal,
      step2DepTotal,
    } = computePlanTotals(appDoc);


    const rawPays = await paymentsCol
      .find(
        { appId, firmId },
        {
          projection: {
            kind: 1,
            status: 1,
            amountCents: 1,
            createdAt: 1,
          },
        },
      )
      .toArray();

    const payments: PaymentLite[] = rawPays.map((p: any) => ({
      kind: (p.kind ?? "operating") as Bucket | "upfront",
      status: (p.status ?? "created") as Status,
      amountCents: safeNum(p.amountCents),
      createdAt:
        p.createdAt instanceof Date
          ? p.createdAt
          : new Date(p.createdAt ?? Date.now()),
    }));

    const progress = computeStepProgress(
      payments,
      step1OpTotal,
      step1DepTotal,
      step2OpTotal,
      step2DepTotal,
    );
    debug.amounts.progress = progress;

    /* ---------- infer payer (billing_details) ---------- */
    const answers = (appDoc as any)?.answersByMember ?? {};
    const mine = answers?.[userId] ?? null;
    const formName =
      (mine?.answers?.q_name as string) ??
      (mine?.answers?.name as string) ??
      null;
    const payerName =
      (formName && String(formName).trim()) ||
      (user as any)?.preferredName ||
      (user as any)?.name ||
      ((user as any)?.email
        ? String((user as any).email)
            .split("@")[0]
            .replace(/[._]/g, " ")
        : "Tenant");
    const payerEmail = (user as any)?.email || undefined;

    debug.resolved.payer = { payerName, payerEmail };

    /* ---------- STRICT: paymentMethodId must be provided + belong to this user ---------- */
    if (!paymentMethodId || !paymentMethodId.trim()) {
      debug.step = "missing_payment_method_id";
      return done(400, { error: "missing_payment_method_id" });
    }

    const usersCol = users;
    const userLookupId = isObjectIdLike(userId)
      ? new ObjectId(userId)
      : userId;

    const uDoc = await usersCol.findOne(
      { _id: userLookupId as any },
      {
        projection: {
          bankPaymentMethods: 1,
        },
      },
    );

    const methods: any[] =
      (uDoc as any)?.bankPaymentMethods ?? [];

    const pmEntry = methods.find(
      (m) => m && String(m.id) === paymentMethodId,
    );

    if (!pmEntry) {
      debug.step = "payment_method_not_owned";
      return done(403, {
        error: "payment_method_not_owned",
      });
    }

    let stripeCustomerId: string | null =
      pmEntry.stripeCustomerId || null;

    if (!stripeCustomerId) {
      debug.step = "missing_stripe_customer_on_pm";
      return done(400, {
        error: "missing_stripe_customer",
      });
    }

    // Optional: retrieve PM for label + sanity check
    let savedBankLabel: string | null = null;
    try {
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
      const pmCustomer =
        typeof pm.customer === "string" ? pm.customer : null;
      if (pmCustomer && pmCustomer !== stripeCustomerId) {
        debug.step = "pm_customer_mismatch";
        return done(400, {
          error: "payment_method_customer_mismatch",
        });
      }
      const bankName =
        (pm as any)?.us_bank_account?.bank_name || "Bank account";
      const last4 = (pm as any)?.us_bank_account?.last4 || "";
      savedBankLabel = last4
        ? `${bankName} \u2022\u2022\u2022\u2022${last4}`
        : bankName;
    } catch (e: any) {
      debug.stripe.errors.pmRetrieve =
        e?.message || "pm_retrieve_failed";
    }

    debug.stripe.customer = {
      used: stripeCustomerId,
      effectivePmId: paymentMethodId,
    };

    const baseIdemKey = newIdemKey("pay", requestId);
    const now = new Date();

    /* ─────────────────────────────────────────────────────────────
       Branch 1: COMBINED SIGNING PAYMENT (Step 1)
    ────────────────────────────────────────────────────────────── */

    const isSigningCombined =
      reason === "signing_combined" && bucket === "operating";

    if (isSigningCombined) {
      debug.step = "signing_combined_flow";

      const step1RemOp = progress.step1.operatingRemaining;
      const step1RemDep = progress.step1.depositRemaining;
      const step1RemTotal = progress.step1.remainingTotal;

      if (step1RemTotal <= 0) {
        debug.step = "step1_already_satisfied";
        return done(400, {
          error: "step_already_satisfied",
          detail: { step: 1 },
        });
      }

      const requested = i32(amountCents);
      debug.amounts.requested = requested;
      if (!Number.isFinite(requested) || requested <= 0) {
        debug.step = "invalid_amount_step1";
        return done(400, { error: "invalid_amount" });
      }

      if (requested !== step1RemTotal) {
        debug.step = "amount_not_allowed_step1";
        return done(400, {
          error: "amount_not_allowed",
          detail: {
            step: 1,
            requested,
            required: step1RemTotal,
          },
        });
      }

      // Consensus with splitHint
      if (splitHint) {
        const hintOp = i32(splitHint.operatingCents);
        const hintDep = i32(splitHint.depositCents);

        debug.amounts.splitHint_step1 = {
          hintOp,
          hintDep,
          canonOp: step1RemOp,
          canonDep: step1RemDep,
        };

        if (
          Number.isFinite(hintOp) &&
          Number.isFinite(hintDep) &&
          (hintOp !== step1RemOp || hintDep !== step1RemDep)
        ) {
          debug.step = "split_mismatch_step1";
          return done(409, {
            error: "split_mismatch",
            detail: {
              step: 1,
              requested,
              canonical: {
                operatingCents: step1RemOp,
                depositCents: step1RemDep,
              },
              hint: {
                operatingCents: hintOp,
                depositCents: hintDep,
              },
            },
          });
        }
      }

      const opRequested = step1RemOp;
      const depRequested = step1RemDep;

      if (!operatingAccountId || !escrowAccountId) {
        debug.step = "missing_destination_accounts_step1";
        return done(400, {
          error: "missing_destination_account",
        });
      }

      const results: {
        mode: "combined";
        operating?: { piId: string; amountCents: number };
        deposit?: { piId: string; amountCents: number };
      } = { mode: "combined" };

      // Operating PI
      if (opRequested > 0) {
        const idemOp = `${baseIdemKey}:op`;
        let piOp: Stripe.PaymentIntent | null = null;

        try {
          piOp = await stripe.paymentIntents.create(
            {
              amount: opRequested,
              currency: "usd",
              description: `Operating payment for application ${appId}`,
              customer: stripeCustomerId,
              payment_method: paymentMethodId!,
              confirm: true,
              off_session: false,
              payment_method_types: ["us_bank_account"],
              transfer_data: { destination: operatingAccountId },
              receipt_email: payerEmail,
              metadata: {
                appId,
                firmId,
                type: "operating",
                reason: "signing_combined",
                initiatedBy: String(
                  (user as any)?.email || (user as any)?._id || "",
                ),
              },
            },
            { idempotencyKey: idemOp },
          );

          results.operating = {
            piId: piOp.id,
            amountCents: opRequested,
          };

          await paymentsCol.insertOne({
            appId,
            firmId: firmId || "",
            leaseId: null,
            kind: "operating",
            status: "processing" as Status,
            amountCents: opRequested,
            currency: "USD",
            provider: "stripe",
            providerIds: { paymentIntentId: piOp.id },
            createdAt: now,
            updatedAt: now,
            meta: {
              session: "tenant.signing_combined",
              by: String(
                (user as any)?.email || (user as any)?._id || "user",
              ),
              reason: "signing_combined_operating",
              destinationAccount: operatingAccountId,
              rails: "ach",
              idempotencyKey: idemOp,
              requestId: requestId ?? null,
            },
          });
        } catch (e: any) {
          debug.stripe.errors.opCombined =
            e?.message || "combined_operating_failed";
          return done(500, { error: "operating_pi_create_failed" });
        }
      }

      // Deposit PI
      if (depRequested > 0) {
        const idemDep = `${baseIdemKey}:dep`;
        let piDep: Stripe.PaymentIntent | null = null;

        try {
          piDep = await stripe.paymentIntents.create(
            {
              amount: depRequested,
              currency: "usd",
              description: `Security deposit for application ${appId}`,
              customer: stripeCustomerId,
              payment_method: paymentMethodId!,
              confirm: true,
              off_session: false,
              payment_method_types: ["us_bank_account"],
              transfer_data: { destination: escrowAccountId },
              receipt_email: payerEmail,
              metadata: {
                appId,
                firmId,
                type: "deposit",
                reason: "signing_combined",
                initiatedBy: String(
                  (user as any)?.email || (user as any)?._id || "",
                ),
              },
            },
            { idempotencyKey: idemDep },
          );

          results.deposit = {
            piId: piDep.id,
            amountCents: depRequested,
          };

          await paymentsCol.insertOne({
            appId,
            firmId: firmId || "",
            leaseId: null,
            kind: "deposit",
            status: "processing" as Status,
            amountCents: depRequested,
            currency: "USD",
            provider: "stripe",
            providerIds: { paymentIntentId: piDep.id },
            createdAt: now,
            updatedAt: now,
            meta: {
              session: "tenant.signing_combined",
              by: String(
                (user as any)?.email || (user as any)?._id || "user",
              ),
              reason: "signing_combined_deposit",
              destinationAccount: escrowAccountId,
              rails: "ach",
              idempotencyKey: idemDep,
              requestId: requestId ?? null,
            },
          });
        } catch (e: any) {
          debug.stripe.errors.depCombined =
            e?.message || "combined_deposit_failed";
          return done(500, { error: "deposit_pi_create_failed" });
        }
      }

      debug.step = "ok_combined_step1";
      return done(200, {
        ok: true,
        mode: "signing_combined",
        summary: {
          totalRequestedCents: step1RemTotal,
          operatingCents: step1RemOp,
          depositCents: step1RemDep,
          bankLabel: savedBankLabel,
        },
      });
    }

    /* ─────────────────────────────────────────────────────────────
       Branch 2: COMBINED MOVE-IN PAYMENT (Step 2)
       reason === "movein_combined"
    ────────────────────────────────────────────────────────────── */

    const isMoveInCombined =
      reason === "movein_combined" && bucket === "operating";

    if (isMoveInCombined) {
      debug.step = "movein_combined_flow";

      const step2RemOp = progress.step2.operatingRemaining;
      const step2RemDep = progress.step2.depositRemaining;
      const step2RemTotal = progress.step2.remainingTotal;

      if (step2RemTotal <= 0) {
        debug.step = "step2_already_satisfied";
        return done(400, {
          error: "step_already_satisfied",
          detail: { step: 2 },
        });
      }

      const requested = i32(amountCents);
      debug.amounts.requested = requested;
      if (!Number.isFinite(requested) || requested <= 0) {
        debug.step = "invalid_amount_step2";
        return done(400, { error: "invalid_amount" });
      }

      if (requested !== step2RemTotal) {
        debug.step = "amount_not_allowed_step2";
        return done(400, {
          error: "amount_not_allowed",
          detail: {
            step: 2,
            requested,
            required: step2RemTotal,
          },
        });
      }

      if (splitHint) {
        const hintOp = i32(splitHint.operatingCents);
        const hintDep = i32(splitHint.depositCents);

        debug.amounts.splitHint_step2 = {
          hintOp,
          hintDep,
          canonOp: step2RemOp,
          canonDep: step2RemDep,
        };

        if (
          Number.isFinite(hintOp) &&
          Number.isFinite(hintDep) &&
          (hintOp !== step2RemOp || hintDep !== step2RemDep)
        ) {
          debug.step = "split_mismatch_step2";
          return done(409, {
            error: "split_mismatch",
            detail: {
              step: 2,
              requested,
              canonical: {
                operatingCents: step2RemOp,
                depositCents: step2RemDep,
              },
              hint: {
                operatingCents: hintOp,
                depositCents: hintDep,
              },
            },
          });
        }
      }

      const opRequested = step2RemOp;
      const depRequested = step2RemDep;

      if (!operatingAccountId || !escrowAccountId) {
        debug.step = "missing_destination_accounts_step2";
        return done(400, {
          error: "missing_destination_account",
        });
      }

      const results: {
        mode: "combined";
        operating?: { piId: string; amountCents: number };
        deposit?: { piId: string; amountCents: number };
      } = { mode: "combined" };

      // Operating PI
      if (opRequested > 0) {
        const idemOp = `${baseIdemKey}:step2-op`;
        let piOp: Stripe.PaymentIntent | null = null;

        try {
          piOp = await stripe.paymentIntents.create(
            {
              amount: opRequested,
              currency: "usd",
              description: `Move-in operating payment for application ${appId}`,
              customer: stripeCustomerId,
              payment_method: paymentMethodId!,
              confirm: true,
              off_session: false,
              payment_method_types: ["us_bank_account"],
              transfer_data: { destination: operatingAccountId },
              receipt_email: payerEmail,
              metadata: {
                appId,
                firmId,
                type: "operating",
                reason: "movein_combined",
                initiatedBy: String(
                  (user as any)?.email || (user as any)?._id || "",
                ),
              },
            },
            { idempotencyKey: idemOp },
          );

          results.operating = {
            piId: piOp.id,
            amountCents: opRequested,
          };

          await paymentsCol.insertOne({
            appId,
            firmId: firmId || "",
            leaseId: null,
            kind: "operating",
            status: "processing" as Status,
            amountCents: opRequested,
            currency: "USD",
            provider: "stripe",
            providerIds: { paymentIntentId: piOp.id },
            createdAt: now,
            updatedAt: now,
            meta: {
              session: "tenant.movein_combined",
              by: String(
                (user as any)?.email || (user as any)?._id || "user",
              ),
              reason: "movein_combined_operating",
              destinationAccount: operatingAccountId,
              rails: "ach",
              idempotencyKey: idemOp,
              requestId: requestId ?? null,
            },
          });
        } catch (e: any) {
          debug.stripe.errors.opCombined2 =
            e?.message || "movein_operating_failed";
          return done(500, { error: "operating_pi_create_failed" });
        }
      }

      // Deposit PI
      if (depRequested > 0) {
        const idemDep = `${baseIdemKey}:step2-dep`;
        let piDep: Stripe.PaymentIntent | null = null;

        try {
          piDep = await stripe.paymentIntents.create(
            {
              amount: depRequested,
              currency: "usd",
              description: `Move-in security deposit for application ${appId}`,
              customer: stripeCustomerId,
              payment_method: paymentMethodId!,
              confirm: true,
              off_session: false,
              payment_method_types: ["us_bank_account"],
              transfer_data: { destination: escrowAccountId },
              receipt_email: payerEmail,
              metadata: {
                appId,
                firmId,
                type: "deposit",
                reason: "movein_combined",
                initiatedBy: String(
                  (user as any)?.email || (user as any)?._id || "",
                ),
              },
            },
            { idempotencyKey: idemDep },
          );

          results.deposit = {
            piId: piDep.id,
            amountCents: depRequested,
          };

          await paymentsCol.insertOne({
            appId,
            firmId: firmId || "",
            leaseId: null,
            kind: "deposit",
            status: "processing" as Status,
            amountCents: depRequested,
            currency: "USD",
            provider: "stripe",
            providerIds: { paymentIntentId: piDep.id },
            createdAt: now,
            updatedAt: now,
            meta: {
              session: "tenant.movein_combined",
              by: String(
                (user as any)?.email || (user as any)?._id || "user",
              ),
              reason: "movein_combined_deposit",
              destinationAccount: escrowAccountId,
              rails: "ach",
              idempotencyKey: idemDep,
              requestId: requestId ?? null,
            },
          });
        } catch (e: any) {
          debug.stripe.errors.depCombined2 =
            e?.message || "movein_deposit_failed";
          return done(500, { error: "deposit_pi_create_failed" });
        }
      }

      debug.step = "ok_combined_step2";
      return done(200, {
        ok: true,
        mode: "movein_combined",
        summary: {
          totalRequestedCents: step2RemTotal,
          operatingCents: step2RemOp,
          depositCents: step2RemDep,
          bankLabel: savedBankLabel,
        },
      });
    }

 /* ─────────────────────────────────────────────────────────────
       Branch 3: monthly rent prepayment (Step 3)
       reason === "monthly_rent"
    ────────────────────────────────────────────────────────────── */

    if (reason === "monthly_rent") {
      debug.step = "monthly_rent_flow";

      const monthlyRentCents = Number((plan as any)?.monthlyRentCents ?? 0);
      const termMonths = Number((plan as any)?.termMonths ?? 0);

      if (!monthlyRentCents || !termMonths) {
        debug.step = "rent_not_configured";
        return done(400, { error: "rent_not_configured" });
      }

      // Require Step 1 and Step 2 to be fully satisfied
      const step1Remaining = progress.step1.remainingTotal;
      const step2Remaining = progress.step2.remainingTotal;
      if (step1Remaining > 0 || step2Remaining > 0) {
        debug.step = "presteps_not_complete_for_rent";
        return done(400, {
          error: "presteps_not_complete",
          detail: {
            step1Remaining,
            step2Remaining,
          },
        });
      }

      // Total scheduled rent over the term
      const totalScheduledRentCents =
        monthlyRentCents * termMonths;

      // First + last month rent that were collected up front
      const totalPrepaidRentCents =
        safeNum(firstCents) + safeNum(lastCents);

      // Rent already paid as "rent" payments
      const paidStatuses = new Set<Status>(["processing", "succeeded"]);
      let rentPaidCents = 0;
      for (const p of payments) {
        if (!paidStatuses.has(p.status)) continue;
        if (p.kind === "rent") {
          rentPaidCents += safeNum(p.amountCents);
        }
      }

      const remainingRentCents = Math.max(
        0,
        totalScheduledRentCents -
          totalPrepaidRentCents -
          rentPaidCents,
      );

      const requestedRent = i32(amountCents);
      debug.amounts.requested = requestedRent;
      debug.amounts.rent = {
        monthlyRentCents,
        termMonths,
        totalScheduledRentCents,
        totalPrepaidRentCents,
        rentPaidCents,
        remainingRentCents,
      };

      // 1) amount > 0
      if (!Number.isFinite(requestedRent) || requestedRent <= 0) {
        debug.step = "invalid_amount_rent";
        return done(400, { error: "invalid_amount" });
      }

      // 2) amount <= total remaining rent to be paid
      if (requestedRent > remainingRentCents) {
        debug.step = "amount_exceeds_remaining_rent";
        return done(400, {
          error: "amount_not_allowed",
          detail: {
            kind: "rent",
            requested: requestedRent,
            remaining: remainingRentCents,
          },
        });
      }

      // 3) amount divisible by the monthly rent
      if (requestedRent % monthlyRentCents !== 0) {
        debug.step = "amount_not_multiple_of_rent";
        return done(400, {
          error: "amount_not_allowed",
          detail: {
            kind: "rent",
            requested: requestedRent,
            monthlyRentCents,
          },
        });
      }

      const rentDestination = operatingAccountId;
      if (!rentDestination) {
        debug.step = "missing_operating_for_rent";
        return done(400, {
          error: "missing_operating_account",
        });
      }

      const description = `Rent payment for application ${appId}`;
      const idemKey = newIdemKey("pay", requestId);
      let pi: Stripe.PaymentIntent | null = null;

      try {
        pi = await stripe.paymentIntents.create(
          {
            amount: requestedRent,
            currency: "usd",
            description,
            customer: stripeCustomerId!,
            payment_method: paymentMethodId!,
            confirm: true,
            off_session: false,
            payment_method_types: ["us_bank_account"],
            transfer_data: { destination: rentDestination },
            receipt_email: payerEmail,
            metadata: {
              appId,
              firmId,
              type: "rent",
              reason: "monthly_rent",
              initiatedBy: String(
                (user as any)?.email || (user as any)?._id || "",
              ),
            },
          },
          { idempotencyKey: idemKey },
        );

        await paymentsCol.insertOne({
          appId,
          firmId: firmId || "",
          leaseId: null,
          kind: "rent",
          status: "processing" as Status,
          amountCents: requestedRent,
          currency: "USD",
          provider: "stripe",
          providerIds: { paymentIntentId: pi.id },
          createdAt: now,
          updatedAt: now,
          meta: {
            session: "tenant.monthly_rent",
            by: String(
              (user as any)?.email || (user as any)?._id || "user",
            ),
            reason: "monthly_rent",
            destinationAccount: rentDestination,
            rails: "ach",
            idempotencyKey: idemKey,
            requestId: requestId ?? null,
          },
        });

        debug.step = "ok_monthly_rent";
        return done(200, {
          ok: true,
          mode: "monthly_rent",
          paymentIntentId: pi.id,
          summary: {
            amountCents: requestedRent,
            months: requestedRent / monthlyRentCents,
            bankLabel: savedBankLabel,
          },
        });
      } catch (e: any) {
        debug.stripe.errors.monthlyRent =
          e?.message || "monthly_rent_failed";
        return done(500, { error: "pi_create_failed" });
      }
    }

    // Fallback: single-bucket top-up (operating or deposit only)
    const requested = i32(amountCents);
    debug.amounts.requested = requested;

    // Remaining room in each bucket across both steps
    const opRemainingTotal =
      safeNum(progress.step1.operatingRemaining) +
      safeNum(progress.step2.operatingRemaining);
    const depRemainingTotal =
      safeNum(progress.step1.depositRemaining) +
      safeNum(progress.step2.depositRemaining);

    if (!Number.isFinite(requested) || requested <= 0) {
      debug.step = "invalid_amount_single";
      return done(400, { error: "invalid_amount" });
    }

    let maxAllowed = 0;
    if (bucket === "operating") {
      maxAllowed = opRemainingTotal;
    } else if (bucket === "deposit") {
      maxAllowed = depRemainingTotal;
    }

    if (requested > maxAllowed || maxAllowed <= 0) {
      debug.step = "amount_not_allowed_single";
      return done(400, {
        error: "amount_not_allowed",
        detail: {
          bucket,
          requested,
          remaining: maxAllowed,
        },
      });
    }

    const destination =
      bucket === "deposit" ? escrowAccountId : operatingAccountId;
    if (!destination) {
      debug.step = "missing_destination_single";
      return done(400, {
        error:
          bucket === "deposit"
            ? "missing_escrow_account"
            : "missing_operating_account",
      });
    }

    const description =
      bucket === "deposit"
        ? `Security deposit for application ${appId}`
        : `Operating payment for application ${appId}`;

    // Direct PM flow
    const idemKey = newIdemKey("pay", requestId);
    let pi: Stripe.PaymentIntent | null = null;

    try {
      pi = await stripe.paymentIntents.create(
        {
          amount: requested,
          currency: "usd",
          description,
          customer: stripeCustomerId!,
          payment_method: paymentMethodId!,
          confirm: true,
          off_session: false,
          payment_method_types: ["us_bank_account"],
          transfer_data: { destination },
          receipt_email: payerEmail,
          metadata: {
            appId,
            firmId,
            type: bucket,
            reason:
              reason ||
              (bucket === "deposit"
                ? "deposit_minimum"
                : "operating_top_up"),
            initiatedBy: String(
              (user as any)?.email || (user as any)?._id || "",
            ),
          },
        },
        { idempotencyKey: idemKey },
      );

      await paymentsCol.insertOne({
        appId,
        firmId: firmId || "",
        leaseId: null,
        kind: bucket,
        status: "processing" as Status,
        amountCents: requested,
        currency: "USD",
        provider: "stripe",
        providerIds: { paymentIntentId: pi.id },
        createdAt: now,
        updatedAt: now,
        meta: {
          session: "tenant.single_direct_pm",
          by: String(
            (user as any)?.email || (user as any)?._id || "user",
          ),
          reason:
            reason ||
            (bucket === "deposit"
              ? "deposit_minimum"
              : "operating_top_up"),
          destinationAccount: destination,
          rails: "ach",
          idempotencyKey: idemKey,
          requestId: requestId ?? null,
        },
      });

      return done(200, {
        ok: true,
        mode: "single_direct_pm",
        paymentIntentId: pi.id,
        summary: {
          amountCents: requested,
          bankLabel: savedBankLabel,
        },
      });
    } catch (e: any) {
      debug.stripe.errors.single =
        e?.message || "single_direct_pm_failed";
      return done(500, { error: "pi_create_failed" });
    }
  } catch (e: any) {
    const msg = e?.message || "server_error";
    const url2 = new URL(req.url);
    return NextResponse.json(
      {
        error: msg,
        ...(url2.searchParams.get("debug") === "1"
          ? { debug: { error: msg } }
          : {}),
      },
      { status: 500 },
    );
  }
}
