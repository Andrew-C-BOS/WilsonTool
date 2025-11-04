// app/api/landlord/chat/[id]/route.ts
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

/** Safely extract a user identifier across auth shapes */
function pickUserId(user: unknown): string {
  const u = user as any;
  return toStringId(
    u?._id ??
    u?.id ??        // some auth libs
    u?.userId ??    // custom
    u?.sub ??       // JWT subject
    u?.uid ??       // Firebase-style
    u?.email ??     // last resort
    ""
  );
}

/** Match memberships where userId may be stored as string OR ObjectId */
async function userFirmIds(user: unknown): Promise<Set<string>> {
  const db = await getDb();
  const { ObjectId } = await import("mongodb");
  const fm = db.collection("firm_memberships");

  const uidStr = pickUserId(user);
  if (!uidStr) return new Set();

  const uidOid = ObjectId.isValid(uidStr) ? new ObjectId(uidStr) : null;
  const userIdOr = uidOid ? [{ userId: uidStr }, { userId: uidOid }] : [{ userId: uidStr }];

  const rows = await fm
    .find({ active: true, $or: userIdOr }, { projection: { firmId: 1 }, limit: 50 })
    .toArray();

  return new Set(rows.map((r: any) => String(r.firmId)));
}

async function getThreadId(
  req: NextRequest,
  paramInput: { id: string } | Promise<{ id: string }>
) {
  try {
    const p = await paramInput;
    if (p?.id) return String(p.id);
  } catch {}
  const seg = (req.nextUrl?.pathname || "").split("/").filter(Boolean).pop();
  return seg || "";
}

/* GET: load messages (firm-auth) */
export async function GET(
  req: NextRequest,
  ctx: { params: { id: string } } | { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const db = await getDb();
  const { ObjectId } = await import("mongodb");
  const threads = db.collection("chat_threads");
  const msgs = db.collection("chat_messages");

  const threadId = await getThreadId(req, (ctx as any).params);
  if (!threadId) return NextResponse.json({ ok: false, error: "bad_thread_id" }, { status: 400 });

  const filter =
    /^[0-9a-fA-F]{24}$/.test(threadId)
      ? { _id: new ObjectId(threadId) }
      : ({ _id: threadId } as any);

  const thread = await threads.findOne(filter);
  if (!thread) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  // Firm authorization
  const firms = await userFirmIds(user);
  const threadFirmId = String(thread.firmId ?? "");
  if (!threadFirmId || !firms.has(threadFirmId)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const m = await msgs
    .find({ threadId: toStringId(thread._id) })
    .sort({ createdAt: 1 })
    .limit(200)
    .toArray();

  return NextResponse.json({
    ok: true,
    thread: {
      id: toStringId(thread._id),
      firmId: threadFirmId,
      firmName: thread.firmName ?? null,
      householdId: String(thread.householdId),
      appIds: (thread.appIds ?? []).map(String),
      updatedAt: thread.updatedAt ?? null,
      lastMessageAt: thread.lastMessageAt ?? null,
    },
    messages: m.map((x: any) => ({
      id: toStringId(x._id),
      from: x.from as "tenant" | "firm",
      by: x.by ?? null,
      text: x.text,
      createdAt: x.createdAt,
    })),
  });
}

/* POST: send message (firm-auth) */
export async function POST(
  req: NextRequest,
  ctx: { params: { id: string } } | { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const db = await getDb();
  const { ObjectId } = await import("mongodb");
  const threads = db.collection("chat_threads");
  const msgs = db.collection("chat_messages");

  const threadId = await getThreadId(req, (ctx as any).params);
  if (!threadId) return NextResponse.json({ ok: false, error: "bad_thread_id" }, { status: 400 });

  const filter =
    /^[0-9a-fA-F]{24}$/.test(threadId)
      ? { _id: new ObjectId(threadId) }
      : ({ _id: threadId } as any);

  const thread = await threads.findOne(filter);
  if (!thread) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const firms = await userFirmIds(user);
  const threadFirmId = String(thread.firmId ?? "");
  if (!threadFirmId || !firms.has(threadFirmId)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const text = String(body?.text ?? "").trim();
  if (!text) return NextResponse.json({ ok: false, error: "empty" }, { status: 400 });

  const now = new Date();
  await msgs.insertOne({
    threadId: toStringId(thread._id),
    from: "firm",
    by: pickUserId(user), // <-- no direct user.id
    text,
    createdAt: now,
  } as any);
  await threads.updateOne(filter, { $set: { updatedAt: now, lastMessageAt: now } });

  return NextResponse.json({ ok: true });
}
