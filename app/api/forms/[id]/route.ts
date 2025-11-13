// app/api/tenant/applications/[id]/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { computeNextState } from "@/domain/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Types aligned with the client (legacy + new) */
type MemberRole = "primary" | "co_applicant" | "cosigner";
type AppStatus =
  | "draft"
  | "submitted"
  | "admin_screened"
  | "approved_high"
  | "terms_set"
  | "min_due"
  | "min_paid"
  | "countersigned"
  | "occupied"
  | "rejected"
  | "withdrawn";

/* ---------- tiny utils ---------- */
function toStringId(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  try { return v?.toHexString ? v.toHexString() : String(v); } catch { return String(v); }
}
async function toIdFilter(id: string) {
  const { ObjectId } = await import("mongodb");
  return /^[0-9a-fA-F]{24}$/.test(id) ? { _id: new ObjectId(id) } : { _id: id as any };
}
function normalizeRole(r: any): MemberRole {
  const x = String(r || "").toLowerCase();
  return x === "primary" || x === "cosigner" ? (x as MemberRole) : "co_applicant";
}
const isEditable = (s: string | null | undefined) => s === "draft";

/* ---------- collections pickers ---------- */
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
  const names = ["application_forms", "forms"];
  const existing = new Set((await db.listCollections().toArray()).map((c: any) => c.name));
  for (const n of names) if (existing.has(n)) return db.collection(n);
  return db.collection("application_forms");
}

/* ---------- auth scope (legacy: members[] on the app) ---------- */
async function filterForUser(id: string, user: any) {
  const userEmail = String(user.email).toLowerCase();
  const userId = toStringId((user as any).id ?? (user as any)._id ?? (user as any).userId ?? user.email);
  return {
    $and: [
      await toIdFilter(id),
      {
        $or: [
          { "members.userId": userId },
          { "members.email": userEmail },
          { "members.email": user.email }, // belt-and-suspenders
        ],
      },
    ],
  };
}

/* ---------- form loading ---------- */
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
type ApplicationForm = { id?: string; _id?: string; name: string; version: number; questions: FormQuestion[] };

async function loadFormById(db: any, formId: string): Promise<ApplicationForm | null> {
  if (!formId) return null;
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
    questions: Array.isArray(doc.questions) ? doc.questions : [],
  };
}

