// app/api/tenant/household/invites/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import crypto from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MemberRole = "primary" | "co_applicant" | "cosigner";

/* ---------- utils ---------- */
function base64url(nBytes = 16): string {
  return crypto.randomBytes(nBytes).toString("base64url");
}
function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}
function toStringId(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (v instanceof ObjectId) return v.toHexString();
  return String(v);
}
function toMaybeObjectId(s: string): ObjectId | null {
  return ObjectId.isValid(s) ? new ObjectId(s) : null;
}
const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;

/* Try all likely membership collection names, return the first that exists. */
async function getMembershipsCol(db: any) {
  const candidates = [
    "household_memberhsips",   // original typo you referenced earlier
    "households_memberhsips",  // plural households + same typo
    "household_memberships",   // corrected spelling
    "households_memberships",  // plural + corrected
    "households_membership",   // matches your latest sample exactly
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

/* ─────────────────────────────────────────────────────────────
   Hardened resolver: finds the caller’s membership, optionally
   constrained to a householdId. Searches:
     - memberships collection (using detected name)
     - households.members (legacy)
   Prefers active rows when multiple exist.
───────────────────────────────────────────────────────────── */
async function resolveMyMembership(opts: {
  db: any;
  user: any;
  householdId?: string | null;
}) {
  const membershipsCol = await getMembershipsCol(opts.db);
  const householdsCol = opts.db.collection("households");

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

  const pickBest = (rows: any[]) =>
    rows.sort(
      (a, b) =>
        Number(!!b.active) - Number(!!a.active) ||
        new Date(b.joinedAt ?? 0).getTime() - new Date(a.joinedAt ?? 0).getTime()
    )[0] ?? null;

  // If explicit householdId provided, check there first
  if (opts.householdId) {
    const hidStr = String(opts.householdId);
    const hidObj = toMaybeObjectId(hidStr);

    // 1) direct membership rows (don’t require active to *find*)
    const directRows = await membershipsCol
      .find({
        $and: [
          { $or: [{ householdId: hidStr }, ...(hidObj ? [{ householdId: hidObj as any }] : [])] },
          { $or: orIdentity },
        ],
      })
      .toArray();

    if (directRows.length) {
      return {
        membership: pickBest(directRows),
        source: "memberships_direct",
        identityDebug: {
          primaryEmail,
          emailAliases,
          rawUserId,
          asObj: uidObj ? uidObj.toHexString() : null,
          householdIdTried: [hidStr, hidObj?.toHexString() ?? null].filter(Boolean),
          colName: membershipsCol.collectionName,
        },
      };
    }

    // 2) legacy households.members array
    const hh = await householdsCol.findOne({
      _id: (hidObj ?? (hidStr as any)),
      $or: [
        { "members.userId": rawUserId },
        ...(uidObj ? [{ "members.userId": uidObj as any }] : []),
        { "members.email": primaryEmail },
        ...emailAliases.map((e) => ({ "members.email": e })),
      ],
    });

    if (hh) {
      const m =
        (hh.members ?? []).find(
          (m: any) =>
            m.userId === rawUserId ||
            (uidObj && (m.userId?.toString?.() ?? "") === uidObj.toHexString()) ||
            String(m.email ?? "").toLowerCase() === primaryEmail ||
            emailAliases.includes(String(m.email ?? "").toLowerCase())
        ) ?? {};
      return {
        membership: { ...m, householdId: hidStr, active: m.active ?? true },
        source: "households_members",
        identityDebug: {
          primaryEmail,
          emailAliases,
          rawUserId,
          asObj: uidObj ? uidObj.toHexString() : null,
          householdIdTried: [hidStr, hidObj?.toHexString() ?? null].filter(Boolean),
          colName: membershipsCol.collectionName,
        },
      };
    }
  }

  // No explicit household: any membership rows for this identity
  const anyRows = await membershipsCol.find({ $or: orIdentity }).toArray();
  if (anyRows.length) {
    return {
      membership: pickBest(anyRows),
      source: "memberships_any",
      identityDebug: {
        primaryEmail,
        emailAliases,
        rawUserId,
        asObj: uidObj ? uidObj.toHexString() : null,
        colName: membershipsCol.collectionName,
      },
    };
  }

  // Fallback: scan households.members
  const hh = await householdsCol.findOne({
    $or: [
      { "members.userId": rawUserId },
      ...(uidObj ? [{ "members.userId": uidObj as any }] : []),
      { "members.email": primaryEmail },
      ...emailAliases.map((e) => ({ "members.email": e })),
    ],
  });

  if (hh) {
    const m =
      (hh.members ?? []).find(
        (m: any) =>
          m.userId === rawUserId ||
          (uidObj && (m.userId?.toString?.() ?? "") === uidObj.toHexString()) ||
          String(m.email ?? "").toLowerCase() === primaryEmail ||
          emailAliases.includes(String(m.email ?? "").toLowerCase())
      ) ?? {};
    return {
      membership: { ...m, householdId: String(hh._id), active: m.active ?? true },
      source: "households_any",
      identityDebug: {
        primaryEmail,
        emailAliases,
        rawUserId,
        asObj: uidObj ? uidObj.toHexString() : null,
        colName: membershipsCol.collectionName,
      },
    };
  }

  return {
    membership: null,
    source: "none",
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
   GET /api/tenant/household/invites?me=1[&householdId=...]
============================================================ */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const url = new URL(req.url);
  if (!url.searchParams.get("me")) {
    return NextResponse.json({ ok: false, error: "unsupported_query" }, { status: 400 });
  }

  const db = await getDb();
  const invitesCol = db.collection("household_invites");

  const householdIdParam = url.searchParams.get("householdId");
  const { membership } = await resolveMyMembership({ db, user, householdId: householdIdParam });

  if (!membership) {
    return NextResponse.json({ ok: true, invites: [] });
  }

  const householdIdStr = toStringId(membership.householdId);
  const now = new Date();

  const rows = await invitesCol
    .find({
      householdId: householdIdStr,
      state: "active",
      expiresAt: { $gt: now },
    })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();

  const origin = new URL(req.url).origin;

  const invites = rows.map((r: any) => ({
    id: String(r._id),
    email: r.email,
    role: r.role as MemberRole,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    state: r.state,
    inviteUrlTemplate: `${origin}/join/<code>`,
  }));

  return NextResponse.json({ ok: true, invites });
}

/* ============================================================
   POST /api/tenant/household/invites
   Body: { email: string, role?: MemberRole, householdId?: string }
============================================================ */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const db = await getDb();
  const invitesCol = db.collection("household_invites");

  const body = await req.json().catch(() => null);
  const emailRaw = String(body?.email ?? "").trim();
  const role: MemberRole = (body?.role as MemberRole) ?? "co_applicant";
  const householdIdParam = body?.householdId ? String(body.householdId) : null;

  if (!emailRaw) {
    return NextResponse.json({ ok: false, error: "missing_email" }, { status: 400 });
  }
  const email = emailRaw.toLowerCase();

  const { membership, identityDebug } = await resolveMyMembership({
    db,
    user,
    householdId: householdIdParam,
  });

  if (!membership) {
    return NextResponse.json(
      { ok: false, error: "no_household", debug: identityDebug },
      { status: 400 }
    );
  }

  const householdIdStr = toStringId(membership.householdId);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + FIFTEEN_DAYS_MS);

  // idempotency hint (we still generate a fresh code for UX)
  const existing = await invitesCol.findOne({
    householdId: householdIdStr,
    email,
    state: "active",
    expiresAt: { $gt: now },
  });

  const origin = new URL(req.url).origin;

  // Generate + store a new code (hash only)
  const code = base64url(24);
  const codeHash = sha256Hex(code);

  const doc = {
    householdId: householdIdStr,
    email,
    role,
    codeHash,
    createdAt: now,
    createdBy: identityDebug.rawUserId,
    expiresAt,
    state: "active" as const,
  };

  const ins = await invitesCol.insertOne(doc as any);

  const inviteUrl = `${origin}/join/${encodeURIComponent(code)}`;
  return NextResponse.json({
    ok: true,
    invite: {
      id: String(ins.insertedId),
      email,
      role,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      code,
      inviteUrl,
      reused: Boolean(existing),
    },
  });
}
