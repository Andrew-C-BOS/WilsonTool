// app/api/tenant/chat/open/route.ts
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

async function pickFormsCol(db: any) {
  const names = new Set((await db.listCollections().toArray()).map((c: any) => c.name));
  return names.has("applications_forms")
    ? db.collection("applications_forms")
    : db.collection("application_forms");
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const appId = String(body?.appId ?? "").trim();
  if (!appId) return NextResponse.json({ ok: false, error: "missing_appId" }, { status: 400 });

  const db = await getDb();
  const appsCol = db.collection("applications");
  const formsCol = await pickFormsCol(db);
  const threadsCol = db.collection("chat_threads");
  const { ObjectId } = await import("mongodb");

  // 1) application → householdId + formId
  const appFilter =
    /^[0-9a-fA-F]{24}$/.test(appId) ? { _id: new ObjectId(appId) } : ({ _id: appId } as any);
  const app = await appsCol.findOne(appFilter, { projection: { householdId: 1, formId: 1 } });
  if (!app) return NextResponse.json({ ok: false, error: "application_not_found" }, { status: 404 });

  const householdId = String(app.householdId ?? "");
  if (!householdId) {
    return NextResponse.json({ ok: false, error: "application_missing_household" }, { status: 400 });
  }

  // 2) form → firmId
  const formKey = String(app.formId ?? "");
  const formFilter =
    /^[0-9a-fA-F]{24}$/.test(formKey) ? { _id: new ObjectId(formKey) } : ({ _id: formKey } as any);
  const form = await formsCol.findOne(formFilter, { projection: { firmId: 1, firmName: 1 } });
  if (!form?.firmId) {
    return NextResponse.json({ ok: false, error: "form_missing_firm" }, { status: 400 });
  }
  const firmId = String(form.firmId);
  const now = new Date();

  // 3a) Upsert the thread WITHOUT touching appIds in the same update (avoid path conflict)
  await threadsCol.updateOne(
    { householdId, firmId },
    {
      $setOnInsert: {
        householdId,
        firmId,
        firmName: form.firmName ?? null,
        createdAt: now,
        lastMessageAt: null,
        appIds: [], // initialize here; safe because $addToSet happens in a separate operation
      },
      $set: { updatedAt: now },
    },
    { upsert: true }
  );

  // 3b) In a separate operation, add this appId to the set
  await threadsCol.updateOne(
    { householdId, firmId },
    { $addToSet: { appIds: String(appId) }, $set: { updatedAt: now } }
  );

  // 4) Read back the thread to get _id for redirect
  const thread = await threadsCol.findOne({ householdId, firmId }, { projection: { _id: 1 } });
  if (!thread?._id) {
    return NextResponse.json({ ok: false, error: "thread_upsert_failed" }, { status: 500 });
  }

  const threadId = toStringId(thread._id);
  return NextResponse.json({
    ok: true,
    threadId,
    redirect: `/tenant/chat/${encodeURIComponent(threadId)}`,
  });
}
