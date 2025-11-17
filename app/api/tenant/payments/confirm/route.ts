// app/api/tenant/payments/confirm/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

/* ─────────────────────────────────────────────────────────────
   Types & helpers
───────────────────────────────────────────────────────────── */

type Status =
  | "created"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled"
  | "returned";

function isObjectIdLike(s?: string | null) {
  return !!s && /^[a-f\d]{24}$/i.test(String(s));
}

function toObjectIdOrString(v: string) {
  return isObjectIdLike(v) ? new ObjectId(v) : v;
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const debugMode = url.searchParams.get("debug") === "1";

  const debug: Record<string, any> = {
    step: "init",
    input: {},
    resolved: {},
    stripe: {
      pi: {},
      errors: {},
    },
  };

  const done = (status: number, payload: any) => {
    if (debugMode) payload.debug = debug;
    return NextResponse.json(payload, { status });
  };

  try {
    const user = await getSessionUser();
    debug.resolved.user = user
      ? {
          id: (user as any)?.id ?? (user as any)?._id,
          email: (user as any)?.email ?? null,
          role: (user as any)?.role ?? null,
        }
      : null;

    if (!user) {
      debug.step = "not_authenticated";
      return done(401, { error: "not_authenticated" });
    }

    const body = (await req.json().catch(() => ({}))) as {
      paymentIntentId?: string | null;
    };

    const paymentIntentId = (body?.paymentIntentId || "").trim();
    debug.input.body = body;
    debug.input.paymentIntentId = paymentIntentId || null;

    if (!paymentIntentId) {
      debug.step = "missing_payment_intent_id";
      return done(400, { error: "missing_payment_intent_id" });
    }

    const db = await getDb();
    const payments = db.collection("payments");
    const applications = db.collection("applications");
    const memberships = db.collection("household_memberships");

    // Find the payment row so we can attach to app/firm & enforce permissions
    const payDoc = await payments.findOne(
      { "providerIds.paymentIntentId": paymentIntentId },
      {
        projection: {
          _id: 1,
          appId: 1,
          firmId: 1,
          leaseId: 1,
          kind: 1,
          status: 1,
          amountCents: 1,
          createdAt: 1,
        },
      },
    );

    debug.resolved.payment = payDoc
      ? {
          _id: payDoc._id,
          appId: payDoc.appId,
          firmId: payDoc.firmId,
          leaseId: payDoc.leaseId,
          kind: payDoc.kind,
          status: payDoc.status,
          amountCents: payDoc.amountCents,
        }
      : null;

    if (!payDoc) {
      debug.step = "payment_not_found";
      return done(404, { error: "payment_not_found" });
    }

    const appId = String(payDoc.appId || "");
    if (!appId) {
      debug.step = "missing_app_id_on_payment";
      return done(400, { error: "missing_app_id_on_payment" });
    }

    // Load application to enforce "user ∈ household" like in the session route
    const appLookupId = toObjectIdOrString(appId);
    const appDoc = await applications.findOne(
      { _id: appLookupId as any },
      { projection: { _id: 1, householdId: 1 } },
    );

    debug.resolved.app = appDoc
      ? { _id: appDoc._id, householdId: appDoc.householdId }
      : null;

    if (!appDoc) {
      debug.step = "app_not_found";
      return done(404, { error: "app_not_found" });
    }

    const hhId = String(appDoc.householdId || "");
    const userId = String(
      (user as any)?.id ?? (user as any)?._id ?? "",
    );
    debug.resolved.householdId = hhId || null;
    debug.resolved.userId = userId || null;

    if (hhId && userId) {
      const hhIdObj = isObjectIdLike(hhId) ? new ObjectId(hhId) : null;
      const membership = await memberships.findOne(
        {
          userId,
          active: true,
          householdId: hhIdObj ? { $in: [hhId, hhIdObj] } : hhId,
        },
        { projection: { _id: 1 } },
      );
      debug.resolved.membershipFound = !!membership;

      if (!membership) {
        debug.step = "forbidden_not_in_household";
        return done(403, { error: "forbidden" });
      }
    }

    // Retrieve the PaymentIntent
    let pi: Stripe.PaymentIntent;
    try {
      pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      debug.stripe.pi.before = {
        id: pi.id,
        status: pi.status,
        amount: pi.amount,
        currency: pi.currency,
        customer: pi.customer ?? null,
      };
    } catch (e: any) {
      debug.stripe.errors.retrieve = e?.message || "pi_retrieve_failed";
      debug.step = "pi_retrieve_failed";
      return done(400, { error: "pi_retrieve_failed" });
    }

    // If it's already in a terminal-ish state, treat as idempotent success
    if (
      pi.status === "succeeded" ||
      pi.status === "processing" ||
      pi.status === "requires_capture"
    ) {
      debug.step = "already_confirmed_or_processing";

      // best-effort metadata on payment doc
      await payments.updateOne(
        { _id: payDoc._id },
        {
          $set: {
            updatedAt: new Date(),
            "meta.confirmCalled": true,
            "meta.lastPiStatus": pi.status,
          },
        },
      );

      return done(200, { ok: true });
    }

    // Confirm off-session. This is the *actual* ACH debit action.
    let pi2: Stripe.PaymentIntent;
    try {
      pi2 = await stripe.paymentIntents.confirm(paymentIntentId, {
        off_session: true,
      });

      debug.stripe.pi.after = {
        id: pi2.id,
        status: pi2.status,
        amount: pi2.amount,
        currency: pi2.currency,
        next_action: pi2.next_action ?? null,
      };
    } catch (e: any) {
      debug.stripe.errors.confirm = e?.message || "pi_confirm_failed";

      // Optional: mark payment row as failed-ish for now; webhook will be source of truth
      await payments.updateOne(
        { _id: payDoc._id },
        {
          $set: {
            status: "failed" as Status,
            updatedAt: new Date(),
            "meta.confirmCalled": true,
            "meta.confirmError": e?.message || "pi_confirm_failed",
          },
        },
      );

      debug.step = "pi_confirm_failed";
      return done(400, {
        ok: false,
        error: e?.message || "pi_confirm_failed",
      });
    }

    // Best-effort status annotation; webhook will still do the real bookkeeping
    const now = new Date();
    let newStatus: Status = "processing";

    if (pi2.status === "succeeded") newStatus = "succeeded";
    else if (pi2.status === "canceled") newStatus = "canceled";
    else if (
      pi2.status === "requires_payment_method" ||
      pi2.status === "requires_action"
    )
      newStatus = "failed";
    else newStatus = "processing";

    await payments.updateOne(
      { _id: payDoc._id },
      {
        $set: {
          status: newStatus,
          updatedAt: now,
          "meta.confirmCalled": true,
          "meta.lastPiStatus": pi2.status,
        },
      },
    );

    debug.step = "ok";

    return done(200, { ok: true });
  } catch (e: any) {
    const msg = e?.message || "server_error";
    if (debugMode) {
      debug.step = "server_error";
      debug.stripe.errors.unknown = msg;
      return NextResponse.json({ error: msg, debug }, { status: 500 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
