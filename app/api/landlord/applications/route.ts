// app/api/landlord/applications/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { ObjectId, type Filter } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------- Error & firm resolution helpers ---------- */
class HttpError extends Error {
  status: number;
  payload?: any;
  constructor(status: number, code: string, payload?: any) {
    super(code);
    this.status = status;
    this.payload = { ok: false, error: code, ...(payload ?? {}) };
  }
}

/** match userId stored as either string or ObjectId */
function userIdFilter(uid: string): Filter<any> {
  if (ObjectId.isValid(uid)) {
    const oid = new ObjectId(uid);
    return { $or: [{ userId: uid }, { userId: oid }] } as any;
  }
  return { userId: uid } as any;
}

/** match a field as either string or ObjectId */
function idEq(field: string, raw: string): Filter<any> {
  if (ObjectId.isValid(raw)) {
    const oid = new ObjectId(raw);
    return { $or: [{ [field]: oid }, { [field]: raw }] } as any;
  }
  return { [field]: raw } as any;
}

async function loadFirmById(db: Awaited<ReturnType<typeof getDb>>, firmId: string) {
  const projection = { _id: 1, name: 1, slug: 1 } as const;
  const firm =
    (await db.collection("firms").findOne(idEq("_id", firmId), { projection })) ??
    (await db.collection("FirmDoc").findOne(idEq("_id", firmId), { projection }));
  if (!firm) throw new HttpError(400, "invalid_firmId");
  return firm as { _id: string | ObjectId; name: string; slug?: string | null };
}

/**
 * Resolve firm for the current user.
 * - If ?firmId= is provided, require active membership there.
 * - Else, if exactly one active membership, use it.
 * - Else: 403 no_firm_membership / 400 ambiguous_firm.
 */
async function resolveFirmForUser(req: NextRequest, user: { _id: string }) {
  const db = await getDb();
  const { searchParams } = new URL(req.url);
  const firmIdParam = searchParams.get("firmId") ?? undefined;

  if (firmIdParam) {
    const m = await db.collection("firm_memberships").findOne(
      { firmId: firmIdParam, active: true, ...userIdFilter(user._id) },
      { projection: { firmId: 1 } }
    );
    if (!m) throw new HttpError(403, "not_in_firm");
    const firm = await loadFirmById(db, firmIdParam);
    return { firmId: String(firm._id), firmName: firm.name, firmSlug: firm.slug ?? null };
  }

  const memberships = await db
    .collection("firm_memberships")
    .find<{ firmId: string }>({ active: true, ...userIdFilter(user._id) }, { projection: { firmId: 1 } })
    .limit(5)
    .toArray();

  if (memberships.length === 0) throw new HttpError(403, "no_firm_membership");
  if (memberships.length > 1) throw new HttpError(400, "ambiguous_firm", { firmIds: memberships.map((m) => m.firmId) });

  const firmId = memberships[0].firmId;
  const firm = await loadFirmById(db, firmId);
  return { firmId: String(firm._id), firmName: firm.name, firmSlug: firm.slug ?? null };
}

/* ---------- Types your UI expects ---------- */
type MemberRole = "primary" | "co-applicant" | "cosigner";
type AppStatus =
  | "new"
  | "in_review"
  | "needs_approval"
  | "approved_pending_lease"
  | "rejected";
type HouseholdUI = {
  id: string;
  property: string;
  unit: string;
  submittedAt: string; // ISO
  status: AppStatus;
  members: {
    name: string;
    email: string;
    role: MemberRole;
    state?: "invited" | "complete" | "missing_docs";
  }[];
};

