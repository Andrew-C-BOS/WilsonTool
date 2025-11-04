// app/api/stripe/connect/status/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { resolveAdminFirmForUser } from "../_shared";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  let firmCtx: { firmId: string; role: string };
  try {
    firmCtx = await resolveAdminFirmForUser(user);
  } catch (e: any) {
    const status = e?.status ?? 400;
    return NextResponse.json(
      { ok: false, error: e?.message || "resolve_firm_failed", ...(e?.data && { details: e.data }) },
      { status }
    );
  }

  const db = await getDb();
  const firms = db.collection("firms");

  // Support string or ObjectId for _id
  const { ObjectId } = await import("mongodb");
  const firmIdStr = String(firmCtx.firmId);
  const firmIdFilter = ObjectId.isValid(firmIdStr)
    ? { _id: new ObjectId(firmIdStr) }
    : ({ _id: firmIdStr } as any);

  // If the firm doc doesn't exist yet, just return “empty” status (no Stripe account)
  const firm = await firms.findOne(
    firmIdFilter,
    { projection: { stripeAccountId: 1, stripeDashboardUrl: 1 } }
  );

  if (!firm?.stripeAccountId) {
    return NextResponse.json({
      ok: true,
      firmId: firmCtx.firmId,
      accountId: null,
      detailsSubmitted: false,
      payoutsEnabled: false,
      chargesEnabled: false,
      dashboardUrl: null,
    });
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return NextResponse.json({ ok: false, error: "stripe_not_configured" }, { status: 500 });
  }
  // Use account default API version
  const stripe = new Stripe(stripeSecret);

  const acct = await stripe.accounts.retrieve(firm.stripeAccountId);

  return NextResponse.json({
    ok: true,
    firmId: firmCtx.firmId,
    accountId: acct.id,
    detailsSubmitted: !!acct.details_submitted,
    payoutsEnabled: !!acct.payouts_enabled,
    chargesEnabled: !!acct.charges_enabled,
    dashboardUrl: firm?.stripeDashboardUrl || null,
  });
}
