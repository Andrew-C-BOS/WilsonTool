// app/api/tenant/applications/open/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MemberRole = "primary" | "co_applicant" | "cosigner";

type Member = {
  userId: string;
  email: string;
  role: MemberRole;
  state: "invited" | "complete";
  joinedAt: Date;
};

type AppStatus =
  | "draft"
  | "new"
  | "in_review"
  | "needs_approval"
  | "approved_pending_lease"
  | "rejected";

// Minimal shape we need here so Mongo types know `members` is an array
type AppDoc = {
  _id?: any;
  formId: string;
  status: AppStatus;
  members: Member[];
  createdAt: Date;
  updatedAt: Date;
  submittedAt?: Date;
  // other fields are fine to omit for typing the update ops
};

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  const { ObjectId } = await import("mongodb");
  const db = await getDb();
  // ✅ Type the collection so $push/$addToSet knows `members` is an array
  const appsCol = db.collection<AppDoc>("applications");
  const invitesCol = db.collection("application_invites");

  const now = new Date();
  const body = await req.json().catch(() => ({} as any));

  const formId: string | undefined = body.formId ? String(body.formId) : undefined;
  const app: string | undefined = body.app ? String(body.app) : undefined;
  const invite: string | undefined = body.invite ? String(body.invite) : undefined;
  const role: MemberRole = (body.role as MemberRole) ?? "primary";

  const userEmail = String(user.email).toLowerCase();
  const userId = String((user as any).id ?? (user as any)._id ?? (user as any).userId ?? user.email);

  let application: any = null;

  // Case A: explicit application id
  if (app) {
    const filter =
      /^[0-9a-fA-F]{24}$/.test(app) ? { _id: new ObjectId(app) } : ({ _id: app } as any);

    application = await appsCol.findOne(filter as any);
    if (!application) {
      return NextResponse.json({ ok: false, error: "application_not_found" }, { status: 404 });
    }

    const exists = (application.members ?? []).some(
      (m: any) => m.userId === userId || String(m.email ?? "").toLowerCase() === userEmail
    );
    if (!exists) {
      const member: Member = {
        userId,
        email: userEmail,
        role: role === "primary" ? "co_applicant" : role,
        state: "invited",
        joinedAt: now,
      };

      // You can use $push or $addToSet; $addToSet avoids accidental dupes
      await appsCol.updateOne(
        filter as any,
        {
          $push: { members: member },
          $set: { updatedAt: now },
        }
      );

      application.members = [...(application.members ?? []), member];
    }
  }
  // Case B: invite token
  else if (invite) {
    const inv = await invitesCol.findOne({ token: invite } as any);
    if (!inv) return NextResponse.json({ ok: false, error: "invalid_invite" }, { status: 400 });
    if (inv.expiresAt && inv.expiresAt < now)
      return NextResponse.json({ ok: false, error: "invite_expired" }, { status: 400 });

    const appId = String(inv.appId ?? inv.hhId ?? "");
    const filter =
      /^[0-9a-fA-F]{24}$/.test(appId) ? { _id: new ObjectId(appId) } : ({ _id: appId } as any);

    const target = await appsCol.findOne(filter as any);
    if (!target) {
      return NextResponse.json({ ok: false, error: "application_not_found" }, { status: 404 });
    }

    const joinRole: MemberRole = (inv.role as MemberRole) ?? "co_applicant";
    const exists = (target.members ?? []).some(
      (m: any) => m.userId === userId || String(m.email ?? "").toLowerCase() === userEmail
    );
    if (!exists) {
      const member: Member = {
        userId,
        email: userEmail,
        role: joinRole,
        state: "invited",
        joinedAt: now,
      };

      await appsCol.updateOne(
        filter as any,
        {
          $push: { members: member },
          $set: { updatedAt: now },
        }
      );

      target.members = [...(target.members ?? []), member];
    }

    await invitesCol.updateOne(
      { _id: inv._id } as any,
      { $set: { usedBy: userId, usedAt: now } } as any
    );

    application = target;
  }
  // Case C: form link → create new application (or reuse an existing draft)
  else if (formId) {
    const existing = await appsCol.findOne({
      formId,
      status: { $in: ["draft", "new"] as AppStatus[] },
      $or: [
        { "members.userId": userId },
        { "members.email": userEmail },
        { "members.email": user.email },
      ],
    } as any);

    if (existing) {
      application = existing;
    } else {
      const doc: AppDoc = {
        formId,
        status: "draft",
        members: [
          {
            userId,
            email: userEmail,
            role: "primary",
            state: "complete",
            joinedAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      };
      const ins = await appsCol.insertOne(doc as any);
      application = { ...doc, _id: ins.insertedId };
    }
  } else {
    return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });
  }

  const appIdOut = String(application._id);
  const formIdOut = String(application.formId ?? formId);

  return NextResponse.json({
    ok: true,
    appId: appIdOut,
    formId: formIdOut,
    redirect: `/tenant/apply?form=${encodeURIComponent(formIdOut)}&app=${encodeURIComponent(appIdOut)}`,
  });
}
