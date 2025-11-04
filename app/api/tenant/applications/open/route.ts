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

// Minimal shape
type AppDoc = {
  _id?: any;
  formId: string;
  status: AppStatus;
  members: Member[];
  householdId?: string;       // <── NEW (stored as string for simplicity)
  property?: any;
  unit?: any;
  createdAt: Date;
  updatedAt: Date;
  submittedAt?: Date;
  answers?: any;
  timeline?: any[];
  tasks?: any;
};

/* ---------------- helpers ---------------- */
function toStringId(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  try {
    // mongodb ObjectId
    return (v as any).toHexString ? (v as any).toHexString() : String(v);
  } catch {
    return String(v);
  }
}

async function getMembershipsCol(db: any) {
  // Probe likely names; pick the first that exists
  const candidates = [
    "households_membership",   // your sample
    "household_memberhsips",   // earlier typo used elsewhere
    "households_memberhsips",
    "household_memberships",
    "households_memberships",
  ];
  const existing: Set<string> = new Set(
    (await db.listCollections().toArray()).map((c: any) => c.name)
  );
  for (const name of candidates) {
    if (existing.has(name)) return db.collection(name);
  }
  // Fall back to your sample name
  return db.collection("households_membership");
}

/** Resolve caller's active household membership; returns {householdIdStr, membership} or null. */
async function resolveMyHousehold(db: any, user: any) {
  const membershipsCol = await getMembershipsCol(db);
  const primaryEmail = String(user?.email ?? "").toLowerCase();
  const userId =
    toStringId((user as any).id) ||
    toStringId((user as any)._id) ||
    toStringId((user as any).userId) ||
    primaryEmail;

  const m = await membershipsCol.findOne({
    $or: [{ userId }, { email: primaryEmail }, { email: (user as any).email }],
    // be tolerant: if "active" missing, still allow; prefer true if multiple
  });

  if (!m) return null;

  const householdIdStr = toStringId(m.householdId);
  return { householdIdStr, membership: m };
}

/* ============================================================
   POST /api/tenant/applications/open
   Body:
     - (A) { app: string }                        -> open existing app, backfill householdId if missing, add member if not present
     - (B) { invite: string }                     -> open via invite, backfill householdId, add member if needed
     - (C) { formId: string, role?: MemberRole }  -> create or reuse draft app by (formId, householdId)
============================================================ */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  const { ObjectId } = await import("mongodb");
  const db = await getDb();
  const appsCol = db.collection<AppDoc>("applications");
  const invitesCol = db.collection("application_invites");

  const now = new Date();
  const body = await req.json().catch(() => ({} as any));

  const formId: string | undefined = body.formId ? String(body.formId) : undefined;
  const app: string | undefined = body.app ? String(body.app) : undefined;
  const invite: string | undefined = body.invite ? String(body.invite) : undefined;
  const role: MemberRole = (body.role as MemberRole) ?? "primary";

  const userEmail = String(user.email).toLowerCase();
  const userId = String(
    (user as any).id ?? (user as any)._id ?? (user as any).userId ?? user.email
  );

  // Resolve caller's household up-front (used by all branches)
  const resolved = await resolveMyHousehold(db, user);
  if (!resolved) {
    // You can change to 400 if you prefer but this is usually a UX case (no household yet)
    return NextResponse.json({ ok: false, error: "no_household" }, { status: 400 });
  }
  const { householdIdStr } = resolved;

  let application: any = null;

  // ---------------- Case A: explicit application id ----------------
  if (app) {
    const filter =
      /^[0-9a-fA-F]{24}$/.test(app) ? { _id: new ObjectId(app) } : ({ _id: app } as any);

    application = await appsCol.findOne(filter as any);
    if (!application) {
      return NextResponse.json({ ok: false, error: "application_not_found" }, { status: 404 });
    }

    // If the app lacks householdId, backfill it to the caller's household now.
    // If it has a conflicting householdId, you could forbid; here we reconcile to caller's household.
    if (!application.householdId || String(application.householdId) !== householdIdStr) {
      await appsCol.updateOne(filter as any, {
        $set: { householdId: householdIdStr, updatedAt: now },
        $push: {
          timeline: {
            at: now,
            by: userId,
            event: "household.attach",
            meta: { householdId: householdIdStr },
          },
        } as any,
      });
      application.householdId = householdIdStr;
      application.updatedAt = now;
    }

    // Ensure the caller is listed as a member (as co_applicant if they weren't the creator)
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

      await appsCol.updateOne(filter as any, {
        $push: { members: member } as any,
        $set: { updatedAt: now },
      });

      application.members = [...(application.members ?? []), member];
    }
  }

  // ---------------- Case B: invite token ----------------
  else if (invite) {
    const inv = await invitesCol.findOne({ token: invite } as any);
    if (!inv) return NextResponse.json({ ok: false, error: "invalid_invite" }, { status: 400 });
    if (inv.expiresAt && inv.expiresAt < now) {
      return NextResponse.json({ ok: false, error: "invite_expired" }, { status: 400 });
    }

    const appId = String(inv.appId ?? inv.hhId ?? "");
    const filter =
      /^[0-9a-fA-F]{24}$/.test(appId) ? { _id: new ObjectId(appId) } : ({ _id: appId } as any);

    const target = await appsCol.findOne(filter as any);
    if (!target) {
      return NextResponse.json({ ok: false, error: "application_not_found" }, { status: 404 });
    }

    // Backfill or enforce householdId on the invited application
    if (!target.householdId || String(target.householdId) !== householdIdStr) {
      await appsCol.updateOne(filter as any, {
        $set: { householdId: householdIdStr, updatedAt: now },
        $push: {
          timeline: {
            at: now,
            by: userId,
            event: "household.attach",
            meta: { householdId: householdIdStr, via: "invite" },
          },
        } as any,
      });
      target.householdId = householdIdStr;
      target.updatedAt = now;
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

      await appsCol.updateOne(filter as any, {
        $push: { members: member } as any,
        $set: { updatedAt: now },
      });

      target.members = [...(target.members ?? []), member];
    }

    await invitesCol.updateOne(
      { _id: inv._id } as any,
      { $set: { usedBy: userId, usedAt: now } } as any
    );

    application = target;
  }

  // ---------------- Case C: form link → (re)use draft by (formId, householdId) ----------------
  else if (formId) {
    const existing = await appsCol.findOne({
      formId,
      householdId: householdIdStr,
      status: { $in: ["draft", "new"] as AppStatus[] },
    } as any);

    if (existing) {
      application = existing;

      // Ensure caller is present in members (idempotent)
      const exists = (existing.members ?? []).some(
        (m: any) => m.userId === userId || String(m.email ?? "").toLowerCase() === userEmail
      );
      if (!exists) {
        const member: Member = {
          userId,
          email: userEmail,
          role: "co_applicant", // joining an existing draft → co_applicant
          state: "invited",
          joinedAt: now,
        };
        await appsCol.updateOne(
          { _id: existing._id } as any,
          {
            $push: { members: member } as any,
            $set: { updatedAt: now },
          }
        );
        application.members = [...(existing.members ?? []), member];
      }
    } else {
      // New household-scoped draft
      const doc: AppDoc = {
        formId,
        status: "draft",
        householdId: householdIdStr,
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
        timeline: [
          {
            at: now,
            by: userId,
            event: "household.attach",
            meta: { householdId: householdIdStr, via: "create" },
          },
        ],
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