/* ---------- Normalization helpers ---------- */
function normalizeRole(v: any): MemberRole {
  const s = String(v ?? "").toLowerCase().replace("_", "-");
  if (s === "primary" || s === "co-applicant" || s === "cosigner") return s as MemberRole;
  if (v === true) return "primary";
  return "co-applicant";
}
function normalizeStatus(v: any): AppStatus {
  const s = String(v ?? "").toLowerCase();
  const map: Record<string, AppStatus> = {
    new: "new",
    pending: "in_review",
    review: "in_review",
    in_review: "in_review",
    needs_approval: "needs_approval",
    approved: "approved_pending_lease",
    approved_pending_lease: "approved_pending_lease",
    reject: "rejected",
    rejected: "rejected",
  };
  return map[s] ?? "in_review";
}
function toISO(x: any): string {
  if (!x) return "";
  if (typeof x === "object" && x.$date) {
    const d = new Date(x.$date);
    return isNaN(d.getTime()) ? "" : d.toISOString();
  }
  if (x instanceof Date) return isNaN(x.getTime()) ? "" : x.toISOString();
  const d = new Date(x);
  return isNaN(d.getTime()) ? "" : d.toISOString();
}
function getId(raw: any): string | null {
  const candidate = raw.id ?? raw.hhId ?? raw.householdId ?? raw.applicationGroupId ?? raw._id ?? null;
  if (!candidate) return null;
  if (typeof candidate === "object" && (candidate as any).$oid) return String((candidate as any).$oid);
  return String(candidate);
}
function coerce(raw: any): HouseholdUI | null {
  if (!raw) return null;

  const id = getId(raw);
  if (!id) return null;

  const property =
    raw.property?.name ??
    raw.propertyName ??
    raw.property_title ??
    raw.property ??
    "—";
  const unit =
    raw.unit?.label ??
    raw.unitLabel ??
    raw.unitNumber ??
    raw.unit_name ??
    raw.unit ??
    "—";

  const submittedAt = toISO(
    raw.submittedAt ?? raw.createdAt ?? raw.updatedAt ?? raw.reviewStartedAt
  );
  const status = normalizeStatus(raw.status ?? raw.workflowStatus ?? raw.state ?? raw.phase);

  const membersRaw: any[] =
    (Array.isArray(raw.members) && raw.members) ||
    (Array.isArray(raw.applicants) && raw.applicants) ||
    (Array.isArray(raw.people) && raw.people) ||
    [];

  const members = membersRaw.map((m) => {
    const name =
      m.name ??
      m.fullName ??
      (m.firstName && m.lastName ? `${m.firstName} ${m.lastName}` : "");
    const email = m.email ?? m.mail ?? "";
    const state =
      m.state ?? (m.complete ? "complete" : m.missingDocuments ? "missing_docs" : undefined);
    const role = normalizeRole(m.role ?? m.type ?? (m.isPrimary ? "primary" : undefined));
    return { name: name || email || "—", email: email || "—", role, state };
  });

  return {
    id,
    property: String(property || "—"),
    unit: String(unit || "—"),
    submittedAt,
    status,
    members,
  };
}

/* ---------- Cursor helpers ---------- */
function b64u(s: string) {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function u64b(s: string) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64").toString("utf8");
}
function encodeCursor(row: HouseholdUI) {
  return b64u(JSON.stringify({ s: row.submittedAt || "", id: row.id }));
}
function decodeCursor(s: string | null) {
  if (!s) return null;
  try {
    return JSON.parse(u64b(s)) as { s: string; id: string };
  } catch {
    return null;
  }
}

/* ---------- Firm-scoped data adapters ---------- */

/** Primary path: Mongo, firm-scoped. Falls back to form->firm if apps lack firmId. */
async function selectViaMongo(desired: number, firmId: string): Promise<HouseholdUI[] | null> {
  const db = await getDb();
  const apps = db.collection("applications");
  const forms = db.collection("application_forms");

  // Collect formIds for this firm (for non-backfilled apps)
  const formIdDocs = await forms
    .find(idEq("firmId", firmId), { projection: { _id: 1 } })
    .limit(2000)
    .toArray();

  // For robustness, include both string and ObjectId candidates
  const formIdCandidates: (string | ObjectId)[] = formIdDocs.flatMap((x: any) => {
    const s = String(x._id);
    return ObjectId.isValid(s) ? [s, new ObjectId(s)] : [s];
    // If x._id was already an ObjectId, String(x._id) will produce the hex, which is fine.
  });

  const or: any[] = [idEq("firmId", firmId)];
  if (formIdCandidates.length) or.push({ formId: { $in: formIdCandidates } });

  const query: Filter<any> = { $or: or } as any;

  const docs: any[] = await apps
    .find(query)
    .sort({ submittedAt: -1, createdAt: -1, updatedAt: -1, _id: -1 })
    .limit(desired)
    .toArray();

  if (!docs?.length) return null;
  return docs.map(coerce).filter(Boolean) as HouseholdUI[];
}

