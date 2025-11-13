// app/api/tenant/allocations/summary/route.ts
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Bucket = "upfront" | "deposit" | "rent" | "fee" | "operating"; // "operating" may exist in DB; we normalize
type Status = "created" | "processing" | "succeeded" | "failed" | "canceled" | "returned";

type ChargeRow = {
  chargeKey: string;   // `${appId}:${bucket}:${code}`
  bucket: "upfront" | "deposit"; // charges use "upfront" for the lease balance pot
  code: string;        // "key_fee" | "first_month" | "last_month" | "security_deposit" | `rent:YYYY-MM`
  amountCents: number; // total owed for this charge line
  priorityIndex: number;
};

type PaymentRow = {
  _id: any;
  kind: Bucket;        // may be "operating" in DB; we normalize to "upfront"
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

/**
 * Build addressable charges from the application doc.
 * Deposit is "security_deposit".
 * Lease-balance ("upfront") items: key_fee, first_month, last_month, then monthly rent (rent:YYYY-MM).
 */
function buildCharges(appId: string, app: any): ChargeRow[] {
  const charges: ChargeRow[] = [];
  const push = (bucket: "upfront" | "deposit", code: string, amt: number, prio: number) => {
    const amountCents = Math.max(0, safeNum(amt));
    if (amountCents <= 0) return;
    charges.push({
      chargeKey: `${appId}:${bucket}:${code}`,
      bucket,
      code,
      amountCents,
      priorityIndex: prio,
    });
  };

  const plan = app?.paymentPlan ?? null;

  // Helper: add rent months strictly after move-in charges
  function addMonthlyRentCharges(
    startISO?: string | null,
    termMonths?: number | null,
    monthly?: number,
    basePrio = 2000
  ) {
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
      push("upfront", `rent:${ym}`, rent, basePrio + i);
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
  }

  if (plan?.upfrontTotals) {
    const first = safeNum(plan.upfrontTotals.firstCents);
    const last  = safeNum(plan.upfrontTotals.lastCents);
    const key   = safeNum(plan.upfrontTotals.keyCents);
    const sec   = safeNum(plan.securityCents);

    // Respect provided priority for move-in items; rent comes after with high base priority
    const prioList =
      Array.isArray(plan.priority) && plan.priority.length
        ? (plan.priority as string[])
        : ["key_fee", "first_month", "last_month", "security_deposit"];
    const prio = (code: string) => {
      const idx = prioList.indexOf(code);
      return idx >= 0 ? idx : 999;
    };

    // Move-in items (lease balance)
    push("upfront", "key_fee",     key,   prio("key_fee"));
    push("upfront", "first_month", first, prio("first_month"));
    push("upfront", "last_month",  last,  prio("last_month"));

    // Monthly rent sequence after move-in items
    addMonthlyRentCharges(plan.startDate, plan.termMonths, plan.monthlyRentCents, 2000);

    // Deposit (escrow)
    push("deposit", "security_deposit", sec, prio("security_deposit"));
    return charges;
  }

  // Fallback to older shape `application.upfronts`
  const u = app?.upfronts ?? {};
  push("upfront", "key_fee",     safeNum(u.key),   0);
  push("upfront", "first_month", safeNum(u.first), 1);
  push("upfront", "last_month",  safeNum(u.last),  2);
  push("deposit", "security_deposit", safeNum(u.security), 3);
  // If legacy has monthly info elsewhere, you can add it similarly.

  return charges;
}

/**
 * Greedy allocator: distributes payment rows across charges
 * in priority order. Track posted vs pending separately.
 *
 * IMPORTANT: We normalize DB payments with kind "operating" to "upfront".
 */
function allocateAcrossCharges(
  charges: ChargeRow[],
  payments: PaymentRow[],
) {
  const ordered = [...charges].sort(
    (a, b) => a.priorityIndex - b.priorityIndex || a.code.localeCompare(b.code)
  );

  const postedByKey = new Map<string, number>();
  const pendingByKey = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) =>
    m.set(k, (m.get(k) ?? 0) + v);

  const orderedPayments = [...payments].sort(
    (a, b) => (a.createdAt?.getTime?.() ?? 0) - (b.createdAt?.getTime?.() ?? 0)
  );

  for (const raw of orderedPayments) {
    const kind = (raw.kind === "operating" ? "upfront" : raw.kind) as "upfront" | "deposit" | string;
    if (kind !== "upfront" && kind !== "deposit") continue;
    if (raw.status !== "succeeded" && raw.status !== "processing") continue;

    let remaining = Math.max(0, raw.amountCents);
    if (remaining <= 0) continue;

    for (const c of ordered) {
      if (c.bucket !== kind) continue;
      if (remaining <= 0) break;

      const alreadyPosted = postedByKey.get(c.chargeKey) ?? 0;
      const alreadyPending = pendingByKey.get(c.chargeKey) ?? 0;
      const open = Math.max(0, c.amountCents - alreadyPosted - alreadyPending);
      if (open <= 0) continue;

      const take = Math.min(open, remaining);
      if (raw.status === "succeeded") add(postedByKey, c.chargeKey, take);
      else add(pendingByKey, c.chargeKey, take);

      remaining -= take;
    }
    // Overages (remaining > 0) are currently unassigned; you can add a credit bucket later if desired.
  }

  return { postedByKey, pendingByKey };
}

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

    // Load app (support ObjectId or string id)
	const appIdForLookup = toObjectIdOrString(appIdRaw) as any;
	const app = await applications.findOne(
	  { _id: appIdForLookup },
	  { projection: { _id: 1, paymentPlan: 1, upfronts: 1 } }
	);

    // Build addressable charges (includes key/first/last + monthly rent + deposit)
    const charges = buildCharges(appIdRaw, app);

    // Fetch payments for this app
    const payMatch: Record<string, any> = { appId: appIdRaw };
    if (firmId) payMatch.firmId = firmId;

    const rawPayments = await paymentsCol
      .find(payMatch, {
        projection: { _id: 1, kind: 1, status: 1, amountCents: 1, createdAt: 1 },
      })
      .toArray();

    const payments: PaymentRow[] = rawPayments.map((p: any) => ({
      _id: p._id,
      kind: (p.kind ?? "upfront") as Bucket, // may be "operating" (normalized later)
      status: (p.status ?? "created") as Status,
      amountCents: safeNum(p.amountCents),
      createdAt: p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt ?? Date.now()),
    }));

    // Allocate posted vs pending across charges
    const { postedByKey, pendingByKey } = allocateAcrossCharges(charges, payments);

    // Format response for client
    const allocationsByCharge = charges.map((c) => ({
      chargeKey: c.chargeKey,
      postedCents: Math.max(0, postedByKey.get(c.chargeKey) ?? 0),
      pendingCents: Math.max(0, pendingByKey.get(c.chargeKey) ?? 0),
    }));

    return NextResponse.json({ ok: true, allocationsByCharge });
  } catch (err: any) {
    console.error("[allocations.summary] error", err);
    return NextResponse.json(
      { ok: false, error: "server_error", message: err?.message || "unknown" },
      { status: 500 }
    );
  }
}