/* ---------- completeness helpers ---------- */
function valuePresent(v: any) {
  return !(v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0));
}
function isMemberCompleteForRole(
  role: MemberRole,
  form: ApplicationForm | null,
  memberAnswers: Record<string, any> | undefined
): boolean {
  if (!form) return true; // if no form available, treat submit as sufficient (MVP)
  const ans = memberAnswers ?? {};
  for (const q of form.questions) {
    if (!q.required) continue;
    if (!q.showForRoles?.includes(role)) continue;
    const v = ans[q.id];
    if (!valuePresent(v)) return false;
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
   GET /api/tenant/applications/:id — limited view incl. answers
   + editable flag for client latch
============================================================ */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const { id } = await ctx.params;

  const db = await getDb();
  const col = db.collection("applications");
  const filter = await filterForUser(id, user);

  const app = await col.findOne(filter, {
    projection: {
      formId: 1,
      status: 1,
      members: 1,
      property: 1,
      unit: 1,
      answers: 1,            // legacy
      answersByMember: 1,    // new
      createdAt: 1,
      updatedAt: 1,
      submittedAt: 1,
      tasks: 1,
    },
  });

  if (!app) {
    const exists = await col.findOne(await toIdFilter(id), { projection: { _id: 1 } });
    return NextResponse.json(
      { ok: false, error: exists ? "forbidden" : "not_found" },
      { status: exists ? 403 : 404 }
    );
  }

  const emailLc = String(user.email ?? "").toLowerCase();
  const userId = toStringId((user as any).id ?? (user as any)._id ?? (user as any).userId ?? emailLc);
  const me =
    (Array.isArray(app.members) ? app.members.find((m: any) => (m.userId && toStringId(m.userId) === userId) || String(m.email || "").toLowerCase() === emailLc) : null)
    ?? { userId, email: emailLc, role: "co_applicant" };

  const status = String(app.status ?? "draft");
  const editable = isEditable(status);

  return NextResponse.json({
    ok: true,
    app: {
      id: String((app as any)._id),
      formId: String(app.formId ?? ""),
      status,
      editable, // ← NEW
      members: app.members ?? [],
      property: app.property ?? null,
      unit: app.unit ?? null,
      createdAt: app.createdAt ?? null,
      updatedAt: app.updatedAt ?? null,
      submittedAt: app.submittedAt ?? null,
      answers: app.answers ?? undefined,
      answersByMember: app.answersByMember ?? undefined,
      tasks: app.tasks ?? undefined,
      me: { memberId: userId, email: me.email, role: normalizeRole(me.role) as MemberRole },
    },
  });
}

/* ============================================================
   PATCH /api/tenant/applications/:id
   Latch: only editable in 'draft'
   - { updates: [...] }  → allowed only in draft (atomic filter)
   - { action: "member_submit" } → allowed only in draft
   - explicit { status } writes disallowed
============================================================ */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const { id } = await ctx.params;

  const db = await getDb();
  const appsCol = db.collection("applications");
  const membershipsCol = await pickMembershipsCol(db);

  const baseFilter = await filterForUser(id, user);
  const now = new Date();
  const body = await req.json().catch(() => ({} as any));

  const emailLc = String(user.email ?? "").toLowerCase();
  const userId = toStringId((user as any).id ?? (user as any)._id ?? (user as any).userId ?? emailLc);
  const actor = userId;

  // Load current status (once)
  const cur = await appsCol.findOne(baseFilter, { projection: { status: 1, formId: 1, members: 1, answers: 1, answersByMember: 1 } });
  if (!cur) {
    const exists = await appsCol.findOne(await toIdFilter(id), { projection: { _id: 1 } });
    return NextResponse.json(
      { ok: false, error: exists ? "forbidden" : "not_found" },
      { status: exists ? 403 : 404 }
    );
  }
  const currentStatus = String(cur.status ?? "draft");
  const editable = isEditable(currentStatus);

  /* ---------- disallow raw status writes (use rules) ---------- */
  if (typeof body?.status === "string") {
    return NextResponse.json({ ok: false, error: "status_write_not_allowed" }, { status: 400 });
  }

  /* ---------- A) debounced answer updates (legacy + new) ---------- */
  if (Array.isArray(body?.updates) && body.updates.length > 0) {
    if (!editable) {
      return NextResponse.json({ ok: false, error: "locked", state: currentStatus }, { status: 409 });
    }

    // Build set paths
    const setPaths: Record<string, any> = { updatedAt: now };
    let count = 0;

    for (const u of body.updates as Array<any>) {
      const qid = String(u?.qid || "");
      if (!qid) continue;
      count++;

      const rawRole = u?.role ? normalizeRole(u.role) : null;

      if (u?.memberId || u?.email) {
        // New: member-scoped write
        const memberKey = toStringId(u.memberId ?? u.email ?? actor);
        const role = rawRole ?? "co_applicant";
        const emailSnap = String(u?.email ?? emailLc).toLowerCase();

        setPaths[`answersByMember.${memberKey}.role`] = role;
        setPaths[`answersByMember.${memberKey}.email`] = emailSnap;
        setPaths[`answersByMember.${memberKey}.answers.${qid}`] = u.value;
      } else if (rawRole) {
        // Legacy: role-scoped
        setPaths[`answers.${rawRole}.${qid}`] = u.value;
      } else {
        // Fallback: assign to caller
        setPaths[`answersByMember.${actor}.role`] = "co_applicant";
        setPaths[`answersByMember.${actor}.email`] = emailLc;
        setPaths[`answersByMember.${actor}.answers.${qid}`] = u.value;
      }
    }

    if (count === 0) return NextResponse.json({ ok: true, noop: true });

    // Atomic latch: only update if status is still draft
    const res = await appsCol.updateOne(
      { ...baseFilter, status: "draft" },
      {
        $set: setPaths,
        $push: { timeline: { at: now, by: actor, event: "answers.update", meta: { count } } } as any,
      }
    );

    if (res.matchedCount === 0) {
      return NextResponse.json({ ok: false, error: "locked", state: currentStatus }, { status: 409 });
    }

    return NextResponse.json({ ok: true, modified: 1 });
  }

  /* ---------- B) member submit ---------- */
  if (body?.action === "member_submit") {
    if (!editable) {
      return NextResponse.json({ ok: false, error: "locked", state: currentStatus }, { status: 409 });
    }

    // Stamp submission (only if still draft)
    const stamp = await appsCol.updateOne(
      { ...baseFilter, status: "draft" },
      {
        $set: {
          [`answersByMember.${actor}.submittedAt`]: now,
          [`answersByMember.${actor}.email`]: emailLc,
          [`answersByMember.${actor}.role`]: (() => {
            const me = Array.isArray(cur.members)
              ? cur.members.find((m: any) => (m.userId && toStringId(m.userId) === actor) || String(m.email || "").toLowerCase() === emailLc)
              : null;
            return normalizeRole(me?.role);
          })(),
          updatedAt: now,
        },
        $push: { timeline: { at: now, by: actor, event: "member.submitted", meta: { userId: actor } } } as any,
      }
    );

    if (stamp.matchedCount === 0) {
      return NextResponse.json({ ok: false, error: "locked", state: currentStatus }, { status: 409 });
    }

    // Reload for completeness check
    const fresh = await appsCol.findOne(baseFilter, {
      projection: { status: 1, formId: 1, members: 1, answers: 1, answersByMember: 1 },
    });

    // Load form
    const form = await loadFormById(db, String(fresh?.formId ?? ""));

    // Required members: prefer app.members; else membership fallback; else caller
    const email = emailLc;
    let required: Array<{ userId: string; role: MemberRole }> = [];
    if (Array.isArray(fresh?.members) && fresh.members.length) {
      required = fresh.members
        .map((m: any) => ({ userId: toStringId(m.userId ?? m.email ?? ""), role: normalizeRole(m.role) }))
        .filter((x) => x.userId);
    }
    if (required.length === 0) {
      const guess = await membershipsCol
        .find({ $or: [{ userId: actor }, { email }] })
        .sort({ joinedAt: -1 })
        .limit(1)
        .next();
      if (guess) required = [{ userId: toStringId(guess.userId ?? actor), role: normalizeRole(guess.role) }];
      else required = [{ userId: actor, role: "co_applicant" }];
    }

    // Check per-member completeness
    const byMember = (fresh?.answersByMember ?? {}) as Record<
      string, { role?: MemberRole; answers?: Record<string, any>; submittedAt?: any; email?: string }
    >;
    const byRoleLegacy = (fresh?.answers ?? {}) as Record<string, Record<string, any>>;

    let allComplete = true;
    for (const rm of required) {
      const snap = byMember[rm.userId];
      const role = normalizeRole(snap?.role ?? rm.role);
      const submitted = !!snap?.submittedAt;
      const answersForMember = snap?.answers ?? byRoleLegacy[role] ?? {};
      const complete = isMemberCompleteForRole(role, form, answersForMember);
      if (!(submitted && complete)) { allComplete = false; break; }
    }

    // Ask rules to flip draft→submitted if everyone complete
    let next = currentStatus as AppStatus;
    if (allComplete) {
      next = computeNextState(currentStatus, "submit", "system", { membersAck: true }) as AppStatus;
    }

    if (next !== currentStatus) {
      await appsCol.updateOne(
        { ...baseFilter, status: "draft" }, // only flip if still draft (race-safe)
        {
          $set: { status: next, submittedAt: now, updatedAt: now },
          $push: {
            timeline: { at: now, by: "system", event: "status.change", meta: { from: currentStatus, to: next, reason: "all_members_complete" } },
          } as any,
        }
      );
      return NextResponse.json({ ok: true, state: next, auto: true });
    }

    return NextResponse.json({ ok: true, state: currentStatus, auto: false });
  }

  /* ---------- nothing to do ---------- */
  return NextResponse.json({ ok: true, noop: true });
}
