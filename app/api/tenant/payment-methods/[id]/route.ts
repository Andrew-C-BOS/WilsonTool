// app/api/tenant/payment-methods/[id]/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(req: NextRequest, context: RouteContext) {
  const debugMode = req.nextUrl.searchParams.get("debug") === "1";
  const debug: Record<string, any> = { step: "init" };

  try {
    const user = await getSessionUser();
    if (!user || user.role !== "tenant") {
      debug.error = "unauthorized";
      return NextResponse.json(
        { ok: false, error: "unauthorized", debug: debugMode ? debug : undefined },
        { status: 401 },
      );
    }
	
    // 🔹 Normalize session user id to ObjectId
    let userId: ObjectId;
    try {
      const rawId = (user as any)._id;
      userId = new ObjectId(String(rawId));
    } catch {
      debug.error = "invalid_session_user_id";
      debug.sessionUserId = (user as any)._id;
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_session_user_id",
          debug: debugMode ? debug : undefined,
        },
        { status: 500 },
      );
    }

    const { id: pmId } = await context.params; // Stripe pm_... id
    debug.pmId = pmId;
    debug.userId = userId.toHexString();

    if (!pmId) {
      debug.error = "missing_payment_method_id";
      return NextResponse.json(
        { ok: false, error: "missing_payment_method_id", debug: debugMode ? debug : undefined },
        { status: 400 },
      );
    }

    const db = await getDb();
    const users = db.collection("users");

    debug.step = "load_user_with_method";

    const doc = await users.findOne<{
      _id: any;
      bankPaymentMethods?: {
        id: string;
        type?: string;
        last4?: string;
        bankName?: string;
        accountType?: string;
        stripeCustomerId?: string;
      }[];
      defaultUsBankPaymentMethodId?: string | null;
    }>({
      _id: userId,                    // 🔹 use normalized ObjectId
      "bankPaymentMethods.id": pmId,  // ensure method belongs to this user
    });

    if (!doc) {
      debug.error = "payment_method_not_found_for_user";
      return NextResponse.json(
        {
          ok: false,
          error: "payment_method_not_found_for_user",
          debug: debugMode ? debug : undefined,
        },
        { status: 404 },
      );
    }

    const currentMethods = doc.bankPaymentMethods ?? [];
    const found = currentMethods.find((m) => m.id === pmId);

    if (!found) {
      debug.error = "payment_method_not_found_in_embedded_list";
      return NextResponse.json(
        {
          ok: false,
          error: "payment_method_not_found_in_embedded_list",
          debug: debugMode
            ? { ...debug, currentCount: currentMethods.length }
            : undefined,
        },
        { status: 404 },
      );
    }

    debug.step = "compute_remaining";
    debug.foundStripeId = found.id;
    debug.currentDefaultStripeId = doc.defaultUsBankPaymentMethodId ?? null;

    const remaining = currentMethods.filter((m) => m.id !== pmId);

    // Handle defaultUsBankPaymentMethodId
    let nextDefault = doc.defaultUsBankPaymentMethodId ?? null;

    if (doc.defaultUsBankPaymentMethodId && doc.defaultUsBankPaymentMethodId === pmId) {
      const next = remaining[0];
      nextDefault = next?.id ?? null;

      debug.step = "unset_or_shift_default";
      debug.oldDefaultStripeId = pmId;
      debug.newDefaultStripeId = nextDefault;
    } else {
      debug.step = "remove_non_default";
    }

    await users.updateOne(
      { _id: userId },
      {
        $set: {
          bankPaymentMethods: remaining,
          defaultUsBankPaymentMethodId: nextDefault,
          updatedAt: new Date(),
        },
      },
    );

    debug.step = "done";
    debug.remainingCount = remaining.length;

    return NextResponse.json(
      {
        ok: true,
        removedPaymentMethodId: pmId,
        defaultUsBankPaymentMethodId: nextDefault,
        debug: debugMode ? debug : undefined,
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("[wallet:unlink:error]", err);
    debug.error = String(err?.message ?? err);

    return NextResponse.json(
      { ok: false, error: "internal_error", debug: debugMode ? debug : undefined },
      { status: 500 },
    );
  }
}
