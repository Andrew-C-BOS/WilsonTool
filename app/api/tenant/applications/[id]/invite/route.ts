// app/api/tenant/applications/[id]/invite/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { ObjectId, type Filter } from "mongodb";
import { randomBytes } from "crypto";

/* ------------------------------------------
   Logging helper
------------------------------------------- */
function log(scope: string, data: Record<string, any>) {
  const ts = new Date().toISOString();
  try {
    // eslint-disable-next-line no-console
    console.log(`[invite] ${ts} ${scope}:`, JSON.stringify(data));
  } catch {
    // eslint-disable-next-line no-console
    console.log(`[invite] ${ts} ${scope}:`, data);
  }
}

/* ------------------------------------------
   Utilities
------------------------------------------- */
function asHexId(x: any): string | undefined {
  if (!x) return undefined;
  if (x instanceof ObjectId) return x.toHexString();
  if (typeof x === "object" && (x as any).$oid) return String((x as any).$oid);
  try {
    const s = String(x);
    return s || undefined;
  } catch {
    return undefined;
  }
}

/** Match doc by either ObjectId(_id) or string _id, covers both schemas */
function dualIdFilter(id: string): Filter<any> {
  if (ObjectId.isValid(id)) {
    const oid = new ObjectId(id);
    // Use $or instead of $in so TS doesn’t require readonly ObjectId[]
    return { $or: [{ _id: oid }, { _id: id }] } as any;
  }
  return { _id: id } as any;
}

function normalizeEmail(e?: string | null): string {
  if (!e) return "";
  let s = e.trim().toLowerCase();
  let [local, domain] = s.split("@");
  if (!domain) return s;
  if (domain === "googlemail.com") domain = "gmail.com";
  const baseLocal = local.split("+")[0];
  local = domain === "gmail.com" ? baseLocal.replace(/\./g, "") : baseLocal;
  return `${local}@${domain}`;
}
function sameEmail(a?: string | null, b?: string | null) {
  const A = normalizeEmail(a);
  const B = normalizeEmail(b);
  return !!A && !!B && A === B;
}

function makeCode(len = 8) {
  return randomBytes(16)
    .toString("base64")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, len)
    .toLowerCase();
}

function requestOrigin(req: NextRequest) {
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

/* ------------------------------------------
   POST /api/tenant/applications/[id]/invite
   ⚠️ params is a Promise in Next 15+, await it
------------------------------------------- */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> } // <- Promise here (Next 15)
) {
  const { searchParams } = new URL(req.url);
  const debug = searchParams.get("debug") === "1";

  // Unwrap dynamic params
  const { id: idParam } = await ctx.params;

  log("incoming", { method: "POST", url: req.url, appIdParam: idParam, debug });

  const user = await getSessionUser();
  if (!user) {
    log("auth", { ok: false, reason: "not_authenticated" });
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  // Who we think you are
  const meIdRaw = (user as any)._id;
  const meId = asHexId(meIdRaw);
  const meEmailRaw = (user as any).email ? String((user as any).email) : undefined;
  const meEmailNorm = normalizeEmail(meEmailRaw);

  log("session_user", {
    userId_raw: meIdRaw,
    userId: meId,
    email_raw: meEmailRaw,
    email_norm: meEmailNorm,
    role: (user as any).role,
    isAdmin: (user as any).isAdmin,
  });

  const body = await req.json().catch(() => ({}));
  const role: "co_applicant" | "cosigner" =
    body?.role === "cosigner" ? "cosigner" : "co_applicant";

  const db = await getDb();

  // Load application by either ObjectId or string id
  const app = await db
    .collection("applications")
    .findOne(dualIdFilter(idParam), {
      projection: { _id: 1, formId: 1, members: 1, status: 1 },
    });

  if (!app) {
    log("load_app", { ok: false, reason: "not_found", appIdParam: idParam });
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const appIdStr = asHexId(app._id) || String(app._id);
  const formIdStr = asHexId(app.formId) || String(app.formId);

  log("load_app", {
    ok: true,
    appId: appIdStr,
    formId: formIdStr,
    status: app.status,
    members_count: Array.isArray(app.members) ? app.members.length : 0,
  });

  // Snapshot members for logs
  const memberSnapshot = (Array.isArray(app.members) ? app.members : []).map((m: any) => ({
    userId_raw: m?.userId,
    userId: asHexId(m?.userId),
    email_raw: m?.email ?? "",
    email_norm: normalizeEmail(m?.email ?? ""),
    role: m?.role ?? "",
    state: m?.state ?? "",
  }));
  log("members_snapshot", { members: memberSnapshot });

  // Inviter must be in the household, match by id OR normalized email
  let inviterIsMember = false;
  const comparisons: Array<{ byId: boolean; byEmail: boolean; member: any }> = [];

  if (Array.isArray(app.members)) {
    for (const m of app.members) {
      const mid = asHexId(m?.userId);
      const byId = !!(mid && meId && mid === meId);
      const byEmail = sameEmail(m?.email, meEmailRaw);
      comparisons.push({
        byId,
        byEmail,
        member: { userId: mid, email_norm: normalizeEmail(m?.email || "") },
      });
      if (byId || byEmail) {
        inviterIsMember = true;
        break;
      }
    }
  }

  log("membership_check", { inviterIsMember, meId, meEmail_norm: meEmailNorm, comparisons });

  if (!inviterIsMember) {
    const payload = { ok: false as const, error: "forbidden" as const };
    if (debug) {
      const headers = new Headers();
      headers.set("x-debug-user-id", meId || "");
      headers.set("x-debug-user-email", meEmailNorm || "");
      return NextResponse.json({ ...payload, debug: { meId, meEmailNorm, comparisons } }, { status: 403, headers });
    }
    return NextResponse.json(payload, { status: 403 });
  }

  // Create or reuse an active invite for this inviter+role+app
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const code = makeCode(8);
  const invitedBy = meId || meEmailNorm || "unknown";

  const upsertRes = await db.collection("app_invites").updateOne(
    { appId: appIdStr, invitedBy, role, status: "active" },
    {
      $setOnInsert: {
        code,
        appId: appIdStr,
        formId: formIdStr,
        invitedBy,
        role,
        status: "active",
        createdAt: now,
        expiresAt,
      },
    },
    { upsert: true }
  );

  let effectiveCode = code;
  if (!upsertRes.upsertedId) {
    const existing = await db.collection("app_invites").findOne(
      { appId: appIdStr, invitedBy, role, status: "active" },
      { projection: { code: 1, expiresAt: 1 } }
    );
    if (existing?.code) effectiveCode = existing.code;
  }

  const origin = requestOrigin(req);
  const url = new URL("/tenant/apply", origin);
  url.searchParams.set("form", formIdStr);
  url.searchParams.set("hh", appIdStr);
  url.searchParams.set("invite", effectiveCode);

  log("invite_created", {
    appId: appIdStr,
    formId: formIdStr,
    invitedBy,
    role,
    code: effectiveCode,
    expiresAt: expiresAt.toISOString(),
    url: url.toString(),
  });

  if (debug) {
    const headers = new Headers();
    headers.set("x-debug-user-id", meId || "");
    headers.set("x-debug-user-email", meEmailNorm || "");
    headers.set("x-debug-app-id", appIdStr || "");
    return NextResponse.json(
      { ok: true, url: url.toString(), code: effectiveCode, debug: { meId, meEmailNorm, appId: appIdStr } },
      { headers }
    );
  }

  return NextResponse.json({ ok: true, url: url.toString(), code: effectiveCode });
}
