// app/api/tenant/charges/route.ts
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Bucket = "upfront" | "deposit" | "rent" | "fee" | "operating";
type Status = "created" | "processing" | "succeeded" | "failed" | "canceled" | "returned";

type ChargeRow = {
  chargeKey: string;             // `${appId}:${bucket}:${code}`
  bucket: "upfront" | "deposit" | "rent"; // ← include "rent"
  code: string;                  // "key_fee" | "first_month" | "last_month" | "security_deposit" | `rent:YYYY-MM`
  label?: string;
  amountCents: number;           // total owed for this line
  priorityIndex: number;
  dueDate?: string | null;       // ISO date "YYYY-MM-DD" for UI bucketing
};

type PaymentRow = {
  kind: Bucket;                  // may be "operating" in DB; we'll normalize to "upfront"
  status: Status;
  amountCents: number;
  createdAt: Date;
};

function isObjectIdLike(v: string) {
  return /^[a-f\d]{24}$/i.test(v);
}
function toObjectIdOrString(v: string) {
  return isObjectIdLike(v) ? new ObjectId(v) : v;
}
function safeNum(x: any, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}
const LABELS: Record<string, string> = {
  first_month: "First month",
  last_month: "Last month",
  key_fee: "Key fee",
  security_deposit: "Security deposit",
};
const roundToDollar = (cents: number) => Math.round(cents / 100) * 100;

