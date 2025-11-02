// app/api/forms/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { ObjectId, type Filter } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class HttpError extends Error {
  status: number;
  payload?: any;
  constructor(status: number, code: string, payload?: any) {
    super(code);
    this.status = status;
    this.payload = { ok: false, error: code, ...(payload ?? {}) };
  }
}

/** Build a filter that matches a field as either string or ObjectId */
function idEq(field: string, raw: string): Filter<any> {
  if (ObjectId.isValid(raw)) {
    const oid = new ObjectId(raw);
    return { $or: [{ [field]: oid }, { [field]: raw }] } as any;
  }
  return { [field]: raw } as any;
}

/** Build a filter that matches userId stored as either string or ObjectId */
function userIdFilter(uid: string): Filter<any> {
  if (ObjectId.isValid(uid)) {
    const oid = new ObjectId(uid);
    return { $or: [{ userId: uid }, { userId: oid }] } as any;
  }
  return { userId: uid } as any;
}

/** Load firm from your firms collection, allow both "firms" and "FirmDoc" names */
async function loadFirmById(db: Awaited<ReturnType<typeof getDb>>, firmId: string) {
  // Don't over-constrain with generics here; project to the shape you need
  const projection = { _id: 1, name: 1, slug: 1 } as const;

  const firm =
    (await db.collection("firms").findOne(idEq("_id", firmId), { projection })) ??
    (await db.collection("FirmDoc").findOne(idEq("_id", firmId), { projection }));

  if (!firm) throw new HttpError(400, "invalid_firmId");
  return firm as { _id: string | ObjectId; name: string; slug?: string };
}

/**
 * Resolve the single firm for this user.
 * - If ?firmId= is provided, require active membership in that firm (403 otherwise).
 * - If not provided:
 *      • if exactly one active membership, use it
 *      • if none → 403 "no_firm_membership"
 *      • if multiple → 400 "ambiguous_firm"
 */
async function resolveFirmForUser(req: NextRequest, user: { _id: string }) {
  const db = await getDb();
  const { searchParams } = new URL(req.url);
  const firmIdParam = searchParams.get("firmId") ?? undefined;

  if (firmIdParam) {
    const m = await db.collection("firm_memberships").findOne(
      { active: true, firmId: firmIdParam, ...userIdFilter(user._id) },
      { projection: { firmId: 1 } }
    );
    if (!m) throw new HttpError(403, "not_in_firm");
    const firm = await loadFirmById(db, firmIdParam);
    return { firmId: String(firm._id), firmName: firm.name, firmSlug: firm.slug ?? null };
  }

  // No firmId provided: infer from memberships
  const memberships = await db
    .collection("firm_memberships")
    .find<{ firmId: string }>({ active: true, ...userIdFilter(user._id) }, { projection: { firmId: 1 } })
    .limit(5)
    .toArray();

  if (memberships.length === 0) throw new HttpError(403, "no_firm_membership");
  if (memberships.length > 1) {
    throw new HttpError(400, "ambiguous_firm", { firmIds: memberships.map((m) => m.firmId) });
  }

  const firmId = memberships[0].firmId;
  const firm = await loadFirmById(db, firmId);
  return { firmId: String(firm._id), firmName: firm.name, firmSlug: firm.slug ?? null };
}

/* ─────────────────────────────────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  try {
    const { firmId, firmName, firmSlug } = await resolveFirmForUser(req, user);
    const db = await getDb();
    const col = db.collection("application_forms");

    const docs = await col
      .find(
        { firmId }, // if firmId is sometimes an ObjectId here, use idEq("firmId", firmId)
        { projection: { name: 1, scope: 1, firmId: 1, firmName: 1, firmSlug: 1, updatedAt: 1 } }
      )
      .sort({ updatedAt: -1 })
      .limit(100)
      .toArray();

    return NextResponse.json({
      ok: true,
      firm: { firmId, firmName, firmSlug },
      forms: docs.map((d: any) => ({
        _id: d._id,
        id: String(d._id),
        name: d.name ?? "Untitled",
        scope: d.scope ?? "portfolio",
        firmId: d.firmId,
        firmName: d.firmName ?? null,
        firmSlug: d.firmSlug ?? null,
        updatedAt: d.updatedAt ?? null,
      })),
    });
  } catch (e: any) {
    if (e instanceof HttpError) return NextResponse.json(e.payload, { status: e.status });
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || !body.name || !Array.isArray(body.sections) || !Array.isArray(body.questions)) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  try {
    const { firmId, firmName, firmSlug } = await resolveFirmForUser(req, user);

    const now = new Date();
    const doc = {
      firmId,
      firmName,                 // denormalized for faster lists
      firmSlug,                 // denormalized for URLs

      name: String(body.name),
      description: body.description ?? "",
      scope: body.scope ?? "portfolio",
      sections: body.sections,
      questions: body.questions,
      qualifications: body.qualifications ?? [],
      version: body.version ?? 1,

      createdAt: now,
      updatedAt: now,
      createdBy: (user as any).email, // simple ownership for now
    };

    const db = await getDb();
    const res = await db.collection("application_forms").insertOne(doc as any);

    return NextResponse.json({ ok: true, id: String(res.insertedId) });
  } catch (e: any) {
    if (e instanceof HttpError) return NextResponse.json(e.payload, { status: e.status });
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
