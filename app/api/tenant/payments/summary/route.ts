import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { ObjectId } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tenant/payments/summary?appId=...&firmId=...
 *
 * Driven off application.paymentPlan + countersign + payments,
 * not obligations / charges. Conceptually:
 *
 * Plan (totals):
 *   Step 1:
 *     - operating: countersign.upfrontMinCents
 *     - deposit:   countersign.depositMinCents
 *
 *   Step 2:
 *     - operating: upfrontTotals.firstCents + lastCents + keyCents
 *                  - countersign.upfrontMinCents
 *     - deposit:   upfrontTotals.securityCents - countersign.depositMinCents
 *
 *   Step 3:
 *     - monthly:   paymentPlan.monthlyRentCents
 *
 * Payments:
 *   - Sum all payments for this app (and firm) by kind & status
 *   - Treat kind "upfront" and "operating" as operating bucket
 *   - Treat kind "deposit" as deposit bucket
 *   - Statuses counted as "paid": processing, succeeded
 *   - Allocate operating + deposit paid into Step 1 first, then Step 2.
 *
 * Returns:
 * {
 *   ok: true,
 *   upfrontDueCents: number,   // total operating upfront (step1 + step2)
 *   depositDueCents: number,   // total deposit (step1 + step2)
 *   upfrontMinCents?: number,  // signing upfront threshold
 *   depositMinCents?: number,  // signing deposit threshold
 *   plan: { ... },             // UI-friendly totals per step
 *   progress: {
 *     step1: { ... },          // totals + paid + remaining
 *     step2: { ... },
 *     totals: { operatingPaidCents, depositPaidCents }
 *   }
 * }
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const appIdRaw = url.searchParams.get("appId") || "";
  const firmId = url.searchParams.get("firmId") || undefined;

  if (!appIdRaw) {
    return NextResponse.json(
      { ok: false, error: "missing_appId" },
      { status: 400 },
    );
  }

  const looksLikeObjectId = /^[a-f\d]{24}$/i.test(appIdRaw);
  const appIdForLookup = looksLikeObjectId
    ? new ObjectId(appIdRaw)
    : appIdRaw;

  const db = await getDb();
  const applications = db.collection("applications");
  const paymentsCol = db.collection("payments");

  // Pull the application – everything is derived from this
  const app = await applications.findOne(
    { _id: appIdForLookup as any },
    {
      projection: {
        _id: 1,
        firmId: 1,
        countersign: 1,
        paymentPlan: 1,
        protoLease: 1,
      },
    },
  );

  if (!app) {
    return NextResponse.json(
      { ok: false, error: "app_not_found" },
      { status: 404 },
    );
  }

  const plan = app.paymentPlan || {};
  const cs = app.countersign || {};
  const totals = plan.upfrontTotals || {};

  /* ─────────────────────────────────────────────────────────────
     1) Plan totals – how big each step is in theory
  ────────────────────────────────────────────────────────────── */

  // Upfront components
  const firstCents = Number(totals.firstCents || 0);
  const lastCents = Number(totals.lastCents || 0);
  const keyCents = Number(totals.keyCents || 0);
  const securityCents = Number(
    totals.securityCents ?? plan.securityCents ?? 0,
  );
  const totalUpfrontCents = Number(
    totals.totalUpfrontCents ||
      firstCents +
        lastCents +
        keyCents +
        securityCents +
        Number(totals.otherUpfrontCents || 0),
  );

  // Signing thresholds (Step 1 totals)
  const upfrontMinCentsRaw =
    cs.upfrontMinCents ?? plan.countersignUpfrontThresholdCents ?? 0;
  const depositMinCentsRaw =
    cs.depositMinCents ?? plan.countersignDepositThresholdCents ?? 0;

  const upfrontMinCents = Math.max(0, Number(upfrontMinCentsRaw || 0));
  const depositMinCents = Math.max(0, Number(depositMinCentsRaw || 0));

  // Step 1 (signing) totals
  const step1OperatingCents = upfrontMinCents;
  const step1DepositCents = depositMinCents;

  // Step 2 (before move-in) totals
  const step2OperatingCents = Math.max(
    0,
    firstCents + lastCents + keyCents - upfrontMinCents,
  );
  const step2DepositCents = Math.max(
    0,
    securityCents - depositMinCents,
  );

  // Step 3 (monthly) totals
  const monthlyRentCents = Number(
    plan.monthlyRentCents ?? app.protoLease?.monthlyRent ?? 0,
  );
  const termMonths = Number(
    plan.termMonths ?? app.protoLease?.termMonths ?? 0,
  );
  const moveInDateISO =
    plan.startDate ?? app.protoLease?.moveInDate ?? null;

  // Aggregate totals for summary (operating/deposit "upfront" buckets only)
  const upfrontDueCents = step1OperatingCents + step2OperatingCents;
  const depositDueCents = step1DepositCents + step2DepositCents;

  // Plan-level monthly rent
  const totalScheduledRentCents =
    monthlyRentCents > 0 && termMonths > 0
      ? monthlyRentCents * termMonths
      : 0;

  const requireFirstBeforeMoveIn = !!plan.requireFirstBeforeMoveIn;
  const requireLastBeforeMoveIn = !!plan.requireLastBeforeMoveIn;

  const planSummary = {
    signing: {
      upfrontThresholdCents: upfrontMinCents,
      depositThresholdCents: depositMinCents,
    },
    moveIn: {
      firstMonthCents: firstCents,
      lastMonthCents: lastCents,
      keyFeeCents: keyCents,
      securityDepositCents: securityCents,
      totalUpfrontCents,
      requireFirstBeforeMoveIn,
      requireLastBeforeMoveIn,
      stepTwoOperatingCents: step2OperatingCents,
      stepTwoDepositCents: step2DepositCents,
    },
    monthly: {
      monthlyRentCents,
      termMonths,
      moveInDateISO,
      totalScheduledRentCents,
    },
  };

  /* ─────────────────────────────────────────────────────────────
     2) Payments – how much has been paid toward each bucket
  ────────────────────────────────────────────────────────────── */

  // Load all payments for this app (and firm if provided)
  const paymentFilter: Record<string, any> = { appId: appIdRaw };
  if (firmId) paymentFilter.firmId = firmId;

  const payments = await paymentsCol
    .find(paymentFilter, {
      projection: {
        kind: 1,
        status: 1,
        amountCents: 1,
      },
    })
    .toArray();

  // Which statuses count as "paid" against gates
  const paidStatuses = new Set<string>([
    "processing",
    "succeeded",
  ]);

  // Aggregate paid amounts into operating vs deposit buckets.
  // - Treat "upfront" and "operating" as the same operating bucket
  // - Treat "deposit" as deposit bucket
  let operatingPaidCents = 0;
  let depositPaidCents = 0;

  for (const p of payments) {
    const status = String(p.status);
    if (!paidStatuses.has(status)) continue;

    const amt = Number(p.amountCents || 0);
    if (!Number.isFinite(amt) || amt <= 0) continue;

    const kind = p.kind;
    if (kind === "deposit") {
      depositPaidCents += amt;
    } else if (kind === "upfront" || kind === "operating") {
      operatingPaidCents += amt;
    }
    // rent/fee buckets are ignored here; they affect Step 3+ only
  }

  // Allocate operating/deposit paid to Step 1 first, then Step 2.

  // Step 1 allocation
  let opRemainingForAllocation = operatingPaidCents;
  let depRemainingForAllocation = depositPaidCents;

  const step1OperatingPaidCents = Math.min(
    step1OperatingCents,
    opRemainingForAllocation,
  );
  opRemainingForAllocation -= step1OperatingPaidCents;

  const step1DepositPaidCents = Math.min(
    step1DepositCents,
    depRemainingForAllocation,
  );
  depRemainingForAllocation -= step1DepositPaidCents;

  const step1OperatingRemainingCents =
    step1OperatingCents - step1OperatingPaidCents;
  const step1DepositRemainingCents =
    step1DepositCents - step1DepositPaidCents;
  const step1RemainingTotalCents =
    step1OperatingRemainingCents + step1DepositRemainingCents;

  const step1Met =
    step1OperatingRemainingCents <= 0 && step1DepositRemainingCents <= 0;

  // Step 2 allocation
  const step2OperatingPaidCents = Math.min(
    step2OperatingCents,
    opRemainingForAllocation,
  );
  opRemainingForAllocation -= step2OperatingPaidCents;

  const step2DepositPaidCents = Math.min(
    step2DepositCents,
    depRemainingForAllocation,
  );
  depRemainingForAllocation -= step2DepositPaidCents;

  const step2OperatingRemainingCents =
    step2OperatingCents - step2OperatingPaidCents;
  const step2DepositRemainingCents =
    step2DepositCents - step2DepositPaidCents;
  const step2RemainingTotalCents =
    step2OperatingRemainingCents + step2DepositRemainingCents;

  const step2Met =
    step2OperatingRemainingCents <= 0 && step2DepositRemainingCents <= 0;

  const inStep1Now = step1RemainingTotalCents > 0;
  const inStep2Now = !inStep1Now && step2RemainingTotalCents > 0;

  /* ─────────────────────────────────────────────────────────────
     3) Response body
  ────────────────────────────────────────────────────────────── */

  const body: any = {
    ok: true,
    upfrontDueCents, // total operating upfront across Step 1+2
    depositDueCents, // total deposit across Step 1+2
    plan: planSummary,
    progress: {
      step1: {
        operatingTotalCents: step1OperatingCents,
        depositTotalCents: step1DepositCents,
        operatingPaidCents: step1OperatingPaidCents,
        depositPaidCents: step1DepositPaidCents,
        operatingRemainingCents: step1OperatingRemainingCents,
        depositRemainingCents: step1DepositRemainingCents,
        remainingTotalCents: step1RemainingTotalCents,
        met: step1Met,
      },
      step2: {
        operatingTotalCents: step2OperatingCents,
        depositTotalCents: step2DepositCents,
        operatingPaidCents: step2OperatingPaidCents,
        depositPaidCents: step2DepositPaidCents,
        operatingRemainingCents: step2OperatingRemainingCents,
        depositRemainingCents: step2DepositRemainingCents,
        remainingTotalCents: step2RemainingTotalCents,
        met: step2Met,
      },
      totals: {
        operatingPaidCents,
        depositPaidCents,
      },
      currentStep: inStep1Now ? 1 : inStep2Now ? 2 : 3,
    },
  };

  // Keep these for back-compat if you're using them anywhere:
  if (Number.isFinite(upfrontMinCents)) body.upfrontMinCents = upfrontMinCents;
  if (Number.isFinite(depositMinCents)) body.depositMinCents = depositMinCents;

  return NextResponse.json(body);
}
