import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Robust token getter (supports Promise params & URL fallback)
async function getTokenParam(req: NextRequest, ctx: { params?: any }) {
  try {
    const p = await (ctx as any)?.params;
    const raw = Array.isArray(p?.token) ? p.token[0] : p?.token;
    if (raw) return String(raw);
  } catch {}
  const path = req.nextUrl?.pathname || "";
  const seg = path.split("/").filter(Boolean).pop();
  return seg || "";
}

/**
 * Returns full holding info by token.
 * Used by both tenant payment and result pages.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: { token: string } } | { params: Promise<{ token: string }> }
) {
  const db = await getDb();
  const token = await getTokenParam(req, ctx);
  if (!token) {
    return NextResponse.json({ ok: false, error: "missing_token" }, { status: 400 });
  }

  const hold = await db.collection("holding_requests").findOne(
    { token },
    {
      projection: {
        total: 1,
        minimumDue: 1,
        status: 1,
        appId: 1,
        updatedAt: 1,
        paidAt: 1,
        createdAt: 1,
      },
    }
  );

  if (!hold) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  // Normalize allowed statuses
  const validStatuses = ["pending", "submitted", "paid", "failed", "canceled"];
  const status = validStatuses.includes(String(hold.status))
    ? String(hold.status)
    : "pending";

  return NextResponse.json({
    ok: true,
    token,
    appId: String(hold.appId ?? ""),
    total: Number(hold.total ?? 0),
    minimumDue: Number(hold.minimumDue ?? 0),
    status,
    updatedAt: hold.updatedAt ?? hold.createdAt ?? null,
    paidAt: hold.paidAt ?? null,
  });
}
