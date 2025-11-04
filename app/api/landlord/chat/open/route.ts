// app/api/landlord/chat/open/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toStringId(v: any) {
  if (!v) return "";
  if (typeof v === "string") return v;
  try { return v?.toHexString ? v.toHexString() : String(v); } catch { return String(v); }
}

// NEW: robust userId matcher (string or ObjectId)
async function resolveFirmForUser(user: any, req: NextRequest): Promise<string | null> {
  const db = await getDb();
  const { ObjectId } = await import("mongodb");
  const url = new URL(req.url);
  const firmIdParam = url.searchParams.get("firmId") || undefined;

  const uidStr = toStringId(user?.id ?? user?._id ?? user?.userId ?? user?.email ?? "");
  const uidOid = ObjectId.isValid(uidStr) ? new ObjectId(uidStr) : null;
  const userIdOr = uidOid ? [{ userId: uidStr }, { userId: uidOid }] : [{ userId: uidStr }];

  const membershipsCol = db.collection("firm_memberships");

  if (firmIdParam) {
    const m = await membershipsCol.findOne({ firmId: firmIdParam, active: true, $or: userIdOr });
    return m ? firmIdParam : null;
  }

  const ms = await membershipsCol
    .find({ active: true, $or: userIdOr }, { projection: { firmId: 1 } })
    .limit(5)
    .toArray();

  if (ms.length !== 1) return null;
  return String(ms[0].firmId);
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const db = await getDb();
  const threads = db.collection("chat_threads");
  const apps = db.collection("applications");
  const forms = db.collection("application_forms");
  const { ObjectId } = await import("mongodb");

  const body = await req.json().catch(() => ({}));
  const appId = body?.appId ? String(body.appId) : "";
  const hh = body?.householdId ? String(body.householdId) : "";

  const firmId = await resolveFirmForUser(user, req);
  if (!firmId) return NextResponse.json({ ok: false, error: "forbidden_firm" }, { status: 403 });

  let householdId = hh;

  if (appId) {
    const appFilter =
      /^[0-9a-fA-F]{24}$/.test(appId) ? { _id: new ObjectId(appId) } : ({ _id: appId } as any);

    const app = await apps.findOne(appFilter, { projection: { householdId: 1, formId: 1 } });
    if (!app) return NextResponse.json({ ok: false, error: "application_not_found" }, { status: 404 });

    householdId = String(app.householdId || householdId);

    const formKey = String(app.formId);
    const form = await forms.findOne(
      /^[0-9a-fA-F]{24}$/.test(formKey) ? { _id: new ObjectId(formKey) } : ({ _id: formKey } as any),
      { projection: { firmId: 1, firmName: 1 } }
    );
    if (!form?.firmId || String(form.firmId) !== String(firmId)) {
      return NextResponse.json({ ok: false, error: "wrong_firm_for_app" }, { status: 403 });
    }
  } else if (!householdId) {
    return NextResponse.json({ ok: false, error: "missing_app_or_household" }, { status: 400 });
  }

  const now = new Date();

  // -------- conflict-free upsert for appIds --------
  // If we have an appId, don't also set appIds in $setOnInsert; use $addToSet only.
  const insertBase = {
    householdId,
    firmId,
    firmName: null,
    createdAt: now,
    lastMessageAt: null,
  };

  const update: any = {
    $setOnInsert: appId ? insertBase : { ...insertBase, appIds: [] },
    $set: { updatedAt: now },
  };

  if (appId) {
    update.$addToSet = { appIds: String(appId) };
  }

  await threads.updateOne(
    { householdId, firmId },
    update,
    { upsert: true }
  );

  const thread = await threads.findOne(
    { householdId, firmId },
    { projection: { _id: 1 } }
  );

  if (!thread?._id) {
    return NextResponse.json({ ok: false, error: "thread_upsert_failed" }, { status: 500 });
  }

  const threadId = toStringId(thread._id);
  return NextResponse.json({ ok: true, threadId, redirect: `/landlord/chat/${encodeURIComponent(threadId)}` });
}
