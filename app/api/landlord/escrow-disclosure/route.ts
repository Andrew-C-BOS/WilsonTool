// app/api/landlord/escrow-disclosure/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { ObjectId } from "mongodb";
import { resolveAdminFirmForUser } from "@/app/api/stripe/connect/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Debug helper — logs only when ?debug=1 */
function logDebug(debug: boolean, label: string, data?: any) {
  if (debug) {
    console.log(
      `[escrow-disclosure] ${label}`,
      JSON.stringify(data, null, 2)
    );
  }
}

/* ---------- tiny utils ---------- */
function onlyDigits(s: any): string {
  return String(s ?? "").replace(/\D/g, "");
}
function last4(s: string): string {
  const d = onlyDigits(s);
  return d.slice(-4);
}
/** Normalize interest: prefer hundredths (int). Map from percent if legacy provided. */
function toHundredths(raw: any): number | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  // If a decimal like 2.5 or 5 was sent, assume it's PERCENT and convert.
  // If an integer >= 20, assume it's already hundredths (e.g., 250, 500).
  // If an integer < 20 with no decimals, assume percent (5 => 500).
  if (String(raw).includes(".")) return Math.round(n * 100); // 2.5 => 250
  if (Number.isInteger(n)) {
    return n >= 20 ? n : n * 100; // 5 => 500, 250 => 250
  }
  return Math.round(n * 100);
}
/** Validate full account number length – allow 5..34 digits */
function isPlausibleAcctLength(d: string): boolean {
  const len = d.length;
  return len >= 5 && len <= 34;
}

/* =======================================================================
 * GET /api/landlord/escrow-disclosure
 * =======================================================================
 */
export async function GET(req: Request) {
  const debug = new URL(req.url).searchParams.get("debug") === "1";
  const debugTrace: Record<string, any> = { step: "init", debug };

  try {
    const user = await getSessionUser();
    debugTrace.user = user;
    if (!user) {
      logDebug(debug, "no_user");
      return NextResponse.json(
        { ok: false, error: "not_authenticated", debugTrace },
        { status: 401 }
      );
    }

    let firmCtx: { firmId: string; role: string };
    try {
      firmCtx = await resolveAdminFirmForUser(user);
      debugTrace.firmCtx = firmCtx;
    } catch (e: any) {
      logDebug(debug, "resolve_failed", e);
      return NextResponse.json(
        {
          ok: false,
          error: e?.message || "resolve_firm_failed",
          ...(e?.data && { details: e.data }),
          debugTrace,
        },
        { status: e?.status ?? 400 }
      );
    }

    const db = await getDb();
    const firms = db.collection<any>("firms");
    const filter: { _id: any } = ObjectId.isValid(firmCtx.firmId)
      ? { _id: new ObjectId(firmCtx.firmId) }
      : { _id: firmCtx.firmId };

    logDebug(debug, "mongo_filter", filter);

    const doc = await firms.findOne(filter, {
      projection: { escrowDisclosure: 1 },
    });
    debugTrace.mongoDoc = doc;

    if (!doc?.escrowDisclosure) {
      logDebug(debug, "no_disclosure");
      // 200 with explicit "empty" so UI can render blank form
      return NextResponse.json({
        ok: true,
        empty: true,
        disclosure: null,
        debugTrace,
      });
    }

    // Normalize legacy → new shape for response
    const d = doc.escrowDisclosure || {};
    const normalized = {
      bankName: String(d.bankName ?? ""),
      accountType: String(
        d.accountType ?? "Interest-bearing escrow"
      ),
      accountIdentifier: onlyDigits(d.accountIdentifier ?? ""), // may be ""
      accountLast4: last4(d.accountIdentifier ?? d.accountLast4 ?? ""),
      bankAddress: String(d.bankAddress ?? ""),
      // legacy interestRate (percent) → hundredths
      interestHundredths:
        d.interestHundredths !== undefined
          ? Number(d.interestHundredths)
          : toHundredths(d.interestRate),
    };

    logDebug(debug, "success", normalized);
    return NextResponse.json({
      ok: true,
      disclosure: normalized,
      debugTrace,
    });
  } catch (err: any) {
    logDebug(true, "unhandled", err);
    return NextResponse.json(
      {
        ok: false,
        error: "unhandled_error",
        message: err?.message || "unknown",
        stack: err?.stack,
      },
      { status: 500 }
    );
  }
}

/* =======================================================================
 * POST /api/landlord/escrow-disclosure
 * Body (new, preferred):
 * {
 *   bankName: string,
 *   accountType: string,
 *   accountIdentifier: string (full digits),
 *   bankAddress: string,
 *   interestHundredths?: number
 * }
 * Back-compat accepted:
 *   accountLast4 (ignored if accountIdentifier present),
 *   interestRate (percent) → mapped to interestHundredths
 * =======================================================================
 */
