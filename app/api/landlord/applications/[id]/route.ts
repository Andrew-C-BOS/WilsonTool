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

  // Also include a string version when an ObjectId comes in
  if (raw instanceof ObjectId) candidates.push(String(raw));

  // De-dupe
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

/* ---------- GET /api/landlord/applications/[id] ---------- */
// ✅ Next 15: params is a Promise; use RouteContext and await.
export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/landlord/applications/[id]">
) {
  const { id } = await ctx.params;

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  try {
    const firm = await resolveFirmForUser(req, user);
    const db = await getDb();

    const app = await db.collection("applications").findOne({
      $or: [
        ...((anyIdQuery(id, ["_id"]) as any).$or ?? []),
        ...((anyIdQuery(id, ["id"]) as any).$or ?? []),
      ],
    });
    if (!app) throw new HttpError(404, "not_found");

    const formIdRaw = app.formId ?? app.form_id ?? app.form?._id ?? app.form?.id;
    const form = await db.collection("application_forms").findOne(
      {
        $or: [
          ...((anyIdQuery(formIdRaw, ["_id"]) as any).$or ?? []),
          ...((anyIdQuery(formIdRaw, ["id"]) as any).$or ?? []),
        ],
      },
      { projection: { _id: 1, firmId: 1, name: 1, sections: 1, questions: 1, qualifications: 1 } }
    );
    if (!form) throw new HttpError(400, "form_not_found");

    const owningFirmId = form.firmId || app.firmId;
    if (owningFirmId && String(owningFirmId) !== String(firm.firmId)) {
      throw new HttpError(403, "not_in_firm");
    }

    const application = {
      id: String(app._id ?? app.id),
      status: String(app.status ?? "in_review"),
      createdAt: toISO(app.createdAt),
      updatedAt: toISO(app.updatedAt),
      submittedAt: toISO(app.submittedAt),
      members: Array.isArray(app.members)
        ? app.members.map((m: any) => ({
            userId: m.userId ?? undefined,
            email: String(m.email || ""),
            role: String(m.role || "co_applicant"),
            state: m.state ?? undefined,
            joinedAt: toISO(m.joinedAt),
            name: m.name ?? undefined,
          }))
        : [],
      answers: app.answers ?? {},
      timeline: Array.isArray(app.timeline)
        ? app.timeline.map((t: any) => ({
            at: toISO(t.at),
            by: t.by ? String(t.by) : undefined,
            event: String(t.event || "event"),
            meta: t.meta ?? undefined,
          }))
        : [],
    };

    const formLite = {
      id: String(form._id ?? form.id),
      name: String(form.name || "Untitled"),
      sections: Array.isArray(form.sections) ? form.sections : [],
      questions: Array.isArray(form.questions) ? form.questions : [],
      qualifications: Array.isArray(form.qualifications) ? form.qualifications : [],
    };

    return NextResponse.json({ ok: true, firm, application, form: formLite });
  } catch (e: any) {
    if (e instanceof HttpError) {
      return NextResponse.json(e.payload, { status: e.status });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
