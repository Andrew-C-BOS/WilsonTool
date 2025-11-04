// app/api/tenant/applications/[id]/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------- shared types ---------- */
type MemberRole = "primary" | "co_applicant" | "cosigner";

/* ---------- helpers ---------- */
function toStringId(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  try { return v?.toHexString ? v.toHexString() : String(v); } catch { return String(v); }
}

async function pickMembershipsCol(db: any) {
  const names = [
    "households_membership",
    "household_memberhsips",
    "households_memberhsips",
    "household_memberships",
    "households_memberships",
  ];
  const existing = new Set((await db.listCollections().toArray()).map((c: any) => c.name));
  for (const n of names) if (existing.has(n)) return db.collection(n);
  return db.collection("households_membership");
}

async function resolveMyHouseholdId(db: any, user: any): Promise<string | null> {
  const col = await pickMembershipsCol(db);
  const emailLc = String(user?.email ?? "").toLowerCase();
  const userId = toStringId((user as any).id ?? (user as any)._id ?? (user as any).userId ?? emailLc);
  const row = await col
    .find({ $or: [{ userId }, { email: emailLc }, { email: (user as any).email }] })
    .sort({ active: -1, joinedAt: -1 })
    .limit(1)
    .next();
  return row ? toStringId(row.householdId) : null;
}

async function getIdFromParamsOrUrl(
  req: NextRequest,
  paramInput: { id: string } | Promise<{ id: string }>
) {
  try {
    const p = await paramInput;
    if (p?.id) return String(p.id);
  } catch {}
  const path = req.nextUrl?.pathname || "";
  const seg = path.split("/").filter(Boolean).pop();
  return seg || "";
}

/* ============================================================
   GET /api/tenant/applications/[id]
============================================================ */
export async function GET(
  req: NextRequest,
  ctx: { params: { id: string } } | { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const url = new URL(req.url);
  const DEBUG = url.searchParams.get("debug") === "1";
  const dbg = (x: any) => (DEBUG ? x : undefined);

  const db = await getDb();
  const appsCol = db.collection("applications");
  const { ObjectId } = await import("mongodb");

  const appId = await getIdFromParamsOrUrl(req, (ctx as any).params);
  if (!appId) return NextResponse.json({ ok: false, error: "bad_app_id" }, { status: 400 });

  const filter =
    /^[0-9a-fA-F]{24}$/.test(appId) ? { _id: new ObjectId(appId) } : ({ _id: appId } as any);

  const app = await appsCol.findOne(filter, {
    projection: {
      formId: 1,
      status: 1,
      householdId: 1,
      updatedAt: 1,
      submittedAt: 1,
      answers: 1,
      members: 1,
    },
  });
  if (!app) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  // Auth by household, with legacy back-compat
  const myHouseholdId = await resolveMyHouseholdId(db, user);
  const emailLc = String(user.email ?? "").toLowerCase();
  const userId = toStringId((user as any).id ?? (user as any)._id ?? (user as any).userId ?? emailLc);

  const appHid = app.householdId ? String(app.householdId) : null;

  let allowed = false;
  let reason = "none";

  if (appHid && myHouseholdId && appHid === myHouseholdId) {
    allowed = true;
    reason = "household_match";
  } else if (!appHid && myHouseholdId) {
    allowed = true;
    reason = "household_missing";
  } else if (!allowed && Array.isArray(app.members) && app.members.length) {
    const legacyHit = app.members.some(
      (m: any) => m.userId === userId || String(m.email || "").toLowerCase() === emailLc
    );
    if (legacyHit) {
      allowed = true;
      reason = "legacy_membership";
    }
  }

  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: "forbidden", debug: dbg({ myHouseholdId, appHid, reason }) },
      { status: 403 }
    );
  }

  return NextResponse.json({
    ok: true,
    app: {
      id: String(app._id),
      formId: String(app.formId),
      status: app.status,
      householdId: appHid ?? undefined,
      updatedAt: app.updatedAt ?? null,
      submittedAt: app.submittedAt ?? null,
    },
    debug: dbg({ myHouseholdId, appHid, reason }),
  });
}

