import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { resolveAdminFirmForUser } from "../_shared";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getKind(req: Request): "operating" | "escrow" {
  const url = new URL(req.url);
  const k = (url.searchParams.get("kind") || "operating").toLowerCase();
  return k === "escrow" ? "escrow" : "operating";
}

function stripeFieldFor(kind: "operating" | "escrow") {
  // Dotted keys only (avoid parent/child conflicts when updating)
  return {
    accountIdKey: `stripe.${kind}AccountId`,
    dashboardUrlKey: `stripe.${kind}DashboardUrl`,
    dashboardAtKey: `stripe.${kind}DashboardAt`,
    projection: {
      [`stripe.${kind}AccountId`]: 1 as const,
      [`stripe.${kind}DashboardUrl`]: 1 as const,
      [`stripe.${kind}DashboardAt`]: 1 as const,
    } as any,
  };
}

export async function GET(req: Request) {
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

  const kind = getKind(req);
  const { accountIdKey, dashboardUrlKey, dashboardAtKey, projection } = stripeFieldFor(kind);

  const db = await getDb();
  const firms = db.collection("firms");

  // Support string or ObjectId for _id
  const { ObjectId } = await import("mongodb");
  const firmIdStr = String(firmCtx.firmId);
  const firmIdFilter = ObjectId.isValid(firmIdStr)
    ? { _id: new ObjectId(firmIdStr) }
    : ({ _id: firmIdStr } as any);

  // Load only what we need
  const firm = await firms.findOne(firmIdFilter, { projection });

  const accountId = firm?.stripe?.[`${kind}AccountId` as const] || null;

  if (!accountId) {
    return NextResponse.json({
      ok: true,
      firmId: firmCtx.firmId,
      kind,
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
  const stripe = new Stripe(stripeSecret);

  // Live account status
  const acct = await stripe.accounts.retrieve(accountId);

  // Always create a fresh Express login link (valid ~24h)
  let dashboardUrl: string | null = null;
  try {
    const login = await stripe.accounts.createLoginLink(accountId);
    dashboardUrl = login?.url || null;

    if (dashboardUrl) {
      // Cache it (optional), using only dotted keys (no parent collisions)
      await firms.updateOne(firmIdFilter, {
        $set: {
          [dashboardUrlKey]: dashboardUrl,
          [dashboardAtKey]: new Date(),
          updatedAt: new Date(),
        },
      });
    }
  } catch {
    // Non-fatal: if creation fails, keep dashboardUrl as null
  }

  return NextResponse.json({
    ok: true,
    firmId: firmCtx.firmId,
    kind,
    accountId: acct.id,
    detailsSubmitted: !!acct.details_submitted,
    payoutsEnabled: !!acct.payouts_enabled,
    chargesEnabled: !!acct.charges_enabled,
    dashboardUrl, // freshly generated (or null if creation failed)
  });
}
