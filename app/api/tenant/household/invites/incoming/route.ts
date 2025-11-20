// app/api/tenant/household/invites/incoming/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MemberRole = "primary" | "co_applicant" | "cosigner";

/* ---------- utils (kept local to this route) ---------- */
function toStringId(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (v instanceof ObjectId) return v.toHexString();
  return String(v);
}
function toMaybeObjectId(s: string | null | undefined): ObjectId | null {
  if (!s) return null;
  return ObjectId.isValid(s) ? new ObjectId(s) : null;
}

/* Try all likely membership collection names, return the first that exists. */
async function getMembershipsCol(db: any) {
  const candidates = [
    "household_memberhsips",   // original typo referenced earlier
    "households_memberhsips",  // plural households + same typo
    "household_memberships",   // corrected spelling
    "households_memberships",  // plural + corrected
    "households_membership",   // matches latest sample
  ];
  const existing: Set<string> = new Set(
    (await db.listCollections().toArray()).map((c: any) => c.name)
  );
  for (const name of candidates) {
    if (existing.has(name)) return db.collection(name);
  }
  // Fall back to the most likely one from your sample
  return db.collection("households_membership");
}

/* Minimal membership resolver to know which household you're currently in */
async function resolveCurrentMembership(opts: { db: any; user: any }) {
  const membershipsCol = await getMembershipsCol(opts.db);

  const primaryEmail = String(opts.user?.email ?? "").toLowerCase();
  const emailAliases: string[] = Array.isArray((opts.user as any)?.emails)
    ? ((opts.user as any).emails as string[]).map((e) => String(e).toLowerCase())
    : [];

  const rawUserId =
    toStringId((opts.user as any).id) ||
    toStringId((opts.user as any)._id) ||
    toStringId((opts.user as any).userId) ||
    primaryEmail;

  const uidObj = toMaybeObjectId(rawUserId);

  const orIdentity = [
    { userId: rawUserId },
    ...(uidObj ? [{ userId: uidObj as any }] : []),
    { email: primaryEmail },
    ...emailAliases.map((e) => ({ email: e })),
  ];

  const rows = await membershipsCol
    .find({
      $or: orIdentity,
      active: { $ne: false },
    })
    .sort({ joinedAt: -1 })
    .limit(1)
    .toArray();

  const membership = rows[0] ?? null;

  return {
    membership,
    identityDebug: {
      primaryEmail,
      emailAliases,
      rawUserId,
      asObj: uidObj ? uidObj.toHexString() : null,
      colName: membershipsCol.collectionName,
    },
  };
}

/* ============================================================
   GET /api/tenant/household/invites/incoming?me=1
   Returns invites addressed to the current user (by email),
   for OTHER households (not their current one).
   Shape:
   {
     ok: true,
     invites: [
       {
         id: string,
         householdId: string,
         householdName: string | null,
         role: MemberRole,
         createdAt: string,
         expiresAt: string,
       },
       ...
     ]
   }
============================================================ */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);

  // Cheap guard for now, matches your existing ?me=1 pattern
  if (!url.searchParams.get("me")) {
    return NextResponse.json(
      { ok: false, error: "unsupported_query" },
      { status: 400 },
    );
  }

  const db = await getDb();
  const invitesCol = db.collection("household_invites");
  const householdsCol = db.collection("households");
  const usersCol = db.collection("users"); // ← NEW

  // Who am I?
  const primaryEmail = String(user.email ?? "").toLowerCase();
  const emailAliases: string[] = Array.isArray((user as any)?.emails)
    ? ((user as any).emails as string[]).map((e) => String(e).toLowerCase())
    : [];
  const emailSet = Array.from(
    new Set([primaryEmail, ...emailAliases].filter(Boolean)),
  );

  // What household am I currently in (if any)?
  const { membership } = await resolveCurrentMembership({ db, user });
  const currentHouseholdId = membership
    ? toStringId(membership.householdId)
    : null;

  const now = new Date();

  // Find active, non-expired invites addressed to my email(s)
  const query: any = {
    state: "active",
    expiresAt: { $gt: now },
    email: { $in: emailSet },
  };

  const rows = await invitesCol
    .find(query)
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();

  // Optionally filter out invites to the household I'm already in
  const filtered = rows.filter((r: any) => {
    const hid = toStringId(r.householdId);
    if (!currentHouseholdId) return true;
    return hid !== currentHouseholdId;
  });

 /* ---------------- Hydrate household names ---------------- */

  const householdIds = Array.from(
    new Set(
      filtered
        .map((r: any) => toStringId(r.householdId))
        .filter(Boolean),
    ),
  );

  // Convert string ids to ObjectId, so the Mongo driver types are happy
  const householdObjectIds = householdIds
    .map((id) => toMaybeObjectId(id))
    .filter((id): id is ObjectId => !!id);

  const householdDocs = householdObjectIds.length
    ? await householdsCol
        .find({ _id: { $in: householdObjectIds } })
        .toArray()
    : [];


  const householdNameById = new Map<string, string | null>();
  for (const hh of householdDocs) {
    const key = toStringId(hh._id);
    const name = (hh.displayName as string | undefined) ?? null;
    householdNameById.set(key, name);
  }

  /* ---------------- Hydrate inviter info ---------------- */

  const creatorIds = Array.from(
    new Set(
      filtered
        .map((r: any) => (r.createdBy ? toStringId(r.createdBy) : null))
        .filter(Boolean) as string[],
    ),
  );

  const userDocs = creatorIds.length
    ? await usersCol
        .find({
          $or: creatorIds.map((uid) => {
            const obj = toMaybeObjectId(uid);
            return obj ? { _id: obj } : ({ _id: uid } as any);
          }),
        })
        .toArray()
    : [];

  const inviterById = new Map<
    string,
    { email: string | null; preferredName: string | null }
  >();
  for (const u of userDocs) {
    const key = toStringId(u._id);
    const email = (u.email as string | undefined) ?? null;
    const preferredName = (u.preferredName as string | undefined) ?? null;
    inviterById.set(key, { email, preferredName });
  }

  /* ---------------- Shape response ---------------- */

  const invites = filtered.map((r: any) => {
    const hid = toStringId(r.householdId);
    const householdName = householdNameById.get(hid) ?? null;

    const creatorId = r.createdBy ? toStringId(r.createdBy) : null;
    const inviter = creatorId ? inviterById.get(creatorId) : undefined;

    return {
      id: toStringId(r._id),
      householdId: hid,
      householdName,
      role: (r.role || "co_applicant") as MemberRole,
      createdAt:
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : new Date(r.createdAt ?? Date.now()).toISOString(),
      expiresAt:
        r.expiresAt instanceof Date
          ? r.expiresAt.toISOString()
          : new Date(r.expiresAt ?? Date.now()).toISOString(),

      // NEW: who invited me?
      inviterEmail: inviter?.email ?? null,
      inviterName: inviter?.preferredName ?? null,

      // NOTE: we intentionally do NOT return the invite code here,
      // because only the hash is stored (codeHash) and SHA-256 is one-way.
      // The user can still join via the secure link in their email.
    };
  });

  return NextResponse.json({ ok: true, invites });
}