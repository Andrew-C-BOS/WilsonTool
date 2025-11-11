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
  try {
    return v?.toHexString ? v.toHexString() : String(v);
  } catch {
    return String(v);
  }
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

/** Resolve most-recent membership for the user (any household). */
async function resolveMyMembership(db: any, user: any): Promise<null | {
  membershipId: string;
  householdId: string | null;
  email: string;
  role: MemberRole;
  active?: boolean;
}> {
  const col = await pickMembershipsCol(db);
  const emailLc = String(user?.email ?? "").toLowerCase();
  const userId = toStringId((user as any).id ?? (user as any)._id ?? (user as any).userId ?? emailLc);
  const row = await col
    .find({
      $or: [{ userId }, { email: emailLc }, { email: (user as any).email }],
    })
    .sort({ active: -1, joinedAt: -1 })
    .limit(1)
    .next();

  if (!row) return null;
  const r = String(row.role || "co_applicant").toLowerCase();
  const role: MemberRole = r === "primary" || r === "cosigner" ? (r as MemberRole) : "co_applicant";
  return {
    membershipId: toStringId(row._id),
    householdId: row.householdId ? toStringId(row.householdId) : null,
    email: String(row.email || emailLc),
    role,
  };
}

/** Resolve membership specifically within a given householdId. */
async function resolveMyMembershipForHousehold(
  db: any,
  user: any,
  householdId: string | null | undefined
): Promise<null | {
  membershipId: string;
  householdId: string | null;
  email: string;
  role: MemberRole;
  active?: boolean;
}> {
  if (!householdId) return null;
  const col = await pickMembershipsCol(db);
  const emailLc = String(user?.email ?? "").toLowerCase();
  const userId = toStringId((user as any).id ?? (user as any)._id ?? (user as any).userId ?? emailLc);

  const row = await col
    .find({
      householdId,
      $or: [{ userId }, { email: emailLc }, { email: (user as any).email }],
    })
    .sort({ active: -1, joinedAt: -1 })
    .limit(1)
    .next();

  if (!row) return null;
  const r = String(row.role || "co_applicant").toLowerCase();
  const role: MemberRole = r === "primary" || r === "cosigner" ? (r as MemberRole) : "co_applicant";
  return {
    membershipId: toStringId(row._id),
    householdId: row.householdId ? toStringId(row.householdId) : null,
    email: String(row.email || emailLc),
    role,
  };
}

async function resolveMyHouseholdId(db: any, user: any): Promise<string | null> {
  const m = await resolveMyMembership(db, user);
  return m?.householdId ?? null;
}

/** Build a map of membershipId -> userId for a household (and inverse) */
async function buildMembershipMaps(db: any, householdId: string | null) {
  const membershipsCol = await pickMembershipsCol(db);
  const mapM2U = new Map<string, string>();
  const mapU2M = new Map<string, string>();
  if (!householdId) return { mapM2U, mapU2M };
  const cursor = membershipsCol.find({ householdId });
  for await (const m of cursor as any) {
    const mid = toStringId(m._id);
    const uid = toStringId(m.userId);
    if (mid && uid) {
      mapM2U.set(mid, uid);
      mapU2M.set(uid, mid);
    }
  }
  return { mapM2U, mapU2M };
}

/** If client sends a membershipId, convert to userId; otherwise passthrough. */
async function normalizeMemberKeyToUserId(
  db: any,
  candidate: string | null | undefined,
  householdId: string | null
): Promise<string | null> {
  if (!candidate) return null;
  const { mapM2U } = await buildMembershipMaps(db, householdId);
  return mapM2U.get(candidate) ?? candidate;
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
   - Returns app.me.memberId as the USER ID (canonical key)
   - Also re-keys answersByMember in the response to userId keys when possible
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
      answersByMember: 1,
      members: 1,
    },
  });
  if (!app) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const appHid: string | null = app.householdId ? String(app.householdId) : null;

  // Resolve household-specific membership (for role/email), but we'll use userId as the canonical key
  let myMembership = await resolveMyMembershipForHousehold(db, user, appHid);
  if (!myMembership) myMembership = await resolveMyMembership(db, user);

  // Auth by household / legacy
  const myHouseholdId = myMembership?.householdId ?? (await resolveMyHouseholdId(db, user));
  const emailLc = String(user.email ?? "").toLowerCase();
  const userId = toStringId((user as any).id ?? (user as any)._id ?? (user as any).userId ?? emailLc);

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

  // Build membershipId -> userId map for re-keying
  const { mapM2U } = await buildMembershipMaps(db, appHid);

  // Re-key answersByMember to userId keys for the response (non-destructive; not persisted here)
  let answersByMemberOut: Record<
    string,
    { role: MemberRole; email: string; answers: Record<string, any> }
  > | undefined = undefined;

  if (app.answersByMember && typeof app.answersByMember === "object") {
    answersByMemberOut = {};
    for (const [k, v] of Object.entries(app.answersByMember as Record<string, any>)) {
      const userKey = mapM2U.get(k) ?? k; // translate membershipId -> userId when known
      const prev = answersByMemberOut[userKey];
      if (!prev) {
        answersByMemberOut[userKey] = {
          role: (v?.role ?? "co_applicant") as MemberRole,
          email: String(v?.email ?? "").toLowerCase(),
          answers: { ...(v?.answers ?? {}) },
        };
      } else {
        // Merge if two keys collapse to same user (prefer newer fields, shallow merge)
        answersByMemberOut[userKey] = {
          role: (v?.role ?? prev.role) as MemberRole,
          email: String(v?.email || prev.email || "").toLowerCase(),
          answers: { ...prev.answers, ...(v?.answers ?? {}) },
        };
      }
    }
  }

  // Provide "me" with memberId set to USER ID (canonical)
  const me = {
    memberId: userId, // canonical key for answersByMember
    email: myMembership?.email ?? emailLc,
    role: (myMembership?.role ?? "co_applicant") as MemberRole,
  };

  return NextResponse.json({
    ok: true,
    app: {
      id: String(app._id),
      formId: String(app.formId),
      status: app.status,
      householdId: appHid ?? undefined,
      updatedAt: app.updatedAt ?? null,
      submittedAt: app.submittedAt ?? null,
      answersByMember: answersByMemberOut ?? undefined,
      answers: app.answers ?? undefined, // legacy
      me,
    },
    debug: dbg({ myHouseholdId, appHid, reason, me }),
  });
}

