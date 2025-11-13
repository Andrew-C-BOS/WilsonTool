// app/api/tenant/payments/result/route.ts
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ObjectId } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Status = "created" | "processing" | "succeeded" | "failed" | "canceled" | "returned";

function isObjectIdLike(s?: string | null) {
  return !!s && /^[a-f\d]{24}$/i.test(String(s));
}
function toObjectIdOrString(v: string) {
  return isObjectIdLike(v) ? new ObjectId(v) : v;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const appIdRaw = url.searchParams.get("appId") || "";
  const key = url.searchParams.get("key") || ""; // can be paymentIntentId OR idempotencyKey

  if (!appIdRaw || !key) {
    return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });
  }

  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

    const db = await getDb();
    const applications = db.collection("applications");
    const memberships = db.collection("household_memberships");
    const payments = db.collection("payments");
    const appId = toObjectIdOrString(appIdRaw);

    // Load app to get householdId for permission check
	const appDoc = await applications.findOne(
	  { _id: appId as any },
	  { projection: { _id: 1, householdId: 1 } }
	);
    if (!appDoc) {
      return NextResponse.json({ ok: false, error: "app_not_found" }, { status: 404 });
    }

    // Permission: user must be active member of this household (tolerate string/ObjectId storage)
    const hhId = String(appDoc.householdId || "");
    const userId = String((user as any)?.id ?? (user as any)?._id ?? "");
    if (hhId && userId) {
      const hhIdObj = isObjectIdLike(hhId) ? new ObjectId(hhId) : null;
      const membership = await memberships.findOne(
        {
          userId,
          active: true,
          householdId: hhIdObj ? { $in: [hhId, hhIdObj] } : hhId,
        },
        { projection: { _id: 1 } }
      );
      if (!membership) {
        return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
      }
    }

    // Find the latest matching payment by paymentIntentId OR idempotency key
    const match = {
      appId: String(appIdRaw),
      $or: [
        { "providerIds.paymentIntentId": key },
        { "meta.idempotencyKey": key },
      ],
    };

    const payDoc = await payments
      .find(match, {
        projection: {
          _id: 1,
          kind: 1,
          status: 1,
          amountCents: 1,
          currency: 1,
          rails: 1,
          provider: 1,
          providerIds: 1,
          receiptUrl: 1,
          meta: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      })
      .sort({ createdAt: -1 })
      .limit(1)
      .next();

    if (!payDoc) {
      return NextResponse.json({ ok: false, error: "payment_not_found" }, { status: 404 });
    }

    // Normalize/shape
    const status: Status = (payDoc.status ?? "created") as Status;
    const resp = {
      ok: true,
      appId: String(appIdRaw),
      status,
      amountCents: Number(payDoc.amountCents || 0),
      currency: String(payDoc.currency || "USD"),
      rails: (payDoc.rails as "ach" | "card" | undefined) ?? (payDoc.meta?.rails as any) ?? "ach",
      kind: String(payDoc.kind || ""),
      provider: String(payDoc.provider || "stripe"),
      paymentIntentId: payDoc.providerIds?.paymentIntentId ?? null,
      idempotencyKey: payDoc.meta?.idempotencyKey ?? null,
      receiptUrl: payDoc.receiptUrl ?? null,
      createdAt: payDoc.createdAt ?? null,
      updatedAt: payDoc.updatedAt ?? null,
    };

    return NextResponse.json(resp, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "server_error" }, { status: 500 });
  }
}
