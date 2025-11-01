// app/api/tenant/applications/[id]/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Types aligned with the client */
type MemberRole = "primary" | "co_applicant" | "cosigner";
type AppStatus =
  | "draft"
  | "new"
  | "in_review"
  | "needs_approval"
  | "approved_pending_lease"
  | "rejected";

/** Turn a string id into a Mongo filter, ObjectId or string */
async function toIdFilter(id: string) {
  const { ObjectId } = await import("mongodb");
  return /^[0-9a-fA-F]{24}$/.test(id) ? { _id: new ObjectId(id) } : { _id: id as any };
}

/** Scope every read/write to the caller's membership on the application */
async function filterForUser(id: string, user: any) {
  const userEmail = String(user.email).toLowerCase();
  const userId = String(user.id ?? user._id ?? user.userId ?? user.email);
  return {
    $and: [
      await toIdFilter(id),
      {
        $or: [
          { "members.userId": userId },
          { "members.email": userEmail },
          { "members.email": user.email }, // belt-and-suspenders
        ],
      },
    ],
  };
}

/** GET /api/tenant/applications/:id — limited view incl. answers */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const { id } = await ctx.params;

  const db = await getDb();
  const col = db.collection("applications");
  const filter = await filterForUser(id, user);

  const app = await col.findOne(filter, {
    projection: {
      formId: 1,
      status: 1,
      members: 1,
      property: 1,
      unit: 1,
      answers: 1,
      createdAt: 1,
      updatedAt: 1,
      submittedAt: 1,
      tasks: 1,
    },
  });

  if (!app) {
    // Distinguish missing vs forbidden
    const exists = await col.findOne(await toIdFilter(id), { projection: { _id: 1 } });
    return NextResponse.json(
      { ok: false, error: exists ? "forbidden" : "not_found" },
      { status: exists ? 403 : 404 }
    );
  }

  return NextResponse.json({ ok: true, app: { ...app, id: String((app as any)._id) } });
}

/**
 * PATCH /api/tenant/applications/:id
 * Body supports:
 *  - { status: AppStatus }
 *  - { updates: [{ role, qid, value }, ...] }
 *  - { answersForRole: { role, answers } }
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const { id } = await ctx.params;

  const db = await getDb();
  const col = db.collection("applications");
  const filter = await filterForUser(id, user);

  const now = new Date();
  const body = await req.json().catch(() => ({} as any));

  const $set: Record<string, any> = { updatedAt: now };
  const $push: any = {};
  const actor = String(
	  (user as any).id ??
	  (user as any)._id ??
	  (user as any).userId ??
	  user.email
	);

  // Status transition
  if (body?.status) {
    const nextStatus = String(body.status) as AppStatus;
    $set.status = nextStatus;
    if (nextStatus === "new") $set.submittedAt = now; // fine for MVP
    $push.timeline = $push.timeline ?? { $each: [] as any[] };
    $push.timeline.$each.push({ at: now, by: actor, event: "status.change", meta: { to: nextStatus } });
  }

  // Incremental updates
  if (Array.isArray(body?.updates) && body.updates.length) {
    for (const u of body.updates as Array<{ role: MemberRole; qid: string; value: any }>) {
      if (!u?.role || !u?.qid) continue;
      $set[`answers.${u.role}.${u.qid}`] = u.value;
    }
    $push.timeline = $push.timeline ?? { $each: [] as any[] };
    $push.timeline.$each.push({ at: now, by: actor, event: "answers.update", meta: { count: body.updates.length } });
  }

  // Replace all answers for a role
  if (body?.answersForRole?.role && body?.answersForRole?.answers) {
    const r = body.answersForRole.role as MemberRole;
    const a = body.answersForRole.answers as Record<string, any>;
    $set[`answers.${r}`] = a;
    $push.timeline = $push.timeline ?? { $each: [] as any[] };
    $push.timeline.$each.push({ at: now, by: actor, event: "answers.replace", meta: { role: r, fields: Object.keys(a).length } });
  }

  if (Object.keys($set).length === 1 && !$push.timeline) {
    return NextResponse.json({ ok: false, error: "no_changes" }, { status: 400 });
  }

  const update: any = { $set };
  if ($push.timeline) update.$push = { timeline: $push.timeline };

  const res = await col.updateOne(filter, update);
  if (res.matchedCount === 0) {
    const exists = await col.findOne(await toIdFilter(id), { projection: { _id: 1 } });
    return NextResponse.json(
      { ok: false, error: exists ? "forbidden" : "not_found" },
      { status: exists ? 403 : 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