/* ============================================================
   PATCH /api/tenant/applications/[id]
   - Accepts memberId as either userId (preferred) or membershipId
   - Normalizes to userId when writing answersByMember.<userId>.*
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
  const membershipsCol = await pickMembershipsCol(db);
  const { ObjectId } = await import("mongodb");

  const appId = await getIdFromParamsOrUrl(req, (ctx as any).params);
  if (!appId) return NextResponse.json({ ok: false, error: "bad_app_id" }, { status: 400 });

  const filter =
    /^[0-9a-fA-F]{24}$/.test(appId) ? { _id: new ObjectId(appId) } : ({ _id: appId } as any);

  const app = await appsCol.findOne(filter, {
    projection: { formId: 1, status: 1, householdId: 1, members: 1, answersByMember: 1 },
  });
  if (!app) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const appHid: string | null = app.householdId ? String(app.householdId) : null;

  // Resolve membership within this app's household first (for role/email),
  // but canonical key will be userId
  let myMembership = await resolveMyMembershipForHousehold(db, user, appHid);
  if (!myMembership) myMembership = await resolveMyMembership(db, user);

  const emailLc = String(user.email ?? "").toLowerCase();
  const userId = toStringId((user as any).id ?? (user as any)._id ?? (user as any).userId ?? emailLc);

  let allowed = false;
  let reason = "none";

  if (appHid && myMembership?.householdId && appHid === myMembership.householdId) {
    allowed = true;
    reason = "household_match";
  } else if (!appHid && myMembership?.householdId) {
    await appsCol.updateOne(filter, { $set: { householdId: myMembership.householdId } });
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
      { ok: false, error: "forbidden", debug: dbg({ myHouseholdId: myMembership?.householdId ?? null, appHid, reason }) },
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
    type Up =
      | { memberId?: string; email?: string; role?: MemberRole | string; qid: string; value: any }
      | { role?: MemberRole | string; qid: string; value: any }; // legacy

    const updates: Up[] = body.updates as Up[];

    // Defaults for "me"
    const defaultUserId = userId; // canonical
    const defaultRole = myMembership?.role ?? "co_applicant";
    const defaultEmail = myMembership?.email ?? emailLc;

    // Build membership maps once for normalization
    const { mapM2U } = await buildMembershipMaps(db, appHid);

    const setPaths: Record<string, any> = {};

    for (const u of updates) {
      const qid = String((u as any).qid);
      if (!qid) continue;

      // Incoming memberId could be: userId (preferred) or membershipId (old clients).
      let incoming = String((u as any).memberId || "");
      let memberUserId: string;

      if (incoming) {
        memberUserId = mapM2U.get(incoming) ?? incoming; // normalize to userId when possible
      } else {
        memberUserId = defaultUserId;
      }

      const rawRole = String((u as any).role ?? defaultRole ?? "co_applicant").toLowerCase();
      const role: MemberRole =
        rawRole === "primary" || rawRole === "cosigner" ? (rawRole as MemberRole) : "co_applicant";
      const emailForSnap = String((u as any).email || defaultEmail || "").toLowerCase();

      if (memberUserId) {
        setPaths[`answersByMember.${memberUserId}.role`] = role;
        if (emailForSnap) setPaths[`answersByMember.${memberUserId}.email`] = emailForSnap;
        setPaths[`answersByMember.${memberUserId}.answers.${qid}`] = (u as any).value;
        continue;
      }

      // Legacy shape (no memberId at all → keep legacy answers.<role>.<qid>)
      setPaths[`answers.${role}.${qid}`] = (u as any).value;
    }

    if (Object.keys(setPaths).length === 0) {
      return NextResponse.json({ ok: true, noop: true, debug: dbg({ reason, count: 0 }) });
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
