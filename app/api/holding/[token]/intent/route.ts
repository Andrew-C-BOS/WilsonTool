// app/api/holding/[token]/intent/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import Stripe from "stripe";
import { ObjectId } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* helpers */
function baseOrigin(req: Request) {
  const h = (req as any).headers;
  return h.get("origin") || process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
}

async function getTokenParam(req: NextRequest, ctx: { params?: any }) {
  try {
    const p = await (ctx as any)?.params;
    const raw = Array.isArray(p?.token) ? p.token[0] : p?.token;
    if (raw) return String(raw);
  } catch {}
  const seg = (req.nextUrl?.pathname || "").split("/").filter(Boolean).pop();
  return seg || "";
}

/* cancelable statuses per Stripe */
const CANCELABLE = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "requires_capture",
  "processing",
  "requires_reauthorization",
]);

export async function POST(
  req: NextRequest,
  ctx: { params: { token: string } } | { params: Promise<{ token: string }> }
) {
  const token = await getTokenParam(req, ctx);

  try {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) {
      return NextResponse.json({ ok: false, error: "stripe_not_configured" }, { status: 500 });
    }
    // Use account default API version
    const stripe = new Stripe(secret);

    const db = await getDb();
    const holds = db.collection("holding_requests");
    const firms = db.collection<{
      _id: string | ObjectId;
      stripe?: {
        operatingAccountId?: string;
        operatingStatus?: string;
        escrowAccountId?: string;
        escrowStatus?: string;
      };
    }>("firms");

    // 1) Load hold
    const hold = await holds.findOne(
      { token },
      { projection: { _id: 1, total: 1, minimumDue: 1, status: 1, paymentIntentId: 1, firmId: 1 } }
    );
    if (!hold || hold.status !== "pending") {
      return NextResponse.json({ ok: false, error: "invalid_or_paid" }, { status: 400 });
    }

    // 2) Load firm; support string or ObjectId ids
    const firmIdStr = String(hold.firmId);
    const firmId: string | ObjectId = ObjectId.isValid(firmIdStr) ? new ObjectId(firmIdStr) : firmIdStr;

    const firm = await firms.findOne(
      { _id: firmId },
      { projection: { "stripe.operatingAccountId": 1, "stripe.operatingStatus": 1 } }
    );

    const operatingAccountId = firm?.stripe?.operatingAccountId;
    if (!operatingAccountId) {
      return NextResponse.json({ ok: false, error: "no_operating_account" }, { status: 400 });
    }

    // 2b) Live-check the destination account on Stripe instead of DB cache
    const acct = await stripe.accounts.retrieve(operatingAccountId);
    const transfersCap = acct.capabilities?.transfers;
    if (transfersCap !== "active") {
      // Payouts can be enabled later; we only enforce transfers capability for destination charges
      return NextResponse.json(
        {
          ok: false,
          error: "operating_destination_not_ready",
          details: {
            transfersCapability: transfersCap ?? "unknown",
            payoutsEnabled: !!acct.payouts_enabled,
            chargesEnabled: !!acct.charges_enabled,
          },
        },
        { status: 400 }
      );
    }

    // 3) Amount
    const amount = Number(hold.minimumDue ?? hold.total) || 0;
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ ok: false, error: "bad_amount" }, { status: 400 });
    }

    const isAchOnly = (pi: Stripe.PaymentIntent) =>
      Array.isArray(pi.payment_method_types) &&
      pi.payment_method_types.length === 1 &&
      pi.payment_method_types[0] === "us_bank_account";

    const isConfirmable = (status: string) =>
      status === "requires_payment_method" ||
      status === "requires_confirmation" ||
      status === "requires_action";

    // 4) Reuse-first: if a confirmable ACH-only PI with the same amount exists, reuse it
    if (hold.paymentIntentId) {
      try {
        const existing = await stripe.paymentIntents.retrieve(hold.paymentIntentId);
        const sameAmount = Number(existing.amount) === amount;

        if (isAchOnly(existing) && sameAmount && isConfirmable(existing.status)) {
          const returnUrl = `${baseOrigin(req)}/tenant/hold/${encodeURIComponent(token)}/result`;
          return NextResponse.json({
            ok: true,
            clientSecret: existing.client_secret,
            accountId: null, // destination charge => platform-scoped on client
            returnUrl,
          });
        }

        // Cancel only if cancelable AND (wrong methods OR wrong amount)
        if (CANCELABLE.has(existing.status as any) && (!isAchOnly(existing) || !sameAmount)) {
          try {
            await stripe.paymentIntents.cancel(existing.id);
          } catch {
            /* ignore */
          }
        }
      } catch {
        // "no such PI" — proceed to create new
      } finally {
        // Clear stored id before creating a new PI to avoid stale reuse
        await holds.updateOne({ _id: hold._id }, { $unset: { paymentIntentId: "" } });
      }
    }

    // 5) Create NEW ACH-only PaymentIntent as a Destination charge to OPERATING account
    const pi = await stripe.paymentIntents.create(
      {
        amount,
        currency: "usd",
        description: `Holding payment ${hold._id} (operating dest)`,
        payment_method_types: ["us_bank_account"],
        payment_method_options: {
          us_bank_account: { verification_method: "automatic" },
        },
        transfer_data: { destination: operatingAccountId },
        metadata: {
          holdingId: String(hold._id),
          firmId: String(hold.firmId),
          token,
          route: "operating",
        },
      },
      { idempotencyKey: `hold:${hold._id}:${amount}:ach-destination-operating-v2` }
    );

    // 6) Persist PI id
    await holds.updateOne(
      { _id: hold._id },
      { $set: { paymentIntentId: pi.id, updatedAt: new Date() } }
    );

    const returnUrl = `${baseOrigin(req)}/tenant/hold/${encodeURIComponent(token)}/result`;

    return NextResponse.json({
      ok: true,
      clientSecret: pi.client_secret,
      accountId: null, // destination charges => loadStripe(pk) on client
      returnUrl,
    });
  } catch (e: any) {
    console.error("[holding_intent] unhandled", { token, error: e?.message });
    return NextResponse.json(
      { ok: false, error: "unhandled_error", message: e?.message || "unknown" },
      { status: 500 }
    );
  }
}
