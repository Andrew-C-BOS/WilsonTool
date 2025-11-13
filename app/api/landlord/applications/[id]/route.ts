// app/api/landlord/applications/[id]/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { ObjectId, type Filter } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------- Small error helper ---------- */
class HttpError extends Error {
  status: number;
  payload: any;
  constructor(status: number, code: string, extra?: any) {
    super(code);
    this.status = status;
    this.payload = { ok: false, error: code, ...(extra ?? {}) };
  }
}

/* ---------- Tiny helpers ---------- */
const toISO = (x: any) => {
  if (!x) return null;
  if (typeof x === "object" && x.$date) return new Date(x.$date).toISOString();
  const d = new Date(x);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

const ensureObjectId = (v: any) => {
  try {
    if (v instanceof ObjectId) return v;
    if (typeof v === "object" && v?.$oid) return new ObjectId(v.$oid);
    if (typeof v === "string" && ObjectId.isValid(v)) return new ObjectId(v);
  } catch {}
  return null;
};

/** Build a tolerant $or query that matches both string and ObjectId forms. */
function anyIdQuery(raw: any, fields: string[] = ["_id"]) {
  const candidates: any[] = [];
  if (raw != null) candidates.push(raw);

  const asOid = ensureObjectId(raw);
  if (asOid) candidates.push(asOid);

  if (raw instanceof ObjectId) candidates.push(String(raw));

  const uniq = Array.from(new Set(candidates.map((c) => String(c))))
    .map((s) => (ObjectId.isValid(s) ? [s, new ObjectId(s)] : [s]))
    .flat();

  const or: any[] = [];
  for (const f of fields) {
    if (uniq.length > 1) or.push({ [f]: { $in: uniq } });
    else or.push({ [f]: uniq[0] });
  }
  return or.length ? { $or: or } : {};
}

/** Build a strict _id filter that satisfies TS and matches string or ObjectId */
const idFilter = (raw: unknown): Filter<any> =>
  ObjectId.isValid(String(raw))
    ? { _id: new ObjectId(String(raw)) }
    : { _id: String(raw) };

/* ---------- RouteContext type ---------- */
type RouteContext<P extends string> = { params: Promise<Record<"id", string>> };

/* ---------- Firm resolution ---------- */
async function resolveFirmForUser(req: NextRequest, user: { _id: any }) {
  const db = await getDb();
  const firmIdParam = req.nextUrl.searchParams.get("firmId") ?? undefined;

  const userIdCandidates = (() => {
    const out: any[] = [];
    if (user?._id != null) out.push(user._id);
    const asOid = ensureObjectId(user?._id);
    if (asOid) out.push(asOid);
    if (user?._id instanceof ObjectId) out.push(String(user._id));
    return Array.from(new Set(out.map(String))).map((s) =>
      ObjectId.isValid(s) ? new ObjectId(s) : s
    );
  })();

  if (firmIdParam) {
    const m = await db
      .collection("firm_memberships")
      .findOne(
        { firmId: firmIdParam, userId: { $in: userIdCandidates }, active: true },
        { projection: { firmId: 1 } }
      );
    if (!m) throw new HttpError(403, "not_in_firm");

    const firm = await db
      .collection("FirmDoc")
      .findOne(idFilter(firmIdParam), { projection: { _id: 1, name: 1, slug: 1 } });
    if (!firm) throw new HttpError(400, "invalid_firmId");
    return { firmId: firm._id, firmName: firm.name, firmSlug: firm.slug };
  }

  const memberships = await db
    .collection("firm_memberships")
    .find({ userId: { $in: userIdCandidates }, active: true }, { projection: { firmId: 1 } })
    .limit(5)
    .toArray();

  if (memberships.length === 0) throw new HttpError(403, "no_firm_membership");
  if (memberships.length > 1) {
    throw new HttpError(400, "ambiguous_firm", {
      firmIds: memberships.map((m) => m.firmId),
    });
  }

  const firmId = memberships[0].firmId;
  const firm = await db
    .collection("FirmDoc")
    .findOne(idFilter(firmId), { projection: { _id: 1, name: 1, slug: 1 } });
  if (!firm) throw new HttpError(400, "invalid_membership");
  return { firmId: firm._id, firmName: firm.name, firmSlug: firm.slug };
}

/* ---------- Membership map helpers (re-key to userId) ---------- */
function toStringId(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  try {
    return v?.toHexString ? v.toHexString() : String(v);
  } catch {
    return String(v);
  }
}

async function pickHouseholdMembershipsCol(db: any) {
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

/** Build membershipId -> userId map for a given householdId */
async function buildMembershipIdToUserIdMap(db: any, householdId: string | null) {
  const map = new Map<string, string>();
  if (!householdId) return map;
  const col = await pickHouseholdMembershipsCol(db);
  const rows = await col.find({ householdId }).project({ _id: 1, userId: 1 }).toArray();
  for (const r of rows) {
    const mid = toStringId(r._id);
    const uid = toStringId(r.userId);
    if (mid && uid) map.set(mid, uid);
  }
  return map;
}

/** Re-key an answersByMember object from possibly membershipId keys -> userId keys,
 *  and also remap questionId -> question.label where possible.
 */
function rekeyAnswersByMemberToUserId(
  answersByMember: Record<string, any> | undefined,
  m2u: Map<string, string>,
  questionLabelById: Record<string, string>
): Record<string, { role: string; email: string; answers: Record<string, any> }> {
  const out: Record<string, { role: string; email: string; answers: Record<string, any> }> = {};
  if (!answersByMember || typeof answersByMember !== "object") return out;

  for (const [key, val] of Object.entries(answersByMember)) {
    const userKey = m2u.get(key) ?? key;
    const role = String((val as any)?.role ?? "co_applicant");
    const email = String((val as any)?.email ?? "").toLowerCase();

    const rawAnswers =
      (val as any)?.answers && typeof (val as any).answers === "object"
        ? (val as any).answers
        : {};

    const mappedAnswers: Record<string, any> = {};
    for (const [qid, answer] of Object.entries(rawAnswers)) {
      const label = questionLabelById[qid] || qid;
      mappedAnswers[label] = answer;
    }

    if (!out[userKey]) {
      out[userKey] = { role, email, answers: { ...mappedAnswers } };
    } else {
      out[userKey] = {
        role,
        email: out[userKey].email || email,
        answers: { ...out[userKey].answers, ...mappedAnswers },
      };
    }
  }

  return out;
}

/** Derive answersByRole from answersByMember + known member roles.
 *  At this point bucket.answers are already label-keyed, so we just merge.
 */
function deriveAnswersByRole(
  answersByMemberUserId: Record<
    string,
    { role: string; email: string; answers: Record<string, any> }
  >,
  members: Array<{ userId?: string; role?: string }>
): Record<string, Record<string, any>> {
  const roleOfUser: Record<string, string> = {};
  for (const m of members) {
    if (m?.userId) roleOfUser[String(m.userId)] = String(m.role ?? "co_applicant");
  }
  const byRole: Record<string, Record<string, any>> = {};

  for (const [uid, bucket] of Object.entries(answersByMemberUserId)) {
    const role = String(roleOfUser[uid] ?? bucket.role ?? "co_applicant").toLowerCase();
    const labelAnswers = bucket.answers || {};
    byRole[role] = { ...(byRole[role] || {}), ...labelAnswers };
  }

  return byRole;
}

/* ---------- Section + question meta, for grouping ---------- */
type QuestionMeta = {
  label: string;
  sectionId?: string;
  sectionTitle?: string;
};

/** Build member -> sections -> questionLabel -> answer */
function deriveAnswersByMemberAndSection(
  rawAnswersByMember: Record<string, any> | undefined,
  m2u: Map<string, string>,
  questionMetaById: Record<string, QuestionMeta>
): Record<
  string,
  {
    role: string;
    email: string;
    sections: Record<string, Record<string, any>>;
  }
> {
  const out: Record<
    string,
    { role: string; email: string; sections: Record<string, Record<string, any>> }
  > = {};

  if (!rawAnswersByMember || typeof rawAnswersByMember !== "object") return out;

  for (const [membershipKey, bucketAny] of Object.entries(rawAnswersByMember)) {
    const bucket = bucketAny as any;
    const userKey = m2u.get(membershipKey) ?? membershipKey;
    const role = String(bucket?.role ?? "co_applicant");
    const email = String(bucket?.email ?? "").toLowerCase();

    if (!out[userKey]) {
      out[userKey] = { role, email, sections: {} };
    } else {
      // keep existing role/email if already present, fill email if missing
      if (!out[userKey].email && email) out[userKey].email = email;
    }

    const rawAnswers =
      bucket?.answers && typeof bucket.answers === "object" ? bucket.answers : {};

    for (const [qid, value] of Object.entries(rawAnswers)) {
      const meta = questionMetaById[qid] || {};
      const label = meta.label || qid;
      const sectionTitle = meta.sectionTitle || "Other";

      if (!out[userKey].sections[sectionTitle]) {
        out[userKey].sections[sectionTitle] = {};
      }

      out[userKey].sections[sectionTitle][label] = value;
    }
  }

  return out;
}

/* ---------- Normalizers for countersign & plan ---------- */
function normalizeCountersign(raw: any) {
  if (!raw) return null;
  return {
    allowed: Boolean(raw.allowed),
    upfrontMinCents: Number(raw.upfrontMinCents ?? 0),
    depositMinCents: Number(raw.depositMinCents ?? 0),
  };
}

function normalizePaymentPlan(app: any) {
  const plan = app?.paymentPlan ?? null;
  if (!plan && !app?.protoLease) return null;

  const monthlyRentCents = Number(
    plan?.monthlyRentCents ?? app?.protoLease?.monthlyRent ?? 0
  );
  const termMonths = Number(
    plan?.termMonths ?? app?.protoLease?.termMonths ?? 0
  );
  const startDate = String(
    plan?.startDate ?? app?.protoLease?.moveInDate ?? ""
  );

  return {
    monthlyRentCents,
    termMonths,
    startDate, // YYYY-MM-DD expected
    securityCents: Number(plan?.securityCents ?? 0),
    keyFeeCents: Number(plan?.keyFeeCents ?? 0),
    requireFirstBeforeMoveIn: Boolean(plan?.requireFirstBeforeMoveIn),
    requireLastBeforeMoveIn: Boolean(plan?.requireLastBeforeMoveIn),
    countersignUpfrontThresholdCents: Number(
      plan?.countersignUpfrontThresholdCents ?? 0
    ),
    countersignDepositThresholdCents: Number(
      plan?.countersignDepositThresholdCents ?? 0
    ),
    upfrontTotals: {
      firstCents: Number(plan?.upfrontTotals?.firstCents ?? 0),
      lastCents: Number(plan?.upfrontTotals?.lastCents ?? 0),
      keyCents: Number(plan?.upfrontTotals?.keyCents ?? 0),
      securityCents: Number(plan?.upfrontTotals?.securityCents ?? 0),
      otherUpfrontCents: Number(plan?.upfrontTotals?.otherUpfrontCents ?? 0),
      totalUpfrontCents: Number(plan?.upfrontTotals?.totalUpfrontCents ?? 0),
    },
    priority: Array.isArray(plan?.priority) ? plan!.priority : [],
  };
}

/* ---------- GET /api/landlord/applications/[id] ---------- */
export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/landlord/applications/[id]">
) {
  const { id } = await ctx.params;

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 }
    );
  }

  try {
    const firm = await resolveFirmForUser(req, user);
    const db = await getDb();

    // Load application
    const app = await db.collection("applications").findOne({
      $or: [
        ...((anyIdQuery(id, ["_id"]) as any).$or ?? []),
        ...((anyIdQuery(id, ["id"]) as any).$or ?? []),
      ],
    });
    if (!app) throw new HttpError(404, "not_found");

    // Load form
    const formIdRaw = app.formId ?? app.form_id ?? app.form?._id ?? app.form?.id;
    const form = await db.collection("application_forms").findOne(
      {
        $or: [
          ...((anyIdQuery(formIdRaw, ["_id"]) as any).$or ?? []),
          ...((anyIdQuery(formIdRaw, ["id"]) as any).$or ?? []),
        ],
      },
      {
        projection: {
          _id: 1,
          firmId: 1,
          name: 1,
          sections: 1,
          questions: 1,
          qualifications: 1,
        },
      }
    );
    if (!form) throw new HttpError(400, "form_not_found");

    // Firm authorization (form-owned or application-owned)
    const owningFirmId = form.firmId || app.firmId;
    if (owningFirmId && String(owningFirmId) !== String(firm.firmId)) {
      throw new HttpError(403, "not_in_firm");
    }

    // Build section + question maps
    const sectionsArray: any[] = Array.isArray(form.sections) ? form.sections : [];
    const questionsArray: any[] = Array.isArray(form.questions) ? form.questions : [];

    const sectionTitleById: Record<string, string> = {};
    for (const s of sectionsArray) {
      if (s && s.id && s.title) {
        sectionTitleById[String(s.id)] = String(s.title);
      }
    }

    const questionLabelById: Record<string, string> = {};
    const questionMetaById: Record<string, QuestionMeta> = {};
    for (const q of questionsArray) {
      if (!q || !q.id) continue;
      const idStr = String(q.id);
      const label = String(q.label ?? idStr);
      const sectionId = q.sectionId ? String(q.sectionId) : undefined;
      const sectionTitle = sectionId ? sectionTitleById[sectionId] : undefined;

      questionLabelById[idStr] = label;
      questionMetaById[idStr] = {
        label,
        sectionId,
        sectionTitle,
      };
    }

    // Membership map for canonical userId keys
    const householdId = app.householdId ? String(app.householdId) : null;
    const m2u = await buildMembershipIdToUserIdMap(db, householdId);

    // Normalize members
    const members = Array.isArray(app.members)
      ? app.members.map((m: any) => ({
          userId: m.userId ? String(m.userId) : undefined,
          email: String(m.email || "").toLowerCase(),
          role: String(m.role || "co_applicant"),
          state: m.state ?? undefined,
          joinedAt: toISO(m.joinedAt),
          name: m.name ?? undefined,
        }))
      : [];

    // Answers (label-keyed by member)
    const answersByMemberUserId = rekeyAnswersByMemberToUserId(
      app.answersByMember,
      m2u,
      questionLabelById
    );

    // Flattened answers by role -> { questionLabel: answer }
    const answersByRole = deriveAnswersByRole(
      answersByMemberUserId,
      members
    );

    // Member + section grouping
    const answersByMemberSections = deriveAnswersByMemberAndSection(
      app.answersByMember,
      m2u,
      questionMetaById
    );

    // Normalize countersign & plan (always present in response as object or null)
    const countersign = normalizeCountersign(app.countersign);
    const paymentPlan = normalizePaymentPlan(app);

    const application = {
      id: String(app._id ?? app.id),
      status: String(app.status ?? "in_review"),
      createdAt: toISO(app.createdAt),
      updatedAt: toISO(app.updatedAt),
      submittedAt: toISO(app.submittedAt),
      members,
      // per-member, label-keyed
      answersByMember: answersByMemberUserId,
      // per-role, flat (label -> answer) – if you still want it
      answers: answersByRole,
      // per-member, per-section, label -> answer
      answersByMemberSections,
      timeline: Array.isArray(app.timeline)
        ? app.timeline.map((t: any) => ({
            at: toISO(t.at),
            by: t.by ? String(t.by) : undefined,
            event: String(t.event || "event"),
            meta: t.meta ?? undefined,
          }))
        : [],
      building: app.building ?? null,
      unit: app.unit ?? null,
      protoLease: app.protoLease ?? null,

      countersign,
      paymentPlan,
    };

    const formLite = {
      id: String(form._id ?? form.id),
      name: String(form.name || "Untitled"),
      sections: sectionsArray,
      questions: questionsArray,
      qualifications: Array.isArray(form.qualifications)
        ? form.qualifications
        : [],
    };

    return NextResponse.json({ ok: true, firm, application, form: formLite });
  } catch (e: any) {
    if (e instanceof HttpError) {
      return NextResponse.json(e.payload, { status: e.status });
    }
    return NextResponse.json(
      { ok: false, error: "server_error" },
      { status: 500 }
    );
  }
}
