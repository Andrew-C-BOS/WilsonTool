// app/api/tenant/applications/[id]/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { computeNextState } from "@/domain/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------- shared types ---------- */
type MemberRole = "primary" | "co_applicant" | "cosigner";

type FormQuestion = {
  id: string;
  sectionId: string;
  label: string;
  inputType:
    | "short_text" | "long_text" | "number" | "currency" | "yes_no"
    | "date" | "email" | "phone" | "select_single" | "select_multi" | "file";
  required: boolean;
  showForRoles: MemberRole[];
  options?: string[];
  validation?: { min?: number; max?: number; pattern?: string };
};
type ApplicationForm = {
  _id?: string;
  id?: string;
  name: string;
  version: number;
  scope: "portfolio";
  questions: FormQuestion[];
};

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

async function pickFormsCol(db: any) {
  // prefer application_forms if present
  const names = ["application_forms", "forms"];
  const existing = new Set((await db.listCollections().toArray()).map((c: any) => c.name));
  for (const n of names) if (existing.has(n)) return db.collection(n);
  return db.collection("application_forms");
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
    .find({ $or: [{ userId }, { email: emailLc }, { email: (user as any).email }] })
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
    .find({ householdId, $or: [{ userId }, { email: emailLc }, { email: (user as any).email }] })
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
  const cursor = membershipsCol.find({ householdId, active: true });
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

/* ---------- completeness helpers ---------- */
async function loadFormById(db: any, formId: string): Promise<ApplicationForm | null> {
  const col = await pickFormsCol(db);
  const { ObjectId } = await import("mongodb");
  const filter = /^[0-9a-fA-F]{24}$/.test(formId)
    ? { _id: new ObjectId(formId) }
    : { $or: [{ _id: formId }, { id: formId }] as any };

  const doc = await col.findOne(filter);
  if (!doc) return null;
  return {
    _id: toStringId(doc._id ?? doc.id),
    id: toStringId(doc.id ?? doc._id),
    name: String(doc.name ?? "Application"),
    version: Number(doc.version ?? 1),
    scope: (doc.scope ?? "portfolio") as "portfolio",
    questions: Array.isArray(doc.questions) ? doc.questions : [],
  };
}

function isMemberCompleteForRole(
  role: MemberRole,
  form: ApplicationForm | null,
  memberAnswers: Record<string, any> | undefined
): boolean {
  if (!form) return true; // treat "submitted" as sufficient if form missing (MVP)
  const ans = memberAnswers ?? {};
  for (const q of form.questions) {
    if (!q.required) continue;
    if (!q.showForRoles?.includes(role)) continue;
    const v = ans[q.id];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (empty) return false;

    if ((q.inputType === "number" || q.inputType === "currency") && v !== "" && v !== null) {
      const n = Number(v);
      if (Number.isNaN(n)) return false;
      if (q.validation?.min !== undefined && n < q.validation.min!) return false;
      if (q.validation?.max !== undefined && n > q.validation.max!) return false;
    }
    if (q.validation?.pattern && typeof v === "string") {
      try { const re = new RegExp(q.validation.pattern); if (!re.test(v)) return false; } catch {}
    }
  }
  return true;
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
    allowed = true; reason = "household_match";
  } else if (!appHid && myHouseholdId) {
    allowed = true; reason = "household_missing";
  } else if (!allowed && Array.isArray(app.members) && app.members.length) {
    const legacyHit = app.members.some(
      (m: any) => m.userId === userId || String(m.email || "").toLowerCase() === emailLc
    );
    if (legacyHit) { allowed = true; reason = "legacy_membership"; }
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
    { role: MemberRole; email: string; answers: Record<string, any>; submittedAt?: string }
  > | undefined = undefined;

  if (app.answersByMember && typeof app.answersByMember === "object") {
    answersByMemberOut = {};
    for (const [k, v] of Object.entries(app.answersByMember as Record<string, any>)) {
      const userKey = mapM2U.get(k) ?? k; // translate membershipId -> userId when known
      const prev = answersByMemberOut[userKey];
      const submittedAt = v?.submittedAt ? new Date(v.submittedAt).toISOString() : undefined;
      if (!prev) {
        answersByMemberOut[userKey] = {
          role: (v?.role ?? "co_applicant") as MemberRole,
          email: String(v?.email ?? "").toLowerCase(),
          answers: { ...(v?.answers ?? {}) },
          submittedAt,
        };
      } else {
        answersByMemberOut[userKey] = {
          role: (v?.role ?? prev.role) as MemberRole,
          email: String(v?.email || prev.email || "").toLowerCase(),
          answers: { ...prev.answers, ...(v?.answers ?? {}) },
          submittedAt: submittedAt ?? prev.submittedAt,
        };
      }
    }
  }

  const status = String(app.status ?? "draft");
  const editable = status === "draft";
  const completed = !editable;

  // Provide "me" with memberId set to USER ID (canonical)
  const me = {
    memberId: userId,
    email: myMembership?.email ?? emailLc,
    role: (myMembership?.role ?? "co_applicant") as MemberRole,
  };

  return NextResponse.json({
    ok: true,
    app: {
      id: String(app._id),
      formId: String(app.formId),
      status,
      editable,            // ← NEW
      completed,           // ← NEW
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
   Latch: only editable in 'draft'
   - { updates: [...] }  → allowed only in draft (atomic filter)
   - { action: "member_submit" } → allowed only in draft
   - explicit { status } writes disallowed
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

  const cur = await appsCol.findOne(filter, {
    projection: { formId: 1, status: 1, householdId: 1, members: 1, answersByMember: 1, submittedAt: 1, updatedAt: 1 },
  });
  if (!cur) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const appHid: string | null = cur.householdId ? String(cur.householdId) : null;

  // Resolve membership within this app's household first (for role/email)
  let myMembership = await resolveMyMembershipForHousehold(db, user, appHid);
  if (!myMembership) myMembership = await resolveMyMembership(db, user);

  const emailLc = String(user.email ?? "").toLowerCase();
  const userId = toStringId((user as any).id ?? (user as any)._id ?? (user as any).userId ?? emailLc);

  // auth: household or legacy members[]
  let allowed = false;
  if (appHid && myMembership?.householdId && appHid === myMembership.householdId) allowed = true;
  else if (!appHid && myMembership?.householdId) {
    await appsCol.updateOne(filter, { $set: { householdId: myMembership.householdId } });
    allowed = true;
  } else if (!allowed && Array.isArray(cur.members) && cur.members.length) {
    const legacyHit = cur.members.some(
      (m: any) => m.userId === userId || String(m.email || "").toLowerCase() === emailLc
    );
    if (legacyHit) allowed = true;
  }
  if (!allowed) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const now = new Date();
  const currentStatus = String(cur.status ?? "draft");
  const isEditable = currentStatus === "draft";

  /* ---------- disallow raw status writes ---------- */
  if (typeof body?.status === "string") {
    return NextResponse.json({ ok: false, error: "status_write_not_allowed" }, { status: 400 });
  }

  /* ---------- A) debounced answer updates (member- or role-scoped) ---------- */
  if (Array.isArray(body?.updates) && body.updates.length > 0) {
    if (!isEditable) {
      return NextResponse.json({ ok: false, error: "locked", state: currentStatus }, { status: 409 });
    }

    type Up =
      | { memberId?: string; email?: string; role?: MemberRole | string; qid: string; value: any }
      | { role?: MemberRole | string; qid: string; value: any };

    const updates: Up[] = body.updates as Up[];

    const defaultRole = myMembership?.role ?? "co_applicant";
    const defaultEmail = myMembership?.email ?? emailLc;

    const { mapM2U } = await buildMembershipMaps(db, appHid);
    const setPaths: Record<string, any> = {};
    let count = 0;

    for (const u of updates) {
      const qid = String((u as any).qid);
      if (!qid) continue;
      count++;

      const incoming = (u as any).memberId ? String((u as any).memberId) : "";
      const memberUserId = incoming ? (mapM2U.get(incoming) ?? incoming) : userId;

      const rawRole = String((u as any).role ?? defaultRole ?? "co_applicant").toLowerCase();
      const role: MemberRole = rawRole === "primary" || rawRole === "cosigner" ? (rawRole as MemberRole) : "co_applicant";
      const emailForSnap = String((u as any).email || defaultEmail || "").toLowerCase();

      if (memberUserId) {
        setPaths[`answersByMember.${memberUserId}.role`] = role;
        setPaths[`answersByMember.${memberUserId}.email`] = emailForSnap;
        setPaths[`answersByMember.${memberUserId}.answers.${qid}`] = (u as any).value;
      } else {
        setPaths[`answers.${role}.${qid}`] = (u as any).value; // legacy fallback
      }
    }

    if (count === 0) return NextResponse.json({ ok: true, noop: true });

    // Atomic latch: only update if still draft
    const res = await appsCol.updateOne(
      { ...filter, status: "draft" },
      {
        $set: { ...setPaths, updatedAt: now },
        $push: { timeline: { at: now, by: userId, event: "answers.update", meta: { count } } } as any,
      }
    );

    if (res.matchedCount === 0) {
      return NextResponse.json({ ok: false, error: "locked", state: currentStatus }, { status: 409 });
    }

    return NextResponse.json({ ok: true, modified: 1, debug: dbg({ count }) });
  }

  /* ---------- B) member submit ---------- */
  if (body?.action === "member_submit") {
    if (!isEditable) {
      return NextResponse.json({ ok: false, error: "locked", state: currentStatus }, { status: 409 });
    }

    // 1) Stamp this member as submitted (guarded by draft)
    const stamp = await appsCol.updateOne(
      { ...filter, status: "draft" },
      {
        $set: {
          [`answersByMember.${userId}.submittedAt`]: now,
          [`answersByMember.${userId}.email`]: myMembership?.email ?? emailLc,
          [`answersByMember.${userId}.role`]: myMembership?.role ?? "co_applicant",
          updatedAt: now,
        },
        $push: { timeline: { at: now, by: userId, event: "member.submitted", meta: { userId } } } as any,
      }
    );
    if (stamp.matchedCount === 0) {
      return NextResponse.json({ ok: false, error: "locked", state: currentStatus }, { status: 409 });
    }

    // 2) Reload minimal state + answers for checks
    const fresh = await appsCol.findOne(filter, {
      projection: { status: 1, formId: 1, householdId: 1, answersByMember: 1 },
    });

    // 3) Load the form to know required questions by role
    const formId = String(fresh?.formId ?? "");
    const form = formId ? await loadFormById(db, formId) : null;

    // 4) Required members: all active household memberships (fallback to caller)
    const householdId: string | null = fresh?.householdId ?? null;
    const activeMembers = householdId
      ? await membershipsCol.find({ householdId, active: true }).project({ userId: 1, role: 1 }).toArray()
      : [];
    const requiredList =
      activeMembers.length > 0
        ? activeMembers.map((m: any) => ({ userId: toStringId(m.userId), role: normalizeRole(m.role) }))
        : [{ userId, role: (myMembership?.role ?? "co_applicant") as MemberRole }];

    // 5) Check each required member: submitted & complete
    const byMember = (fresh?.answersByMember ?? {}) as Record<
      string, { role?: MemberRole; answers?: Record<string, any>; submittedAt?: any }
    >;

    let allSubmitted = true;
    for (const rm of requiredList) {
      const snap = byMember[rm.userId] ?? {};
      const submitted = !!snap.submittedAt;
      const roleForCheck = normalizeRole(snap.role ?? rm.role);
      const complete = isMemberCompleteForRole(roleForCheck, form, snap.answers || {});
      if (!(submitted && complete)) { allSubmitted = false; break; }
    }

    // 6) If everyone complete, flip draft→submitted via rules (guarded by draft)
    let next = currentStatus;
    if (allSubmitted) {
      // Prefer system actor in rules to support jobs/queues; tenant also works if your rules allow it.
      next = computeNextState(currentStatus as any, "submit", "system", { membersAck: true }) as string;
    }

    if (next !== currentStatus) {
      const flip = await appsCol.updateOne(
        { ...filter, status: "draft" }, // atomic guard
        {
          $set: { status: next, submittedAt: now, updatedAt: now },
          $push: { timeline: { at: now, by: "system", event: "status.change", meta: { from: currentStatus, to: next, reason: "all_members_complete" } } } as any,
        }
      );
      if (flip.matchedCount === 0) {
        return NextResponse.json({ ok: false, error: "locked", state: currentStatus }, { status: 409 });
      }
      return NextResponse.json({ ok: true, state: next, auto: true });
    }

    return NextResponse.json({ ok: true, state: currentStatus, auto: false });
  }

  /* ---------- C) explicit status writes not allowed from tenant ---------- */
  if (typeof body?.status === "string") {
    return NextResponse.json({ ok: false, error: "status_write_not_allowed" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, noop: true, debug: dbg({ status: currentStatus }) });

  // local
  function normalizeRole(r: any): MemberRole {
    const x = String(r || "").toLowerCase();
    return x === "primary" || x === "cosigner" ? (x as MemberRole) : "co_applicant";
  }
}
