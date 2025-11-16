"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";

/* ─────────────────────────────────────────────────────────────
   Local helpers
───────────────────────────────────────────────────────────── */
function clsx(...xs: (string | false | null | undefined)[]) { return xs.filter(Boolean).join(" "); }
const log = (...args: any[]) => console.log("[payments]", ...args);

function money(cents?: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 })
    .format((cents || 0) / 100);
}
let stripePromise: Promise<import("@stripe/stripe-js").Stripe | null> | null = null;
async function getStripe() {
  if (!stripePromise) {
    stripePromise = (async () => {
      const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
      if (!pk) { console.error("Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"); return null; }
      const { loadStripe } = await import("@stripe/stripe-js");
      return loadStripe(pk);
    })();
  }
  return stripePromise;
}

/* ─────────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────────── */
type Kind = "" | "upfront" | "deposit";
type Charge = {
  chargeKey: string;
  bucket: "upfront" | "deposit" | "rent" | "fee";
  code: string;
  label?: string;
  amountCents: number;
  dueDate?: string | null;
  priorityIndex?: number | null;
  postedCents?: number;
  pendingCents?: number;
  remainingCents?: number;
};
type PaymentLite = {
  _id: string;
  kind: "upfront" | "deposit" | "rent" | "fee";
  status: "created" | "processing" | "succeeded" | "failed" | "canceled" | "returned";
  amountCents: number;
  rails?: "ach" | "card";
  receiptUrl?: string | null;
  providerIds?: { paymentIntentId?: string };
  createdAt: string;
  updatedAt?: string;
};
type AllocationByCharge = { chargeKey: string; postedCents: number; pendingCents: number; };
type MoneyView = {
  dueUpfrontCents: number;
  dueDepositCents: number;
  charges?: Charge[];
  payments?: PaymentLite[];
  statusCounts?: Record<string, number>;
  allocationsByCharge?: AllocationByCharge[];
};
type Summary = {
  ok: boolean;
  upfrontDueCents: number;
  depositDueCents: number;
  upfrontMinCents?: number;
  depositMinCents?: number;
  __mv?: MoneyView;
};
type ChargesApi = {
  ok: boolean;
  charges: Charge[];
  dueUpfrontCents: number;
  dueDepositCents: number;
  grossUpfrontCents: number;
  grossDepositCents: number;
  allowed?: { upfront?: number[]; deposit?: number[] };
  countersign?: {
    upfrontMinThresholdCents: number | null;
    upfrontMinRemainingCents: number | null;
    depositMinThresholdCents: number | null;
    depositMinRemainingCents: number | null;
    upfrontMet: boolean | null;
    depositMet: boolean | null;
  };
  windows?: { dueNowCents: number; dueBeforeMoveInCents: number; dueNext30Cents: number; laterCents: number; moveInDateISO: string | null; };
  nextRent?: { ym: string; dueDateISO: string | null; amountCents: number; remainingCents: number } | null;
  firstCovered?: boolean;
  lastCovered?: boolean;
  receipts?: Array<{ id: string; kind: "upfront" | "deposit" | "rent" | "fee"; status: "processing" | "succeeded" | "failed" | "canceled" | "returned" | "created"; amountCents: number; createdAt: string; receiptUrl?: string | null; }>;
};

