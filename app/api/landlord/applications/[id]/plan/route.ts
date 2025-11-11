// app/api/landlord/applications/[id]/plan/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────────────── helpers ───────────────── */
function isHex24(s: string) {
  return /^[0-9a-fA-F]{24}$/.test(s);
}
function toStr(v: any) {
  if (!v) return "";
  if (typeof v === "string") return v;
  try { return v?.toHexString ? v.toHexString() : String(v); } catch { return String(v); }
}
async function getParamsId(
  _req: NextRequest,
  ctx: { params?: { id: string } } | { params?: Promise<{ id: string }> } | any
) {
  try {
    const p = await ctx?.params;
    const raw = Array.isArray(p?.id) ? p.id[0] : p?.id;
    if (raw) return String(raw);
  } catch {}
  return "";
}

/* ─────────────── POST /api/landlord/applications/[id]/plan ───────────────
Body (all cents unless noted):
{
  monthlyRentCents: number,
  termMonths: number,                // >=1
  startDate: "YYYY-MM-DD",
  securityCents: number,
  keyFeeCents: number,
  requireFirstBeforeMoveIn: boolean,
  requireLastBeforeMoveIn: boolean,
  countersignUpfrontThresholdCents: number,   // standard (first/last/key)
  countersignDepositThresholdCents: number    // deposit (security)
}
Also updates application.status:
  - "approved_pending_payment" if any pre-sign money is due (upfront totals > 0 OR any countersign min > 0)
  - "approved_pending_lease"   otherwise
Returns: { ok: true, paymentPlan, nextStatus }
---------------------------------------------------------------------------*/
export async function POST(
  req: NextRequest,
  ctx: { params?: { id: string } } | { params?: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const db = await getDb();
  const { ObjectId } = await import("mongodb");

  const appId = await getParamsId(req, ctx);
  if (!appId) return NextResponse.json({ ok: false, error: "bad_application_id" }, { status: 400 });

  const apps = db.collection("applications");
  const appFilter = isHex24(appId) ? { _id: new ObjectId(appId) } : { _id: appId };

  // ensure the application exists (optional but nicer error)
  const app = await apps.findOne(appFilter, { projection: { _id: 1 } });
  if (!app) return NextResponse.json({ ok: false, error: "application_not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({} as any));
  const m = Math.max(0, Number(body.monthlyRentCents || 0));
  const term = Math.max(1, Number(body.termMonths || 0));
  const startDate = String(body.startDate || "");
  const security = Math.max(0, Number(body.securityCents || 0));
  const keyFee = Math.max(0, Number(body.keyFeeCents || 0));
  const requireFirst = !!body.requireFirstBeforeMoveIn;
  const requireLast  = !!body.requireLastBeforeMoveIn;

  const csUpfront = Math.max(0, Number(body.countersignUpfrontThresholdCents || 0));
  const csDeposit = Math.max(0, Number(body.countersignDepositThresholdCents || 0));

  if (m <= 0) return NextResponse.json({ ok: false, error: "bad_monthly" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return NextResponse.json({ ok: false, error: "bad_start_date" }, { status: 400 });
  if (security > m) return NextResponse.json({ ok: false, error: "security_gt_monthly" }, { status: 400 });

  // clamp countersign mins to their legal maximums
  const upfrontMax = (requireFirst ? m : 0) + (requireLast ? m : 0) + keyFee;
  const depositMax = security;
  const csUpfrontClamped = Math.min(csUpfront, upfrontMax);
  const csDepositClamped = Math.min(csDeposit, depositMax);

  const otherUpfront = (requireFirst ? m : 0) + (requireLast ? m : 0) + keyFee;

  const paymentPlan = {
    monthlyRentCents: m,
    termMonths: term,
    startDate,
    securityCents: security,
    keyFeeCents: keyFee,
    requireFirstBeforeMoveIn: requireFirst,
    requireLastBeforeMoveIn : requireLast,
    countersignUpfrontThresholdCents: csUpfrontClamped,
    countersignDepositThresholdCents: csDepositClamped,
    upfrontTotals: {
      firstCents: requireFirst ? m : 0,
      lastCents : requireLast ? m : 0,
      keyCents  : keyFee,
      securityCents: security,
      otherUpfrontCents: otherUpfront,
      totalUpfrontCents: otherUpfront + security,
    },
    priority: [
      ...(requireLast ? ["last_month"] : []),
      ...(requireFirst ? ["first_month"] : []),
      ...(keyFee > 0 ? ["key_fee"] : []),
      ...(security > 0 ? ["security_deposit"] : []),
    ],
  };

  // decide the next application status based on pre-sign money due
  const hasAnyUpfront = paymentPlan.upfrontTotals.totalUpfrontCents > 0;
  const needsThreshold = (csUpfrontClamped > 0) || (csDepositClamped > 0);
  const nextStatus = (hasAnyUpfront || needsThreshold)
    ? "approved_pending_payment"
    : "approved_pending_lease";

  const now = new Date();
  await apps.updateOne(appFilter, {
    $set: {
      paymentPlan,
      updatedAt: now,
      status: nextStatus,
      countersign: {
        allowed: false,
        upfrontMinCents: csUpfrontClamped,
        depositMinCents: csDepositClamped,
      },
    },
    $push: {
      timeline: {
        at: now,
        by: toStr((user as any)?._id ?? (user as any)?.email ?? "system"),
        event: "lease.plan.set",
        meta: {
          requireFirst, requireLast,
          csUpfrontClamped, csDepositClamped,
          nextStatus,
        },
      },
    },
  });

  return NextResponse.json({ ok: true, paymentPlan, nextStatus });
}
