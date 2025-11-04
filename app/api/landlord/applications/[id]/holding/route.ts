// app/api/landlord/applications/[id]/holding/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { validateMAHolding } from "@/lib/holding/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toStringId(v: any) {
  if (!v) return "";
  if (typeof v === "string") return v;
  try { return v?.toHexString ? v.toHexString() : String(v); } catch { return String(v); }
}
const rand = (n = 16) => Array.from({ length: n }, () => Math.floor(Math.random() * 36).toString(36)).join("");
const isHex24 = (s: string) => /^[0-9a-fA-F]{24}$/.test(s);

// --- NEW: robust id reader (supports Promise params & URL fallback)
async function getIdParam(req: NextRequest, ctx: { params?: any }) {
  try {
    const p = await (ctx as any)?.params; // handles both plain object and Promise
    const raw = Array.isArray(p?.id) ? p.id[0] : p?.id;
    if (raw) return String(raw);
  } catch {}
  const path = req.nextUrl?.pathname || "";
  const seg = path.split("/").filter(Boolean).pop();
  return seg || "";
}

// --- NEW: safe user id picker, tolerant of varied auth shapes
function pickUserId(user: unknown): string {
  const u = user as any;
  return toStringId(
    u?._id ??
    u?.id ??        // some auth libs
    u?.userId ??    // custom user objects
    u?.sub ??       // JWT subject
    u?.uid ??       // Firebase-style
    u?.email ??     // last resort
    ""
  );
}

export async function POST(
  req: NextRequest,
  ctx: { params: { id: string } } | { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const db = await getDb();
  const apps = db.collection("applications");
  const forms = db.collection("application_forms");
  const holds = db.collection("holding_requests");
  const fms = db.collection("firm_memberships");
  const { ObjectId } = await import("mongodb");

  const appId = await getIdParam(req, ctx as any); // <-- unwrap params safely
  const body = await req.json().catch(() => ({}));

  const amounts = body?.amounts ?? {};
  const monthlyRent = Number(body?.monthlyRent ?? 0) | 0;
  const minimumDue = Number(body?.minimumDue ?? 0) | 0;

  // Load application (string or ObjectId)
  const appFilter = isHex24(appId) ? { _id: new ObjectId(appId) } : ({ _id: appId } as any);
  const app = await apps.findOne(appFilter, {
    projection: { _id: 1, householdId: 1, formId: 1, status: 1 },
  });
  if (!app) return NextResponse.json({ ok: false, error: "application_not_found" }, { status: 404 });

  // Load form → firmId (string or ObjectId)
  const formKey = String(app.formId);
  const formFilter = isHex24(formKey) ? { _id: new ObjectId(formKey) } : ({ _id: formKey } as any);
  const form = await forms.findOne(formFilter, { projection: { firmId: 1 } });
  if (!form?.firmId) return NextResponse.json({ ok: false, error: "firm_not_found" }, { status: 400 });
  const firmId = String(form.firmId);

  // Firm auth (userId may be stored as string or ObjectId)
  const uidStr = pickUserId(user); // <-- replaced direct user.id access
  const uidOid = ObjectId.isValid(uidStr) ? new ObjectId(uidStr) : null;
  const userIdOr = uidOid ? [{ userId: uidStr }, { userId: uidOid }] : [{ userId: uidStr }];

  const membership = await fms.findOne(
    { firmId, active: true, $or: userIdOr },
    { projection: { role: 1 } }
  );
  if (!membership) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  // If a PAID hold already exists, block
  const existing = await holds.findOne(
    { appId: String(app._id), firmId, status: { $in: ["pending", "paid"] } },
    { projection: { _id: 1, status: 1, token: 1 } }
  );
  if (existing?.status === "paid") {
    return NextResponse.json({ ok: false, error: "already_paid" }, { status: 409 });
  }

  // Validate MA caps
  const a = {
    first: Number(amounts.first || 0),
    last: Number(amounts.last || 0),
    security: Number(amounts.security || 0),
    key: Number(amounts.key || 0),
  };
  const { ok, errs, total } = validateMAHolding(a, monthlyRent);
  if (!ok) return NextResponse.json({ ok: false, error: "invalid_amounts", details: errs }, { status: 400 });

  // Validate minimumDue
  if (!(minimumDue > 0 && minimumDue <= total)) {
    return NextResponse.json(
      { ok: false, error: "invalid_minimum", details: ["minimumDue must be > 0 and ≤ total"] },
      { status: 400 }
    );
  }

  const token = existing?.token ?? `hold_${rand(22)}`;
  const doc = {
    _id: existing?._id ?? token,
    appId: String(app._id),
    firmId,
    householdId: String(app.householdId),
    amounts: a,
    monthlyRent,
    total,
    minimumDue,
    status: "pending",
    token,
    createdAt: new Date(),
  };

  await holds.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });

  // Optionally reflect that we’re gating on payment
  await apps.updateOne(appFilter, { $set: { status: "needs_approval" } });

  const payUrl = `/hold/${encodeURIComponent(token)}`;
  return NextResponse.json({ ok: true, payUrl, token, total, minimumDue });
}
