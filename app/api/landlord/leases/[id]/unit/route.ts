// app/api/landlord/leases/[id]/unit/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import type { ObjectId } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ────────── types (keep the Mongo driver happy) ────────── */
type IdLike = string | ObjectId;

type TimelineEvent = {
  at: Date;
  by: string;
  event: string;
  meta?: Record<string, unknown>;
};

type Upfronts = {
  first?: number;    // cents
  last?: number;     // cents
  security?: number; // cents
  key?: number;      // cents
};

type ApplicationDoc = {
  _id: IdLike;
  formId: IdLike;
  firmId?: IdLike;
  timeline?: TimelineEvent[];
  // new fields we’ll set
  building?: {
    addressLine1: string;
    addressLine2?: string | null;
    city: string;
    state: string;
    postalCode: string;
    country?: string;
  };
  unit?: {
    unitNumber?: string | null;
    beds?: number;
    baths?: number;
    sqft?: number | null;
    petsAllowed?: boolean;
    parkingSpaces?: number;
  };
  protoLease?: {
    monthlyRent: number;        // cents
    termMonths?: number | null; // e.g., 12
    moveInDate?: string | null; // ISO yyyy-mm-dd
  };
  upfronts?: Upfronts; // <<< NEW: where first/last/security/key live
};

type ApplicationFormDoc = { _id: IdLike; firmId: IdLike };
type FirmMembershipDoc = {
  _id: IdLike;
  firmId: string;
  userId?: IdLike;
  email?: string;
  role?: "member" | "admin" | "owner";
  active: boolean;
};

/* ────────── helpers ────────── */
function toStringId(v: any) {
  if (!v) return "";
  if (typeof v === "string") return v;
  try {
    return v?.toHexString ? v.toHexString() : String(v);
  } catch {
    return String(v);
  }
}
function isHex24(s: string) {
  return /^[0-9a-fA-F]{24}$/.test(s);
}
async function getParamsId(
  req: NextRequest,
  ctx: { params?: { id: string } | Promise<{ id: string }> }
) {
  try {
    const p = await (ctx as any)?.params; // always await
    const raw = Array.isArray(p?.id) ? p.id[0] : p?.id;
    if (raw) return String(raw);
  } catch {}
  const seg = (req.nextUrl?.pathname || "").split("/").filter(Boolean).pop();
  return seg || "";
}
function pickUserId(user: unknown): string {
  const u = user as any;
  return toStringId(
    u?._id ??
      u?.id ??
      u?.userId ??
      u?.sub ??
      u?.uid ??
      u?.email ??
      ""
  );
}
function isNonNegInt(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 0;
}
function toCentsSafe(n: unknown): number | null {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  const c = Math.round(x);
  return c >= 0 ? c : null;
}