/** Optional fallback: Prisma; we try common firm keys, safely, catch on schema mismatch. */
async function selectViaPrisma(desired: number, firmId: string): Promise<HouseholdUI[] | null> {
  try {
    const mod = await import("@prisma/client").catch(() => null);
    if (!mod?.PrismaClient) return null;
    const prisma = new mod.PrismaClient();

    const candidates = ["householdApplication", "applicationGroup", "application", "tenantApplication"];
    const orderings = [
      [{ submittedAt: "desc" }, { createdAt: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
      [{ createdAt: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
      [{ updatedAt: "desc" }, { id: "desc" }],
    ];
    const firmFieldCandidates = ["firmId", "orgId", "landlordId"];

    for (const name of candidates) {
      // @ts-ignore dynamic model access
      const model = (prisma as any)[name];
      if (!model?.findMany) continue;

      for (const key of firmFieldCandidates) {
        for (const orderBy of orderings) {
          try {
            const rows: any[] = await model.findMany({
              take: desired,
              where: { [key]: firmId } as any,
              orderBy: orderBy as any,
              include: { members: true, applicants: true, people: true, property: true, unit: true } as any,
            });
            if (rows?.length) {
              await prisma.$disconnect().catch(() => {});
              return rows.map(coerce).filter(Boolean) as HouseholdUI[];
            }
          } catch {
            // try next key / ordering
          }
        }
      }
    }

    await prisma.$disconnect().catch(() => {});
  } catch {}
  return null;
}

/** Optional fallback: in-process collections; filter by firm if the field exists. */
async function selectViaCollections(desired: number, firmId: string): Promise<HouseholdUI[] | null> {
  const paths = ["@/app/api/collections", "@/lib/collections", "@/collections"];
  for (const p of paths) {
    try {
      const mod: any = await import(p);
      const candidates = ["applications", "applicationGroups", "householdApplications", "tenantApplications"];
      for (const name of candidates) {
        const col = mod?.[name] ?? mod?.default?.[name];
        if (!col) continue;

        // Mongo-style helpers
        if (col.find) {
          const cursor = col
            .find({ $or: [idEq("firmId", firmId), { "form.firmId": firmId }, { firm: firmId }] })
            .sort?.({ submittedAt: -1, createdAt: -1, updatedAt: -1, _id: -1 })
            .limit?.(desired);
          const docs =
            cursor?.toArray ? await cursor.toArray() :
            (await col.find({}).limit?.(desired)) ?? [];
          const filtered = Array.isArray(docs)
            ? docs.filter((d: any) => d?.firmId === firmId || d?.firm === firmId || d?.form?.firmId === firmId)
            : [];
          if (filtered.length) return filtered.map(coerce).filter(Boolean) as HouseholdUI[];
        }

        // Array export
        if (Array.isArray(col) && col.length) {
          const filtered = (col as any[]).filter(
            (d) => d?.firmId === firmId || d?.firm === firmId || d?.form?.firmId === firmId
          );
          if (filtered.length) return filtered.slice(0, desired).map(coerce).filter(Boolean) as HouseholdUI[];
        }
      }
    } catch {
      // next path
    }
  }
  return null;
}

/* ---------- GET (firm-scoped) ---------- */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  // Basic paging & filters, unchanged
  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit") || 50);
  const limit = Math.max(1, Math.min(200, Math.floor(limitParam)));
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const statusParam = url.searchParams.get("status"); // optional
  const q = (url.searchParams.get("q") || "").toLowerCase();

  // Pull extra so in-memory filters still fill a page
  const desired = limit * 3;

  try {
    const { firmId, firmName, firmSlug } = await resolveFirmForUser(req, user);

    // Prefer Mongo firm-scoped, then graceful fallbacks
    let rows: HouseholdUI[] =
      (await selectViaMongo(desired, firmId)) ??
      (await selectViaPrisma(desired, firmId)) ??
      (await selectViaCollections(desired, firmId)) ??
      [];

    // Sort newest first, then property, unit, id (unchanged)
    rows.sort(
      (a, b) =>
        (b.submittedAt || "").localeCompare(a.submittedAt || "") ||
        a.property.localeCompare(b.property) ||
        a.unit.localeCompare(b.unit) ||
        b.id.localeCompare(a.id)
    );

    // Cursor
    if (cursor) {
      rows = rows.filter(
        (r) =>
          (r.submittedAt || "") < (cursor.s || "") ||
          ((r.submittedAt || "") === (cursor.s || "") && r.id < cursor.id)
      );
    }

    // Filters
    if (statusParam) rows = rows.filter((r) => r.status === String(statusParam));
    if (q) {
      rows = rows.filter((h) =>
        [h.property, h.unit, h.status, ...h.members.map((m) => m.name), ...h.members.map((m) => m.email)]
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }

    const page = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? encodeCursor(page[page.length - 1]) : null;

    return NextResponse.json(
      { ok: true, firm: { firmId, firmName, firmSlug }, households: page, nextCursor },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e: any) {
    if (e instanceof HttpError) return NextResponse.json(e.payload, { status: e.status });
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
