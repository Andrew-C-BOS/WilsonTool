// app/api/join/lookup/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { createHash } from "crypto";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sha256(s: string) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
function maskEmail(e: string) {
  const [u, d] = String(e).split("@");
  if (!d) return e;
  const head = u.slice(0, 2);
  return `${head}${u.length > 2 ? "…" : ""}@${d}`;
}
function toMaybeObjectId(v: any): ObjectId | null {
  try {
    return ObjectId.isValid(v) ? new ObjectId(v) : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code") || "";
    if (!code) return json({ ok: false, error: "missing_code" }, 400);

    const db = await getDb();
    const invites = db.collection("household_invites");
    const codeHash = sha256(code);

    const inv = await invites.findOne({ codeHash });
    if (!inv) return json({ ok: false, error: "invalid_or_used" }, 404);

    const now = new Date();
    let status: "active" | "expired" | "redeemed" = "active";

    if (inv.state !== "active") status = "redeemed";
    if (inv.expiresAt && new Date(inv.expiresAt) < now) status = "expired";

    // early exit on inactive if you want:
    // if (status !== "active") return json({ ok: false, error: status }, 410/409/...);

    // household label
    let householdLine: string | null = null;
    try {
      const households = db.collection("households");
      const oid = toMaybeObjectId(inv.householdId);
      const hh =
        (oid && (await households.findOne({ _id: oid }))) ||
        (await households.findOne({ _id: inv.householdId as any }));
      householdLine = (hh?.displayName as string | null) ?? null;
    } catch {}

    // session
    const user = await getSessionUser();
    const sessionEmail = user?.email ?? null;

    // compute match
    let match: InviteMatch;
    if (!user) {
      match = "anon";
    } else {
      // if you can, check if user is already in that household
      const alreadyMember = false; // TODO: query household membership
      if (alreadyMember) {
        match = "already_member";
      } else if (
        sessionEmail &&
        String(sessionEmail).toLowerCase() === String(inv.email).toLowerCase()
      ) {
        match = "email_match";
      } else {
        match = "email_mismatch";
      }
    }

    return NextResponse.json({
      ok: true,
      invite: {
        emailMasked: maskEmail(String(inv.email || "")),
        emailRaw: String(inv.email || ""),
        role: (inv.role as "primary" | "co_applicant" | "cosigner") || "co_applicant",
        householdLine,
        expiresAtISO: new Date(inv.expiresAt || now).toISOString(),
        status,
        isLoggedIn: !!user,
        sessionEmail,
        match,
      } satisfies InviteMeta,
    });
  } catch (e) {
    console.error("[join.lookup] error", e);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}