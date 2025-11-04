// app/api/stripe/connect/init/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { resolveAdminFirmForUser } from "../_shared";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  // Find exactly one firm where user is owner/admin
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

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "stripe_not_configured" }, { status: 500 });
  }

  // Use your account's default Stripe API version (no apiVersion literal)
  const stripe = new Stripe(secret);

  // Support string or ObjectId for _id
  const { ObjectId } = await import("mongodb");
  const firmIdStr = String(firmCtx.firmId);
  const firmIdFilter = ObjectId.isValid(firmIdStr)
    ? { _id: new ObjectId(firmIdStr) }
    : ({ _id: firmIdStr } as any);

  // See if we already created an account for this firm
  const existing = await firms.findOne(
    firmIdFilter,
    { projection: { stripeAccountId: 1, stripeStatus: 1 } }
  );

  if (existing?.stripeAccountId) {
    // Ensure capabilities we need are requested (idempotent)
    const acct = await stripe.accounts.update(existing.stripeAccountId, {
      capabilities: {
        transfers: { requested: true },
        us_bank_account_ach_payments: { requested: true },
      },
      business_profile: {
        mcc: "6513",
        product_description: "Residential property management payouts and ACH rent collection",
      },
    });

    // derive a simple local status
    const status =
      acct.charges_enabled && acct.payouts_enabled
        ? "active"
        : (acct.requirements?.currently_due?.length ?? 0) > 0
        ? "restricted"
        : "pending";

    await firms.updateOne(firmIdFilter, {
      $set: { stripeStatus: status, updatedAt: new Date() },
    });

    return NextResponse.json({
      ok: true,
      accountId: existing.stripeAccountId,
      firmId: firmCtx.firmId,
      stripeStatus: status,
    });
  }

  // Create a NEW Express connected account with the right capabilities
  const account = await stripe.accounts.create({
    type: "express",
    country: "US",
    capabilities: {
      transfers: { requested: true },
      us_bank_account_ach_payments: { requested: true },
    },
    business_type: "company",
    business_profile: {
      mcc: "6513",
      product_description: "Residential property management payouts and ACH rent collection",
    },
    metadata: { firmId: firmCtx.firmId },
  });

  await firms.updateOne(
    firmIdFilter,
    {
      $set: {
        stripeAccountId: account.id,
        stripeStatus: "pending", // will flip via webhook after onboarding
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );

  return NextResponse.json({
    ok: true,
    accountId: account.id,
    firmId: firmCtx.firmId,
    stripeStatus: "pending",
  });
}