/* ─────────────────────────────────────────────────────────────
   Coverage (for explainer chip)
───────────────────────────────────────────────────────────── */
function buildAllocMaps(alloc?: AllocationByCharge[]) {
  const posted = new Map<string, number>(), pending = new Map<string, number>();
  (alloc ?? []).forEach(a => { posted.set(a.chargeKey, Math.max(0, a.postedCents || 0)); pending.set(a.chargeKey, Math.max(0, a.pendingCents || 0)); });
  return { posted, pending };
}
function remainingForCharge(c: Charge, posted: Map<string, number>, pending: Map<string, number>) {
  const paid = (posted.get(c.chargeKey) ?? 0) + (pending.get(c.chargeKey) ?? 0);
  const total = c.amountCents ?? 0;
  if (typeof c.remainingCents === "number") return Math.max(0, c.remainingCents);
  return Math.max(0, total - paid);
}
function computeCoverage(amountCents: number, charges?: Charge[], allocations?: AllocationByCharge[]) {
  const { posted, pending } = buildAllocMaps(allocations);
  const lease = (charges ?? []).filter(c => c.bucket === "upfront");
  const rem = {
    last: lease.filter(c => c.code === "last_month").reduce((s, c) => s + remainingForCharge(c, posted, pending), 0),
    first: lease.filter(c => c.code === "first_month").reduce((s, c) => s + remainingForCharge(c, posted, pending), 0),
    key: lease.filter(c => c.code === "key_fee").reduce((s, c) => s + remainingForCharge(c, posted, pending), 0),
  };
  let amt = Math.max(0, amountCents || 0);
  const pieces: { label: "Last month" | "First month" | "Key fee"; amountCents: number; fullyCovered: boolean }[] = [];
  (["last","first","key"] as const).forEach(b => {
    const need = rem[b]; if (need <= 0) return;
    const take = Math.min(need, amt); if (take <= 0) return;
    pieces.push({ label: b === "last" ? "Last month" : b === "first" ? "First month" : "Key fee", amountCents: take, fullyCovered: take === need });
    amt -= take;
  });
  return { pieces, leftoverCents: amt };
}

/* ─────────────────────────────────────────────────────────────
   UI atoms
───────────────────────────────────────────────────────────── */
function Badge({ children, tone = "gray" }: { children: React.ReactNode; tone?: "gray"|"emerald"|"rose"|"amber"|"blue" }) {
  const map = {
    gray: "bg-gray-100 text-gray-800 ring-gray-200",
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    rose: "bg-rose-50 text-rose-700 ring-rose-200",
    amber: "bg-amber-50 text-amber-900 ring-amber-200",
    blue: "bg-blue-50 text-blue-800 ring-blue-200",
  } as const;
  return <span className={clsx("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", map[tone])}>{children}</span>;
}
function Card({ title, subtitle, children, as = "section" }: { title: string; subtitle?: string; children: React.ReactNode; as?: "section"|"div" }) {
  const Comp = as as any;
  return (
    <Comp className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3">
        <div className="text-sm font-semibold text-gray-900">{title}</div>
        {subtitle && <div className="mt-0.5 text-xs text-gray-600">{subtitle}</div>}
      </div>
      {children}
    </Comp>
  );
}

/* ─────────────────────────────────────────────────────────────
   Stripe Elements subform
───────────────────────────────────────────────────────────── */
function PaymentCheckoutForm({ returnUrl, onDone }: { returnUrl: string; onDone: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true); setMsg(null);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: returnUrl },
    });

    if (error) { setMsg(error.message || "Payment failed, please try again."); setSubmitting(false); return; }
    if (paymentIntent) { window.location.assign(returnUrl); return; }
    setSubmitting(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <PaymentElement />
      <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
        Pay securely from your bank account, ACH can take 2–5 business days.
      </div>
      <p className="text-[11px] text-gray-500">By clicking <em>Pay now</em>, you authorize a one-time ACH debit.</p>
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onDone} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium hover:bg-gray-50">Cancel</button>
        <button type="submit" disabled={!stripe || !elements || submitting} className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-black disabled:opacity-60">
          {submitting ? "Processing…" : "Pay now"}
        </button>
      </div>
      {msg && <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">{msg}</div>}
    </form>
  );
}

