// app/api/landlord/applications/[id]/decision/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import type { ObjectId } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────────────── Types ───────────────── */
type IdLike = string | ObjectId;

type TimelineEvent = {
  at: Date;
  by: string;
  event: string;
  meta?: Record<string, unknown>;
};

type ApplicationDoc = {
  _id: IdLike;
  formId: IdLike;
  status: string;
  householdId?: IdLike;
  timeline?: TimelineEvent[];
  updatedAt?: Date;
  submittedAt?: Date | string | null;
};

type ApplicationFormDoc = {
  _id: IdLike;
  firmId: IdLike;
  firmName?: string | null;
};

type FirmMembershipDoc = {
  _id: IdLike;
  firmId: string;
  userId?: IdLike;
  email?: string;
  role?: "member" | "admin" | "owner";
  active: boolean;
};

/* ───────────────── helpers ───────────────── */
function toStringId(v: any) {
  if (!v) return "";
  if (typeof v === "string") return v;
  try {
    return v?.toHexString ? v.toHexString() : String(v);
  } catch {
    return String(v);
  }
}
function isHex24(s: string) {
  return /^[0-9a-fA-F]{24}$/.test(s);
}
async function getParamsId(
  req: NextRequest,
  ctx: { params?: { id: string } | Promise<{ id: string }> }
) {
  try {
    const p = await (ctx as any)?.params;
    const raw = Array.isArray(p?.id) ? p.id[0] : p?.id;
    if (raw) return String(raw);
  } catch {}
  const seg = (req.nextUrl?.pathname || "").split("/").filter(Boolean).pop();
  return seg || "";
}
/** Safely derive a stable identifier for the current user, stringifying ObjectId if needed. */
function pickUserId(user: unknown): string {
  const u = user as any;
  return toStringId(
    u?._id ?? u?.id ?? u?.userId ?? u?.sub ?? u?.uid ?? u?.email ?? ""
  );
}

/* ───────────────── handler ───────────────── */
export async function POST(
  req: NextRequest,
  ctx: { params: { id: string } } | { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  const db = await getDb();
  const { ObjectId } = await import("mongodb");

  // Collections
  const apps  = db.collection<ApplicationDoc>("applications");
  const forms = db.collection<ApplicationFormDoc>("application_forms");
  const fms   = db.collection<FirmMembershipDoc>("firm_memberships");

  const appId = await getParamsId(req, ctx);
  if (!appId) {
    return NextResponse.json({ ok: false, error: "bad_application_id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "");

  if (!["preliminary_accept", "approve", "reject"].includes(action)) {
    return NextResponse.json({ ok: false, error: "bad_action" }, { status: 400 });
  }

  // Load the application
  const appFilter = isHex24(appId) ? { _id: new ObjectId(appId) } : ({ _id: appId } as any);
  const app = await apps.findOne(appFilter, {
    projection: { _id: 1, formId: 1, status: 1, householdId: 1 },
  });
  if (!app) {
    return NextResponse.json({ ok: false, error: "application_not_found" }, { status: 404 });
  }

  // Find the form (to get firmId)
  const formKey = String(app.formId);
  const form = await forms.findOne(
    isHex24(formKey) ? { _id: new ObjectId(formKey) } : ({ _id: formKey } as any),
    { projection: { firmId: 1, firmName: 1 } }
  );
  if (!form?.firmId) {
    return NextResponse.json({ ok: false, error: "form_or_firm_missing" }, { status: 400 });
  }

  const firmId = String(form.firmId);

  // Resolve current user's membership role
  const uidStr = pickUserId(user);
  const uidOid = ObjectId.isValid(uidStr) ? new ObjectId(uidStr) : null;
  const userIdOr = uidOid
    ? [{ userId: uidStr }, { userId: uidOid }]
    : [{ userId: uidStr }];

  const membership = await fms.findOne(
    { firmId, active: true, $or: userIdOr },
    { projection: { role: 1 } }
  );
  const role = String(membership?.role || "").toLowerCase() as "member" | "admin" | "owner" | "";

  // Server-side authorization (role)
  const canPrelim = role === "member" || role === "admin" || role === "owner";
  const canApprove = role === "admin" || role === "owner";
  const canReject = role === "member" || role === "admin" || role === "owner";

  const allowedByRole =
    (action === "preliminary_accept" && canPrelim) ||
    (action === "approve"            && canApprove) ||
    (action === "reject"             && canReject);

  if (!allowedByRole) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // Status gating — new canonical flow
  // preliminary_accept: submitted → admin_screened
  // approve          : submitted|admin_screened → approved_high
  // reject           : submitted → rejected
  const current = String(app.status || "draft");
  let target: string | null = null;
  let updateFilter: any = { ...appFilter }; // will add expected status for atomicity

  if (action === "preliminary_accept") {
    if (current === "admin_screened") {
      // already prelim accepted → no-op
      return NextResponse.json({ ok: true, status: current, no_op: true });
    }
    if (current !== "submitted") {
      return NextResponse.json({ ok: false, error: "bad_state", from: current, needs: "submitted" }, { status: 409 });
    }
    target = "admin_screened";
    updateFilter = { ...appFilter, status: "submitted" };
  } else if (action === "approve") {
    if (current === "approved_high") {
      return NextResponse.json({ ok: true, status: current, no_op: true });
    }
    if (current !== "submitted" && current !== "admin_screened") {
      return NextResponse.json({ ok: false, error: "bad_state", from: current, needs: "submitted|admin_screened" }, { status: 409 });
    }
    target = "approved_high";
    updateFilter = { ...appFilter, status: { $in: ["submitted", "admin_screened"] } };
  } else {
    // reject
    if (current === "rejected" || current === "withdrawn") {
      return NextResponse.json({ ok: true, status: current, no_op: true });
    }
    if (current !== "submitted") {
      return NextResponse.json({ ok: false, error: "bad_state", from: current, needs: "submitted" }, { status: 409 });
    }
    target = "rejected";
    updateFilter = { ...appFilter, status: "submitted" };
  }

  const now = new Date();

  // Timeline entries
  const decisionEntry: TimelineEvent = {
    at: now,
    by: uidStr,
    event: `decision.${action}`, // e.g., decision.approve
  };
  const statusEntry: TimelineEvent = {
    at: now,
    by: uidStr,
    event: "status.change",
    meta: { from: current, to: target, via: action },
  };

  // Atomic update (only if status is as expected)
  const res = await apps.updateOne(updateFilter, {
    $set: { status: target, updatedAt: now },
    $push: { timeline: { $each: [decisionEntry, statusEntry] } },
  });

  if (res.matchedCount === 0) {
    // Someone else may have advanced the state; reload and report
    const after = await apps.findOne(appFilter, { projection: { status: 1 } });
    return NextResponse.json(
      { ok: false, error: "conflict_or_bad_state", current: after?.status ?? current },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true, status: target });
}