export async function POST(req: Request) {
  const debug = new URL(req.url).searchParams.get("debug") === "1";
  const debugTrace: Record<string, any> = { step: "init", debug };

  try {
    const user = await getSessionUser();
    debugTrace.user = user;
    if (!user) {
      logDebug(debug, "no_user");
      return NextResponse.json(
        { ok: false, error: "not_authenticated", debugTrace },
        { status: 401 }
      );
    }

    let firmCtx: { firmId: string; role: string };
    try {
      firmCtx = await resolveAdminFirmForUser(user);
      debugTrace.firmCtx = firmCtx;
    } catch (e: any) {
      logDebug(debug, "resolve_failed", e);
      return NextResponse.json(
        {
          ok: false,
          error: e?.message || "resolve_firm_failed",
          ...(e?.data && { details: e.data }),
          debugTrace,
        },
        { status: e?.status ?? 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    debugTrace.body = body;

    // Prefer full account number; accept legacy last4 only (but warn)
    const rawFull = onlyDigits(body.accountIdentifier);
    const derivedLast4 = last4(
      rawFull || body.accountLast4 || ""
    );

    const interestHundredths =
      body.interestHundredths !== undefined
        ? Number(body.interestHundredths)
        : toHundredths(body.interestRate);

    const disclosure = {
      bankName: String(body.bankName || "").trim(),
      accountType: String(body.accountType || "").trim(),
      accountIdentifier: rawFull, // store full digits (consider encrypting at-rest in your lib/db layer)
      accountLast4: derivedLast4, // convenience, redundant but handy for quick UI
      bankAddress: String(body.bankAddress || "").trim(),
      interestHundredths:
        interestHundredths === undefined
          ? undefined
          : Number(interestHundredths),
    };
    debugTrace.parsedDisclosure = disclosure;

    // Validation
    if (!disclosure.bankName) {
      return NextResponse.json(
        { ok: false, error: "bankName_required", debugTrace },
        { status: 400 }
      );
    }
    if (!disclosure.accountType) {
      return NextResponse.json(
        { ok: false, error: "accountType_required", debugTrace },
        { status: 400 }
      );
    }
    if (!disclosure.bankAddress) {
      return NextResponse.json(
        { ok: false, error: "bankAddress_required", debugTrace },
        { status: 400 }
      );
    }

    // Require full account number; allow legacy last4-only, but flag with specific error
    if (!disclosure.accountIdentifier) {
      return NextResponse.json(
        {
          ok: false,
          error: "accountIdentifier_required_full_digits",
          debugTrace,
        },
        { status: 400 }
      );
    }
    if (
      !isPlausibleAcctLength(disclosure.accountIdentifier)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "accountIdentifier_invalid_length",
          debugTrace,
        },
        { status: 400 }
      );
    }
    if (!/^\d{4}$/.test(disclosure.accountLast4)) {
      return NextResponse.json(
        {
          ok: false,
          error: "accountLast4_invalid",
          debugTrace,
        },
        { status: 400 }
      );
    }

    if (disclosure.interestHundredths !== undefined) {
      const n = Number(disclosure.interestHundredths);
      if (!Number.isInteger(n) || n < 0 || n > 5000) {
        // Keep range sane (0.00%..50.00%); adjust if needed
        return NextResponse.json(
          {
            ok: false,
            error: "interestHundredths_out_of_range",
            debugTrace,
          },
          { status: 400 }
        );
      }
    }

    const db = await getDb();
    const firms = db.collection<any>("firms");
    const filter: { _id: any } = ObjectId.isValid(
      firmCtx.firmId
    )
      ? { _id: new ObjectId(firmCtx.firmId) }
      : { _id: firmCtx.firmId };

    logDebug(debug, "mongo_filter", filter);

    // Persist normalized shape
    const toSave = {
      bankName: disclosure.bankName,
      accountType: disclosure.accountType,
      accountIdentifier: disclosure.accountIdentifier,
      accountLast4: disclosure.accountLast4,
      bankAddress: disclosure.bankAddress,
      interestHundredths: disclosure.interestHundredths,
    };

    await firms.updateOne(filter, {
      $set: { escrowDisclosure: toSave, updatedAt: new Date() },
    });

    logDebug(debug, "update_success");
    // Echo normalized disclosure so the UI updates immediately
    return NextResponse.json({
      ok: true,
      disclosure: toSave,
      debugTrace,
    });
  } catch (err: any) {
    logDebug(true, "unhandled", err);
    return NextResponse.json(
      {
        ok: false,
        error: "unhandled_error",
        message: err?.message || "unknown",
        stack: err?.stack,
      },
      { status: 500 }
    );
  }
}