/* ─────────────────────────────────────────────────────────────
   Component
───────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────
   Component
───────────────────────────────────────────────────────────── */
export default function PaymentsDesktop({
  appId,
  firmId,
  type,
}: {
  appId: string;
  firmId?: string;
  type: Kind;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [chargesApi, setChargesApi] = useState<ChargesApi | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [returnUrl, setReturnUrl] = useState<string | null>(null);

  const lastFetchedKeyRef = useRef<string | null>(null);
  const stripePromise = useMemo(() => getStripe(), []);

  // Fetch summary + charges
  useEffect(() => {
    const key = `${appId || ""}|${firmId || ""}`;
    const hasAppId = !!appId && !!`${appId}`.trim();
    const controller = new AbortController();
    let aborted = false;

    async function run() {
      if (!hasAppId) {
        setLoading(false);
        setSummary(null);
        setChargesApi(null);
        return;
      }
      if (lastFetchedKeyRef.current === key) return;
      lastFetchedKeyRef.current = key;

      setLoading(true);
      const qs = new URLSearchParams();
      qs.set("appId", appId);
      if (firmId) qs.set("firmId", firmId);

      let base: Summary | null = null;
      let api: ChargesApi | null = null;

      try {
        const res = await fetch(`/api/tenant/payments/summary?${qs.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (res.ok) {
          const j = await res.json();
          base = {
            ok: !!j?.ok,
            upfrontDueCents: Number(j?.upfrontDueCents || 0),
            depositDueCents: Number(j?.depositDueCents || 0),
            upfrontMinCents: Number.isFinite(j?.upfrontMinCents)
              ? Number(j?.upfrontMinCents)
              : undefined,
            depositMinCents: Number.isFinite(j?.depositMinCents)
              ? Number(j?.depositMinCents)
              : undefined,
            __mv: j?.__mv,
          };
        }
      } catch {}

      try {
        const res = await fetch(`/api/tenant/charges?${qs.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (res.ok) api = await res.json();
      } catch {}

      // fallback receipts
      let fallbackReceipts: ChargesApi["receipts"] | undefined;
      try {
        if (!api?.receipts) {
          const res = await fetch(`/api/tenant/payments/list?${qs.toString()}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          if (res.ok) {
            const j = await res.json();
            const items: PaymentLite[] = Array.isArray(j?.items) ? j.items : [];
            fallbackReceipts = items.slice(0, 10).map((p) => ({
              id: p._id,
              kind: p.kind,
              status: p.status,
              amountCents: p.amountCents,
              createdAt: p.createdAt,
              receiptUrl: p.receiptUrl,
            }));
          }
        }
      } catch {}

      if (!aborted) {
        setSummary(base);
        setChargesApi(api ? { ...api, receipts: api.receipts ?? fallbackReceipts } : null);
        setLoading(false);
      }
    }

    run();
    return () => {
      aborted = true;
      controller.abort();
    };
  }, [appId, firmId]);

  // Derived windows & countersign/deposit info
  const w = chargesApi?.windows;
  const countersignRem = chargesApi?.countersign?.upfrontMinRemainingCents ?? null;
  const countersignMin = chargesApi?.countersign?.upfrontMinThresholdCents ?? null;
  const countersignMet = chargesApi?.countersign?.upfrontMet ?? null;
  const upfrontDue = chargesApi?.dueUpfrontCents ?? 0;
  const nextRentRemaining = chargesApi?.nextRent?.remainingCents ?? 0;

  const depositRemaining = useMemo(() => {
    const rows = chargesApi?.charges ?? [];
    return rows
      .filter((c) => c.bucket === "deposit")
      .reduce((s, c) => s + Math.max(0, c.remainingCents ?? 0), 0);
  }, [chargesApi?.charges]);

  // Presets from SERVER policy
  const presets = useMemo(() => {
    const out: {
      label: string;
      bucket: "upfront" | "deposit";
      amount: number;
      reason: string;
    }[] = [];

    const allowedUpfront = chargesApi?.allowed?.upfront ?? [];
    const allowedDeposit = chargesApi?.allowed?.deposit ?? [];

    // Countersign preset
    if ((countersignRem ?? 0) > 0) {
      const pick =
        allowedUpfront.find((v) => v >= (countersignRem ?? 0)) ?? allowedUpfront[0];
      if (pick && pick > 0) {
        out.push({
          label: `Countersign (${money(pick)})`,
          bucket: "upfront",
          amount: pick,
          reason: "operating_to_countersign",
        });
      }
    }

    // Full upfronts
    if (upfrontDue > 0 && allowedUpfront.length > 0) {
      const maxU = Math.max(...allowedUpfront);
      out.push({
        label: `Full up-fronts (${money(maxU)})`,
        bucket: "upfront",
        amount: maxU,
        reason: "operating_all_now",
      });
    }

    // Next month completion (only when no upfront due)
    if (upfrontDue === 0 && nextRentRemaining > 0 && allowedUpfront.length > 0) {
      const exact = allowedUpfront.find((v) => v === nextRentRemaining);
      const near =
        exact ?? allowedUpfront.find((v) => v >= nextRentRemaining) ?? allowedUpfront[0];
      if (near && near > 0) {
        out.push({
          label: `Complete next month (${money(near)})`,
          bucket: "upfront",
          amount: near,
          reason: "operating_complete_month",
        });
      }
    }

    // Deposit preset
    if (depositRemaining > 0) {
      const dep = (allowedDeposit && allowedDeposit[0]) || depositRemaining;
      if (dep > 0) {
        out.push({
          label: `Deposit (${money(dep)})`,
          bucket: "deposit",
          amount: dep,
          reason: "deposit_minimum",
        });
      }
    }

    const seen = new Set<string>();
    return out
      .filter((p) => {
        const k = `${p.bucket}:${p.amount}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => b.amount - a.amount);
  }, [
    chargesApi?.allowed?.upfront,
    chargesApi?.allowed?.deposit,
    countersignRem,
    upfrontDue,
    nextRentRemaining,
    depositRemaining,
  ]);

  // Start payment
  const startPayment = useCallback(
    async (kind: "upfront" | "deposit", amountCents: number, reasonLabel?: string) => {
      if (!appId || !`${appId}`.trim()) {
        setToast("Missing application,");
        return;
      }
      if (!Number.isFinite(amountCents) || amountCents <= 0) return;

      const busyKey = `${kind}:${amountCents}`;
      setBusy(busyKey);
      setToast(null);

      const requestId = `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      try {
        const res = await fetch("/api/tenant/payments/session?debug=1", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            appId,
            firmId: firmId || null,
            type: kind,
            amountCents,
            reason: reasonLabel ?? null,
            requestId,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({} as any));
          if (err?.error === "amount_not_allowed") {
            if (err?.detail?.lineItemExacts) {
              setToast(
                `Amount not allowed. Try one of: ${err.detail.lineItemExacts
                  .map((n: number) => money(n))
                  .join(", ")}`,
              );
            } else if (err?.detail?.required) {
              setToast(`Deposit must be exactly ${money(err.detail.required)}.`);
            } else if (err?.detail?.minTopUpCents && err?.detail?.maxTopUpCents) {
              setToast(
                `Pick between ${money(err.detail.minTopUpCents)} and ${money(
                  err.detail.maxTopUpCents,
                )}.`,
              );
            } else {
              setToast("This amount isn’t allowed by policy.");
            }
          } else if (err?.error) {
            setToast(err.error);
          } else {
            setToast("Couldn’t start payment,");
          }
          return;
        }

        const j = await res.json().catch(() => ({} as any));
        if (j?.url) {
          window.location.assign(j.url as string);
          return;
        }
        if (j?.clientSecret) {
          setClientSecret(j.clientSecret as string);
          setReturnUrl(
            j?.returnUrl ||
              `/tenant/payments/result?appId=${encodeURIComponent(
                appId,
              )}&type=${encodeURIComponent(kind)}`,
          );
          return;
        }
        if (j?.ok) {
          window.location.reload();
          return;
        }
        setToast("Unexpected response,");
      } catch (e: any) {
        setToast(e?.message || "Couldn’t start payment,");
      } finally {
        setBusy(null);
      }
    },
    [appId, firmId],
  );

  /* ───────────────── Stripe Elements view ───────────────── */
  if (clientSecret && returnUrl) {
    return (
      <main className="min-h-[calc(100vh-4rem)] bg-[#e6edf1]">
        <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6">
          <header className="rounded-3xl bg-gradient-to-r from-indigo-50 via-sky-50 to-rose-50 p-5 shadow-sm ring-1 ring-indigo-100/60">
            <div className="text-xs font-semibold text-indigo-700">Step 3 · Payment</div>
            <h1 className="mt-2 text-xl font-semibold text-gray-900">Complete payment</h1>
            <p className="mt-1 text-sm text-gray-600">
              Connect your bank account securely with Stripe, confirm the payment, and you’re done,
            </p>
          </header>

          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <Elements
              key={clientSecret}
              stripe={awaitedStripeOrNull(stripePromise)}
              options={{ clientSecret, appearance: { theme: "stripe" } }}
            >
              <PaymentCheckoutForm
                returnUrl={`${
                  typeof window !== "undefined" ? window.location.origin : ""
                }${returnUrl}`}
                onDone={() => {
                  setClientSecret(null);
                  setReturnUrl(null);
                }}
              />
            </Elements>
          </div>

          {toast && (
            <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
              {toast}
            </div>
          )}
        </div>
      </main>
    );
  }

  /* ───────────────── Main payments view ───────────────── */
  const dueNow = w?.dueNowCents ?? 0;
  const beforeMoveIn = w?.dueBeforeMoveInCents ?? 0;
  const next30 = w?.dueNext30Cents ?? 0;
  const later = w?.laterCents ?? 0;

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#e6edf1]">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6">
        {/* Hero-style status header */}
        <header className="rounded-3xl bg-gradient-to-r from-indigo-50 via-sky-50 to-rose-50 p-5 shadow-sm ring-1 ring-indigo-100/60">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-indigo-700">
                <span className="inline-flex items-center rounded-full bg-indigo-600 px-3 py-1 text-[11px] font-semibold text-white shadow-sm">
                  Step 3 · Payments
                </span>
                <span className="hidden text-indigo-500 sm:inline">
                  Move-in & deposit for this lease
                </span>
              </div>
              <h1 className="mt-3 text-xl font-semibold text-gray-900">
                What’s due for this lease
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-gray-600">
                Use this page to finish your move-in payments and handle your security deposit,
                we’ll route each payment to the correct account automatically,
              </p>
            </div>
            <div className="flex flex-col items-end gap-2 text-right text-[11px] text-gray-600">
              <div>
                <span className="font-semibold text-gray-900">
                  Due now {money(dueNow)}
                </span>
                {!!beforeMoveIn && (
                  <span className="ml-1 text-gray-600">
                    · Before move-in {money(beforeMoveIn)}
                  </span>
                )}
              </div>
              <div>
                Next 30 days {money(next30)}
                {later > 0 && <span className="ml-1 text-gray-500">· Later {money(later)}</span>}
              </div>
            </div>
          </div>

          {/* Inline badges explaining countersign / deposit thresholds */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            <Badge tone="blue">Application: {money(upfrontDue)} in up-fronts remaining</Badge>
            {typeof countersignMin === "number" && countersignMin > 0 && (
              <Badge tone={countersignMet ? "emerald" : "amber"}>
                {countersignMet
                  ? "Countersign minimum met"
                  : `Countersign unlocks at ${money(countersignMin)}`}
              </Badge>
            )}
            {typeof chargesApi?.countersign?.depositMinThresholdCents === "number" &&
              chargesApi.countersign.depositMinThresholdCents! > 0 && (
                <Badge
                  tone={
                    chargesApi?.countersign?.depositMet ? "emerald" : "amber"
                  }
                >
                  {chargesApi?.countersign?.depositMet
                    ? "Deposit minimum met"
                    : `Deposit minimum ${money(
                        chargesApi.countersign.depositMinThresholdCents!,
                      )}`}
                </Badge>
              )}
            {w?.moveInDateISO && (
              <Badge tone="gray">Move-in {w.moveInDateISO}</Badge>
            )}
          </div>
        </header>

        {/* Main content: overview + pay panel */}
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          {/* LEFT: overview & receipts */}
          <div className="space-y-4">
            {/* Up-fronts overview */}
            <Card
              title="Move-in up-fronts"
              subtitle="Key fee, first month, and last month rent. Extra rolls into future months."
            >
              <UpfrontMini
                charges={chargesApi?.charges}
                allocations={summary?.__mv?.allocationsByCharge}
                nextRent={chargesApi?.nextRent}
              />
            </Card>

            {/* Deposit */}
            {depositRemaining > 0 && (
              <Card
                title="Security deposit"
                subtitle="Held in a dedicated escrow account as required by law."
              >
                <div className="flex items-end justify-between gap-3 text-sm">
                  <div className="space-y-1">
                    <div className="text-gray-700">
                      Remaining deposit:&nbsp;
                      <span className="font-semibold">
                        {money(depositRemaining)}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-600">
                      Your deposit is kept separate from operating funds, and may earn
                      interest depending on local rules,
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      startPayment(
                        "deposit",
                        Math.max(0, depositRemaining),
                        "deposit_minimum",
                      )
                    }
                    disabled={depositRemaining <= 0 || !!busy}
                    className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-black disabled:opacity-60"
                  >
                    {busy?.startsWith("deposit:") ? "Processing…" : "Pay deposit"}
                  </button>
                </div>
              </Card>
            )}

            {/* Monthly rent summary */}
            <Card
              title="Monthly rent"
              subtitle="What happens after move-in."
            >
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <div className="space-y-1">
                  <div className="text-gray-700">
                    Next rent due:&nbsp;
                    <span className="font-semibold">
                      {chargesApi?.nextRent
                        ? `${chargesApi.nextRent.ym}: ${money(
                            chargesApi.nextRent.remainingCents,
                          )}`
                        : "None scheduled yet"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
                    {chargesApi?.firstCovered && (
                      <Badge tone="emerald">First month prepaid</Badge>
                    )}
                    {chargesApi?.lastCovered && (
                      <Badge tone="emerald">Last month prepaid</Badge>
                    )}
                    {!chargesApi?.firstCovered &&
                      !chargesApi?.lastCovered && (
                        <span>No months prepaid yet.</span>
                      )}
                  </div>
                </div>
              </div>
            </Card>

            {/* Receipts */}
            <details className="rounded-xl border border-gray-200 bg-white p-4">
              <summary className="cursor-pointer text-sm font-semibold text-gray-900">
                Payment history & receipts
              </summary>
              <div className="mt-3 overflow-hidden rounded-lg border border-gray-200">
                <ul className="divide-y divide-gray-200 bg-white">
                  {(chargesApi?.receipts ?? [])
                    .sort(
                      (a, b) =>
                        new Date(b.createdAt).getTime() -
                        new Date(a.createdAt).getTime(),
                    )
                    .slice(0, 12)
                    .map((r) => (
                      <li
                        key={r.id}
                        className="flex items-center justify-between px-4 py-3 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <Badge
                            tone={
                              r.status === "succeeded"
                                ? "emerald"
                                : r.status === "processing"
                                ? "gray"
                                : "rose"
                            }
                          >
                            {r.status}
                          </Badge>
                          <span className="text-gray-700 capitalize">
                            {r.kind === "upfront" ? "Lease" : r.kind}
                          </span>
                          <span className="text-xs text-gray-500">
                            {new Date(r.createdAt).toLocaleString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-gray-900 font-medium">
                            {money(r.amountCents)}
                          </div>
                          {r.receiptUrl ? (
                            <a
                              href={r.receiptUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-blue-700 underline"
                            >
                              Receipt
                            </a>
                          ) : (
                            <span className="text-xs text-gray-400">
                              No receipt
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                </ul>
              </div>
            </details>
          </div>

          {/* RIGHT: sticky pay panel */}
          <aside className="lg:sticky lg:top-6">
            <Card
              as="div"
              title="Make a payment"
              subtitle="Select which payment you want to make."
            >
              <SmartPayPanel
                presets={presets}
                charges={chargesApi?.charges}
                allocations={summary?.__mv?.allocationsByCharge}
                onPay={(bucket, amount, reason) =>
                  startPayment(bucket, amount, reason)
                }
                busyKey={busy}
              />
            </Card>
          </aside>
        </div>

        {toast && (
          <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
            <div className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
              {toast}
              <button className="ml-3 underline" onClick={() => setToast(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

/* ---------- unwrap the stripe promise in JSX ---------- */
function awaitedStripeOrNull(
  p: Promise<import("@stripe/stripe-js").Stripe | null>,
) {
  // Stripe Elements accepts a Promise<Stripe | null>; this helper just
  // satisfies TypeScript while keeping the runtime behavior you want.
  return p as unknown as import("@stripe/stripe-js").Stripe | null;
}

/* ─────────────────────────────────────────────────────────────
   Subcomponents
───────────────────────────────────────────────────────────── */

function UpfrontMini({
  charges, allocations, nextRent,
}: {
  charges?: Charge[];
  allocations?: AllocationByCharge[];
  nextRent?: { ym: string; dueDateISO: string | null; amountCents: number; remainingCents: number } | null | undefined;
}) {
  const { posted, pending } = buildAllocMaps(allocations);
  const lease = (charges ?? []).filter(c => c.bucket === "upfront");
  const leaseRemaining = lease.reduce((s, c) => s + remainingForCharge(c, posted, pending), 0);

  const rem = {
    first: lease.filter(c => c.code === "first_month").reduce((s, c) => s + remainingForCharge(c, posted, pending), 0),
    last:  lease.filter(c => c.code === "last_month").reduce((s, c) => s + remainingForCharge(c, posted, pending), 0),
    key:   lease.filter(c => c.code === "key_fee").reduce((s, c) => s + remainingForCharge(c, posted, pending), 0),
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
        <div className="text-gray-800">Remaining up-fronts</div>
        <div className="font-medium text-gray-900">{money(leaseRemaining)}</div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <MiniRow label="Last month" remaining={rem.last} />
        <MiniRow label="First month" remaining={rem.first} />
        <MiniRow label="Key fee" remaining={rem.key} />
      </div>
      <div className="rounded-md border border-gray-200 p-3 text-[11px] text-gray-700">
        Payments apply in this order: <b>Last → First → Key</b>, extra rolls into monthly rent{nextRent?.remainingCents ? `, next due ${nextRent.ym} (${money(nextRent.remainingCents)} remaining)` : ","} simple.
      </div>
    </div>
  );
}
function MiniRow({ label, remaining }: { label: string; remaining: number }) {
  const paid = remaining <= 0;
  return (
    <div className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
      <div className="text-gray-800">{label}</div>
      <div className="flex items-center gap-2">
        <div className="font-medium text-gray-900">{money(Math.max(0, remaining))}</div>
        <Badge tone={paid ? "emerald" : "gray"}>{paid ? "Paid" : "Pending"}</Badge>
      </div>
    </div>
  );
}

function SmartPayPanel({
  presets,
  charges,
  allocations,
  onPay,
  busyKey,
}: {
  presets: { label: string; bucket: "upfront" | "deposit"; amount: number; reason: string }[];
  charges?: Charge[];
  allocations?: AllocationByCharge[];
  onPay: (bucket: "upfront" | "deposit", amount: number, reason: string) => void;
  busyKey: string | null;
}) {
  const [picked, setPicked] = useState<(typeof presets)[number] | null>(
    presets[0] || null,
  );

  // Coverage preview only for upfront presets
  const cov = useMemo(() => {
    if (!picked || picked.bucket !== "upfront" || picked.amount <= 0) return null;
    return computeCoverage(picked.amount, charges, allocations);
  }, [picked, charges, allocations]);

  const isBusy = !!busyKey;
  const hasPresets = presets.length > 0;

  const primaryLabel = picked
    ? picked.bucket === "upfront"
      ? `Pay ${money(Math.max(0, picked.amount))} toward move-in charges`
      : `Pay ${money(Math.max(0, picked.amount))} to deposit escrow`
    : "Select a payment option";

  return (
    <div className="space-y-4">
      {/* Short intro */}
      <div className="text-xs text-gray-600">
        Select which payment you want to make. You’ll see what it covers before you confirm,
      </div>

      {/* Preset options */}
      {hasPresets ? (
        <div className="flex flex-col gap-2">
          {presets.map((p, i) => {
            const active =
              picked?.label === p.label &&
              picked.amount === p.amount &&
              picked.bucket === p.bucket;

            const isDeposit = p.bucket === "deposit";

            return (
              <button
                key={`${p.label}-${i}`}
                type="button"
                onClick={() => setPicked(p)}
                className={clsx(
                  "w-full rounded-md border px-3 py-2 text-left text-sm transition",
                  "flex flex-col gap-1",
                  active
                    ? "border-gray-900 bg-gray-50 shadow-sm"
                    : "border-gray-200 bg-white hover:bg-gray-50",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold truncate text-gray-900">
                    {p.label}
                  </span>
                  <span
                    className={clsx(
                      "text-[11px] font-medium rounded-full px-2 py-0.5",
                      isDeposit
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-gray-100 text-gray-700",
                      active && "ring-1 ring-gray-400",
                    )}
                  >
                    {isDeposit ? "Deposit" : "Lease"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-gray-600">
                    {isDeposit
                      ? "Goes into your regulated deposit account,"
                      : "Counts toward first, last, and key fees for move-in,"}
                  </span>
                  <span className="font-medium text-gray-900">
                    {money(p.amount)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
          Nothing is due right now for this lease,
        </div>
      )}

      {/* Coverage explainer for selected upfront preset */}
      {picked?.bucket === "upfront" && picked.amount > 0 && (
        <div className="rounded-md border border-gray-200 bg-white p-3 text-[11px] text-gray-700">
          <div className="mb-1 font-semibold text-gray-900">
            How this payment will be applied
          </div>
          {cov && (cov.pieces.length > 0 || cov.leftoverCents > 0) ? (
            <ul className="space-y-0.5 list-disc list-inside">
              {cov.pieces.map((p, idx) => (
                <li key={idx}>
                  <span className="font-medium">{p.label}</span>{" "}
                  {p.fullyCovered
                    ? `fully covered (${money(p.amountCents)})`
                    : `covered ${money(p.amountCents)} (partial)`}
                </li>
              ))}
              {cov.leftoverCents > 0 && (
                <li>
                  Any extra&nbsp;
                  <span className="font-medium">
                    {money(cov.leftoverCents)}
                  </span>{" "}
                  rolls into future monthly rent,
                </li>
              )}
            </ul>
          ) : (
            <p>
              Payments are applied in this order:{" "}
              <span className="font-medium">
                Last month → First month → Key fee
              </span>
              , extra rolls into monthly rent,
            </p>
          )}
        </div>
      )}

      {/* Primary CTA */}
      <button
        onClick={() =>
          picked &&
          onPay(picked.bucket, Math.max(0, picked.amount), picked.reason)
        }
        disabled={!picked || Math.max(0, picked?.amount ?? 0) <= 0 || isBusy}
        className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-60"
      >
        {isBusy ? "Processing…" : primaryLabel}
      </button>

      <p className="text-[10px] text-gray-500">
        Bank payments are processed by Stripe, secure and encrypted. You’ll see a confirmation
        after the payment is submitted,
      </p>
    </div>
  );
}

