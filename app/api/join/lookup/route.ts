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
    if (!code) {
      return NextResponse.json({ ok: false, error: "missing_code" }, { status: 400 });
    }

    const db = await getDb();
    const invites = db.collection("household_invites");
    const codeHash = sha256(code);

    const inv = await invites.findOne({ codeHash, state: "active" as const });
    if (!inv) return NextResponse.json({ ok: false, error: "invalid_or_used" }, { status: 404 });

    const now = new Date();
    if (inv.expiresAt && new Date(inv.expiresAt) < now) {
      return NextResponse.json({ ok: false, error: "expired" }, { status: 410 });
    }

    // Optional: show a household display line if present
    let householdLine: string | null = null;
    try {
      const households = db.collection("households");
      // householdId may be string or ObjectId
      const oid = toMaybeObjectId(inv.householdId);
      const hh =
        (oid && (await households.findOne({ _id: oid }))) ||
        (await households.findOne({ _id: inv.householdId as any }));
      householdLine = (hh?.displayName as string | null) ?? null;
    } catch {
      // ignore
    }

    const user = await getSessionUser();
    return NextResponse.json({
      ok: true,
      invite: {
        emailMasked: maskEmail(String(inv.email || "")),
        role: (inv.role as "primary" | "co_applicant" | "cosigner") || "co_applicant",
        householdLine,
        expiresAtISO: new Date(inv.expiresAt || now).toISOString(),
        isLoggedIn: !!user,
      },
    });
  } catch (e) {
    console.error("[join.lookup] error", e);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
