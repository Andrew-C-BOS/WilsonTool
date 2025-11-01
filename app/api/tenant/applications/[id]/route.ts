// app/api/tenant/applications/[id]/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MemberRole = "primary" | "co_applicant" | "cosigner";
type AppStatus =
  | "draft"
  | "new"
  | "in_review"
  | "needs_approval"
  | "approved_pending_lease"
  | "rejected";

/** Build an _id filter that accepts either ObjectId or string ids */
async function idFilter(id: string) {
  const { ObjectId } = await import("mongodb");
  return /^[0-9a-fA-F]{24}$/.test(id) ? { _id: new ObjectId(id) } : { _id: id as any };
}

/** Filter that proves the caller is a member of the application */
function membershipFilter(user: any) {
  const userEmail = String(user.email).toLowerCase();
  const userId = String(user.id ?? user._id ?? user.userId ?? user.email);
  return {
    $or: [
      { "members.userId": userId },
      { "members.email": userEmail },
      { "members.email": user.email }, // belt-and-suspenders
    ],
  };
}

/** GET /api/tenant/applications/:id — limited view (includes answers) */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

    const { id } = await ctx.params;

    const db = await getDb();
    const col = db.collection("applications");

    // First, check for a document where the caller is a member
    const app = await col.findOne(
      { $and: [await idFilter(id), membershipFilter(user)] },
      {
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
      }
    );

    if (!app) {
      // Distinguish “doesn’t exist” from “exists but you’re not a member”
      const exists = await col.findOne(await idFilter(id), { projection: { _id: 1, members: 1 } });
      return NextResponse.json(
        { ok: false, error: exists ? "forbidden" : "not_found" },
        { status: exists ? 403 : 404 }
      );
    }

    return NextResponse.json({ ok: true, app: { ...app, id: String((app as any)._id) } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "server_error" }, { status: 500 });
  }
}

/**
 * PATCH /api/tenant/applications/:id
 * Body supports:
 *  - { status: AppStatus }
 *  - { updates: [{ role: MemberRole, qid: string, value: any }, ...] }
 *  - { answersForRole: { role: MemberRole, answers: Record<string, any> } }
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

    const { id } = await ctx.params;

    const db = await getDb();
    const col = db.collection("applications");

    const now = new Date();
    const body = await req.json().catch(() => ({} as any));

    const sets: Record<string, any> = { updatedAt: now };
    const timeline: Array<{ at: Date; by: string; event: string; meta?: any }> = [];

    // Identify actor
    const actor = String(
	  (user as any).id ??
	  (user as any)._id ??
	  (user as any).userId ??
	  user.email
	);

    // 1) Status change
    if (body?.status) {
      const nextStatus = String(body.status) as AppStatus;
      sets.status = nextStatus;
      // Simple first-submission timestamp (ok for MVP)
      if (nextStatus === "new") sets.submittedAt = now;
      timeline.push({ at: now, by: actor, event: "status.change", meta: { to: nextStatus } });
    }

    // 2) Incremental answer updates
    if (Array.isArray(body?.updates) && body.updates.length) {
      for (const u of body.updates as Array<{ role: MemberRole; qid: string; value: any }>) {
        if (!u || !u.role || !u.qid) continue;
        sets[`answers.${u.role}.${u.qid}`] = u.value;
      }
      timeline.push({ at: now, by: actor, event: "answers.update", meta: { count: body.updates.length } });
    }

    // 3) Replace a role’s entire answer map
    if (body?.answersForRole?.role && body?.answersForRole?.answers) {
      const r = body.answersForRole.role as MemberRole;
      const a = body.answersForRole.answers as Record<string, any>;
      sets[`answers.${r}`] = a;
      timeline.push({ at: now, by: actor, event: "answers.replace", meta: { role: r, fields: Object.keys(a).length } });
    }

    if (Object.keys(sets).length === 1 /* only updatedAt */) {
      return NextResponse.json({ ok: false, error: "no_changes" }, { status: 400 });
    }

    const update: any = { $set: sets };
    if (timeline.length) update.$push = { timeline: { $each: timeline } };

    // Enforce membership
    const res = await col.updateOne(
      { $and: [await idFilter(id), membershipFilter(user)] },
      update
    );

    if (res.matchedCount === 0) {
      // Didn’t match under membership: decide not_found vs forbidden
      const exists = await col.findOne(await idFilter(id), { projection: { _id: 1, members: 1 } });
      return NextResponse.json(
        { ok: false, error: exists ? "forbidden" : "not_found" },
        { status: exists ? 403 : 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || "server_error" }, { status: 500 });
  }
}
