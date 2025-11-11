import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { ObjectId } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tenant/payments/summary?appId=...&firmId=...
 * Returns:
 * {
 *   ok: true,
 *   upfrontDueCents: number,   // standard bucket (first/last/key/fee)
 *   depositDueCents: number,   // deposit bucket
 *   upfrontMinCents?: number,  // countersign minimums (if available)
 *   depositMinCents?: number
 * }
 */
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

  // Support ObjectId or string ids on applications._id
  const looksLikeObjectId = /^[a-f\d]{24}$/i.test(appIdRaw);
  const appIdForLookup = looksLikeObjectId ? new ObjectId(appIdRaw) : appIdRaw;

  const db = await getDb();
  const obligations = db.collection("obligations");
  const applications = db.collection("applications");

  // Pull the application (for countersign mins and plan totals)
  const app = await applications
    .findOne(
      { _id: appIdForLookup },
      {
        projection: {
          _id: 1,
          firmId: 1,
          countersign: 1,
          paymentPlan: 1,
        },
      }
    )
    .catch(() => null as any);

  // Optional, soft firm check (leave as soft to avoid breaking UI)
  if (firmId && app?.firmId && String(app.firmId) !== String(firmId)) {
    // To hard-fail: return NextResponse.json({ ok:false, error:"firm_mismatch" }, { status:400 });
  }

  // obligations.appId stored as raw string in your schema
  const filter: Record<string, any> = { appId: appIdRaw };
  if (firmId) filter.firmId = firmId;

  const obls = await obligations
    .find(filter, { projection: { group: 1, amountCents: 1, paidCents: 1 } })
    .toArray()
    .catch(() => []);

  let upfrontDueCents = 0;
  let depositDueCents = 0;

  // Sum remaining from obligations if they exist
  for (const o of obls) {
    const amount = Math.max(0, Number(o?.amountCents || 0));
    const paid = Math.max(0, Number(o?.paidCents || 0));
    const remain = Math.max(0, amount - paid);

    if (o?.group === "upfront" || o?.group === "fee") upfrontDueCents += remain;
    else if (o?.group === "deposit") depositDueCents += remain;
  }

  // If no obligations were written yet, synthesize from the plan
  if (obls.length === 0 && app?.paymentPlan) {
    const totals = app.paymentPlan.upfrontTotals;

    // ✅ Use the plan's canonical total for upfront if present
    const planUpfrontTotal = Number(totals?.totalUpfrontCents);
    if (Number.isFinite(planUpfrontTotal) && planUpfrontTotal > 0) {
      upfrontDueCents = planUpfrontTotal;
    } else {
      // Fallback (rare): derive from parts if total isn't present
      const first = Number(totals?.firstCents || 0);
      const last = Number(totals?.lastCents || 0);
      const key = Number(totals?.keyCents || 0);
      const other = Math.max(0, Number(totals?.otherUpfrontCents || 0));
      // If your data model sometimes duplicates parts in "other", you can drop "other" here.
      upfrontDueCents = first + last + key + other;
    }

    // Deposit (security) from plan
    const planSecurity = Number(app.paymentPlan.securityCents || 0);
    depositDueCents = planSecurity;
  }

  // Countersign thresholds (prefer countersign, else plan thresholds)
  const upfrontMinCents = Number(
    app?.countersign?.upfrontMinCents ??
      app?.paymentPlan?.countersignUpfrontThresholdCents ??
      NaN
  );
  const depositMinCents = Number(
    app?.countersign?.depositMinCents ??
      app?.paymentPlan?.countersignDepositThresholdCents ??
      NaN
  );

  const body: any = {
    ok: true,
    upfrontDueCents,
    depositDueCents,
  };
  if (Number.isFinite(upfrontMinCents)) body.upfrontMinCents = upfrontMinCents;
  if (Number.isFinite(depositMinCents)) body.depositMinCents = depositMinCents;

  return NextResponse.json(body);
}
