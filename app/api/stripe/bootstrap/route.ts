// app/api/tenant/stripe/bootstrap/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Let the stripe library use its pinned API version,
// so we don't fight the literal type.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export async function POST() {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "not_logged_in" },
        { status: 401 },
      );
    }

    if (user.role !== "tenant") {
      return NextResponse.json(
        { ok: false, error: "not_a_tenant" },
        { status: 403 },
      );
    }

    const db = await getDb();
    const users = db.collection("users");

    const rawId = (user as any)._id;
    const userId =
      rawId instanceof ObjectId ? rawId : new ObjectId(String(rawId));

    const dbUser = await users.findOne({ _id: userId });
    if (!dbUser) {
      console.warn("[stripe.bootstrap] no user found for _id", userId);
      return NextResponse.json(
        { ok: false, error: "user_not_found" },
        { status: 404 },
      );
    }

    if ((dbUser as any).stripeCustomerId) {
      return NextResponse.json({
        ok: true,
        stripeCustomerId: (dbUser as any).stripeCustomerId,
        alreadyHadCustomer: true,
      });
    }

    const customer = await stripe.customers.create({
      email: user.email,
      name: (dbUser as any).legal_name || (user as any).name || undefined,
      metadata: {
        appUserId: String(userId),
        role: "tenant",
      },
    });

    const result = await users.updateOne(
      { _id: userId },
      { $set: { stripeCustomerId: customer.id } },
    );

    if (result.matchedCount === 0) {
      console.error(
        "[stripe.bootstrap] updateOne matched 0 docs for _id",
        userId,
      );
      return NextResponse.json(
        { ok: false, error: "update_failed_no_match" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      stripeCustomerId: customer.id,
      alreadyHadCustomer: false,
    });
  } catch (err) {
    console.error("[tenant.stripe.bootstrap] error", err);
    return NextResponse.json(
      { ok: false, error: "server_error" },
      { status: 500 },
    );
  }
}
