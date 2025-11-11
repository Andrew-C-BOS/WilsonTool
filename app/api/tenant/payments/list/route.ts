// app/api/tenant/payments/list/route.ts
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Status =
  | "created"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled"
  | "returned";

type ClientKind = "upfront" | "deposit" | "rent" | "fee";

// normalize DB kind -> client kind
function normalizeKind(k: any): ClientKind {
  // New world stores "operating" in DB; client expects "upfront"
  if (k === "operating" || k === "upfront" || !k) return "upfront";
  if (k === "deposit" || k === "rent" || k === "fee") return k;
  return "upfront";
}

function toObjectIdOrNull(v?: string | null) {
  try {
    if (!v) return null;
    return new ObjectId(v);
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  const appId = url.searchParams.get("appId") || "";
  const firmId = url.searchParams.get("firmId") || undefined;

  if (!appId) {
    return NextResponse.json({ ok: false, error: "missing_appId" }, { status: 400 });
  }

  // Optional pagination
  const limitRaw = Number(url.searchParams.get("limit") || 10);
  const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? limitRaw : 10));
  const cursor = url.searchParams.get("cursor");
  const cursorId = toObjectIdOrNull(cursor);

  try {
    const db = await getDb();
    const payments = db.collection("payments");

    // Base filter
    const match: Record<string, any> = { appId };
    if (firmId) match.firmId = firmId;
    if (cursorId) match._id = { $lt: cursorId };

    // Fetch latest N payments (lightweight fields)
    const projection = {
      _id: 1,
      kind: 1,                 // may be "operating" in DB
      status: 1,
      amountCents: 1,
      currency: 1,
      providerIds: 1,
      createdAt: 1,
      updatedAt: 1,
      // light meta
      "meta.rails": 1,
      "meta.receiptUrl": 1,
      "meta.optionId": 1,      // optional; harmless passthrough
    } as const;

    const itemsRaw = await payments
      .find(match, { projection })
      .sort({ _id: -1 })
      .limit(limit)
      .toArray();

    // Normalize to client shape
    const items = itemsRaw.map((p: any) => ({
      _id: String(p._id),
      kind: normalizeKind(p.kind),
      status: (p.status ?? "created") as Status,
      amountCents: Number(p.amountCents || 0),
      rails: (p?.meta?.rails ?? undefined) as "ach" | "card" | undefined,
      receiptUrl: p?.meta?.receiptUrl ?? null,
      providerIds: p?.providerIds ?? undefined,
      optionId: p?.meta?.optionId ?? undefined, // optional, not required by UI
      createdAt: (p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt ?? Date.now())).toISOString(),
      updatedAt: (p.updatedAt instanceof Date ? p.updatedAt : (p.updatedAt ? new Date(p.updatedAt) : null))?.toISOString(),
    }));

    // Status counts across ALL matching docs
    const countsAgg = await payments
      .aggregate([
        { $match: firmId ? { appId, firmId } : { appId } },
        { $group: { _id: "$status", n: { $sum: 1 } } },
      ])
      .toArray()
      .catch(() => [] as Array<{ _id: Status; n: number }>);

    const statusCounts: Record<string, number> = {};
    for (const row of countsAgg) {
      if (!row?._id) continue;
      statusCounts[row._id] = row.n ?? 0;
    }
    statusCounts.processing ??= 0;
    statusCounts.succeeded ??= 0;
    statusCounts.failed ??= 0;

    const nextCursor = items.length === limit ? items[items.length - 1]._id : null;

    return NextResponse.json({ ok: true, items, statusCounts, nextCursor });
  } catch (err: any) {
    console.error("[payments.list] error", err);
    return NextResponse.json(
      { ok: false, error: "server_error", message: err?.message || "unknown" },
      { status: 500 }
    );
  }
}