/* ============================================================
   PATCH /api/tenant/applications/[id]
   Body:
     { status: AppStatus }
   OR
     { updates: [{ role, qid, value }, ...] }
============================================================ */
export async function PATCH(
  req: NextRequest,
  ctx: { params: { id: string } } | { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const url = new URL(req.url);
  const DEBUG = url.searchParams.get("debug") === "1";
  const dbg = (x: any) => (DEBUG ? x : undefined);

  const db = await getDb();
  const appsCol = db.collection("applications");
  const { ObjectId } = await import("mongodb");

  const appId = await getIdFromParamsOrUrl(req, (ctx as any).params);
  if (!appId) return NextResponse.json({ ok: false, error: "bad_app_id" }, { status: 400 });

  const filter =
    /^[0-9a-fA-F]{24}$/.test(appId) ? { _id: new ObjectId(appId) } : ({ _id: appId } as any);

  const app = await appsCol.findOne(filter, {
    projection: { formId: 1, status: 1, householdId: 1, members: 1 },
  });
  if (!app) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  // Auth by household, with back-compat
  const myHouseholdId = await resolveMyHouseholdId(db, user);
  const emailLc = String(user.email ?? "").toLowerCase();
  const userId = toStringId((user as any).id ?? (user as any)._id ?? (user as any).userId ?? emailLc);

  const appHid = app.householdId ? String(app.householdId) : null;

  let allowed = false;
  let reason = "none";

  if (appHid && myHouseholdId && appHid === myHouseholdId) {
    allowed = true;
    reason = "household_match";
  } else if (!appHid && myHouseholdId) {
    await appsCol.updateOne(filter, { $set: { householdId: myHouseholdId } });
    allowed = true;
    reason = "household_attached";
  } else if (!allowed && Array.isArray(app.members) && app.members.length) {
    const legacyHit = app.members.some(
      (m: any) => m.userId === userId || String(m.email || "").toLowerCase() === emailLc
    );
    if (legacyHit) {
      allowed = true;
      reason = "legacy_membership";
    }
  }

  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: "forbidden", debug: dbg({ myHouseholdId, appHid, reason }) },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const now = new Date();

  // Status-only change
  if (typeof body?.status === "string") {
    const upd = await appsCol.updateOne(filter, {
      $set: { status: body.status, updatedAt: now },
      $push: {
        timeline: {
          at: now,
          by: userId,
          event: "status.change",
          meta: { to: body.status },
        },
      } as any,
    });
    return NextResponse.json({ ok: true, modified: upd.modifiedCount, debug: dbg({ reason }) });
  }

  // Debounced answer updates
  if (Array.isArray(body?.updates) && body.updates.length > 0) {
    type Up = { role: MemberRole | string; qid: string; value: any };
    const updates: Up[] = body.updates as Up[];

    // Build $set paths like "answers.primary.q_email": "foo"
    const setPaths: Record<string, any> = {};
    for (const u of updates) {
      const rawRole = String((u as any).role ?? "").toLowerCase();
      const r: MemberRole =
        rawRole === "co_applicant" || rawRole === "cosigner" ? (rawRole as MemberRole) : "primary";

      const qid = String(u.qid);
      setPaths[`answers.${r}.${qid}`] = u.value;
    }

    const upd = await appsCol.updateOne(filter, {
      $set: { ...setPaths, updatedAt: now },
      $push: {
        timeline: {
          at: now,
          by: userId,
          event: "answers.update",
          meta: { count: updates.length },
        },
      } as any,
    });

    return NextResponse.json({
      ok: true,
      modified: upd.modifiedCount,
      debug: dbg({ reason, count: updates.length }),
    });
  }

  // Nothing to do
  return NextResponse.json({ ok: true, noop: true, debug: dbg({ reason }) });
}
