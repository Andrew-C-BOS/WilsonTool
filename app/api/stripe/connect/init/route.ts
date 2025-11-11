import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { resolveAdminFirmForUser } from "../_shared";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getKind(req: Request): "operating" | "escrow" {
  // For POST without explicit query, default to "operating" to stay BC
  try {
    const url = new URL((req as any).url ?? "");
    const k = (url.searchParams.get("kind") || "operating").toLowerCase();
    return k === "escrow" ? "escrow" : "operating";
  } catch {
    return "operating";
  }
}

function businessProfileFor(kind: "operating" | "escrow") {
  return kind === "escrow"
    ? {
        mcc: "6513",
        product_description:
          "Tenant security deposits held in a dedicated escrow account",
      }
    : {
        mcc: "6513",
        product_description:
          "Residential property management payouts and ACH rent collection",
      };
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

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

  const db = await getDb();
  const firms = db.collection("firms");

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "stripe_not_configured" }, { status: 500 });
  }
  const stripe = new Stripe(secret);

  // Support string or ObjectId for _id
  const { ObjectId } = await import("mongodb");
  const firmIdStr = String(firmCtx.firmId);
  const firmIdFilter = ObjectId.isValid(firmIdStr)
    ? { _id: new ObjectId(firmIdStr) }
    : ({ _id: firmIdStr } as any);

  // Does this firm already have the requested kind account?
  const projection: any = {
    [`stripe.${kind}AccountId`]: 1,
    [`stripe.${kind}Status`]: 1,
  };
  const existing = await firms.findOne(firmIdFilter, { projection });
  const existingAccountId = existing?.stripe?.[`${kind}AccountId` as const];

  if (existingAccountId) {
    // Idempotently ensure capabilities are requested & profile set
    const acct = await stripe.accounts.update(existingAccountId, {
      capabilities: {
        transfers: { requested: true },
        // Collecting via ACH; add more (e.g., card_payments) if you accept cards.
        us_bank_account_ach_payments: { requested: true },
        // card_payments: { requested: true },
      },
      business_profile: businessProfileFor(kind),
      metadata: { firmId: String(firmCtx.firmId), accountKind: kind },
    });

    const status =
      acct.charges_enabled && acct.payouts_enabled
        ? "active"
        : (acct.requirements?.currently_due?.length ?? 0) > 0
        ? "restricted"
        : "pending";

    // IMPORTANT: do not touch the parent `stripe` key in the same update as dotted children
    await firms.updateOne(
      firmIdFilter,
      {
        $set: { [`stripe.${kind}Status`]: status, updatedAt: new Date() },
      }
    );

    return NextResponse.json({
      ok: true,
      firmId: firmCtx.firmId,
      kind,
      accountId: existingAccountId,
      stripeStatus: status,
    });
  }

  // Create a NEW Express connected account for this kind
  const account = await stripe.accounts.create({
    type: "express",
    country: "US",
    capabilities: {
      transfers: { requested: true },
      us_bank_account_ach_payments: { requested: true },
      // Add card_payments if you will accept card deposits/rent:
      // card_payments: { requested: true },
    },
    business_type: "company",
    business_profile: businessProfileFor(kind),
    metadata: { firmId: String(firmCtx.firmId), accountKind: kind },
  });

  // Upsert only dotted fields; do NOT set the parent `stripe` in the same update
  await firms.updateOne(
    firmIdFilter,
    {
      $set: {
        [`stripe.${kind}AccountId`]: account.id,
        [`stripe.${kind}Status`]: "pending",
        updatedAt: new Date(),
      },
      // Safe to stamp createdAt on first insert without touching `stripe`
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  return NextResponse.json({
    ok: true,
    firmId: firmCtx.firmId,
    kind,
    accountId: account.id,
    stripeStatus: "pending",
  });
}
