// app/api/holding/[token]/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Robust token getter (supports Promise params & URL fallback)
async function getTokenParam(req: NextRequest, ctx: { params?: any }) {
  try {
    const p = await (ctx as any)?.params; // handles plain object or Promise
    const raw = Array.isArray(p?.token) ? p.token[0] : p?.token;
    if (raw) return String(raw);
  } catch {}
  const path = req.nextUrl?.pathname || "";
  const seg = path.split("/").filter(Boolean).pop();
  return seg || "";
}

export async function GET(
  req: NextRequest,
  ctx: { params: { token: string } } | { params: Promise<{ token: string }> }
) {
  const db = await getDb();
  const token = await getTokenParam(req, ctx);

  const hold = await db
    .collection("holding_requests")
    .findOne(
      { token },
      { projection: { total: 1, minimumDue: 1, status: 1 } }
    );

  if (!hold || hold.status !== "pending") {
    return NextResponse.json({ ok: false, error: "invalid_or_paid" }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    total: Number(hold.total) || 0,
    minimumDue: Number(hold.minimumDue ?? 0),
    status: hold.status,
  });
}
