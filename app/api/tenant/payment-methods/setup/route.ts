// app/api/tenant/payment-methods/setup/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // body optional
  }

  const appId = body.appId as string | undefined;
  const firmId = body.firmId as string | undefined;

  const db = await getDb();
  const users = db.collection("users") as any;

  // Look up or lazily create a Stripe Customer for this user
  let u = await users.findOne(
    { _id: user._id },
    { projection: { stripeCustomerId: 1, email: 1 } },
  );

  let stripeCustomerId: string | undefined = u?.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: {
        appUserId: String(user._id),
      },
    });
    stripeCustomerId = customer.id;
    await users.updateOne(
      { _id: user._id },
      { $set: { stripeCustomerId } },
    );
  }

  // SetupIntent that saves a us_bank_account for later usage (no charge yet)
  const setupIntent = await stripe.setupIntents.create({
    customer: stripeCustomerId,
    payment_method_types: ["us_bank_account"],
    payment_method_options: {
      us_bank_account: {
        verification_method: "automatic", // enables Financial Connections
      },
    },
    usage: "off_session",
    metadata: {
      kind: "tenant_bank_link",
      appId: appId ?? "",
      firmId: firmId ?? "",
      userId: String(user._id),
    },
  });

  if (!setupIntent.client_secret) {
    return NextResponse.json(
      { ok: false, error: "no_client_secret" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    clientSecret: setupIntent.client_secret,
    customerId: stripeCustomerId,
  });
}
