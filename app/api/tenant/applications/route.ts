// app/api/tenant/applications/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------- Types ---------- */
type AppStatus =
  | "draft"
  | "new"
  | "in_review"
  | "needs_approval"
  | "approved_pending_lease"
  | "rejected";
type MemberRole = "primary" | "co_applicant" | "cosigner";

function toStringId(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  try { return (v as any).toHexString ? (v as any).toHexString() : String(v); } catch { return String(v); }
}

/* ---------- Household resolver & membership loader ---------- */
async function pickMembershipsCol(db: any) {
  const candidates = [
    "households_membership",   // your sample
    "household_memberhsips",   // earlier typo
    "households_memberhsips",
    "household_memberships",
    "households_memberships",
  ];
  const existing = new Set((await db.listCollections().toArray()).map((c: any) => c.name));
  for (const name of candidates) if (existing.has(name)) return db.collection(name);
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

type DerivedMember = { id: string; name: string | null; email: string; role: MemberRole; state: "active" | "invited" | "left" };
function inferState(m: any): "active" | "invited" | "left" {
  if (m?.active === true) return "active";
  if (m?.active === false && !m?.name) return "invited";
  return "left";
}

async function loadHouseholdMembers(db: any, householdId: string): Promise<DerivedMember[]> {
  const col = await pickMembershipsCol(db);
  // include both string and ObjectId variants
  const { ObjectId } = await import("mongodb");
  const maybeOid = ObjectId.isValid(householdId) ? new ObjectId(householdId) : null;

  const rows = await col
    .find({
      $or: [{ householdId }, ...(maybeOid ? [{ householdId: maybeOid as any }] : [])],
      // include active & invited; if you store explicit states, adjust this
      active: { $in: [true, false] },
    })
    .toArray();

  return rows.map((m: any) => ({
    id: toStringId(m.userId),
    name: m.name ?? null,
    email: m.email ?? "",
    role: (m.role ?? "co_applicant") as MemberRole,
    state: inferState(m),
  }));
}

/* ============================================================
   GET /api/tenant/applications?me=1&formId=<optional>
   Household-first; members are derived from household membership.
============================================================ */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const url = new URL(req.url);
  if (!url.searchParams.get("me")) {
    return NextResponse.json({ ok: false, error: "unsupported_query" }, { status: 400 });
  }
  const formIdFilter = url.searchParams.get("formId")?.trim() || undefined;

  const db = await getDb();
  const appsCol = db.collection("applications");
  const formsCol = db.collection("application_forms");

  const myHouseholdId = await resolveMyHouseholdId(db, user);

  // Primary: apps tied to my householdId
  const primaryFilter: any = myHouseholdId ? { householdId: myHouseholdId } : { _id: null };
  if (formIdFilter) primaryFilter.formId = formIdFilter;

  let rows: any[] = await appsCol
    .find(primaryFilter, {
      projection: {
        formId: 1,
        status: 1,
        property: 1,
        unit: 1,
        updatedAt: 1,
        submittedAt: 1,
        tasks: 1,
        householdId: 1,
        members: 1, // legacy presence tolerated; we won't rely on it
      },
    })
    .sort({ updatedAt: -1 })
    .limit(100)
    .toArray();

  // Fallback for legacy docs: if none household-scoped (or user has no household), attempt legacy member-based
  if (!rows.length) {
    const emailLc = String(user.email ?? "").toLowerCase();
    const userId = toStringId((user as any).id ?? (user as any)._id ?? (user as any).userId ?? emailLc);

    const legacyFilter: any = {
      $or: [
        { "members.userId": userId },
        { "members.email": emailLc },
        { "members.email": (user as any).email },
      ],
    };
    if (formIdFilter) legacyFilter.formId = formIdFilter;

    rows = await appsCol
      .find(legacyFilter, {
        projection: {
          formId: 1,
          status: 1,
          property: 1,
          unit: 1,
          updatedAt: 1,
          submittedAt: 1,
          tasks: 1,
          householdId: 1,
          members: 1,
        },
      })
      .sort({ updatedAt: -1 })
      .limit(100)
      .toArray();
  }

  // Resolve form names
  const formIds = Array.from(new Set(rows.map((r) => String(r.formId))));
  const { ObjectId } = await import("mongodb");
  const forms = formIds.length
    ? await formsCol
        .find(
          {
            $or: formIds.map((fid) =>
              /^[0-9a-fA-F]{24}$/.test(fid) ? { _id: new ObjectId(fid) } : { _id: fid as any }
            ),
          },
          { projection: { name: 1 } }
        )
        .toArray()
    : [];
  const nameById = new Map<string, string>(forms.map((f: any) => [String(f._id), f.name ?? "Application"]));

  // Derive members from household membership for each row
  const apps = await Promise.all(
    rows.map(async (h) => {
      const householdId = String(h.householdId ?? myHouseholdId ?? "");
      const members: DerivedMember[] = householdId ? await loadHouseholdMembers(db, householdId) : [];

      // If householdId missing on a legacy app but we have myHouseholdId, prefer that load.
      // If still empty and legacy `members` exists, synthesize from legacy for display only.
      const displayMembers: DerivedMember[] =
        members.length > 0
          ? members
          : (h.members ?? []).map((m: any) => ({
              id: toStringId(m.userId),
              name: m.name ?? null,
              email: m.email ?? "",
              role: (m.role ?? "co_applicant") as MemberRole,
              state: (m.state as any) ?? "active",
            }));

      // Infer "my" role from derived members
      const emailLc = String(user.email ?? "").toLowerCase();
      const userId = toStringId((user as any).id ?? (user as any)._id ?? (user as any).userId ?? emailLc);
      const me = displayMembers.find((m) => m.id === userId || m.email.toLowerCase() === emailLc);
      const role: MemberRole = (me?.role as MemberRole) ?? "primary";
      const status: AppStatus = (h.status as AppStatus) ?? "draft";

      return {
        id: String(h._id),
        formId: String(h.formId),
        formName: nameById.get(String(h.formId)) ?? "Application",
        property: h.property ?? undefined,
        unit: h.unit ?? undefined,
        role,
        status,
        updatedAt: h.updatedAt ? new Date(h.updatedAt).toISOString().slice(0, 10) : "",
        submittedAt: h.submittedAt ? new Date(h.submittedAt).toISOString().slice(0, 10) : undefined,
        members: displayMembers.map((m) => ({
          name: m.name ?? m.email ?? "",
          email: m.email ?? "",
          role: m.role,
          state: m.state,
        })),
        tasks: {
          myIncomplete: h.tasks?.myIncomplete ?? 0,
          householdIncomplete: h.tasks?.householdIncomplete ?? 0,
          missingDocs: h.tasks?.missingDocs ?? 0,
        },
        householdId: householdId || undefined,
      };
    })
  );

  return NextResponse.json({ ok: true, apps });
}

