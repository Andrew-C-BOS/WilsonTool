// app/api/tenant/deposit/disclosure/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { ObjectId } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function addDaysISO(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
function toISO(v: any | null | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function toObjectIdMaybe(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const appIdParam = url.searchParams.get("appId") || "";
  const firmId = url.searchParams.get("firmId") || "";

  if (!appIdParam || !firmId) {
    return NextResponse.json(
      { ok: false, error: "missing_params" },
      { status: 400 },
    );
  }

  const db = await getDb();

  // --- Application lookup: support _id stored as ObjectId or string ---
  const appIdObj = toObjectIdMaybe(appIdParam);
  const app = await db.collection("applications").findOne(
    {
      $or: [
        { _id: appIdParam as any }, // string id (if stored as string)
        ...(appIdObj ? [{ _id: appIdObj }] : []), // ObjectId
      ],
    } as any,
  );

  if (!app) {
    return NextResponse.json(
      { ok: false, error: "application_not_found" },
      { status: 404 },
    );
  }

  // --- Firm lookup (firmId is a string like "firm_...") ---
  const firm = await db.collection("firms").findOne({ _id: firmId as any });
  if (!firm) {
    return NextResponse.json(
      { ok: false, error: "firm_not_found" },
      { status: 404 },
    );
  }

  // --- Deposit payments: sum across ALL succeeded deposits for this app+firm ---
const deposits = await db
  .collection("payments")
  .find(
    {
      kind: "deposit",
      status: "succeeded",
      firmId,
      $or: [
        { appId: appIdParam },
        ...(appIdObj ? [{ appId: appIdObj }] : []),
      ],
    },
    {
      sort: {
        succeededAt: -1,
        updatedAt: -1,
        createdAt: -1,
      },
    },
  )
  .toArray();

const paid = deposits.length > 0;

// This is the key line: sum *all* succeeded deposit payments.
const totalAmountCents = deposits.reduce(
  (sum, p) => sum + (Number(p.amountCents) || 0),
  0,
);

// latest payment drives id / date / receipt
const latestPayment = deposits[0] || null;
  const createdAtISO = toISO(
    latestPayment?.succeededAt ??
      latestPayment?.updatedAt ??
      latestPayment?.createdAt,
  );
  const bankReceiptDueISO = createdAtISO
    ? addDaysISO(createdAtISO, 30)
    : null;

  const receiptPath = latestPayment
    ? `/api/receipts/security-deposit/${String(latestPayment._id)}`
    : null;

  const escrow = firm.escrowDisclosure ?? {};
  const escrowPresent = Boolean(
    escrow.bankName &&
      (escrow.accountIdentifier || escrow.accountLast4),
  );

  return NextResponse.json({
    ok: true,
    paid,
    paymentId: latestPayment ? String(latestPayment._id) : null,
    amountCents: paid ? totalAmountCents : null,
    currency: latestPayment?.currency ?? "USD",
    bankReceiptDueISO,
    disclosureReady: paid && escrowPresent,
    receiptPath,
    escrowSummary: {
      bankName: escrow.bankName ?? null,
      bankAddress: escrow.bankAddress ?? null,
      accountIdentifier: escrow.accountIdentifier ?? null,
      accountLast4: escrow.accountLast4 ?? null,
      interestRate:
        typeof escrow.interestRate === "number"
          ? escrow.interestRate
          : null,
    },
  });
}
