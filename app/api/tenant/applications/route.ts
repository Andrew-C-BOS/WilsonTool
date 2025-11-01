// app/api/tenant/applications/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Local types align with your UI */
type AppStatus =
  | "draft"
  | "new"
  | "in_review"
  | "needs_approval"
  | "approved_pending_lease"
  | "rejected";
type MemberRole = "primary" | "co_applicant" | "cosigner";

/**
 * GET /api/tenant/applications?me=1&formId=<optional>
 * Lists apps for the logged-in user, optionally filtered by formId.
 * Tries "applications" first, falls back to legacy "households".
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const url = new URL(req.url);
  if (!url.searchParams.get("me")) {
    return NextResponse.json({ ok: false, error: "unsupported_query" }, { status: 400 });
  }
  const formIdFilter = url.searchParams.get("formId")?.trim();

  const userEmail = String(user.email).toLowerCase();
  const userId = String((user as any).id ?? (user as any)._id ?? (user as any).userId ?? user.email);

  const db = await getDb();
  const appsCol = db.collection("applications");
  const hhCol = db.collection("households"); // legacy
  const formsCol = db.collection("application_forms");

  const baseFilter: any = {
    $or: [
      { "members.userId": userId },
      { "members.email": userEmail },
      { "members.email": user.email }, // belt-and-suspenders
    ],
  };
  if (formIdFilter) baseFilter.formId = formIdFilter;

  // Prefer the new "applications" collection
  let rows: any[] = await appsCol
    .find(baseFilter, {
      projection: {
        formId: 1,
        status: 1,
        members: 1,
        property: 1,
        unit: 1,
        updatedAt: 1,
        submittedAt: 1,
        tasks: 1,
      },
    })
    .sort({ updatedAt: -1 })
    .limit(100)
    .toArray();

  // Back-compat fallback to "households" if nothing is found yet
  if (!rows.length) {
    rows = await hhCol
      .find(baseFilter, {
        projection: {
          formId: 1,
          status: 1,
          members: 1,
          property: 1,
          unit: 1,
          updatedAt: 1,
          submittedAt: 1,
          tasks: 1,
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
    ? await formsCol.find(
        {
          $or: formIds.map((fid) =>
            /^[0-9a-fA-F]{24}$/.test(fid)
              ? { _id: new ObjectId(fid) }
              : { _id: fid as any }
          ),
        },
        { projection: { name: 1 } }
      ).toArray()
    : [];
  const nameById = new Map<string, string>(
    forms.map((f: any) => [String(f._id), f.name ?? "Application"])
  );

  const apps = rows.map((h: any) => {
    const me = (h.members ?? []).find(
      (m: any) =>
        m.userId === userId || String(m.email ?? "").toLowerCase() === userEmail
    );
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
      updatedAt: h.updatedAt
        ? new Date(h.updatedAt).toISOString().slice(0, 10)
        : "",
      submittedAt: h.submittedAt
        ? new Date(h.submittedAt).toISOString().slice(0, 10)
        : undefined,
      members: (h.members ?? []).map((m: any) => ({
        name: m.name ?? m.email ?? "",
        email: m.email ?? "",
        role: m.role as MemberRole,
        state: m.state ?? undefined,
      })),
      tasks: {
        myIncomplete: h.tasks?.myIncomplete ?? 0,
        householdIncomplete: h.tasks?.householdIncomplete ?? 0,
        missingDocs: h.tasks?.missingDocs ?? 0,
      },
    };
  });

  return NextResponse.json({ ok: true, apps });
}

/**
 * POST /api/tenant/applications
 * Body: { formId: string }
 * Idempotently creates (or reuses) a draft application tied to the user.
 * Returns { ok, appId, redirect, reused }
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const formId = String(body?.formId ?? "").trim();
  if (!formId) return NextResponse.json({ ok: false, error: "missing_formId" }, { status: 400 });

  const db = await getDb();
  const appsCol = db.collection("applications");
  const now = new Date();

  const userEmail = String(user.email).toLowerCase();
  const userId = String((user as any).id ?? (user as any)._id ?? (user as any).userId ?? user.email);

  // Reuse existing draft/new on this form for this user
  const existing = await appsCol.findOne({
    formId,
    status: { $in: ["draft", "new"] },
    $or: [
      { "members.userId": userId },
      { "members.email": userEmail },
      { "members.email": user.email },
    ],
  });

  if (existing) {
    return NextResponse.json({
      ok: true,
      appId: String(existing._id),
      redirect: `/tenant/apply?form=${encodeURIComponent(formId)}&app=${encodeURIComponent(String(existing._id))}`,
      reused: true,
    });
  }

  // Create new application instance
  const doc = {
    formId,
    status: "draft" as AppStatus,
    members: [
      {
        userId,
        email: userEmail,
        role: "primary" as MemberRole,
        state: "invited",
        joinedAt: now,
      },
    ],
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