/* ============================================================
   POST /api/tenant/applications
   Body: { formId: string }
   Reuse or create a draft tied to *my householdId*, no members written.
============================================================ */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const formId = String(body?.formId ?? "").trim();
  if (!formId) return NextResponse.json({ ok: false, error: "missing_formId" }, { status: 400 });

  const db = await getDb();
  const appsCol = db.collection("applications");
  const now = new Date();

  const myHouseholdId = await resolveMyHouseholdId(db, user);
  if (!myHouseholdId) {
    return NextResponse.json({ ok: false, error: "no_household" }, { status: 400 });
  }

  // Reuse by (formId, householdId)
  const existing = await appsCol.findOne({
    formId,
    householdId: myHouseholdId,
    status: { $in: ["draft", "new"] },
  });

  if (existing) {
    return NextResponse.json({
      ok: true,
      appId: String(existing._id),
      redirect: `/tenant/apply?form=${encodeURIComponent(formId)}&app=${encodeURIComponent(String(existing._id))}`,
      reused: true,
    });
  }

  // Create without members; household is the source of truth
  const doc = {
    formId,
    householdId: myHouseholdId,
    status: "draft" as AppStatus,
    createdAt: now,
    updatedAt: now,
  };

  const ins = await appsCol.insertOne(doc as any);
  return NextResponse.json({
    ok: true,
    appId: String(ins.insertedId),
    redirect: `/tenant/apply?form=${encodeURIComponent(formId)}&app=${encodeURIComponent(String(ins.insertedId))}`,
    reused: false,
  });
}
