// app/api/tenant/household/invites/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import crypto from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { sendMail } from "@/lib/mailer";

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
function maskEmail(e: string) {
  const [u, d] = String(e).split("@");
  if (!d) return e;
  const head = u.slice(0, 2);
  return `${head}${u.length > 2 ? "…" : ""}@${d}`;
}
const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;

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

/* Hardened resolver, finds the caller’s membership */
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

  if (opts.householdId) {
    const hidStr = String(opts.householdId);
    const hidObj = toMaybeObjectId(hidStr);

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

/* ---------- invite email (simple, branded) ---------- */
function renderInviteEmail(opts: {
  brand?: string;
  toDisplay?: string;
  inviterDisplay?: string;
  householdDisplay?: string | null;
  inviteUrl: string;
  expiresAt: Date;
}) {
  const brand = opts.brand ?? "MILO";
  const subject = `${brand} invitation to join a household`;
  const niceExpires = opts.expiresAt.toLocaleString();
  const who = opts.inviterDisplay ? ` from ${opts.inviterDisplay}` : "";
  const hh = opts.householdDisplay ? ` for “${opts.householdDisplay}”` : "";

  const text =
`${brand} invitation${who}${hh}

You’ve been invited to join a household${hh}.
Click this link to accept:
${opts.inviteUrl}

This link expires on ${niceExpires}.
If you didn’t expect this, you can ignore this email.`;

  const html = `<!doctype html>
<html>
  <body style="font-family: system-ui,-apple-system,Segoe UI,Roboto,Arial; background:#f8fafc; padding:24px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:12px">
      <tr><td style="padding:24px">
        <h1 style="font-size:18px; margin:0 0 8px; color:#111827;">${brand} invitation${who}${hh}</h1>
        <p style="font-size:14px; color:#374151; margin:0 0 16px;">
          You’ve been invited to join a household${hh}.
        </p>
        <p style="margin:16px 0;">
          <a href="${opts.inviteUrl}" style="display:inline-block; padding:10px 14px; border-radius:10px; border:1px solid #0f172a; text-decoration:none; font-weight:700; color:#ffffff; background:#0f172a;">
            Accept invitation
          </a>
        </p>
        <p style="font-size:12px; color:#6b7280; margin:16px 0 0;">
          This link expires on ${niceExpires}.
        </p>
      </td></tr>
    </table>
    <p style="text-align:center; font-size:12px; color:#9ca3af; margin-top:16px;">${brand}</p>
  </body>
</html>`;

  return { subject, text, html };
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
   Creates the invite, emails the recipient with the link.
============================================================ */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const db = await getDb();
  const invitesCol = db.collection("household_invites");
  const householdsCol = db.collection("households");

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

  // Optional: pull a display name for the household
  let householdDisplay: string | null = null;
  try {
    const hidObj = toMaybeObjectId(householdIdStr);
    const hh =
      (hidObj && (await householdsCol.findOne({ _id: hidObj }))) ||
      (await householdsCol.findOne({ _id: householdIdStr as any }));
    householdDisplay = (hh?.displayName as string | undefined) ?? null;
  } catch {
    // ignore
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + FIFTEEN_DAYS_MS);

  // Generate + store a new code (hash only)
  const code = base64url(24);
  const codeHash = sha256Hex(code);

  const origin = new URL(req.url).origin;

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

  // ---- Send the invitation email (non-blocking for creation, but we report status) ----
  const traceId = crypto.randomBytes(8).toString("hex");
  const inviterDisplay =
    (user as any)?.preferredName ||
    (user as any)?.name ||
    (user as any)?.email ||
    "a MILO user";

  const { subject, text, html } = renderInviteEmail({
    brand: "MILO",
    inviterDisplay,
    householdDisplay,
    toDisplay: email,
    inviteUrl,
    expiresAt,
  });

  // Log attempt
  console.log("[invite.email] send_attempt", {
    traceId,
    to: maskEmail(email),
    inviteId: String(ins.insertedId),
    householdId: householdIdStr,
    role,
    region: process.env.AWS_REGION,
    provider: (process.env.MAIL_PROVIDER || "console").toLowerCase(),
    from: process.env.MAIL_FROM,
    usingEmailKeys: !!process.env.AWS_EMAIL_ACCESS_KEY_ID,
  });

  const mail = await sendMail({
    to: email,
    subject,
    text,
    html,
    idempotencyKey: `invite:${String(ins.insertedId)}`,
    traceId,
  });

  if (!mail.ok) {
    console.error("[invite.email] send_failed", {
      traceId,
      to: maskEmail(email),
      inviteId: String(ins.insertedId),
      error: mail.error,
    });
  } else {
    console.log("[invite.email] send_ok", {
      traceId,
      to: maskEmail(email),
      inviteId: String(ins.insertedId),
    });
  }

  return NextResponse.json({
    ok: true,
    invite: {
      id: String(ins.insertedId),
      email,
      role,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      inviteUrl,
    },
    email: {
      sent: mail.ok,
      ...(mail.ok ? {} : { error: mail.error }),
    },
  });
}
