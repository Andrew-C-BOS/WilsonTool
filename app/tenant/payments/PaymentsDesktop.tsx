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
export default function PaymentsDesktop({ appId, firmId, type }: { appId: string; firmId?: string; type: Kind; }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [chargesApi, setChargesApi] = useState<ChargesApi | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [returnUrl, setReturnUrl] = useState<string | null>(null);

  const lastFetchedKeyRef = useRef<string | null>(null);
  const stripePromise = useMemo(() => getStripe(), []);

  // Fetch
  useEffect(() => {
    const key = `${appId || ""}|${firmId || ""}`;
    const hasAppId = !!appId && !!`${appId}`.trim();
    const controller = new AbortController();
    let aborted = false;

    async function run() {
      if (!hasAppId) { setLoading(false); setSummary(null); setChargesApi(null); return; }
      if (lastFetchedKeyRef.current === key) return;
      lastFetchedKeyRef.current = key;

      setLoading(true);
      const qs = new URLSearchParams();
      qs.set("appId", appId);
      if (firmId) qs.set("firmId", firmId);

      let base: Summary | null = null;
      let api: ChargesApi | null = null;

      try {
        const res = await fetch(`/api/tenant/payments/summary?${qs.toString()}`, { cache: "no-store", signal: controller.signal });
        if (res.ok) {
          const j = await res.json();
          base = {
            ok: !!j?.ok,
            upfrontDueCents: Number(j?.upfrontDueCents || 0),
            depositDueCents: Number(j?.depositDueCents || 0),
            upfrontMinCents: Number.isFinite(j?.upfrontMinCents) ? Number(j?.upfrontMinCents) : undefined,
            depositMinCents: Number.isFinite(j?.depositMinCents) ? Number(j?.depositMinCents) : undefined,
          };
        }
      } catch {}

      try {
        const res = await fetch(`/api/tenant/charges?${qs.toString()}`, { cache: "no-store", signal: controller.signal });
        if (res.ok) api = await res.json();
      } catch {}

      // fallback receipts
      let fallbackReceipts: ChargesApi["receipts"] | undefined;
      try {
        if (!api?.receipts) {
          const res = await fetch(`/api/tenant/payments/list?${qs.toString()}`, { cache: "no-store", signal: controller.signal });
          if (res.ok) {
            const j = await res.json();
            const items: PaymentLite[] = Array.isArray(j?.items) ? j.items : [];
            fallbackReceipts = items.slice(0, 10).map(p => ({
              id: p._id, kind: p.kind, status: p.status, amountCents: p.amountCents, createdAt: p.createdAt, receiptUrl: p.receiptUrl,
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
    return () => { aborted = true; controller.abort(); };
  }, [appId, firmId]);

  // Derived
  const w = chargesApi?.windows;
  const countersignRem = chargesApi?.countersign?.upfrontMinRemainingCents ?? null;
  const countersignMin = chargesApi?.countersign?.upfrontMinThresholdCents ?? null;
  const countersignMet = chargesApi?.countersign?.upfrontMet ?? null;
  const upfrontDue = chargesApi?.dueUpfrontCents ?? 0;
  const nextRentRemaining = chargesApi?.nextRent?.remainingCents ?? 0;

  // Source of truth: remaining deposit from charges
  const depositRemaining = useMemo(() => {
    const rows = chargesApi?.charges ?? [];
    return rows
      .filter(c => c.bucket === "deposit")
      .reduce((s, c) => s + Math.max(0, c.remainingCents ?? 0), 0);
  }, [chargesApi?.charges]);

  // Presets from SERVER policy
  const presets = useMemo(() => {
    const out: { label: string; bucket: "upfront" | "deposit"; amount: number; reason: string }[] = [];

    // Operating/upfront allowed
    const allowedUpfront = chargesApi?.allowed?.upfront ?? [];
    const allowedDeposit = chargesApi?.allowed?.deposit ?? [];

    // First: countersign if present (and >0) – pick the closest allowed amount (>= countersignRem)
    if ((countersignRem ?? 0) > 0) {
      const pick = allowedUpfront.find(v => v >= (countersignRem ?? 0)) ?? allowedUpfront[0];
      if (pick && pick > 0) {
        out.push({ label: `Countersign (${money(pick)})`, bucket: "upfront", amount: pick, reason: "operating_to_countersign" });
      }
    }

    // If any up-front due, offer the largest allowed upfront as “Full up-fronts”
    if (upfrontDue > 0 && allowedUpfront.length > 0) {
      const maxU = Math.max(...allowedUpfront);
      out.push({ label: `Full up-fronts (${money(maxU)})`, bucket: "upfront", amount: maxU, reason: "operating_all_now" });
    }

    // Only when NO upfront due, allow completing next month (fallback to an allowed amount closest to nextRent)
    if (upfrontDue === 0 && nextRentRemaining > 0 && allowedUpfront.length > 0) {
      const exact = allowedUpfront.find(v => v === nextRentRemaining);
      const near = exact ?? allowedUpfront.find(v => v >= nextRentRemaining) ?? allowedUpfront[0];
      if (near && near > 0) {
        out.push({ label: `Complete next month (${money(near)})`, bucket: "upfront", amount: near, reason: "operating_complete_month" });
      }
    }

    // Deposit only if remaining > 0 and server allows a number
    if (depositRemaining > 0) {
      const dep = (allowedDeposit && allowedDeposit[0]) || depositRemaining;
      if (dep > 0) {
        out.push({ label: `Deposit (${money(dep)})`, bucket: "deposit", amount: dep, reason: "deposit_minimum" });
      }
    }

    // De-dup + sort by amount descending for clarity
    const seen = new Set<string>();
    return out
      .filter(p => {
        const k = `${p.bucket}:${p.amount}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => b.amount - a.amount);
  }, [chargesApi?.allowed?.upfront, chargesApi?.allowed?.deposit, countersignRem, upfrontDue, nextRentRemaining, depositRemaining]);

  // Start payment
  const startPayment = useCallback(
    async (kind: "upfront" | "deposit", amountCents: number, reasonLabel?: string) => {
      if (!appId || !`${appId}`.trim()) { setToast("Missing application,"); return; }
      if (!Number.isFinite(amountCents) || amountCents <= 0) return;

      const busyKey = `${kind}:${amountCents}`;
      setBusy(busyKey); setToast(null);

      // Simple requestId for idempotency on the server
      const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

      try {
        const res = await fetch("/api/tenant/payments/session?debug=1", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            appId,
            firmId: firmId || null,
            type: kind,              // server treats "upfront" as "operating"
            amountCents,
            reason: reasonLabel ?? null,
            requestId,
          }),
        });

        // Helpful errors
        if (!res.ok) {
          const err = await res.json().catch(() => ({} as any));
          if (err?.error === "amount_not_allowed") {
            if (err?.detail?.lineItemExacts) {
              setToast(
                `Amount not allowed. Try one of: ${err.detail.lineItemExacts
                  .map((n: number) => money(n))
                  .join(", ")}`
              );
            } else if (err?.detail?.required) {
              setToast(`Deposit must be exactly ${money(err.detail.required)}.`);
            } else if (err?.detail?.minTopUpCents && err?.detail?.maxTopUpCents) {
              setToast(`Pick between ${money(err.detail.minTopUpCents)} and ${money(err.detail.maxTopUpCents)}.`);
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
        if (j?.url) { window.location.assign(j.url as string); return; }
        if (j?.clientSecret) {
          setClientSecret(j.clientSecret as string);
          setReturnUrl(
            j?.returnUrl ||
            `/tenant/payments/result?appId=${encodeURIComponent(appId)}&type=${encodeURIComponent(kind)}`
          );
          return;
        }
        if (j?.ok) { window.location.reload(); return; }
        setToast("Unexpected response,");
      } catch (e: any) {
        setToast(e?.message || "Couldn’t start payment,");
      } finally {
        setBusy(null);
      }
    },
    [appId, firmId]
  );

  // Elements screen
  if (clientSecret && returnUrl) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-6">
        <h1 className="text-base font-semibold text-gray-900">Complete payment</h1>
        <p className="mt-1 text-sm text-gray-600">Connect your bank, finish the payment, you’re done.</p>
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5">
          <Elements key={clientSecret} stripe={awaitedStripeOrNull(stripePromise)} options={{ clientSecret, appearance: { theme: "stripe" } }}>
            <PaymentCheckoutForm
              returnUrl={`${typeof window !== "undefined" ? window.location.origin : ""}${returnUrl}`}
              onDone={() => { setClientSecret(null); setReturnUrl(null); }}
            />
          </Elements>
        </div>
        {toast && <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">{toast}</div>}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-6">
      {/* Status strip */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <Badge tone="blue">Due now {money(w?.dueNowCents ?? 0)}</Badge>
            {typeof countersignMin === "number" && (
              <Badge tone={countersignMet ? "emerald" : "amber"}>
                {countersignMet ? "Countersign met" : `Countersign min ${money(countersignMin)}`}
              </Badge>
            )}
            {typeof chargesApi?.countersign?.depositMinThresholdCents === "number" && (
              <Badge tone={chargesApi?.countersign?.depositMet ? "emerald" : "amber"}>
                {chargesApi?.countersign?.depositMet ? "Deposit met" : `Deposit min ${money(chargesApi!.countersign!.depositMinThresholdCents!)}`}
              </Badge>
            )}
            {w?.moveInDateISO && <Badge tone="gray">Move-in {w.moveInDateISO}</Badge>}
          </div>
          <div className="text-xs text-gray-600">
            Before move-in {money(w?.dueBeforeMoveInCents ?? 0)}, next 30 days {money(w?.dueNext30Cents ?? 0)}, later {money(w?.laterCents ?? 0)}
          </div>
        </div>
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        {/* LEFT */}
        <div className="space-y-4">
          {/* Up-fronts */}
          <Card title="Get your keys" subtitle="Covers Key, First, Last. Extra rolls into monthly rent.">
            <UpfrontMini
              charges={chargesApi?.charges}
              allocations={summary?.__mv?.allocationsByCharge}
              nextRent={chargesApi?.nextRent}
            />
          </Card>

          {/* Deposit card (hidden if fully covered) */}
          {depositRemaining > 0 && (
            <Card title="Security deposit (escrow)" subtitle="Held in a separate, regulated account.">
              <div className="flex items-end justify-between gap-3 text-sm">
                <div className="space-y-1">
                  <div className="text-gray-700">Due now: <span className="font-semibold">{money(depositRemaining)}</span></div>
                  <div className="text-[11px] text-amber-900">May earn interest per state law, handled separately.</div>
                </div>
                <button
                  onClick={() => startPayment("deposit", Math.max(0, depositRemaining), "deposit_minimum")}
                  disabled={depositRemaining <= 0 || !!busy}
                  className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-black disabled:opacity-60"
                >
                  {busy?.startsWith("deposit:") ? "Processing…" : `Pay ${money(depositRemaining)}`}
                </button>
              </div>
            </Card>
          )}

          {/* Monthly rent summary */}
          <Card title="Monthly rent" subtitle="Standard monthly charges after move-in.">
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <div className="space-y-1">
                <div className="text-gray-700">
                  Next rent due:&nbsp;
                  <span className="font-semibold">
                    {chargesApi?.nextRent ? `${chargesApi.nextRent.ym}: ${money(chargesApi.nextRent.remainingCents)}` : "—"}
                  </span>
                </div>
                <div className="text-[11px] text-gray-600 flex items-center gap-2">
                  {chargesApi?.firstCovered && <Badge tone="emerald">First prepaid</Badge>}
                  {chargesApi?.lastCovered && <Badge tone="emerald">Last prepaid</Badge>}
                  {!chargesApi?.firstCovered && !chargesApi?.lastCovered && <span>No months prepaid.</span>}
                </div>
              </div>
            </div>
          </Card>

          {/* Receipts */}
          <details className="rounded-xl border border-gray-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-semibold text-gray-900">Receipts</summary>
            <div className="mt-3 overflow-hidden rounded-lg border border-gray-200">
              <ul className="divide-y divide-gray-200 bg-white">
                {(chargesApi?.receipts ?? [])
                  .sort((a, b) => (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()))
                  .slice(0, 12)
                  .map(r => (
                    <li key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge tone={r.status === "succeeded" ? "emerald" : r.status === "processing" ? "gray" : "rose"}>{r.status}</Badge>
                        <span className="text-gray-700 capitalize">{r.kind === "upfront" ? "lease" : r.kind}</span>
                        <span className="text-xs text-gray-500">{new Date(r.createdAt).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-gray-900 font-medium">{money(r.amountCents)}</div>
                        {r.receiptUrl ? <a href={r.receiptUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-700 underline">Receipt</a> : <span className="text-xs text-gray-400">No receipt</span>}
                      </div>
                    </li>
                  ))}
              </ul>
            </div>
          </details>
        </div>

        {/* RIGHT: sticky pay panel */}
        <aside className="lg:sticky lg:top-6">
          <Card as="div" title="Make a payment" subtitle="Pick an amount, pay from your bank.">
            <SmartPayPanel
              presets={presets}
              charges={chargesApi?.charges}
              allocations={summary?.__mv?.allocationsByCharge}
              onPay={(bucket, amount, reason) => startPayment(bucket, amount, reason)}
              busyKey={busy}
            />
          </Card>
        </aside>
      </div>

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
          <div className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
            {toast} <button className="ml-3 underline" onClick={() => setToast(null)}>Close</button>
          </div>
        </div>
      )}
    </main>
  );
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
  presets, charges, allocations, onPay, busyKey,
}: {
  presets: { label: string; bucket: "upfront" | "deposit"; amount: number; reason: string }[];
  charges?: Charge[];
  allocations?: AllocationByCharge[];
  onPay: (bucket: "upfront" | "deposit", amount: number, reason: string) => void;
  busyKey: string | null;
}) {
  const [picked, setPicked] = useState<(typeof presets)[number] | null>(presets[0] || null);

  // Coverage preview only for upfront presets
  const cov = useMemo(() => {
    if (!picked || picked.bucket !== "upfront" || picked.amount <= 0) return null;
    return computeCoverage(picked.amount, charges, allocations);
  }, [picked, charges, allocations]);

  return (
    <div className="space-y-4">
      {/* Presets only (no custom amounts) */}
      {presets.length > 0 ? (
        <div className="flex flex-col gap-2">
          {presets.map((p, i) => {
            const active = picked?.label === p.label && picked.amount === p.amount && picked.bucket === p.bucket;
            return (
              <button
                key={`${p.label}-${i}`}
                onClick={() => setPicked(p)}
                className={clsx(
                  "flex items-center justify-between rounded-md border px-3 py-2 text-sm",
                  active ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white hover:bg-gray-50"
                )}
              >
                <span>{p.label}</span>
                <span className={clsx("text-xs", active ? "text-white/80" : "text-gray-600")}>
                  {p.bucket === "upfront" ? "Lease" : "Deposit"}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">Nothing due right now.</div>
      )}

      {/* Coverage explainer for selected upfront preset */}
      {picked?.bucket === "upfront" && picked.amount > 0 && (
        <div className="rounded-md border border-gray-200 p-3 text-[11px] text-gray-700">
          {cov && (cov.pieces.length > 0 || cov.leftoverCents > 0) ? (
            <>
              This payment will cover:&nbsp;
              {cov.pieces.length === 0 ? <span className="text-gray-600">No remaining move-in items.</span> : (
                <>
                  {cov.pieces.map((p, idx) => (
                    <span key={idx}>
                      <b>{p.label}</b>{p.fullyCovered ? "" : ` (${money(p.amountCents)} partial)`}{idx < cov.pieces.length - 1 ? ", " : ""}
                    </span>
                  ))}
                  {cov.leftoverCents > 0 && <>, then <b>{money(cov.leftoverCents)}</b> rolls into monthly rent.</>}
                </>
              )}
            </>
          ) : (
            <span>Payments apply in this order: <b>Last → First → Key</b>, extra rolls into monthly rent.</span>
          )}
        </div>
      )}

      {/* Primary CTA */}
      <button
        onClick={() => picked && onPay(picked.bucket, Math.max(0, picked.amount), picked.reason)}
        disabled={!picked || Math.max(0, picked?.amount ?? 0) <= 0 || !!busyKey}
        className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-60"
      >
        {busyKey ? "Processing…" : picked ? `Pay ${money(Math.max(0, picked.amount))}` : "Select an amount"}
      </button>
      <p className="text-[10px] text-gray-500">Bank payments are processed by Stripe, secure and encrypted.</p>
    </div>
  );
}

/* ---------- unwrap the stripe promise in JSX ---------- */
function awaitedStripeOrNull(p: Promise<import("@stripe/stripe-js").Stripe | null>) {
  return p as unknown as import("@stripe/stripe-js").Stripe | null;
}
