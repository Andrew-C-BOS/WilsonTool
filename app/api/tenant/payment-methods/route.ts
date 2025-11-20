import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const debugMode = url.searchParams.get("debug") === "1";
  const debug: Record<string, any> = {
    step: "init",
  };

  function dpush(key: string, val: any) {
    if (!debugMode) return;
    debug[key] = val;
    // eslint-disable-next-line no-console
    console.log(
      "[wallet:debug]",
      key,
      typeof val === "object" ? JSON.stringify(val, null, 2) : val,
    );
  }

  try {
    const user = await getSessionUser();
    if (!user) {
      dpush("auth", "not_authenticated");
      return NextResponse.json(
        { ok: false, error: "not_authenticated" },
        { status: 401 },
      );
    }

    dpush("user", {
      id: String(user._id),
      email: user.email,
    });

    const db = await getDb();
    const users = db.collection("users") as any;

    // 🔑 Normalize _id (string vs ObjectId)
    const { ObjectId } = await import("mongodb");
    const rawId = String(user._id);
    const userFilter = ObjectId.isValid(rawId)
      ? { _id: new ObjectId(rawId) }
      : { _id: rawId };

    const u = await users.findOne(userFilter, {
      projection: {
        stripeCustomerId: 1,
        defaultUsBankPaymentMethodId: 1,
        bankPaymentMethods: 1,
      },
    });

    dpush("user_doc", u || null);

    const stripeCustomerId = u?.stripeCustomerId as string | undefined;
    const defaultPmId = u?.defaultUsBankPaymentMethodId as string | undefined;
    let bankPaymentMethods: any[] = Array.isArray(u?.bankPaymentMethods)
      ? u!.bankPaymentMethods
      : [];

    dpush("local_wallet", {
      stripeCustomerId,
      defaultPmId,
      bankPaymentMethodsCount: bankPaymentMethods.length,
      hasSecretKey: !!process.env.STRIPE_SECRET_KEY,
    });

    // No Stripe customer and no local methods → empty wallet
    if (!stripeCustomerId && bankPaymentMethods.length === 0) {
      dpush("result", "no_stripe_customer_no_local_methods");
      return NextResponse.json({
        ok: true,
        items: [] as any[],
        defaultPaymentMethodId: null,
        ...(debugMode ? { debug } : {}),
      });
    }

    // If we have a default PM but no local bankPaymentMethods yet,
    // lazy backfill from Stripe once to seed our local array.
    if (bankPaymentMethods.length === 0 && stripeCustomerId && defaultPmId) {
      dpush("backfill", {
        reason: "no_local_methods_but_default_pm_present",
        stripeCustomerId,
        defaultPmId,
      });

      try {
        const pm = await stripe.paymentMethods.retrieve(defaultPmId, {
          expand: ["us_bank_account"],
        });
        const bank = pm.us_bank_account;

        const bankDoc = {
          id: pm.id,
          type: pm.type,
          last4: bank?.last4 ?? null,
          bankName: bank?.bank_name ?? null,
          accountType: bank?.account_type ?? null,
          stripeCustomerId,
          createdAt: new Date(),
        };

        const updateRes = await users.updateOne(userFilter, {
          $addToSet: {
            bankPaymentMethods: bankDoc,
          },
        });

        dpush("backfill_update", {
          matched: updateRes.matchedCount,
          modified: updateRes.modifiedCount,
          bankDoc,
        });

        // Update our local snapshot too
        bankPaymentMethods = [bankDoc];
      } catch (err: any) {
        dpush("backfill_error", err?.message || String(err));
      }
    }

    // If we still have no bankPaymentMethods, just return empty list.
    if (bankPaymentMethods.length === 0) {
      dpush("result", "no_bank_methods_after_backfill");
      return NextResponse.json({
        ok: true,
        items: [] as any[],
        defaultPaymentMethodId: null,
        ...(debugMode ? { debug } : {}),
      });
    }

    // Derive a default if one isn't explicitly set
    let effectiveDefaultId = defaultPmId ?? null;
    if (!effectiveDefaultId && bankPaymentMethods.length > 0) {
      effectiveDefaultId = bankPaymentMethods[0].id;
      dpush("derived_default", effectiveDefaultId);
    }

    // Normalize items for the UI
    // (you can sort by createdAt desc if you’d like)
    const items = bankPaymentMethods
      .slice()
      .sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      })
      .map((pm) => ({
        id: pm.id as string,
        type: "us_bank_account" as const,
        bankName: (pm.bankName as string | null) ?? "Bank account",
        last4: (pm.last4 as string | null) ?? null,
        accountType: (pm.accountType as string | null) ?? null,
      }));

    dpush("items_out", items);

    return NextResponse.json({
      ok: true,
      items,
      defaultPaymentMethodId: effectiveDefaultId,
      ...(debugMode ? { debug } : {}),
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error("[wallet:error]", err?.message || err);
    if (debugMode) {
      debug.error = err?.message || String(err);
    }
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "unhandled",
        ...(debugMode ? { debug } : {}),
      },
      { status: 500 },
    );
  }
}
