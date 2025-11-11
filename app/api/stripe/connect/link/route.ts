import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { resolveAdminFirmForUser } from "../_shared";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function baseOrigin(req: Request) {
  const h = (req as any).headers;
  return h.get("origin") || process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
}

function getKind(req: Request): "operating" | "escrow" {
  const url = new URL(req.url);
  const k = (url.searchParams.get("kind") || "operating").toLowerCase();
  return k === "escrow" ? "escrow" : "operating";
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  let firmCtx: { firmId: string; role: string };
  try {
    firmCtx = await resolveAdminFirmForUser(user);
  } catch (e: any) {
    const status = e?.status ?? 400;
    return NextResponse.json(
      { ok: false, error: e?.message || "resolve_firm_failed", ...(e?.data && { details: e.data }) },
      { status }
    );
  }

  const kind = getKind(req);
  const db = await getDb();
  const firms = db.collection("firms");

  // Support string or ObjectId for _id
  const { ObjectId } = await import("mongodb");
  const firmIdStr = String(firmCtx.firmId);
  const firmIdFilter = ObjectId.isValid(firmIdStr)
    ? { _id: new ObjectId(firmIdStr) }
    : ({ _id: firmIdStr } as any);

  const projection: any = { [`stripe.${kind}AccountId`]: 1 };
  const firm = await firms.findOne(firmIdFilter, { projection });

  const accountId = firm?.stripe?.[`${kind}AccountId` as const];
  if (!accountId) {
    return NextResponse.json({ ok: false, error: "no_account" }, { status: 400 });
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return NextResponse.json({ ok: false, error: "stripe_not_configured" }, { status: 500 });
  }
  const stripe = new Stripe(stripeSecret);

  const returnBase = baseOrigin(req);

  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${returnBase}/landlord/payments`,
    return_url: `${returnBase}/landlord/payments`,
    type: "account_onboarding",
  });

  // Optional: create login link for Express dashboard (per-kind)
  try {
    const login = await stripe.accounts.createLoginLink(accountId);
    if (login?.url) {
      await firms.updateOne(firmIdFilter, {
        $set: { [`stripe.${kind}DashboardUrl`]: login.url, updatedAt: new Date() },
      });
    }
  } catch {
    /* non-fatal */
  }

  return NextResponse.json({ ok: true, url: link.url, firmId: firmCtx.firmId, kind });
}
