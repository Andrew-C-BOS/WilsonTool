// app/api/tenant/applications/resolve/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MemberRole = "primary" | "co_applicant" | "cosigner";

function toStringId(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  try { return v?.toHexString ? v.toHexString() : String(v); } catch { return String(v); }
}

async function pickFormsCol(db: any) {
  const names = ["application_forms", "forms"];
  const existing = new Set((await db.listCollections().toArray()).map((c: any) => c.name));
  for (const n of names) if (existing.has(n)) return db.collection(n);
  return db.collection("application_forms");
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

function normalizeRole(r: any): MemberRole {
  const x = String(r || "").toLowerCase();
  return x === "primary" || x === "cosigner" ? (x as MemberRole) : "co_applicant";
}

async function loadForm(db: any, idOrSlug: string) {
  const col = await pickFormsCol(db);
  const { ObjectId } = await import("mongodb");

  const tries: any[] = [];
  if (/^[0-9a-fA-F]{24}$/.test(idOrSlug)) tries.push({ _id: new ObjectId(idOrSlug) });
  tries.push({ _id: idOrSlug });
  tries.push({ id: idOrSlug });
  tries.push({ slug: idOrSlug }); // if you ever add slugs

  for (const filter of tries) {
    const doc = await col.findOne(filter);
    if (doc) {
      return {
        raw: doc,
        form: {
          _id: toStringId(doc._id ?? doc.id),
          id: toStringId(doc.id ?? doc._id),
          firmId: doc.firmId ?? null,
          firmName: doc.firmName ?? null,
          firmSlug: doc.firmSlug ?? null,
          name: String(doc.name ?? "Application"),
          description: doc.description ?? "",
          scope: (doc.scope ?? "portfolio") as "portfolio",
          sections: Array.isArray(doc.sections) ? doc.sections : [],
          questions: Array.isArray(doc.questions) ? doc.questions : [],
          qualifications: Array.isArray(doc.qualifications) ? doc.qualifications : [],
          version: Number(doc.version ?? 1),
        },
      };
    }
  }
  return { raw: null, form: null };
}

export async function GET(req: NextRequest) {
  // Query: ?form=<formIdOrSlug>&create=1 (optional)
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const url = new URL(req.url);
  const DEBUG = url.searchParams.get("debug") === "1";
  const dbg = (x: any) => (DEBUG ? x : undefined);

  const formParam = url.searchParams.get("form") || "";
  const allowCreate = url.searchParams.get("create") === "1";

  if (!formParam) {
    return NextResponse.json({ ok: false, error: "missing_form" }, { status: 400 });
  }

  const db = await getDb();
  const apps = db.collection("applications");
  const memberships = await pickMembershipsCol(db);

  // 1) Load the form robustly
  const { form, raw } = await loadForm(db, formParam);
  if (!form) {
    return NextResponse.json({ ok: false, error: "form_not_found", debug: dbg({ formParam }) }, { status: 404 });
  }

  // 2) Resolve caller identity + household
  const emailLc = String(user.email ?? "").toLowerCase();
  const userId = toStringId((user as any).id ?? (user as any)._id ?? (user as any).userId ?? emailLc);

  // Most-recent active membership → household
  const myMembership = await memberships
    .find({ $or: [{ userId }, { email: emailLc }, { email: (user as any).email }], active: true })
    .sort({ joinedAt: -1 })
    .limit(1)
    .next();

  const householdId = myMembership?.householdId ? toStringId(myMembership.householdId) : null;

  if (!householdId) {
    return NextResponse.json({ ok: false, error: "no_household", debug: dbg({ userId, emailLc }) }, { status: 400 });
  }

  // 3) Each household can only have ONE app per form → find it
  const existing = await apps.findOne(
    { householdId, formId: form._id ?? form.id },
    {
      projection: {
        _id: 1, formId: 1, status: 1, answers: 1, answersByMember: 1,
        property: 1, unit: 1, updatedAt: 1, submittedAt: 1, members: 1,
      },
    }
  );

  if (existing) {
    return NextResponse.json({
      ok: true,
      form,
      app: {
        id: toStringId(existing._id),
        formId: String(existing.formId ?? ""),
        status: String(existing.status ?? "draft"),
        property: existing.property ?? null,
        unit: existing.unit ?? null,
        updatedAt: existing.updatedAt ?? null,
        submittedAt: existing.submittedAt ?? null,
        answers: existing.answers ?? undefined,
        answersByMember: existing.answersByMember ?? undefined,
        members: existing.members ?? [],
      },
      debug: dbg({ found: true, householdId }),
    });
  }

  if (!allowCreate) {
    // Caller may first probe with create=0 to decide UX
    return NextResponse.json({
      ok: true,
      form,
      app: null,
      debug: dbg({ found: false, householdId }),
    });
  }

  // 4) Create a minimal draft app (household-scoped, one per form)
  const now = new Date();
  const role = normalizeRole(myMembership?.role);
  const doc = {
    formId: form._id ?? form.id,
    householdId,
    status: "draft" as const,
    members: [
      { userId, email: emailLc, role }, // snapshot; your other members will upsert on join/invite
    ],
    answersByMember: {
      [userId]: { role, email: emailLc, answers: {} },
    },
    createdAt: now,
    updatedAt: now,
    timeline: [{ at: now, by: userId, event: "app.created", meta: { formId: form._id ?? form.id } }],
  };

  const ins = await apps.insertOne(doc as any);
  return NextResponse.json({
    ok: true,
    form,
    app: {
      id: toStringId(ins.insertedId),
      formId: String(doc.formId),
      status: "draft",
      property: null,
      unit: null,
      updatedAt: now,
      submittedAt: null,
      answers: undefined,
      answersByMember: doc.answersByMember,
      members: doc.members,
    },
    debug: dbg({ created: true, householdId }),
  });
}
