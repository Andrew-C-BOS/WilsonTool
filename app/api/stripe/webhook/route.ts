// app/api/stripe/webhook/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Use the account's default Stripe API version (no apiVersion literal)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  // IMPORTANT: use the raw body for signature verification
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature")!;
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 });
  }

  const db = await getDb();
  const firms = db.collection("firms");

  // 👇 Type the collections that we touch in this handler
  type HoldDoc = { _id: string | import("mongodb").ObjectId; appId: string | import("mongodb").ObjectId; status: string };
  type AppDoc  = { _id: string | import("mongodb").ObjectId; status?: string; timeline?: any[] };

  const holds = db.collection<HoldDoc>("holding_requests");
  const apps  = db.collection<AppDoc>("applications");

  // lazy import to avoid top-level ESM requirement
  const { ObjectId } = await import("mongodb");

  switch (event.type) {
    case "account.updated": {
      const acct = event.data.object as Stripe.Account;

      const currentlyDue = (acct.requirements?.currently_due ?? []).length > 0;
      const disabledCode = acct.requirements?.disabled_reason ?? null;

      const stripeStatus =
        acct.charges_enabled && acct.payouts_enabled
          ? "active"
          : currentlyDue
          ? "restricted"
          : "pending";

      await firms.updateOne(
        { stripeAccountId: acct.id },
        {
          $set: {
            stripeStatus,
            stripeDetails: {
              charges_enabled: acct.charges_enabled,
              payouts_enabled: acct.payouts_enabled,
              disabled_reason: disabledCode,
              currently_due: acct.requirements?.currently_due ?? [],
              eventually_due: acct.requirements?.eventually_due ?? [],
              past_due: acct.requirements?.past_due ?? [],
            },
            updatedAt: new Date(),
          },
        }
      );
      break;
    }

    case "account.application.deauthorized": {
      const accountId = event.account as string | null;
      if (accountId) {
        await firms.updateOne(
          { stripeAccountId: accountId },
          { $set: { stripeStatus: "disconnected", updatedAt: new Date() } }
        );
      }
      break;
    }

    case "payout.failed":
    case "payout.canceled":
    case "payout.paid": {
      const p = event.data.object as Stripe.Payout;
      await firms.updateOne(
        { stripeAccountId: (event as any).account },
        { $set: { lastPayoutStatus: p.status, lastPayoutAt: new Date(), updatedAt: new Date() } }
      );
      break;
    }

    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const holdingId = (pi.metadata as any)?.holdingId;

      if (holdingId) {
        const holdingKey = String(holdingId);
        const holdFilter =
          ObjectId.isValid(holdingKey)
            ? { _id: new ObjectId(holdingKey) }
            : ({ _id: holdingKey } as any); // _id is a token string in your create flow

        const hold = await holds.findOne(holdFilter, {
          projection: { appId: 1, status: 1 },
        });

        if (hold && hold.status !== "paid") {
          await holds.updateOne(holdFilter, {
            $set: { status: "paid", paidAt: new Date() },
          });

          const appIdStr = String(hold.appId);
          const appFilter =
            ObjectId.isValid(appIdStr)
              ? { _id: new ObjectId(appIdStr) }
              : ({ _id: appIdStr } as any);

          await apps.updateOne(appFilter, {
            $set: { status: "approved_pending_lease" },
            $push: {
              timeline: {
                at: new Date(),
                by: "system",
                event: "payment.holding_paid",
                meta: { amount: pi.amount_received },
              },
            },
          });
        }
      }
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}
