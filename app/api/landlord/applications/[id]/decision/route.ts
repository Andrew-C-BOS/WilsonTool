// app/api/landlord/applications/[id]/decision/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import type { ObjectId } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────────────── Types to make Mongo driver happy ───────────────── */
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
  timeline?: TimelineEvent[]; // <-- declare as array so $push is allowed
};

type ApplicationFormDoc = {
  _id: IdLike;
  firmId: IdLike;
  firmName?: string | null;
};

type FirmMembershipDoc = {
  _id: IdLike;
  firmId: string;            // often stored as string in app DBs
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

async function getParamsId(req: NextRequest, ctx: { params?: any }) {
  try {
    const id = ctx?.params?.id ?? (await (ctx as any).params)?.id;
    if (id) return String(id);
  } catch {}
  const seg = (req.nextUrl?.pathname || "").split("/").filter(Boolean).pop();
  return seg || "";
}

/** Safely derive a stable identifier for the current user, stringifying ObjectId if needed. */
function pickUserId(user: unknown): string {
  const u = user as any; // SessionUser shape varies across apps
  return toStringId(
    u?._id ??
      u?.id ??     // some auth libs
      u?.userId ?? // custom user objects
      u?.sub ??    // JWT subject
      u?.uid ??    // Firebase-style
      u?.email ??  // last resort: email as identifier
      ""
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

  // Declare typed collections so update operators are type-safe
  const apps = db.collection<ApplicationDoc>("applications");
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

  // Load application (need formId/household) -> load form to get firmId
  const appFilter = isHex24(appId) ? { _id: new ObjectId(appId) } : ({ _id: appId } as any);
  const app = await apps.findOne(appFilter, {
    projection: { _id: 1, formId: 1, status: 1, householdId: 1 },
  });
  if (!app) {
    return NextResponse.json({ ok: false, error: "application_not_found" }, { status: 404 });
  }

  // Find the form and firmId
  const formKey = String(app.formId);
  const form = await forms.findOne(
    isHex24(formKey) ? { _id: new ObjectId(formKey) } : ({ _id: formKey } as any),
    { projection: { firmId: 1, firmName: 1 } }
  );
  if (!form?.firmId) {
    return NextResponse.json({ ok: false, error: "form_or_firm_missing" }, { status: 400 });
  }

  const firmId = String(form.firmId);

  // Resolve current user's membership role (string or ObjectId match)
  const uidStr = pickUserId(user);
  const uidOid = ObjectId.isValid(uidStr) ? new ObjectId(uidStr) : null;
  const userIdOr = uidOid
    ? [{ userId: uidStr }, { userId: uidOid }]
    : [{ userId: uidStr }];

  const membership = await fms.findOne(
    { firmId, active: true, $or: userIdOr },
    { projection: { role: 1 } }
  );
  const role = String(membership?.role || "").toLowerCase() as
    | "member"
    | "admin"
    | "owner"
    | "";

  // Server-side authorization
  const canPrelim = role === "member" || role === "admin" || role === "owner";
  const canApprove = role === "admin" || role === "owner";
  const canReject = role === "member" || role === "admin" || role === "owner";

  const allowed =
    action === "preliminary_accept"
      ? canPrelim
      : action === "approve"
      ? canApprove
      : canReject;

  if (!allowed) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // Compute new status based on action
  const newStatus =
    action === "preliminary_accept"
      ? "needs_approval"
      : action === "approve"
      ? "approved_pending_lease"
      : "rejected";

  const now = new Date();
  const entry: TimelineEvent = {
    at: now,
    by: uidStr,
    event: "status.change",
    meta: { to: newStatus, via: action },
  };

  await apps.updateOne(appFilter, {
    $set: { status: newStatus, updatedAt: now },
    $push: { timeline: entry }, // ok now that timeline is typed as an array
  });

  return NextResponse.json({ ok: true, status: newStatus });
}