/* ────────── POST /api/landlord/leases/[id]/unit ────────── */
export async function POST(
  req: NextRequest,
  ctx: { params: { id: string } } | { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  const db = await getDb();
  const { ObjectId } = await import("mongodb");

  const apps = db.collection<ApplicationDoc>("applications");
  const forms = db.collection<ApplicationFormDoc>("application_forms");
  const fms = db.collection<FirmMembershipDoc>("firm_memberships");

  const appId = await getParamsId(req, ctx as any);
  if (!appId) {
    return NextResponse.json({ ok: false, error: "bad_application_id" }, { status: 400 });
  }

  // Resolve application → form → firmId
  const appFilter = isHex24(appId) ? { _id: new ObjectId(appId) } : ({ _id: appId } as any);
  const app = await apps.findOne(appFilter, {
    projection: { _id: 1, formId: 1 },
  });
  if (!app) {
    return NextResponse.json({ ok: false, error: "application_not_found" }, { status: 404 });
  }

  const formKey = toStringId(app.formId);
  const form = await forms.findOne(
    isHex24(formKey) ? { _id: new ObjectId(formKey) } : ({ _id: formKey } as any),
    { projection: { firmId: 1 } }
  );
  if (!form?.firmId) {
    return NextResponse.json({ ok: false, error: "form_or_firm_missing" }, { status: 400 });
  }
  const firmId = String(form.firmId);

  // Firm auth
  const uidStr = pickUserId(user);
  const uidOid = ObjectId.isValid(uidStr) ? new ObjectId(uidStr) : null;
  const userIdOr = uidOid ? [{ userId: uidStr }, { userId: uidOid }] : [{ userId: uidStr }];

  const membership = await fms.findOne(
    { firmId, active: true, $or: userIdOr },
    { projection: { role: 1 } }
  );
  const role = String(membership?.role || "").toLowerCase() as
    | "member"
    | "admin"
    | "owner"
    | "";
  if (!role) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // Parse + light-validate body
  const body = (await req.json().catch(() => ({}))) as {
    building?: ApplicationDoc["building"];
    unit?: ApplicationDoc["unit"];
    lease?: {
      monthlyRent?: number;
      termMonths?: number | null;
      moveInDate?: string | null;
    };
    // accept any of these keys for upfronts
    amounts?: Upfronts;
    upfronts?: Upfronts;
    fees?: Upfronts;
  };

  const building = body?.building;
  const unit = body?.unit;

  // Prefer "amounts", then "upfronts", then "fees"
  const incomingUpfronts: Upfronts = {
    ...(body?.amounts ?? {}),
    ...(body?.upfronts ?? {}),
    ...(body?.fees ?? {}),
  };

  const lease = body?.lease;

  const errs: string[] = [];

  // Building (required by your UI)
  if (!building?.addressLine1) errs.push("addressLine1 required");
  if (!building?.city) errs.push("city required");
  if (!building?.state || String(building.state).length < 2) errs.push("state must be 2 letters");
  if (!building?.postalCode) errs.push("postalCode required");

  // Lease
  const monthlyRent = Number(lease?.monthlyRent ?? NaN);
  if (!Number.isFinite(monthlyRent) || monthlyRent <= 0) errs.push("monthlyRent (cents) must be > 0");
  const termMonths =
    lease?.termMonths == null ? null : Number.isFinite(lease.termMonths) ? Number(lease.termMonths) : NaN;
  if (termMonths !== null && (!Number.isFinite(termMonths) || termMonths <= 0))
    errs.push("termMonths must be a positive integer or null");

  // Unit (optional, but sanitize)
  const safeUnit: ApplicationDoc["unit"] = {
    unitNumber: unit?.unitNumber ?? null,
    beds: unit?.beds != null ? Math.max(0, Number(unit.beds) || 0) : undefined,
    baths: unit?.baths != null ? Math.max(0, Number(unit.baths) || 0) : undefined,
    sqft: unit?.sqft != null ? (Number(unit.sqft) || 0) : null,
    petsAllowed: !!unit?.petsAllowed,
    parkingSpaces: unit?.parkingSpaces != null ? Math.max(0, Number(unit.parkingSpaces) || 0) : undefined,
  };

  // Upfronts (optional) – sanitize to non-negative integer cents
  const rawFirst = incomingUpfronts.first ?? undefined;
  const rawLast = incomingUpfronts.last ?? undefined;
  const rawSec = incomingUpfronts.security ?? undefined;
  const rawKey = incomingUpfronts.key ?? undefined;

  const cleanUpfronts: Upfronts = {};
  if (rawFirst != null) {
    const v = toCentsSafe(rawFirst);
    if (v == null) errs.push("amounts.first must be a non-negative integer (cents)");
    else cleanUpfronts.first = v;
  }
  if (rawLast != null) {
    const v = toCentsSafe(rawLast);
    if (v == null) errs.push("amounts.last must be a non-negative integer (cents)");
    else cleanUpfronts.last = v;
  }
  if (rawSec != null) {
    const v = toCentsSafe(rawSec);
    if (v == null) errs.push("amounts.security must be a non-negative integer (cents)");
    else cleanUpfronts.security = v;
  }
  if (rawKey != null) {
    const v = toCentsSafe(rawKey);
    if (v == null) errs.push("amounts.key must be a non-negative integer (cents)");
    else cleanUpfronts.key = v;
  }

  // If monthlyRent is available, enforce MA cap-style rule on first/last/security
  if (Number.isFinite(monthlyRent) && monthlyRent > 0) {
    const cap = monthlyRent;
    if (cleanUpfronts.first != null && cleanUpfronts.first > cap) {
      errs.push(`amounts.first cannot exceed monthlyRent (${cap})`);
    }
    if (cleanUpfronts.last != null && cleanUpfronts.last > cap) {
      errs.push(`amounts.last cannot exceed monthlyRent (${cap})`);
    }
    if (cleanUpfronts.security != null && cleanUpfronts.security > cap) {
      errs.push(`amounts.security cannot exceed monthlyRent (${cap})`);
    }
    // key fee left uncapped here, but you can add policy later if desired
  }

  if (errs.length) {
    return NextResponse.json({ ok: false, error: "bad_request", details: errs }, { status: 400 });
  }

  const now = new Date();

  // Build the $set document
  const setDoc: Partial<ApplicationDoc> = {
    building: {
      addressLine1: building!.addressLine1,
      addressLine2: building!.addressLine2 ?? null,
      city: building!.city,
      state: String(building!.state).toUpperCase(),
      postalCode: building!.postalCode,
      country: building!.country ?? "US",
    },
    unit: safeUnit,
    protoLease: {
      monthlyRent,
      termMonths: termMonths ?? null,
      moveInDate: lease?.moveInDate ?? null,
    },
  };

  // Only include upfronts if at least one field was provided
  if (
    cleanUpfronts.first != null ||
    cleanUpfronts.last != null ||
    cleanUpfronts.security != null ||
    cleanUpfronts.key != null
  ) {
    setDoc.upfronts = {
      ...(cleanUpfronts.first != null ? { first: cleanUpfronts.first } : {}),
      ...(cleanUpfronts.last != null ? { last: cleanUpfronts.last } : {}),
      ...(cleanUpfronts.security != null ? { security: cleanUpfronts.security } : {}),
      ...(cleanUpfronts.key != null ? { key: cleanUpfronts.key } : {}),
    };
  }

  // Upsert fields and timeline entry
  await apps.updateOne(appFilter, {
    $set: { ...setDoc, updatedAt: now } as any,
    $push: {
      timeline: {
        at: now,
        by: uidStr,
        event: "lease.setup.updated",
        meta: {
          fields: [
            "building",
            "unit",
            "protoLease",
            ...(setDoc.upfronts ? ["upfronts"] : []),
          ],
        },
      } as TimelineEvent,
    },
  });

  return NextResponse.json({
    ok: true,
    saved: {
      building: setDoc.building,
      unit: setDoc.unit,
      protoLease: setDoc.protoLease,
      upfronts: setDoc.upfronts ?? null,
    },
    updatedAt: now.toISOString(),
  });
}