/* ---------- tiny helper: ISO (YYYY-MM-DD) => previous day in UTC ---------- */
function prevDayISO(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/* ----------------------- charge construction ----------------------- */
/**
 * Build addressable charges from the application doc.
 * Deposit is "security_deposit".
 * Lease-balance ("upfront") items: key_fee, first_month, last_month.
 * Monthly rent is **rent**, due on its own schedule (rent:YYYY-MM).
 *
 * NOTE: key/first/last get due dates set to the **day before move-in**.
 */
function buildCharges(appId: string, app: any): ChargeRow[] {
  const charges: ChargeRow[] = [];
  const push = (
    bucket: "upfront" | "deposit" | "rent",
    code: string,
    amt: number,
    prio: number,
    dueDate?: string | null
  ) => {
    const amountCents = Math.max(0, safeNum(amt));
    if (amountCents <= 0) return;
    charges.push({
      chargeKey: `${appId}:${bucket}:${code}`,
      bucket,
      code,
      label: LABELS[code] ?? (code.startsWith("rent:") ? `Rent ${code.slice(5)}` : code.replaceAll("_", " ")),
      amountCents,
      priorityIndex: prio,
      dueDate: dueDate ?? null,
    });
  };

  const plan = app?.paymentPlan ?? null;

  // Helper: add YYYY-MM rent charges strictly after move-in items,
  // skipping start/end months when first/last are upfront.
  function addMonthlyRentCharges(params: {
    startISO?: string | null;
    termMonths?: number | null;
    monthly?: number;
    basePrio?: number;
    skipFirstMonth?: boolean;
    skipLastMonth?: boolean;
  }) {
    const rent = Math.max(0, safeNum(params.monthly));
    const months = Math.max(0, safeNum(params.termMonths));
    if (!params.startISO || !months || !rent) return;

    const parts = String(params.startISO).split("-");
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (!y || !m) return;

    let year = y, month = m; // 1..12
    const base = params.basePrio ?? 2000;

    for (let i = 0; i < months; i++) {
      // Skip the first lease month if first is paid upfront
      if (i === 0 && params.skipFirstMonth) {
        month += 1;
        if (month > 12) { month = 1; year += 1; }
        continue;
      }
      // Skip the last lease month if last is paid upfront
      if (i === months - 1 && params.skipLastMonth) {
        continue;
      }

      const ym = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}`;
      // RENT LINES ARE RENT, not upfront
      push("rent", `rent:${ym}`, rent, base + i, ym + "-01");

      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
  }

  if (plan?.upfrontTotals) {
    const first = safeNum(plan.upfrontTotals.firstCents);
    const last  = safeNum(plan.upfrontTotals.lastCents);
    const key   = safeNum(plan.upfrontTotals.keyCents);
    const sec   = safeNum(plan.securityCents);

    const requireFirst = !!plan.requireFirstBeforeMoveIn && first > 0;
    const requireLast  = !!plan.requireLastBeforeMoveIn  && last  > 0;

    const prioList =
      Array.isArray(plan.priority) && plan.priority.length
        ? (plan.priority as string[])
        : ["key_fee", "first_month", "last_month", "security_deposit"];
    const prio = (code: string) => {
      const idx = prioList.indexOf(code);
      return idx >= 0 ? idx : 999;
    };

    const moveInISO =
      typeof plan?.startDate === "string" ? plan.startDate : app?.protoLease?.moveInDate ?? null;

    // Slide ONLY the move-in items to the **day before** move-in
    const preMoveInISO = moveInISO ? prevDayISO(moveInISO) : null;

    // Move-in items (lease balance)
    push("upfront", "key_fee",     key,   prio("key_fee"),     preMoveInISO);
    if (requireFirst) push("upfront", "first_month", first, prio("first_month"), preMoveInISO);
    if (requireLast)  push("upfront", "last_month",  last,  prio("last_month"),  preMoveInISO);

    // Monthly rent lines (skip the months covered by first/last upfront)
    addMonthlyRentCharges({
      startISO: plan.startDate,
      termMonths: plan.termMonths,
      monthly: plan.monthlyRentCents,
      basePrio: 2000,
      skipFirstMonth: requireFirst,
      skipLastMonth: requireLast,
    });

    // Deposit stays on the move-in/start date
    push("deposit", "security_deposit", sec, prio("security_deposit"), moveInISO);
    return charges;
  }

  // Legacy fallback (application.upfronts)
  const u = app?.upfronts ?? {};
  const moveInISO = app?.protoLease?.moveInDate ?? null;
  const preMoveInISO = moveInISO ? prevDayISO(moveInISO) : null;

  push("upfront", "key_fee",     safeNum(u.key),   0, preMoveInISO);
  push("upfront", "first_month", safeNum(u.first), 1, preMoveInISO);
  push("upfront", "last_month",  safeNum(u.last),  2, preMoveInISO);
  push("deposit", "security_deposit", safeNum(u.security), 3, moveInISO);
  return charges;
}

/* ------------------------ allocation (greedy) ----------------------- */
/**
 * Greedy allocator across charges (priority, then code) to compute
 * posted + pending per charge from payments.
 *
 * Rules:
 *  - "deposit" payments → only deposit line,
 *  - "rent" payments → only rent lines,
 *  - "upfront"/"operating" → upfront first (key/first/last), then rent lines by priority.
 */
function allocate(
  charges: ChargeRow[],
  payments: PaymentRow[]
) {
  const orderedCharges = [...charges].sort(
    (a, b) => a.priorityIndex - b.priorityIndex || a.code.localeCompare(b.code)
  );
  const postedByKey = new Map<string, number>();
  const pendingByKey = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) =>
    m.set(k, (m.get(k) ?? 0) + v);

  const orderedPayments = [...payments].sort(
    (a, b) => (a.createdAt?.getTime?.() ?? 0) - (b.createdAt?.getTime?.() ?? 0)
  );

  for (const p of orderedPayments) {
    const norm = (p.kind === "operating" ? "upfront" : p.kind) as Bucket;

    let allowed: Array<"upfront" | "deposit" | "rent"> = [];
    if (norm === "deposit") allowed = ["deposit"];
    else if (norm === "rent") allowed = ["rent"];
    else if (norm === "upfront") allowed = ["upfront", "rent"]; // spillover into rent after move-in items

    if (allowed.length === 0) continue;
    if (p.status !== "succeeded" && p.status !== "processing") continue;

    let remaining = Math.max(0, p.amountCents);
    if (remaining <= 0) continue;

    for (const c of orderedCharges) {
      if (remaining <= 0) break;
      if (!allowed.includes(c.bucket)) continue;

      const posted = postedByKey.get(c.chargeKey) ?? 0;
      const pending = pendingByKey.get(c.chargeKey) ?? 0;
      const open = Math.max(0, c.amountCents - posted - pending);
      if (open <= 0) continue;

      const take = Math.min(open, remaining);
      if (p.status === "succeeded") add(postedByKey, c.chargeKey, take);
      else add(pendingByKey, c.chargeKey, take);
      remaining -= take;
    }
  }

  return { postedByKey, pendingByKey };
}

/* ---------------------------- route ---------------------------- */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  const appIdRaw = url.searchParams.get("appId") || "";
  const firmId = url.searchParams.get("firmId") || undefined;

  if (!appIdRaw) {
    return NextResponse.json({ ok: false, error: "missing_appId" }, { status: 400 });
  }

  try {
    const db = await getDb();
    const applications = db.collection("applications");
    const paymentsCol = db.collection("payments");

    // Load the application (support string or ObjectId)
    const appIdForLookup = toObjectIdOrString(appIdRaw);
    const app = await applications.findOne(
      { _id: appIdForLookup },
      { projection: { _id: 1, paymentPlan: 1, upfronts: 1, protoLease: 1, countersign: 1 } }
    );

    const charges = buildCharges(appIdRaw, app);

    // Gross totals per bucket (before considering payments)
    const grossUpfrontCents = charges.filter(c => c.bucket === "upfront").reduce((s, c) => s + c.amountCents, 0);
    const grossDepositCents = charges.filter(c => c.bucket === "deposit").reduce((s, c) => s + c.amountCents, 0);
    // (We could add grossRentCents if you want, not required by current client.)

    // Pull payments (light) and allocate to determine posted/pending per charge
    const payMatch: Record<string, any> = { appId: appIdRaw };
    if (firmId) payMatch.firmId = firmId;

    const rawPays = await paymentsCol
      .find(payMatch, { projection: { kind: 1, status: 1, amountCents: 1, createdAt: 1 } })
      .toArray();

    const payments: PaymentRow[] = rawPays.map((p: any) => ({
      kind: (p.kind ?? "upfront") as Bucket, // may be "operating", normalized in allocate()
      status: (p.status ?? "created") as Status,
      amountCents: safeNum(p.amountCents),
      createdAt: p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt ?? Date.now()),
    }));

    const { postedByKey, pendingByKey } = allocate(charges, payments);

    // Map per-charge remaining (for UI + windows)
    let dueUpfrontCents = 0;
    let dueDepositCents = 0;

    const chargesOut = charges.map(c => {
      const posted = Math.max(0, postedByKey.get(c.chargeKey) ?? 0);
      const pending = Math.max(0, pendingByKey.get(c.chargeKey) ?? 0);
      const remaining = Math.max(0, c.amountCents - posted - pending);

      if (c.bucket === "upfront") dueUpfrontCents += remaining;
      else if (c.bucket === "deposit") dueDepositCents += remaining;
      // rent is deliberately excluded from the legacy two-bucket totals

      return {
        chargeKey: c.chargeKey,
        bucket: c.bucket,
        code: c.code,
        label: c.label,
        amountCents: c.amountCents,
        priorityIndex: c.priorityIndex,
        dueDate: c.dueDate ?? null,
        postedCents: posted,
        pendingCents: pending,
        remainingCents: remaining,
      };
    });

    /* --------- Countersign thresholds + remaining (precise) --------- */
    const upMinThresholdRaw =
      app?.countersign?.upfrontMinCents ??
      app?.paymentPlan?.countersignUpfrontThresholdCents ??
      undefined;
    const depMinThresholdRaw =
      app?.countersign?.depositMinCents ??
      app?.paymentPlan?.countersignDepositThresholdCents ??
      undefined;

    const upfrontMinThresholdCents = Number.isFinite(Number(upMinThresholdRaw)) ? Number(upMinThresholdRaw) : undefined;
    const depositMinThresholdCents = Number.isFinite(Number(depMinThresholdRaw)) ? Number(depMinThresholdRaw) : undefined;

    // how much allocated to any upfront charge (posted+pending, capped at each line amount)
    const allocatedUpfront = chargesOut
      .filter(c => c.bucket === "upfront")
      .reduce((s, c) => s + Math.min(c.amountCents, (c.postedCents ?? 0) + (c.pendingCents ?? 0)), 0);
    // how much allocated to the deposit line
    const depositLine = chargesOut.find(c => c.code === "security_deposit");
    const allocatedDeposit = depositLine ? Math.min(depositLine.amountCents, (depositLine.postedCents ?? 0) + (depositLine.pendingCents ?? 0)) : 0;

    const upfrontMinRemainingCents = upfrontMinThresholdCents !== undefined
      ? roundToDollar(Math.max(0, upfrontMinThresholdCents - allocatedUpfront))
      : undefined;

    const depositMinRemainingCents = depositMinThresholdCents !== undefined
      ? roundToDollar(Math.max(0, depositMinThresholdCents - allocatedDeposit))
      : undefined;

    /* ---------------------- Windowed dues for UX --------------------- */
    const today = new Date();
    const dateOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dToday = dateOnly(today);
    const dNext30 = new Date(dToday.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Use move-in date from plan.startDate (or protoLease.moveInDate)
    const moveInISO =
      (app?.paymentPlan?.startDate as string | undefined) ??
      (app?.protoLease?.moveInDate as string | undefined) ??
      null;
    const dMoveIn = moveInISO ? new Date(moveInISO) : null;
    const sameDay = (a?: Date | null, b?: Date | null) =>
      !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

    const isMoveInItem = (code: string) =>
      code === "key_fee" || code === "first_month" || code === "last_month";

    let dueNowCents = 0;
    let dueBeforeMoveInCents = 0;
    let dueNext30Cents = 0;

    const seen = new Set<string>(); // to avoid double counting

    // Start with countersign remaining (these are “due now” gates if configured)
    if (upfrontMinRemainingCents) dueNowCents += upfrontMinRemainingCents;
    if (depositMinRemainingCents) dueNowCents += depositMinRemainingCents;

    // Pass 1: any charge remaining with dueDate <= today → due now
    for (const c of chargesOut) {
      const rem = Math.max(0, c.remainingCents || 0);
      if (!rem) continue;
      if (!c.dueDate) continue;
      const d = new Date(c.dueDate);
      if (d <= dToday) {
        dueNowCents += rem;
        seen.add(`${c.bucket}:${c.code}`);
      }
    }

    // Pass 2: move-in items due exactly on move-in date (not already counted)
    for (const c of chargesOut) {
      const rem = Math.max(0, c.remainingCents || 0);
      if (!rem) continue;
      if (seen.has(`${c.bucket}:${c.code}`)) continue;
      if (!isMoveInItem(c.code)) continue;
      const d = c.dueDate ? new Date(c.dueDate) : null;
      if (dMoveIn && sameDay(d, dMoveIn)) {
        // Only count as before-move-in if that date is in the future
        if (d! > dToday) {
          dueBeforeMoveInCents += rem;
          seen.add(`${c.bucket}:${c.code}`);
        }
      }
    }

    // Pass 3: next 30 days window (future, not already counted)
    for (const c of chargesOut) {
      const rem = Math.max(0, c.remainingCents || 0);
      if (!rem) continue;
      if (seen.has(`${c.bucket}:${c.code}`)) continue;
      const d = c.dueDate ? new Date(c.dueDate) : null;
      if (d && d > dToday && d <= dNext30) {
        dueNext30Cents += rem;
        seen.add(`${c.bucket}:${c.code}`);
      }
    }

    const laterCents = chargesOut.reduce((s, c) => {
      const rem = Math.max(0, c.remainingCents || 0);
      if (!rem) return s;
      return seen.has(`${c.bucket}:${c.code}`) ? s : s + rem;
    }, 0);

    /* -------------------- First unpaid rent “next” ------------------- */
    const rentLines = chargesOut
      .filter(c => c.code.startsWith("rent:"))
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
    const nextRentRow = rentLines.find(c => (c.remainingCents ?? 0) > 0) || null;
    const nextRent = nextRentRow
      ? {
          ym: nextRentRow.code.slice(5), // "YYYY-MM"
          dueDateISO: nextRentRow.dueDate ?? null,
          amountCents: nextRentRow.amountCents,
          remainingCents: nextRentRow.remainingCents,
        }
      : null;

    /* -------------------- Move-in coverage chips --------------------- */
    const firstLine = chargesOut.find(c => c.code === "first_month");
    const lastLine  = chargesOut.find(c => c.code === "last_month");
    const firstCovered = firstLine ? (firstLine.remainingCents ?? 0) <= 0 : false;
    const lastCovered  = lastLine  ? (lastLine.remainingCents  ?? 0) <= 0 : false;

    /* ----------------------- Allowed quick amounts ------------------- */
    const upMinThreshold = Number(
      app?.countersign?.upfrontMinCents ??
      app?.paymentPlan?.countersignUpfrontThresholdCents ??
      NaN
    );
    const depMinThreshold = Number(
      app?.countersign?.depositMinCents ??
      app?.paymentPlan?.countersignDepositThresholdCents ??
      NaN
    );

    const upfrontRemainingNet = dueUpfrontCents;
    const depositRemainingNet = dueDepositCents;

    const minTopUpCents = roundToDollar(Math.min(upfrontRemainingNet, 100000)); // $1,000 or remaining
    const upfrontAllNow = roundToDollar(Math.max(0, upfrontRemainingNet));
    const upfrontBeyondMin = Number.isFinite(upMinThreshold)
      ? roundToDollar(Math.max(0, upfrontRemainingNet - Number(upMinThreshold)))
      : 0;

    const depositMinToPay = Number.isFinite(depMinThreshold)
      ? roundToDollar(Math.max(0, Math.min(depositRemainingNet, Number(depMinThreshold))))
      : roundToDollar(Math.max(0, depositRemainingNet));

    const allowedUpfront = [minTopUpCents, upfrontBeyondMin, upfrontAllNow]
      .filter((v, i, a) => v > 0 && a.indexOf(v) === i);
    const allowedDeposit = [depositMinToPay].filter(v => v > 0);

    /* --------------------------- Response ---------------------------- */
    return NextResponse.json({
      ok: true,

      // Per-line detail for UI
      charges: chargesOut,

      // Legacy totals (kept as-is, rent excluded)
      dueUpfrontCents,
      dueDepositCents,
      grossUpfrontCents,
      grossDepositCents,

      // “Quick amounts” buttons the server authorizes
      allowed: {
        upfront: allowedUpfront,
        deposit: allowedDeposit,
      },

      // Precise countersign info
      countersign: {
        upfrontMinThresholdCents: upfrontMinThresholdCents ?? null,
        upfrontMinRemainingCents: upfrontMinRemainingCents ?? null,
        depositMinThresholdCents: depositMinThresholdCents ?? null,
        depositMinRemainingCents: depositMinRemainingCents ?? null,
        upfrontMet: upfrontMinRemainingCents !== undefined ? upfrontMinRemainingCents <= 0 : null,
        depositMet: depositMinRemainingCents !== undefined ? depositMinRemainingCents <= 0 : null,
      },

      // Windowed dues (now naturally include rent where applicable)
      windows: {
        dueNowCents,
        dueBeforeMoveInCents,
        dueNext30Cents,
        laterCents,
        moveInDateISO: moveInISO,
      },

      // Rent preview + move-in coverage chips
      nextRent,
      firstCovered,
      lastCovered,
    });
  } catch (err: any) {
    console.error("[tenant.charges] error", err);
    return NextResponse.json(
      { ok: false, error: "server_error", message: err?.message || "unknown" },
      { status: 500 }
    );
  }
}
