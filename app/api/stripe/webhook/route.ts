// app/api/stripe/webhook/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getDb } from "@/lib/db";
import { getMailer } from "@/lib/mailer";

import {
  computeNextState,
  deriveMinRulesFromPlan,
  type AppState,
} from "@/domain/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Use account default API version
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/** Debug helper */
function dpush(debug: any, key: string, val: any) {
  if (!debug) return;
  debug[key] = val;
  // Also emit to console when ?debug=1 to see breadcrumbs immediately
  // eslint-disable-next-line no-console
  console.log(
    "[webhook:debug]",
    key,
    typeof val === "object" ? JSON.stringify(val, null, 2) : val
  );
}

/** Normalize id filters that might be string or ObjectId */
async function asFilter(idLike: string) {
  const { ObjectId } = await import("mongodb");
  return (ObjectId.isValid(idLike)
    ? { _id: new ObjectId(idLike) }
    : { _id: idLike }) as any;
}

/* ───────────────────────────────────────────────────────────
   Email helpers
─────────────────────────────────────────────────────────── */

/** Render the full HTML receipt via your existing route */
async function renderReceiptHTML(paymentId: string, debug?: any) {
  const base = process.env.APP_BASE_URL;
  if (!base) {
    dpush(debug, "email_html_skip", "APP_BASE_URL_missing");
    throw new Error("APP_BASE_URL missing");
  }
  const url = `${base}/api/receipts/security-deposit/${encodeURIComponent(
    paymentId
  )}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "x-internal": "1" },
  });
  const text = await res.text();
  if (!res.ok) {
    dpush(debug, "email_html_failed", {
      status: res.status,
      preview: text.slice(0, 200),
    });
    throw new Error(`receipt_render_failed_${res.status}`);
  }
  dpush(debug, "email_html_ok", { length: text.length });
  return text;
}

/** Plain-text fallback (does not include full account number) */
function toPlainText({
  landlord,
  tenant,
  premises,
  amount,
  receivedOn,
  bankName,
  bankAddress,
  accountIdentifierDisplay,
  depositDate,
  interestDisplay,
}: {
  landlord: string;
  tenant: string;
  premises: string;
  amount: string;
  receivedOn: string;
  bankName: string;
  bankAddress: string;
  accountIdentifierDisplay: string;
  depositDate: string;
  interestDisplay: string;
}) {
  return [
    "SECURITY DEPOSIT RECEIPT (M.G.L. c.186 §15B)",
    "",
    `Tenant: ${tenant}`,
    `Landlord (legal name): ${landlord}`,
    `Premises: ${premises}`,
    `Amount Received: ${amount}`,
    `Date Received: ${receivedOn}`,
    "",
    "BANK ACCOUNT RECEIPT (within 30 days, §15B(3)(a))",
    `Bank: ${bankName || "—"}`,
    `Bank Address: ${bankAddress || "—"}`,
    `Account Number / Identifier: ${accountIdentifierDisplay || "—"}`,
    `Deposit Amount: ${amount}`,
    `Deposit Date: ${depositDate || "—"}`,
    `Annual Interest: ${interestDisplay || "≤5% or bank rate"}`,
    "",
    "Note: MILO Homes is not the landlord’s broker and does not hold tenant funds; MILO facilitated this payment directly to the landlord’s Massachusetts escrow account.",
  ].join("\n");
}

/** Get all active household member user emails (primary + others) */
async function getHouseholdUserEmails(
  db: any,
  householdId: string,
  debug?: any
): Promise<string[]> {
  const membershipsCollCanonical = db.collection(
    "household_memberships"
  ) as any;
  const membershipsCollLegacy = db.collection(
    "household_memberhsips"
  ) as any; // legacy misspelling
  const { ObjectId } = await import("mongodb");

  const isHex = ObjectId.isValid(householdId);
  const hhIdObj = isHex ? new ObjectId(householdId) : null;

  // Tolerate both storage types for householdId
  const hhMatch = hhIdObj ? { $in: [householdId, hhIdObj] } : householdId;

  // Try canonical collection first
  let mships = await membershipsCollCanonical
    .find({ householdId: hhMatch, active: true })
    .project({ userId: 1, email: 1, role: 1 })
    .toArray();

  if (mships?.length) {
    dpush(debug, "household_memberships_ok", {
      used: "household_memberships",
      count: mships.length,
    });
  } else {
    // Fallback to legacy collection name (if it exists)
    try {
      mships = await membershipsCollLegacy
        .find({ householdId: hhMatch, active: true })
        .project({ userId: 1, email: 1, role: 1 })
        .toArray();
      dpush(debug, "household_memberships_fallback", {
        used: "household_memberhsips",
        count: mships?.length || 0,
      });
    } catch {
      dpush(debug, "household_memberships_fallback", {
        used: "none_available",
        count: 0,
      });
    }
  }

  if (!mships?.length) {
    dpush(debug, "household_recipients", { count: 0, emails: [] });
    return [];
  }

  // Convert userIds for users lookup (string → ObjectId when possible)
  const rawIds = mships.map((m: any) => m.userId).filter(Boolean);
  const userIds = rawIds.map((id: any) =>
    ObjectId.isValid(String(id))
      ? new ObjectId(String(id))
      : String(id)
  );

  const users = userIds.length
    ? await db
        .collection("users")
        .find({ _id: { $in: userIds } })
        .project({ email: 1, preferredName: 1 })
        .toArray()
    : [];

  const emailByUserIdStr = new Map<string, string>(
    users.map((u: any) => [String(u._id), (u.email || "").trim()])
  );

  const emails = new Set<string>();
  for (const m of mships) {
    const uidStr = String(m.userId || "");
    const userEmail = emailByUserIdStr.get(uidStr);
    if (userEmail) emails.add(userEmail);
    // fallback to membership.email if user record has no email
    if (!userEmail && m.email) emails.add(String(m.email).trim());
  }

  const arr = Array.from(emails).filter(Boolean);
  dpush(debug, "household_recipients", { count: arr.length, emails: arr });
  return arr;
}

/* ───────────────────────────────────────────────────────────
   Obligations + recompute (your existing logic)
─────────────────────────────────────────────────────────── */

async function applyToObligations(opts: {
  db: any;
  appId: string;
  firmId: string;
  bucket: "upfront" | "deposit";
  settledCents: number;
  paymentKey: string;
  priority?: string[] | null;
  debug?: any;
}) {
  const {
    db,
    appId,
    firmId,
    bucket,
    settledCents,
    paymentKey,
    debug,
  } = opts;
  const obligations = db.collection("obligations") as any;
  const ledger = db.collection("payments_ledger") as any;

  if (settledCents <= 0)
    return { applied: 0, remaining: 0, splits: [] as any[] };

  const existing = await ledger.findOne(
    { paymentKey, appId, firmId, bucket },
    { projection: { appliedCents: 1 } }
  );
  if (existing?.appliedCents > 0) {
    dpush(debug, "ob_apply_skip", {
      reason: "already_applied",
      paymentKey,
      applied: existing.appliedCents,
    });
    return { applied: 0, remaining: 0, splits: [] };
  }

  const groups = bucket === "deposit" ? ["deposit"] : ["upfront", "fee"];
  const list = await obligations
    .find(
      { appId, firmId, group: { $in: groups } },
      { projection: { _id: 1, group: 1, amountCents: 1, paidCents: 1, createdAt: 1 } }
    )
    .toArray();

  list.sort((a: any, b: any) => {
    const byDate =
      new Date(a.createdAt || 0).getTime() -
      new Date(b.createdAt || 0).getTime();
    if (byDate !== 0) return byDate;
    if (a.group === b.group) return 0;
    return a.group === "upfront" ? -1 : 1;
  });

  let toApply = settledCents;
  const splits: any[] = [];

  for (const ob of list) {
    const amount = Math.max(0, Number(ob.amountCents || 0));
    const paid = Math.max(0, Number(ob.paidCents || 0));
    const due = Math.max(0, amount - paid);
    if (due <= 0) continue;
    if (toApply <= 0) break;
    const take = Math.min(due, toApply);
    if (take <= 0) continue;

    await obligations.updateOne(
      { _id: ob._id },
      { $inc: { paidCents: take } }
    );
    splits.push({ obligationId: ob._id, group: ob.group, applied: take });
    toApply -= take;
  }

  await ledger.insertOne({
    paymentKey,
    appId,
    firmId,
    bucket,
    appliedCents: settledCents - toApply,
    splits,
    createdAt: new Date(),
  });

  dpush(debug, "ob_apply_result", {
    applied: settledCents - toApply,
    leftover: toApply,
    splits,
  });
  return {
    applied: settledCents - toApply,
    remaining: toApply,
    splits,
  };
}

async function recomputeAndMaybeFlip(opts: {
  db: any;
  appId: string;
  firmId: string;
  debug?: any;
}) {
  const { db, appId, firmId, debug } = opts;
  const obligations = db.collection("obligations") as any;
  const applications = db.collection("applications") as any;
  const payments = db.collection("payments") as any;

  // 1) Optional: still compute "due" from obligations (for logging / future UI)
  const obls = await obligations
    .find(
      { appId, firmId },
      { projection: { group: 1, amountCents: 1, paidCents: 1 } }
    )
    .toArray();

  let upfrontDue = 0,
    depositDue = 0;
  for (const o of obls) {
    const amount = Math.max(0, Number(o.amountCents || 0));
    const paid = Math.max(0, Number(o.paidCents || 0));
    const due = Math.max(0, amount - paid);

    if (o.group === "deposit") {
      depositDue += due;
    } else {
      upfrontDue += due;
    }
  }

  // 2) Compute PAID totals directly from succeeded payments
  const payRows = await payments
    .find(
      { appId, firmId, status: "succeeded" },
      { projection: { kind: 1, amountCents: 1, meta: 1 } }
    )
    .toArray();

  let upfrontPaid = 0;
  let depositPaid = 0;

  for (const p of payRows) {
    const amt = Math.max(0, Number(p.amountCents || 0));
    const k = String(p.kind || "").toLowerCase();

    if (k === "deposit") {
      depositPaid += amt;
    } else if (k === "upfront" || k === "operating") {
      upfrontPaid += amt;
    }
  }

  // 3) Load application to get plan + countersign + current status
  const appFilter = await asFilter(appId);
  const app = await applications.findOne(
    { _id: appFilter._id },
    { projection: { countersign: 1, paymentPlan: 1, status: 1 } }
  );

  if (!app) {
    dpush(debug, "recompute_no_app", { appId });
    return {
      upfrontDue,
      depositDue,
      upfrontPaid,
      depositPaid,
      nextStatus: null,
    };
  }

  const plan = app.paymentPlan ?? null;

  // Derive minRules from clamped thresholds (prefer countersign, fallback to plan)
  const minRules = deriveMinRulesFromPlan({
    countersignUpfrontThresholdCents:
      app.countersign?.upfrontMinCents ??
      plan?.countersignUpfrontThresholdCents,
    countersignDepositThresholdCents:
      app.countersign?.depositMinCents ??
      plan?.countersignDepositThresholdCents,
  });

  const paymentTotals = {
    upfront: upfrontPaid,
    deposit: depositPaid,
  };

  const currentStatus = String(app.status ?? "approved_high") as AppState;

  dpush(debug, "recomputed_due", {
    upfrontDue,
    depositDue,
    upfrontPaid,
    depositPaid,
    minRules,
    currentStatus,
    paymentTotals,
  });

  // 4) Ask the rules engine what the next state should be
  const nextStatus = computeNextState(
    currentStatus,
    "payment_updated",
    "system",
    {
      minRules,
      paymentTotals,
    }
  );

  // 5) If state changed (e.g. min_due -> min_paid), persist it + timeline
  if (nextStatus !== currentStatus) {
    const now = new Date();
    await applications.updateOne(
      { _id: appFilter._id },
      {
        $set: { status: nextStatus, updatedAt: now },
        $push: {
          timeline: {
            at: now,
            by: "system",
            event: "payments.gates_satisfied",
            meta: {
              from: currentStatus,
              to: nextStatus,
              upfrontDue,
              depositDue,
              upfrontPaid,
              depositPaid,
              minRules,
            },
          },
        },
      }
    );
    dpush(debug, "status_flipped", {
      from: currentStatus,
      to: nextStatus,
    });
  }

  return {
    upfrontDue,
    depositDue,
    upfrontPaid,
    depositPaid,
    minRules,
    currentStatus,
    nextStatus,
  };
}

async function linkUserDefaultUsBankPm(
  pi: Stripe.PaymentIntent,
  charge: Stripe.Charge | null,
  users: any,
  debugMode: boolean,
  debug: any
) {
  try {
    const pmId =
      typeof pi.payment_method === "string" ? pi.payment_method : null;
    const customerId =
      typeof pi.customer === "string" ? pi.customer : null;
    const isUsBank =
      charge?.payment_method_details?.type === "us_bank_account" ||
      (pi.payment_method_types?.length === 1 &&
        pi.payment_method_types[0] === "us_bank_account");

    if (pmId && customerId && isUsBank) {
      const userUpdateRes = await users.updateOne(
        { stripeCustomerId: customerId },
        { $set: { defaultUsBankPaymentMethodId: pmId } }
      );

      dpush(debugMode ? debug : null, "user_pm_linked", {
        status: pi.status,
        customerId,
        paymentMethodId: pmId,
        matched: userUpdateRes.matchedCount,
        modified: userUpdateRes.modifiedCount,
      });
    } else {
      dpush(debugMode ? debug : null, "user_pm_skip", {
        status: pi.status,
        pmId,
        customerId,
        isUsBank,
      });
    }
  } catch (err: any) {
    dpush(
      debugMode ? debug : null,
      "user_pm_error",
      String(err?.message || err),
    );
  }
}

/* ───────────────────────────────────────────────────────────
   WEBHOOK
─────────────────────────────────────────────────────────── */

export async function POST(req: Request) {
  const url = new URL(req.url);
  const debugMode = url.searchParams.get("debug") === "1";
  const debug: Record<string, any> = { step: "init" };

  try {
    const raw = await req.text();
    const sig = req.headers.get("stripe-signature") || "";
    const event = stripe.webhooks.constructEvent(
      raw,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
    dpush(debugMode ? debug : null, "event", {
      type: event.type,
      id: event.id,
    });

    let pi: Stripe.PaymentIntent | null = null;
    if ((event.data.object as any)?.object === "payment_intent") {
      pi = event.data.object as Stripe.PaymentIntent;
    } else if ((event.data.object as any)?.object === "charge") {
      const ch = event.data.object as Stripe.Charge;
      if (ch.payment_intent) {
        try {
          pi = await stripe.paymentIntents.retrieve(
            ch.payment_intent as string
          );
        } catch {}
      }
    }
    if (!pi)
      return NextResponse.json({
        ok: true,
        note: "ignored_non_pi",
        ...(debugMode ? { debug } : {}),
      });

    const db = await getDb();
    const payments = db.collection("payments") as any;
    const applications = db.collection("applications") as any;
    const firms = db.collection("firms") as any;
	const users = db.collection("users") as any;

    const paymentIntentId = pi.id;
    const status = pi.status;
    const amount = typeof pi.amount === "number" ? pi.amount : undefined;
    const m = pi.metadata || {};
    const kind = (m.type as "upfront" | "deposit") || null;
    const appId = (m.appId as string) || null;
    const firmId = (m.firmId as string) || null;

    // Charge details
    let charge: Stripe.Charge | null = null;
    let chargeId: string | undefined;
    if (typeof pi.latest_charge === "string") {
      chargeId = pi.latest_charge;
      try {
        charge = await stripe.charges.retrieve(chargeId);
      } catch {}
    } else if (pi.latest_charge && typeof pi.latest_charge === "object") {
      charge = pi.latest_charge as Stripe.Charge;
      chargeId = charge.id;
    }

    const destinationAcct = charge
      ? (charge as any).destination as string | undefined
      : undefined;
    const transferId = charge
      ? (charge as any).transfer as string | undefined
      : undefined;
    const receiptUrl = charge?.receipt_url || undefined;

    // Resolve existing row by PI id (or reconcile by metadata if missing)
    let row = await payments.findOne(
      { "providerIds.paymentIntentId": paymentIntentId },
      {
        projection: {
          _id: 1,
          appId: 1,
          firmId: 1,
          kind: 1,
          amountCents: 1,
          status: 1,
          meta: 1,
          provider: 1,
          createdAt: 1,
        },
      }
    );
    dpush(debugMode ? debug : null, "row_by_pi", { found: !!row });

    if (!row && appId && kind && amount) {
      await payments.updateOne(
        {
          appId,
          kind,
          amountCents: amount,
          provider: "stripe",
          "providerIds.paymentIntentId": { $exists: false },
        },
        {
          $set: {
            "providerIds.paymentIntentId": paymentIntentId,
            updatedAt: new Date(),
          },
        }
      );
      row = await payments.findOne(
        { "providerIds.paymentIntentId": paymentIntentId },
        {
          projection: {
            _id: 1,
            appId: 1,
            firmId: 1,
            kind: 1,
            amountCents: 1,
            status: 1,
            meta: 1,
            provider: 1,
            createdAt: 1,
          },
        }
      );
      dpush(debugMode ? debug : null, "row_attached_by_meta", {
        attached: !!row,
      });
    }

    const effectiveAppId = row?.appId || appId || "";
    const effectiveFirmId = row?.firmId || firmId || "";
    const effectiveKind = (row?.kind || kind) as
      | "upfront"
      | "deposit"
      | null;

    dpush(debugMode ? debug : null, "resolved", {
      paymentIntentId,
      status,
      effectiveAppId,
      effectiveFirmId,
      effectiveKind,
    });

    if (!row || !effectiveAppId || !effectiveFirmId || !effectiveKind) {
      dpush(debugMode ? debug : null, "skip_no_row", {
        reason: "unmatched_payment",
      });
      return NextResponse.json({
        ok: true,
        note: "unmatched_payment",
        ...(debugMode ? { debug } : {}),
      });
    }

    const baseSet: any = {
      updatedAt: new Date(),
      "meta.piStatus": status,
      "meta.receiptUrl": receiptUrl || null,
      "meta.transferId": transferId || null,
      "meta.destinationAccount":
        destinationAcct || m.destinationAccount || null,
    };

    switch (status) {
      case "processing": {
        await payments.updateOne(
          { _id: row._id },
          {
            $set: {
              status: "processing",
              processingAt: new Date(),
              ...baseSet,
            },
          }
        );
        await applications.updateOne(
          await asFilter(String(effectiveAppId)),
          {
            $push: {
              timeline: {
                at: new Date(),
                by: "system",
                event: "payment.processing",
                meta: {
                  paymentIntentId,
                  kind: effectiveKind,
                  amount: amount ?? null,
                },
              },
            },
          }
        );
		
		await linkUserDefaultUsBankPm(pi, charge, users, debugMode, debug);
		
        break;
      }

      case "succeeded": {
        await payments.updateOne(
          { _id: row._id },
          {
            $set: {
              status: "succeeded",
              succeededAt: new Date(),
              "providerIds.chargeId": chargeId || null,
              ...baseSet,
            },
          }
        );
		
		await linkUserDefaultUsBankPm(pi, charge, users, debugMode, debug);


const bucket = effectiveKind === "deposit" ? "deposit" : "upfront";

// Normalize metadata.priority (string) → string[] | null
const priorityMeta = m.priority;
const priority =
  typeof priorityMeta === "string" && priorityMeta.trim()
    ? priorityMeta
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

const applied = await applyToObligations({
  db,
  appId: String(effectiveAppId),
  firmId: String(effectiveFirmId),
  bucket,
  settledCents: row.amountCents ?? amount ?? 0,
  paymentKey: chargeId || paymentIntentId,
  priority,
  debug: debugMode ? debug : null,
});
        await applications.updateOne(
          await asFilter(String(effectiveAppId)),
          {
            $push: {
              timeline: {
                at: new Date(),
                by: "system",
                event: "payment.succeeded",
                meta: {
                  paymentIntentId,
                  chargeId: chargeId || null,
                  kind: effectiveKind,
                  amount: row.amountCents ?? amount ?? null,
                  splits: applied.splits,
                },
              },
            },
          }
        );

        await recomputeAndMaybeFlip({
          db,
          appId: String(effectiveAppId),
          firmId: String(effectiveFirmId),
          debug: debugMode ? debug : null,
        });

        // ───────── EMAIL to household users ─────────
        if (effectiveKind === "deposit") {
          dpush(debugMode ? debug : null, "email_branch_enter", {
            rowId: String(row._id),
          });

          const fresh = await payments.findOne(
            { _id: row._id },
            { projection: { meta: 1 } }
          );
          dpush(debugMode ? debug : null, "email_meta_check", {
            alreadyEmailed: !!fresh?.meta?.receiptEmailAt,
          });

          if (!fresh?.meta?.receiptEmailAt) {
            try {
              const app = await applications.findOne({
                _id: (await asFilter(String(effectiveAppId)))._id,
              });
              if (!app?.householdId) {
                dpush(
                  debugMode ? debug : null,
                  "email_skip",
                  "no_householdId_on_app"
                );
              } else {
                // collect household user emails
                const recipients = await getHouseholdUserEmails(
                  db,
                  String(app.householdId),
                  debugMode ? debug : null
                );
                dpush(
                  debugMode ? debug : null,
                  "email_recipients",
                  recipients
                );

                if (!recipients.length) {
                  dpush(
                    debugMode ? debug : null,
                    "email_skip",
                    "no_household_recipients"
                  );
                } else if (!process.env.APP_BASE_URL) {
                  dpush(
                    debugMode ? debug : null,
                    "email_skip",
                    "APP_BASE_URL_missing"
                  );
                } else {
                  const firmDoc = await firms.findOne({
                    _id: effectiveFirmId,
                  });

                  // Build shared fields for plain text
                  const b = app?.building,
                    u = app?.unit;
                  const premises = b
                    ? `${b.addressLine1 ?? ""}${b.addressLine2 ? `, ${b.addressLine2}` : ""}, ${
                        b.city ?? ""
                      }, ${b.state ?? ""} ${b.postalCode ?? ""}${
                        u?.unitNumber ? ` — ${u.unitNumber}` : ""
                      }`
                    : "Premises";
                  const landlord =
                    firmDoc?.legalName ?? firmDoc?.name ?? "Landlord";

                  // "Tenant" display from primary (just for body text nicety)
                  const primary =
                    app?.answersByMember &&
                    Object.values<any>(app.answersByMember).find(
                      (m: any) => m.role === "primary"
                    );
                  const tenant = (() => {
                    if (!primary) return "Tenant";
                    const nm = primary?.answers?.q_name;
                    const em =
                      primary?.answers?.q_email ?? primary?.email;
                    return nm
                      ? `${nm}${em ? ` — ${em}` : ""}`
                      : em ?? "Tenant";
                  })();

                  const receivedOn = new Date(
                    row?.succeededAt ?? new Date()
                  ).toLocaleDateString();
                  const amountText = `$${(
                    (row?.amountCents ?? amount ?? 0) / 100
                  ).toFixed(2)}`;
                  const esc =
                    firmDoc?.escrowDisclosure ?? {};
                  const bankName = esc.bankName ?? "";
                  const bankAddress = esc.bankAddress ?? "";
                  const accountIdentifierDisplay =
                    esc.accountIdentifier ||
                    (esc.accountLast4
                      ? `•••• ${esc.accountLast4}`
                      : "");
                  const depositISO =
                    row?.succeededAt ??
                    row?.processingAt ??
                    new Date();
                  const depositDate = new Date(
                    depositISO
                  ).toLocaleDateString();
                  const interestDisplay =
                    typeof esc.interestHundredths === "number"
                      ? (esc.interestHundredths / 100).toFixed(2) +
                        "%"
                      : typeof esc.interestRate === "number"
                      ? Number(esc.interestRate).toFixed(2) + "%"
                      : "≤5% or bank rate";

                  // Render full HTML via receipt route
                  let html = "";
                  try {
                    html = await renderReceiptHTML(
                      String(row._id),
                      debugMode ? debug : null
                    );
                  } catch (e: any) {
                    dpush(
                      debugMode ? debug : null,
                      "email_html_exception",
                      e?.message || String(e)
                    );
                  }

                  const text = toPlainText({
                    landlord,
                    tenant,
                    premises,
                    amount: amountText,
                    receivedOn,
                    bankName,
                    bankAddress,
                    accountIdentifierDisplay,
                    depositDate,
                    interestDisplay,
                  });

                  // Send to each recipient
                  const mailer = getMailer();
                  const results: Array<{
                    to: string;
                    ok: boolean;
                    error?: string;
                  }> = [];
                  for (const to of recipients) {
                    const mailRes = await mailer.send({
                      to,
                      subject: `Security Deposit Receipt — ${premises}`,
                      html: html || undefined,
                      text,
                      idempotencyKey: `dep-receipt:${String(
                        row._id
                      )}:${to}`,
                      traceId: `pi:${paymentIntentId}`,
                    });
                    results.push({
                      to,
                      ok: (mailRes as any).ok === true,
                      error: (mailRes as any).error,
                    });
                  }
                  dpush(debugMode ? debug : null, "email_results", results);

                  const anyOk = results.some((r) => r.ok);
                  if (anyOk) {
                    await payments.updateOne(
                      { _id: row._id },
                      {
                        $set: {
                          "meta.receiptEmailAt": new Date(),
                          "meta.receiptEmailTo": recipients,
                        },
                      }
                    );
                  } else {
                    await payments.updateOne(
                      { _id: row._id },
                      {
                        $set: {
                          "meta.receiptEmailError": results
                            .map(
                              (r) =>
                                `${r.to}:${
                                  r.error || "unknown"
                                }`
                            )
                            .join(", "),
                        },
                      }
                    );
                  }
                }
              }
            } catch (emailErr: any) {
              dpush(
                debugMode ? debug : null,
                "email_exception",
                String(emailErr?.message || emailErr)
              );
              await payments.updateOne(
                { _id: row._id },
                {
                  $set: {
                    "meta.receiptEmailError": String(
                      emailErr?.message ||
                        emailErr ||
                        "unknown_exception"
                    ),
                  },
                }
              );
            }
          } else {
            dpush(debugMode ? debug : null, "email_already_sent", true);
          }
        }
        // ───────── END EMAIL ─────────

        break;
      }

      case "requires_payment_method":
      case "canceled": {
        const newStatus =
          status === "canceled" ? "canceled" : "failed";
        await payments.updateOne(
          { _id: row._id },
          {
            $set: {
              status: newStatus,
              [newStatus === "failed"
                ? "failedAt"
                : "canceledAt"]: new Date(),
              ...baseSet,
            },
          }
        );
        await applications.updateOne(
          await asFilter(String(effectiveAppId)),
          {
            $push: {
              timeline: {
                at: new Date(),
                by: "system",
                event:
                  newStatus === "failed"
                    ? "payment.failed"
                    : "payment.canceled",
                meta: {
                  paymentIntentId,
                  kind: effectiveKind,
                  amount: row.amountCents ?? amount ?? null,
                },
              },
            },
          }
        );
        break;
      }

      default: {
        await payments.updateOne(
          { _id: row._id },
          { $set: baseSet }
        );
        break;
      }
    }

    return NextResponse.json({
      ok: true,
      ...(debugMode ? { debug } : {}),
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error("[webhook:error]", err?.message || err);
    return new NextResponse(
      JSON.stringify({
        ok: false,
        error: err?.message || "unhandled",
        ...(debugMode ? { debug } : {}),
      }),
      { status: 500 }
    );
  }
}
