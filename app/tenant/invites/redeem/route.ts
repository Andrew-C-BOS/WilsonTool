import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { ObjectId, type UpdateFilter } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AppDoc = {
  _id: ObjectId | string;
  formId?: ObjectId | string;
  members?: any[];   // declare as arrays so $push is happy
  timeline?: any[];
};

function idQuery(id: any) {
  if (id && typeof id === "object" && (id as any)._bsontype === "ObjectID") return { _id: id };
  return ObjectId.isValid(String(id)) ? { _id: new ObjectId(String(id)) } : { _id: String(id) };
}
const toDate = (x: any) => (x instanceof Date ? x : new Date(x));

/**
 * POST /tenant/invites/redeem
 * Body: { code: string }
 * Returns: { ok, appId, formId }
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const code = String(body?.code || "").trim();
  if (!code) return NextResponse.json({ ok: false, error: "invalid_code" }, { status: 400 });

  const db = await getDb();
  const now = new Date();

  const invite = await db.collection("application_invites").findOne({
    code,
    active: true,
    expiresAt: { $gt: now },
  });
  if (!invite) return NextResponse.json({ ok: false, error: "not_found_or_expired" }, { status: 404 });

  const apps = db.collection<AppDoc>("applications");

  const app = await apps.findOne(idQuery(invite.appId), {
    projection: { _id: 1, formId: 1, members: 1 },
  });
  if (!app) return NextResponse.json({ ok: false, error: "application_not_found" }, { status: 404 });

  const userId = (user as any)._id;
  const email = String((user as any).email || "");
  const name = (user as any).name || undefined;

  const already =
    Array.isArray(app.members) &&
    app.members.some(
      (m: any) =>
        String(m.userId || "") === String(userId) ||
        String(m.email || "") === email
    );

  if (!already) {
    const member = {
      userId,
      email,
      name,
      role: (invite as any).role, // "co_applicant" | "cosigner"
      state: "invited" as const,
      joinedAt: now,
    };

    const timelineEntry = {
      at: now,
      by: userId,
      event: "member.joined",
      meta: { via: "invite", code },
    };

    const update: UpdateFilter<AppDoc> = {
      $push: {
        members: { $each: [member] },
        timeline: { $each: [timelineEntry] },
      },
    };

    await apps.updateOne({ _id: app._id } as any, update);
  }

  const nextUses = ((invite as any).uses || 0) + 1;
  await db.collection("application_invites").updateOne(
    { _id: (invite as any)._id },
    {
      $set: {
        uses: nextUses,
        lastUsedAt: now,
        lastUsedBy: userId,
        active: nextUses < ((invite as any).maxUses || 1),
      },
    }
  );

  return NextResponse.json({
    ok: true,
    appId: String(app._id),
    formId: String(app.formId),
  });
}
