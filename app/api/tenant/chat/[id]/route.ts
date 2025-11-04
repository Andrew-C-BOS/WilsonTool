// app/api/tenant/chat/[id]/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toStringId(v:any){ if(!v) return ""; if(typeof v==="string") return v; try{ return v?.toHexString? v.toHexString(): String(v);}catch{ return String(v);} }

async function getThreadId(req: NextRequest, paramInput: { id: string } | Promise<{ id: string }>) {
  try { const p = await paramInput; if (p?.id) return String(p.id); } catch {}
  const path = req.nextUrl?.pathname || "";
  const seg = path.split("/").filter(Boolean).pop();
  return seg ? String(seg) : "";
}

async function pickMembershipsCol(db:any){
  const names = ["households_membership","household_memberhsips","households_memberhsips","household_memberships","households_memberships"];
  const existing = new Set((await db.listCollections().toArray()).map((c:any)=>c.name));
  for (const n of names) if (existing.has(n)) return db.collection(n);
  return db.collection("households_membership");
}
async function resolveMyHouseholdId(db:any, user:any): Promise<string|null>{
  const col = await pickMembershipsCol(db);
  const email = String(user?.email ?? "").toLowerCase();
  const userId = toStringId((user as any).id ?? (user as any)._id ?? (user as any).userId ?? email);
  const row = await col.find({ $or:[{userId},{email},{email:(user as any).email}] })
    .sort({ active:-1, joinedAt:-1 }).limit(1).next();
  return row ? toStringId(row.householdId) : null;
}

/* GET: load thread + messages */
export async function GET(req: NextRequest, ctx: { params: { id: string } } | { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok:false, error:"not_authenticated" }, { status:401 });

  const db = await getDb();
  const { ObjectId } = await import("mongodb");
  const threadsCol = db.collection("chat_threads");
  const msgsCol = db.collection("chat_messages");

  const threadId = await getThreadId(req, (ctx as any).params);
  if (!threadId) return NextResponse.json({ ok:false, error:"bad_thread_id" }, { status:400 });

  const filter = /^[0-9a-fA-F]{24}$/.test(threadId) ? { _id: new ObjectId(threadId) } : ({ _id: threadId } as any);
  const thread = await threadsCol.findOne(filter);
  if (!thread) return NextResponse.json({ ok:false, error:"not_found" }, { status:404 });

  const myHouseholdId = await resolveMyHouseholdId(db, user);
  if (!myHouseholdId || String(thread.householdId) !== String(myHouseholdId)) {
    return NextResponse.json({ ok:false, error:"forbidden" }, { status:403 });
  }

  const messages = await msgsCol.find({ threadId: toStringId(thread._id) }).sort({ createdAt: 1 }).limit(200).toArray();

  return NextResponse.json({
    ok: true,
    thread: {
      id: toStringId(thread._id),
      firmId: String(thread.firmId),
      firmName: thread.firmName ?? null,
      householdId: String(thread.householdId),
      appIds: (thread.appIds ?? []).map(String),
      updatedAt: thread.updatedAt ?? null,
      lastMessageAt: thread.lastMessageAt ?? null,
    },
    messages: messages.map((m:any)=>({
      id: toStringId(m._id),
      from: m.from as "tenant"|"firm",
      by: m.by ?? null,
      text: m.text,
      createdAt: m.createdAt,
    })),
  });
}

/* POST: send message */
export async function POST(req: NextRequest, ctx: { params: { id: string } } | { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok:false, error:"not_authenticated" }, { status:401 });

  const db = await getDb();
  const { ObjectId } = await import("mongodb");
  const threadsCol = db.collection("chat_threads");
  const msgsCol = db.collection("chat_messages");

  const threadId = await getThreadId(req, (ctx as any).params);
  if (!threadId) return NextResponse.json({ ok:false, error:"bad_thread_id" }, { status:400 });

  const filter = /^[0-9a-fA-F]{24}$/.test(threadId) ? { _id: new ObjectId(threadId) } : ({ _id: threadId } as any);
  const thread = await threadsCol.findOne(filter);
  if (!thread) return NextResponse.json({ ok:false, error:"not_found" }, { status:404 });

  const myHouseholdId = await resolveMyHouseholdId(db, user);
  if (!myHouseholdId || String(thread.householdId) !== String(myHouseholdId)) {
    return NextResponse.json({ ok:false, error:"forbidden" }, { status:403 });
  }

  const body = await req.json().catch(()=>null);
  const text = String(body?.text ?? "").trim();
  if (!text) return NextResponse.json({ ok:false, error:"empty" }, { status:400 });

  const now = new Date();
  await msgsCol.insertOne({
    threadId: toStringId(thread._id),
    from: "tenant",
    by: toStringId((user as any).id ?? (user as any)._id ?? (user as any).userId ?? String(user.email ?? "")),
    text,
    createdAt: now,
  } as any);
  await threadsCol.updateOne(filter, { $set: { updatedAt: now, lastMessageAt: now } });

  return NextResponse.json({ ok:true });
}
