import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import type { ObjectId } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------- tiny utils ---------- */
type IdLike = string | ObjectId;
const toStr = (v: any) => {
  if (!v) return "";
  if (typeof v === "string") return v;
  try { return v?.toHexString ? v.toHexString() : String(v); } catch { return String(v); }
};
const isHex24 = (s: string) => /^[0-9a-fA-F]{24}$/.test(s);

/* Safely unwrap ctx.params (it may be a Promise in dynamic API routes) */
async function getParamsId(
  req: NextRequest,
  ctx: { params?: { id: string } } | { params?: Promise<{ id: string }> } | any
): Promise<string> {
  try {
    const p = await ctx?.params;
    const raw = Array.isArray(p?.id) ? p.id[0] : p?.id;
    if (raw) return String(raw);
  } catch {}
  // Fallback from URL path segment
  const seg = (req.nextUrl?.pathname || "").split("/").filter(Boolean).pop();
  return seg || "";
}

/* ---------- shapes we read ---------- */
type ApplicationDoc = {
  _id: IdLike;
  formId: IdLike;
  upfronts?: {
    first?: number;    // cents
    last?: number;     // cents
    security?: number; // cents
    key?: number;      // cents
  };
};

type ApplicationFormDoc = { _id: IdLike; firmId: IdLike };
type FirmMembershipDoc = {
  _id: IdLike;
  firmId: string;
  userId?: IdLike;
  email?: string;
  role?: "member" | "admin" | "owner";
  active: boolean;
};

/* ---------- payment sources (be liberal) ---------- */
async function getHoldingPaidCents(db: any, appId: string, debug = false): Promise<number> {
  const candidates: { col: string; q: any; map?: (d: any) => number }[] = [
    { col: "holding_requests", q: { appId }, map: (d) => Number(d?.paidCents || d?.amountPaidCents || 0) },
    { col: "payments", q: { appId, type: "holding", status: { $in: ["paid","succeeded","completed"] } }, map: (d) => Number(d?.amountCents || d?.netCents || d?.amount || 0) },
    { col: "stripe_charges", q: { appId, paid: true }, map: (d) => Number(d?.amount_captured || d?.amount || 0) },
  ];

  let total = 0;
  for (const c of candidates) {
    const col = db.collection(c.col);
    const many = await col.find(c.q).toArray().catch(() => []);
    for (const doc of many) {
      total += typeof c.map === "function" ? c.map(doc) : Number(doc?.amountCents || 0);
    }
    if (debug && many?.length) {
      if (c.col === "holding_requests") break;
    }
  }
  return Math.max(0, Math.round(total));
}

export async function GET(
  req: NextRequest,
  ctx: { params?: { id: string } } | { params?: Promise<{ id: string }> }
) {
  const debug = req.nextUrl.searchParams.get("debug") === "1";
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
    }

    const db = await getDb();
    const { ObjectId } = await import("mongodb");

    // ✅ unwrap params safely
    const appId = await getParamsId(req, ctx as any);
    if (!appId) {
      return NextResponse.json({ ok: false, error: "bad_application_id" }, { status: 400 });
    }

    const firmIdQuery = req.nextUrl.searchParams.get("firmId") || undefined;

    const apps = db.collection<ApplicationDoc>("applications");
    const forms = db.collection<ApplicationFormDoc>("application_forms");
    const fms   = db.collection<FirmMembershipDoc>("firm_memberships");

    const appFilter = isHex24(appId) ? { _id: new ObjectId(appId) } : ({ _id: appId } as any);
    const app = await apps.findOne(appFilter, { projection: { _id: 1, formId: 1, upfronts: 1 } });
    if (!app) {
      return NextResponse.json({ ok: false, error: "application_not_found" }, { status: 404 });
    }

    // Resolve firm via form
    const formKey = toStr(app.formId);
    const form = await forms.findOne(
      isHex24(formKey) ? { _id: new ObjectId(formKey) } : ({ _id: formKey } as any),
      { projection: { firmId: 1 } }
    );
    if (!form?.firmId) {
      return NextResponse.json({ ok: false, error: "form_or_firm_missing" }, { status: 400 });
    }
    const firmIdResolved = String(form.firmId);
    if (firmIdQuery && firmIdQuery !== firmIdResolved) {
      return NextResponse.json({ ok: false, error: "firm_mismatch" }, { status: 403 });
    }

    // Firm auth
    const uid = toStr((user as any)?._id ?? (user as any)?.id ?? (user as any)?.userId ?? (user as any)?.sub ?? "");
    const uidOid = ObjectId.isValid(uid) ? new ObjectId(uid) : null;
    const userIdOr = uidOid ? [{ userId: uid }, { userId: uidOid }] : [{ userId: uid }];
    const membership = await fms.findOne(
      { firmId: firmIdResolved, active: true, $or: userIdOr },
      { projection: { role: 1 } }
    );
    if (!membership?.role) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    // Expected amounts from application
    const first    = Math.max(0, Number(app.upfronts?.first || 0));
    const last     = Math.max(0, Number(app.upfronts?.last || 0));
    const keyFee   = Math.max(0, Number(app.upfronts?.key || 0));
    const security = Math.max(0, Number(app.upfronts?.security || 0));

    const expectedOther = first + last + keyFee; // “Other Up-front Fees”
    const expectedDep   = security;

    if (expectedOther === 0 && expectedDep === 0) {
      return NextResponse.json({
        ok: true,
        upfront: { exists: false, dueCents: 0 },
        deposit: { exists: false, dueCents: 0 },
      }, { status: 404 });
    }

    // Total holding paid so far
    const paid = await getHoldingPaidCents(db, toStr(app._id), debug);

    // Allocation
    const remainingOther = Math.max(0, expectedOther - paid);
    const spill = Math.max(0, paid - expectedOther);
    const remainingDep = Math.max(0, expectedDep - spill);

    // Tenant links
    const qs = new URLSearchParams({ appId: toStr(app._id) });
    if (firmIdQuery) qs.set("firmId", firmIdQuery);
    const upfrontHref = `/tenant/pay/upfront?${qs.toString()}`;
    const depositHref = `/tenant/pay/deposit?${qs.toString()}`;

    const response = {
      ok: true,
      upfront: {
        exists: expectedOther > 0,
        dueCents: remainingOther,
        href: expectedOther > 0 && remainingOther > 0 ? upfrontHref : undefined,
      },
      deposit: {
        exists: expectedDep > 0,
        dueCents: remainingDep,
        href: expectedDep > 0 && remainingDep > 0 ? depositHref : undefined,
      },
      ...(debug
        ? {
            debug: {
              expected: { first, last, key: keyFee, security },
              expectedOther,
              expectedDep,
              paidHoldingCents: paid,
              allocation: { remainingOther, spillToDeposit: spill, remainingDep },
              firmIdResolved,
            },
          }
        : {}),
    };

    return NextResponse.json(response);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "server_error", message: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
