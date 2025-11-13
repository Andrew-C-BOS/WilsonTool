// app/api/tenant/applications/resolve/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toStringId(v:any){ if(!v)return""; if(typeof v==="string")return v;
  try{ return v?.toHexString? v.toHexString(): String(v);}catch{ return String(v);} }

async function pickFormsCol(db:any){
  const names = ["application_forms","forms"];
  const existing = new Set((await db.listCollections().toArray()).map((c:any)=>c.name));
  for (const n of names) if (existing.has(n)) return db.collection(n);
  return db.collection("application_forms");
}
async function pickMembershipsCol(db:any){
  const names = ["households_membership","household_memberhsips","households_memberhsips","household_memberships","households_memberships"];
  const existing = new Set((await db.listCollections().toArray()).map((c:any)=>c.name));
  for (const n of names) if (existing.has(n)) return db.collection(n);
  return db.collection("households_membership");
}

export async function GET(req: NextRequest){
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok:false, error:"not_authenticated" }, { status:401 });

  const url = new URL(req.url);
  const formParam = url.searchParams.get("form") || "";
  const create = url.searchParams.get("create") === "1";

  if (!formParam) return NextResponse.json({ ok:false, error:"missing_form" }, { status:400 });

  const db = await getDb();
  const apps = db.collection("applications");
  const memberships = await pickMembershipsCol(db);
  const formsCol = await pickFormsCol(db);
  const { ObjectId } = await import("mongodb");

  // Robust form lookup
  const tries:any[] = [];
  if (/^[0-9a-fA-F]{24}$/.test(formParam)) tries.push({ _id: new ObjectId(formParam) });
  tries.push({ _id: formParam }, { id: formParam });

  let formDoc:any = null;
  for (const f of tries){ formDoc = await formsCol.findOne(f); if (formDoc) break; }
  if (!formDoc) return NextResponse.json({ ok:false, error:"form_not_found" }, { status:404 });

  const form = {
    _id: toStringId(formDoc._id ?? formDoc.id),
    id: toStringId(formDoc.id ?? formDoc._id),
    name: String(formDoc.name ?? "Application"),
    description: formDoc.description ?? "",
    scope: (formDoc.scope ?? "portfolio") as "portfolio",
    sections: Array.isArray(formDoc.sections)? formDoc.sections: [],
    questions: Array.isArray(formDoc.questions)? formDoc.questions: [],
    qualifications: Array.isArray(formDoc.qualifications)? formDoc.qualifications: [],
    version: Number(formDoc.version ?? 1),
  };

  // Caller identity & household
  const emailLc = String(user.email ?? "").toLowerCase();
  const userId = toStringId((user as any).id ?? (user as any)._id ?? (user as any).userId ?? emailLc);

  const myMembership = await memberships.find({
    $or: [{ userId }, { email: emailLc }, { email: (user as any).email }],
    active: true,
  }).sort({ joinedAt: -1 }).limit(1).next();

  const householdId = myMembership?.householdId ? toStringId(myMembership.householdId) : null;
  if (!householdId) return NextResponse.json({ ok:false, error:"no_household" }, { status:400 });

  // One app per (householdId, formId)
  const formKey = form._id || form.id;
  const existing = await apps.findOne(
    { householdId, formId: formKey },
    { projection: { _id:1, formId:1, status:1, updatedAt:1, submittedAt:1, answers:1, answersByMember:1, members:1 } }
  );

  if (existing) {
    return NextResponse.json({
      ok:true,
      form,
      app: {
        id: toStringId(existing._id),
        formId: String(existing.formId ?? ""),
        status: String(existing.status ?? "draft"),
        updatedAt: existing.updatedAt ?? null,
        submittedAt: existing.submittedAt ?? null,
        answers: existing.answers ?? undefined,
        answersByMember: existing.answersByMember ?? undefined,
        members: existing.members ?? [],
      }
    });
  }

  if (!create){
    return NextResponse.json({ ok:true, form, app: null });
  }

  // Create minimal draft app
  const now = new Date();
  const role = String(myMembership?.role || "co_applicant").toLowerCase();
  const normRole = (role === "primary" || role === "cosigner") ? role : "co_applicant";

  const doc:any = {
    formId: formKey,
    householdId,
    status: "draft",
    members: [{ userId, email: emailLc, role: normRole }],
    answersByMember: { [userId]: { role: normRole, email: emailLc, answers: {} } },
    createdAt: now, updatedAt: now,
    timeline: [{ at: now, by: userId, event: "app.created", meta: { formId: formKey } }],
  };

  const ins = await apps.insertOne(doc);
  return NextResponse.json({
    ok:true,
    form,
    app: {
      id: toStringId(ins.insertedId),
      formId: String(doc.formId),
      status: "draft",
      updatedAt: now,
      submittedAt: null,
      answersByMember: doc.answersByMember,
      members: doc.members,
    }
  });
}
