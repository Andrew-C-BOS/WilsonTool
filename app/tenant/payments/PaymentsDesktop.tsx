"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { CheckCircle2, X } from "lucide-react";
/* ─────────────────────────────────────────────────────────────
   Small utilities
───────────────────────────────────────────────────────────── */
function clsx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

function money(cents?: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format((cents || 0) / 100);
}

type Kind = "" | "upfront" | "deposit";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY as string,
);

function dateFromISODateOnly(iso?: string | null): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/* ─────────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────────── */

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
  status:
    | "created"
    | "processing"
    | "succeeded"
    | "failed"
    | "canceled"
    | "returned";
  amountCents: number;
  rails?: "ach" | "card";
  receiptUrl?: string | null;
  providerIds?: { paymentIntentId?: string };
  createdAt: string;
  updatedAt?: string;
};

type AllocationByCharge = {
  chargeKey: string;
  postedCents: number;
  pendingCents: number;
};

type MoneyView = {
  dueUpfrontCents: number;
  dueDepositCents: number;
  charges?: Charge[];
  payments?: PaymentLite[];
  statusCounts?: Record<string, number>;
  allocationsByCharge?: AllocationByCharge[];
};

type SummaryPlan = {
  signing: {
    upfrontThresholdCents: number;
    depositThresholdCents: number;
  };
  moveIn: {
    firstMonthCents: number;
    lastMonthCents: number;
    keyFeeCents: number;
    securityDepositCents: number;
    totalUpfrontCents: number;
    requireFirstBeforeMoveIn: boolean;
    requireLastBeforeMoveIn: boolean;
    stepTwoOperatingCents?: number;
    stepTwoDepositCents?: number;
  };
  monthly: {
    monthlyRentCents: number;
    termMonths: number;
    moveInDateISO: string | null;
    totalScheduledRentCents: number;
  };
};

type SummaryStepProgress = {
  operatingTotalCents: number;
  depositTotalCents: number;
  operatingPaidCents: number;
  depositPaidCents: number;
  operatingRemainingCents: number;
  depositRemainingCents: number;
  remainingTotalCents: number;
  met: boolean;
};

type SummaryProgress = {
  step1?: SummaryStepProgress;
  step2?: SummaryStepProgress;
  totals?: {
    operatingPaidCents: number;
    depositPaidCents: number;
  };
  currentStep?: number;
};

type Summary = {
  ok: boolean;
  upfrontDueCents: number;
  depositDueCents: number;
  upfrontMinCents?: number;
  depositMinCents?: number;
  __mv?: MoneyView;
  plan?: SummaryPlan;
  progress?: SummaryProgress;
};

type ChargesApi = {
  ok: boolean;
  charges: Charge[];
  dueUpfrontCents: number;
  dueDepositCents: number;
  grossUpfrontCents: number;
  grossDepositCents: number;
  windows?: {
    dueNowCents: number;
    dueBeforeMoveInCents: number;
    dueNext30Cents: number;
    laterCents: number;
    moveInDateISO: string | null;
  };
  nextRent?: {
    ym: string;
    dueDateISO: string | null;
    amountCents: number;
    remainingCents: number;
  } | null;
  firstCovered?: boolean;
  lastCovered?: boolean;
  receipts?: Array<{
    id: string;
    kind: "upfront" | "deposit" | "rent" | "fee";
    status:
      | "processing"
      | "succeeded"
      | "failed"
      | "canceled"
      | "returned"
      | "created";
    amountCents: number;
    createdAt: string;
    receiptUrl?: string | null;
  }>;
};

/* ─────────────────────────────────────────────────────────────
   Wallet types
───────────────────────────────────────────────────────────── */

type WalletMethod = {
  id: string;
  type: "us_bank_account";
  bankName: string;
  last4: string | null;
  accountType: string | null;
};

/* ─────────────────────────────────────────────────────────────
   Simple atoms
───────────────────────────────────────────────────────────── */

function CardShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 sm:p-5 shadow-sm backdrop-blur">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle && (
          <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function BankLinkForm({
  clientSecret,
  onComplete,
  onCancel,
}: {
  clientSecret: string;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    const { error: stripeError } = await stripe.confirmSetup({
      elements,
      confirmParams: {},
      redirect: "if_required",
    });

    if (stripeError) {
      setError(stripeError.message || "Could not link bank account,");
      setSubmitting(false);
      return;
    }

    onComplete();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
          {error}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!stripe || !elements || submitting}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-black disabled:opacity-60"
        >
          {submitting ? "Linking…" : "Link bank account"}
        </button>
      </div>
    </form>
  );
}

function StageCard({
  step,
  title,
  amountCents,
  met,
  accent = "pink",
  children,
}: {
  step: number;
  title: string;
  amountCents: number;
  met: boolean;
  accent?: "pink" | "amber" | "sky";
  children: React.ReactNode;
}) {
  const palette = {
    pink: {
      stepBg: "bg-rose-100",
      stepText: "text-slate-800",
      pillMet: "bg-emerald-50 text-emerald-700",
      pillPending: "bg-rose-50 text-rose-700",
    },
    amber: {
      stepBg: "bg-amber-100",
      stepText: "text-slate-800",
      pillMet: "bg-emerald-50 text-emerald-700",
      pillPending: "bg-amber-50 text-amber-800",
    },
    sky: {
      stepBg: "bg-sky-100",
      stepText: "text-slate-800",
      pillMet: "bg-emerald-50 text-emerald-700",
      pillPending: "bg-sky-50 text-sky-800",
    },
  }[accent];

  const stepCircleClasses = met
    ? "bg-emerald-100 text-emerald-900"
    : clsx(palette.stepBg, palette.stepText);

  return (
    <div
      className={clsx(
        "flex h-full flex-col rounded-2xl px-4 py-4 shadow-sm border",
        met ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={clsx(
              "inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold shadow-sm ring-1 ring-slate-200",
              stepCircleClasses,
            )}
          >
            {step}
          </span>

          <div className="flex flex-col">
            <span className="text-[12px] font-semibold text-slate-900">
              {title}
            </span>
            <span className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-400">
              {met ? "Already paid" : "Amount tied to this step"}
            </span>
          </div>
        </div>

        <div className="text-right">
          <div className="text-[10px] text-slate-400">
            {met ? "You paid" : "Total"}
          </div>
          <div className="text-sm font-semibold text-slate-900">
            {money(amountCents)}
          </div>
        </div>
      </div>

      {/* Only show the detailed explanation while this step is still required */}
      {!met && (
        <div
          className={clsx(
            "mt-3 text-[11px] leading-relaxed text-slate-700",
            "[&_p]:text-slate-700 [&_li]:text-slate-700 [&_span]:text-slate-700 [&_strong]:text-slate-900 [&_.font-semibold]:text-slate-900",
          )}
        >
          {children}
        </div>
      )}

      <div className={clsx("mt-3", met && "mt-2")}>
        <span
          className={clsx(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium shadow-sm ring-1 ring-slate-200",
            met ? palette.pillMet : palette.pillPending,
          )}
        >
          <span className="mr-1 flex h-1.5 w-1.5 items-center justify-center rounded-full bg-current" />
          {met ? "Completed" : "Still required"}
        </span>
      </div>
    </div>
  );
}

function BankCard({
  method,
  isActive,
  isDefault,
  onSelect,
  onUnlink,
}: {
  method: WalletMethod;
  isActive: boolean;
  isDefault: boolean;
  onSelect: () => void;
  onUnlink: () => void;
}) {
  const label =
    method.accountType === "checking" || method.accountType === "savings"
      ? `${method.accountType[0].toUpperCase()}${method.accountType.slice(1)}`
      : "Bank account";

  let badge: React.ReactNode;
  if (isActive) {
    badge = (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
        Active for payments
      </span>
    );
  } else if (isDefault) {
    badge = (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/70 px-2 py-0.5 text-[10px] font-medium text-slate-200">
        Default
      </span>
    );
  } else {
    badge = (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium opacity-0">
        <span className="h-1.5 w-1.5 rounded-full" />
        Active for payments
      </span>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={clsx(
        "group flex h-full flex-col rounded-2xl p-[1px] text-left transition-shadow cursor-pointer",
        isActive
          ? "border-transparent bg-gradient-to-br from-slate-200 via-slate-100 to-slate-200 shadow-md"
          : "border-transparent bg-gradient-to-br from-slate-100 via-white to-slate-100 shadow-sm",
      )}
    >
      <div
        className={clsx(
          "flex h-full flex-col rounded-2xl bg-gradient-to-br from-slate-900/95 via-slate-900/90 to-slate-950/95 p-4 sm:p-5 text-slate-50",
          isActive ? "ring-2 ring-emerald-400/80" : "ring-1 ring-slate-900/40",
        )}
      >
        <div className="flex items-start justify-between text-[11px]">
          <div className="flex flex-col">
            <span className="uppercase tracking-[0.18em] text-slate-300/80">
              {label}
            </span>
            <span className="mt-1 text-sm font-semibold text-slate-50">
              {method.bankName}
            </span>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="min-h-[20px] flex items-center">{badge}</div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUnlink();
              }}
              className="mt-1 inline-flex items-center gap-1 rounded-full border border-slate-700/70 bg-slate-900/70 px-2 py-0.5 text-[10px] font-medium text-slate-300 hover:bg-slate-800/80"
            >
              <span className="h-2 w-2 rounded-[2px] bg-slate-400" />
              Remove
            </button>
          </div>
        </div>

        <div className="mt-6 space-y-1 text-sm font-medium tracking-[0.24em]">
          <div className="text-slate-100/95">
            •••• •••• •••• {method.last4 ?? "••••"}
          </div>
          <div className="text-[11px] tracking-normal text-slate-400">
            ACH · {label}
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const [summary, setSummary] = useState<Summary | null>(null);
  const [chargesApi, setChargesApi] = useState<ChargesApi | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [wallet, setWallet] = useState<WalletMethod[]>([]);
  const [walletDefaultId, setWalletDefaultId] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState<boolean>(true);

  const [linkClientSecret, setLinkClientSecret] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  const [selectedPaymentMethodId, setSelectedPaymentMethodId] =
    useState<string | null>(null);

  const lastFetchedKeyRef = useRef<string | null>(null);

  const [creatingSession, setCreatingSession] = useState(false);
  const [monthsToPrepay, setMonthsToPrepay] = useState<number>(1);
  
  const [lastPayment, setLastPayment] = useState<{
    amountCents: number;
    bankLabel: string;
  } | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  /* ─────────────────────────────────────────────────────────────
     Fetch summary + charges (for receipts/windows)
  ────────────────────────────────────────────────────────────── */
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
      setErrorMsg(null);
      const qs = new URLSearchParams();
      qs.set("appId", appId);
      if (firmId) qs.set("firmId", firmId);

      let base: Summary | null = null;
      let api: ChargesApi | null = null;

      try {
        const res = await fetch(
          `/api/tenant/payments/summary?${qs.toString()}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
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
            plan: j?.plan,
            progress: j?.progress,
          };
        } else {
          setErrorMsg("Couldn’t load payment summary,");
        }
      } catch {
        setErrorMsg("Couldn’t load payment summary,");
      }

      try {
        const res = await fetch(`/api/tenant/charges?${qs.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (res.ok) api = await res.json();
      } catch {
        // ignore
      }

      // fallback receipts from payments/list if chargesApi has no receipts
      let fallbackReceipts: ChargesApi["receipts"] | undefined;
      try {
        if (!api?.receipts) {
          const res = await fetch(
            `/api/tenant/payments/list?${qs.toString()}`,
            {
              cache: "no-store",
              signal: controller.signal,
            },
          );
          if (res.ok) {
            const j = await res.json();
            const items: PaymentLite[] = Array.isArray(j?.items) ? j.items : [];
            fallbackReceipts = items.slice(0, 20).map((p) => ({
              id: p._id,
              kind: p.kind,
              status: p.status,
              amountCents: p.amountCents,
              createdAt: p.createdAt,
              receiptUrl: p.receiptUrl,
            }));
          }
        }
      } catch {
        // ignore
      }

      if (!aborted) {
        setSummary(base);
        setChargesApi(
          api ? { ...api, receipts: api.receipts ?? fallbackReceipts } : null,
        );
        setLoading(false);
      }
    }

    run();
    return () => {
      aborted = true;
      controller.abort();
    };
  }, [appId, firmId]);

  /* ─────────────────────────────────────────────────────────────
     Fetch wallet methods
  ────────────────────────────────────────────────────────────── */
  useEffect(() => {
    let aborted = false;

    async function run() {
      setWalletLoading(true);
      try {
        const res = await fetch("/api/tenant/payment-methods?debug=1", {
          cache: "no-store",
        });
        if (!res.ok) {
          if (!aborted) {
            setWallet([]);
            setWalletDefaultId(null);
          }
          return;
        }
        const j = await res.json();
        if (aborted) return;
        const items: WalletMethod[] = Array.isArray(j?.items) ? j.items : [];
        setWallet(items);
        setWalletDefaultId(
          typeof j?.defaultPaymentMethodId === "string"
            ? j.defaultPaymentMethodId
            : null,
        );
      } catch {
        if (!aborted) {
          setWallet([]);
          setWalletDefaultId(null);
        }
      } finally {
        if (!aborted) setWalletLoading(false);
      }
    }

    run();
    return () => {
      aborted = true;
    };
  }, []);

  // initial selected method
  useEffect(() => {
    if (walletLoading) return;
    if (wallet.length === 0) {
      setSelectedPaymentMethodId(null);
      return;
    }
    setSelectedPaymentMethodId((prev) => {
      if (prev && wallet.some((m) => m.id === prev)) return prev;
      if (walletDefaultId && wallet.some((m) => m.id === walletDefaultId)) {
        return walletDefaultId;
      }
      return wallet[0].id;
    });
  }, [walletLoading, wallet, walletDefaultId]);
  
  const refreshReceipts = React.useCallback(async () => {
    if (!appId) return;

    const qs = new URLSearchParams();
    qs.set("appId", appId);
    if (firmId) qs.set("firmId", firmId);

    try {
      const res = await fetch(`/api/tenant/payments/list?${qs.toString()}`, {
        cache: "no-store",
      });

      if (!res.ok) {
        console.warn("[payments] refreshReceipts non-OK", await res.text());
        return;
      }

      const j = await res.json();
      const items: PaymentLite[] = Array.isArray(j?.items) ? j.items : [];

      const mapped =
        items.slice(0, 50).map((p) => ({
          id: p._id,
          kind: p.kind,
          status: p.status,
          amountCents: p.amountCents,
          createdAt: p.createdAt,
          receiptUrl: p.receiptUrl,
        })) ?? [];

      setChargesApi((prev) =>
        prev ? { ...prev, receipts: mapped } : prev,
      );
    } catch (err) {
      console.error("[payments] refreshReceipts error", err);
    }
  }, [appId, firmId]);

  /* ─────────────────────────────────────────────────────────────
     Derived values from summary + charges
  ────────────────────────────────────────────────────────────── */

  const plan = summary?.plan;
  const progress = summary?.progress;
  const w = chargesApi?.windows;

  // Receipts list for history
  const receipts = useMemo(
    () =>
      (chargesApi?.receipts ?? [])
        .slice()
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
    [chargesApi?.receipts],
  );
  
    useEffect(() => {
		// Only auto-refresh if there are pending-ish payments
		const hasPending = receipts.some(
		  (r) => r.status === "processing" || r.status === "created",
		);
		if (!hasPending) return;

		let cancelled = false;

		const intervalId = setInterval(() => {
		  if (cancelled) return;
		  refreshReceipts();
		}, 8000); // 8s cadence – tune however you like

		return () => {
		  cancelled = true;
		  clearInterval(intervalId);
		};
	  }, [receipts, refreshReceipts]);


  // Upfront breakdown from charges for explanatory text
  const upfrontSummary = useMemo(() => {
    const rows = chargesApi?.charges ?? [];
    const upfront = rows.filter((c) => c.bucket === "upfront");
    const deposit = rows.find((c) => c.bucket === "deposit");

    let first: Charge | undefined;
    let last: Charge | undefined;
    let key: Charge | undefined;
    let totalUpfront = 0;
    let remainingUpfront = 0;

    for (const c of upfront) {
      totalUpfront += c.amountCents ?? 0;
      remainingUpfront += Math.max(0, c.remainingCents ?? 0);
      if (c.code === "first_month") first = c;
      if (c.code === "last_month") last = c;
      if (c.code === "key_fee") key = c;
    }

    return {
      totalUpfrontCents: totalUpfront,
      remainingUpfrontCents: remainingUpfront,
      first,
      last,
      key,
      deposit,
    };
  }, [chargesApi?.charges]);

  const nextRentRemaining = chargesApi?.nextRent?.remainingCents ?? 0;
  const nextRent = money(nextRentRemaining);

  // Step 1 totals / progress from summary
  const step1 = progress?.step1;
  const step2 = progress?.step2;

  const step1OperatingTotal = step1?.operatingTotalCents ?? 0;
  const step1DepositTotal = step1?.depositTotalCents ?? 0;
  const signingRequiredCents = step1OperatingTotal + step1DepositTotal;

  const step1OperatingRemaining = step1?.operatingRemainingCents ?? 0;
  const step1DepositRemaining = step1?.depositRemainingCents ?? 0;
  const step1PayAmountCents = step1?.remainingTotalCents ?? 0;
  const signingPaidCents = Math.max(
    0,
    signingRequiredCents - step1PayAmountCents,
  );
  const signingMet = !!step1?.met;

  const inStep1 = step1PayAmountCents > 0;

  // Step 2 totals / progress from summary
  const step2OperatingTotal = step2?.operatingTotalCents ?? 0;
  const step2DepositTotal = step2?.depositTotalCents ?? 0;
  const moveInStepTwoPlannedCents =
    step2OperatingTotal + step2DepositTotal;

  const step2OperatingRemaining = step2?.operatingRemainingCents ?? 0;
  const step2DepositRemaining = step2?.depositRemainingCents ?? 0;
  const step2PayAmountCents = step2?.remainingTotalCents ?? 0;

  const preMoveInDueNowCents = step2PayAmountCents;

  const inStep2 = !inStep1 && step2PayAmountCents > 0;

  // Monthly rent (Step 3) from plan
   const monthlyRentBaseCents =
    plan?.monthly?.monthlyRentCents ||
    chargesApi?.nextRent?.amountCents ||
    0;

  const leaseTermMonthsFromPlan = plan?.monthly?.termMonths || 0;
  const rentCharges = (chargesApi?.charges ?? []).filter(
    (c) => c.bucket === "rent",
  );
  const leaseTermMonths =
    leaseTermMonthsFromPlan || rentCharges.length;

  const firstPrepaid =
    (plan?.moveIn?.firstMonthCents || 0) > 0 ? 1 : 0;
  const lastPrepaid =
    (plan?.moveIn?.lastMonthCents || 0) > 0 ? 1 : 0;
  const prepaidMonths = firstPrepaid + lastPrepaid;

  // Count any successful rent payments already made
	const rentPaidCents = receipts.reduce((sum, r) => {
		const isRent =
		  r.kind === "rent" &&
		  (r.status === "succeeded" || r.status === "processing");
		if (!isRent) return sum;
		return sum + (r.amountCents ?? 0);
	  }, 0);

	  const rentPaymentsMadeCount =
		monthlyRentBaseCents > 0
		  ? Math.floor(rentPaidCents / monthlyRentBaseCents)
		  : 0;

	  const remainingRentPayments = Math.max(
		0,
		leaseTermMonths - prepaidMonths - rentPaymentsMadeCount,
	  );
	  
  const moveInTotalPlannedCents =
    plan?.moveIn?.totalUpfrontCents ??
    upfrontSummary.totalUpfrontCents +
      (upfrontSummary.deposit?.amountCents || 0);

  // ── STEP 3–specific derived values ──────────────────────────

  // Next rent due date, falling back to move‑in date if needed
  const nextRentDueISO =
    chargesApi?.nextRent?.dueDateISO || plan?.monthly?.moveInDateISO || null;
	
  const nextRentDate =
    dateFromISODateOnly(chargesApi?.nextRent?.dueDateISO) ??
    dateFromISODateOnly(plan?.monthly?.moveInDateISO) ??
    null;

  const nextRentDueLabel = nextRentDate
    ? nextRentDate.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "your next rent due date";

  // "Current through" = the day before the next due date, if we have one
  const currentThroughLabel = nextRentDate
    ? (() => {
        const d = new Date(nextRentDate);
        d.setDate(d.getDate() - 1);
        return d.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
      })()
    : "today";

  // Max months we’ll let the renter prepay in the UI
  const maxMonthsPayable =
    remainingRentPayments || leaseTermMonths || 12;

  const clampedMonthsToPrepay = Math.min(
    Math.max(1, monthsToPrepay || 1),
    maxMonthsPayable,
  );

  const step3PayAmountCents =
    clampedMonthsToPrepay * monthlyRentBaseCents;
	
  const activeMethod = useMemo(() => {
    if (!selectedPaymentMethodId) return null;
    return (
      wallet.find(
        (m) => ((m as any)._id ?? m.id) === selectedPaymentMethodId,
      ) ?? null
    );
  }, [wallet, selectedPaymentMethodId]);
  
  const activeBankLabelForModal = activeMethod
    ? `${activeMethod.bankName} •••• ${activeMethod.last4 ?? "••••"}`
    : "your selected bank account";

  const canPayStep1 =
    !!selectedPaymentMethodId &&
    step1PayAmountCents > 0 &&
    !creatingSession;

  const canPayStep2 =
    !!selectedPaymentMethodId &&
    step2PayAmountCents > 0 &&
    !creatingSession;

  /* ─────────────────────────────────────────────────────────────
     Layout
  ────────────────────────────────────────────────────────────── */

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top,_rgba(251,191,36,0.18),transparent_55%),radial-gradient(ellipse_at_top,_rgba(56,189,248,0.18),transparent_60%)]" />

      <div className="relative mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-10 pt-8 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="rounded-3xl bg-gradient-to-r from-slate-900/90 via-slate-900/95 to-slate-950 p-5 sm:p-6 shadow-sm ring-1 ring-slate-800/60">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-slate-800/80 px-3 py-1 text-[11px] font-medium text-slate-200">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-400/90 text-[10px] font-semibold text-slate-900">
                  3
                </span>
                <span>Step 3 · Payments for this lease</span>
              </div>
              <h1 className="mt-3 text-lg sm:text-xl font-semibold text-slate-50">
                How your payments work for this lease
              </h1>
              <p className="mt-1 text-xs sm:text-sm text-slate-300/90">
                Every payment you make goes toward{" "}
                <span className="font-medium text-slate-50">
                  rent, your security deposit,
                </span>{" "}
                or the permitted key fee. Some of this is due{" "}
                <span className="font-medium text-slate-50">
                  before your lease is signed,
                </span>{" "}
                some before you move in, and the rest as{" "}
                <span className="font-medium text-slate-50">
                  regular monthly rent
                </span>
                ,
              </p>
              {errorMsg && (
                <p className="mt-2 text-[11px] text-rose-300">
                  {errorMsg}
                </p>
              )}
            </div>

            <div className="flex flex-col items-end gap-1 text-right text-[11px] text-slate-300">
              <span className="font-semibold text-slate-50">
                Due today {money(w?.dueNowCents ?? 0)}
              </span>
              <span>
                Before move-in {money(w?.dueBeforeMoveInCents ?? 0)} · Later{" "}
                {money(w?.laterCents ?? 0)}
              </span>
              {w?.moveInDateISO && (
                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-slate-800/80 px-2 py-0.5 text-[10px] text-slate-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Move-in {w.moveInDateISO}
                </span>
              )}
            </div>
          </div>

          {/* Stage overview */}
          <div className="mt-4 space-y-3">
            <StageCard
              step={1}
              accent="pink"
              title="Before your lease is signed"
              amountCents={signingRequiredCents}
              met={!!step1?.met}
            >
              <p>
                Your total move-in amount for this lease is{" "}
                <span className="font-semibold text-slate-900">
                  {money(moveInTotalPlannedCents)}
                </span>
                , this covers:
              </p>

              <div className="mt-2 space-y-0.5">
                {(plan?.moveIn?.firstMonthCents || upfrontSummary.first) && (
                  <div>
                    • First month rent{" "}
                    <span className="font-semibold">
                      {money(
                        plan?.moveIn?.firstMonthCents ??
                          upfrontSummary.first?.amountCents ??
                          0,
                      )}
                    </span>
                  </div>
                )}
                {(plan?.moveIn?.lastMonthCents || upfrontSummary.last) && (
                  <div>
                    • Last month rent{" "}
                    <span className="font-semibold">
                      {money(
                        plan?.moveIn?.lastMonthCents ??
                          upfrontSummary.last?.amountCents ??
                          0,
                      )}
                    </span>
                  </div>
                )}
                {(plan?.moveIn?.keyFeeCents || upfrontSummary.key) && (
                  <div>
                    • Key fee{" "}
                    <span className="font-semibold">
                      {money(
                        plan?.moveIn?.keyFeeCents ??
                          upfrontSummary.key?.amountCents ??
                          0,
                      )}
                    </span>
                  </div>
                )}
                {(plan?.moveIn?.securityDepositCents ||
                  upfrontSummary.deposit) && (
                  <div>
                    • Security deposit{" "}
                    <span className="font-semibold">
                      {money(
                        plan?.moveIn?.securityDepositCents ??
                          upfrontSummary.deposit?.amountCents ??
                          0,
                      )}
                    </span>
                  </div>
                )}
              </div>

              <p className="mt-2">
                Instead of collecting all of this up front, your landlord only
                requires{" "}
                <span className="font-semibold text-slate-900">
                  {money(signingRequiredCents)}
                </span>{" "}
                before they sign your lease, the remaining{" "}
                <span className="font-semibold text-slate-900">
                  {money(moveInStepTwoPlannedCents)}
                </span>{" "}
                can be paid closer to move-in,
              </p>

              {signingRequiredCents > 0 && (
                <p className="mt-1">
                  You’ve paid{" "}
                  <span className="font-semibold">
                    {money(signingPaidCents)}
                  </span>{" "}
                  so far, with{" "}
                  <span className="font-semibold">
                    {money(step1PayAmountCents)}
                  </span>{" "}
                  still required for this step,
                </p>
              )}

              {(plan?.moveIn?.securityDepositCents ||
                upfrontSummary.deposit) && (
                <p className="mt-1">
                  Your security deposit is part of this total and is{" "}
                  <span className="font-semibold">refundable</span> at the end
                  of the lease (subject to damages and local rules), it does not
                  pay your last month’s rent,
                </p>
              )}
            </StageCard>

            <StageCard
              step={2}
              accent="amber"
              title="Before you move in"
              amountCents={moveInStepTwoPlannedCents}
              met={!!step2?.met && !inStep1}
            >
              <p>
                This is the portion of your move-in amount that your landlord
                lets you pay{" "}
                <span className="font-semibold">later</span>—after your lease is
                signed but before you move in,
              </p>

              <p className="mt-1">
                From the total{" "}
                <span className="font-semibold">
                  {money(moveInTotalPlannedCents)}
                </span>
                ,{" "}
                <span className="font-semibold">
                  {money(signingRequiredCents)}
                </span>{" "}
                is due in step 1, and the remaining{" "}
                <span className="font-semibold text-slate-900">
                  {money(moveInStepTwoPlannedCents)}
                </span>{" "}
                is tied to this step,
              </p>

              <p className="mt-1">
                Based on what you still owe today, you have{" "}
                <span className="font-semibold text-slate-900">
                  {money(step2PayAmountCents)}
                </span>{" "}
                left to pay for this step before move-in,
              </p>
            </StageCard>

            <StageCard
              step={3}
              accent="sky"
              title="Each month during your lease"
              amountCents={monthlyRentBaseCents}
              met={false}
            >
              <p>
                Your regular monthly rent is{" "}
                <span className="font-semibold text-slate-900">
                  {money(monthlyRentBaseCents)}
                </span>
                ,
              </p>

              {leaseTermMonths > 0 && (
                <p className="mt-1">
                  Your lease runs for{" "}
                  <span className="font-semibold">{leaseTermMonths}</span>{" "}
                  months in total, which means{" "}
                  <span className="font-semibold">{leaseTermMonths}</span> rent
                  payments over the term,
                </p>
              )}

              {leaseTermMonths > 0 && (firstPrepaid || lastPrepaid) && (
                <p className="mt-1">
                  Because{" "}
                  {firstPrepaid ? "your first month" : ""}
                  {firstPrepaid && lastPrepaid ? " and " : ""}
                  {lastPrepaid ? "your last month" : ""} is collected up front,
                  you’ll make{" "}
                  <span className="font-semibold">
                    {remainingRentPayments}
                  </span>{" "}
                  monthly rent payments after you move in,
                </p>
              )}

              {!leaseTermMonths && (
                <p className="mt-1">
                  Once your lease starts, you’ll pay this amount on the schedule
                  in your lease until the term ends,
                </p>
              )}
            </StageCard>
          </div>
        </header>

        {/* Payment methods row – wallet-based */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-100">
            Payment methods
          </h2>

          {walletLoading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="h-32 rounded-2xl bg-slate-900/60 animate-pulse" />
              <div className="h-32 rounded-2xl bg-slate-900/40 animate-pulse" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {wallet.map((m) => {
                  const subdocId = (m as any)._id ?? m.id;

                  return (
                    <BankCard
                      key={subdocId}
                      method={m}
                      isActive={selectedPaymentMethodId === subdocId}
                      isDefault={walletDefaultId === m.id}
                      onSelect={() => setSelectedPaymentMethodId(subdocId)}
                      onUnlink={async () => {
                        const targetId = subdocId;

                        try {
                          const res = await fetch(
                            `/api/tenant/payment-methods/${encodeURIComponent(
                              targetId,
                            )}?debug=1`,
                            {
                              method: "DELETE",
                              headers: { "content-type": "application/json" },
                            },
                          );

                          if (!res.ok) {
                            console.error(
                              "Failed to unlink payment method",
                              await res.text(),
                            );
                            return;
                          }
                        } catch (err) {
                          console.error("unlink error", err);
                          return;
                        }

                        setWallet((prev) => {
                          const remaining = prev.filter((x) => {
                            const xid = (x as any)._id ?? x.id;
                            return xid !== targetId;
                          });

                          setSelectedPaymentMethodId((prevSelected) => {
                            if (prevSelected !== targetId) return prevSelected;
                            const first = remaining[0];
                            return first
                              ? ((first as any)._id ?? first.id)
                              : null;
                          });

                          return remaining;
                        });
                      }}
                    />
                  );
                })}

                {/* "Add bank account" card */}
                <div className="rounded-2xl border border-dashed border-slate-600/60 bg-slate-950/60 p-4 text-xs sm:text-sm text-slate-300">
                  <button
                    type="button"
                    className="flex h-full flex-col items-start justify-between gap-3 text-left"
                    disabled={linking}
                    onClick={async () => {
                      try {
                        setLinking(true);
                        const res = await fetch(
                          "/api/tenant/payment-methods/setup",
                          {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ appId, firmId }),
                          },
                        );
                        if (!res.ok) {
                          setLinking(false);
                          return;
                        }
                        const j = await res.json();
                        if (j?.clientSecret) {
                          setLinkClientSecret(j.clientSecret as string);
                        }
                      } catch {
                        // ignore
                      } finally {
                        setLinking(false);
                      }
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-600 bg-slate-900 text-slate-200">
                        +
                      </span>
                      <div className="flex flex-col">
                        <span className="text-[12px] font-semibold text-slate-100">
                          Add bank account
                        </span>
                        <span className="mt-0.5 text-[11px] text-slate-400">
                          Link a bank account you’ll use for payments on this
                          lease,
                        </span>
                      </div>
                    </div>
                    <span className="mt-2 text-[10px] text-slate-500">
                      You can link more than one account and choose which one to
                      use when paying,
                    </span>
                  </button>
                </div>
              </div>

              {/* Bank link modal */}
              {linkClientSecret && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
                  <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-black/5">
                    <h2 className="text-sm font-semibold text-slate-900">
                      Link a bank account
                    </h2>
                    <p className="mt-1 text-[11px] text-slate-600">
                      Connect your bank securely with Stripe. You won’t be
                      charged yet — this just saves the account for future
                      payments.
                    </p>
                    <div className="mt-4">
                      <Elements
                        stripe={stripePromise}
                        options={{ clientSecret: linkClientSecret }}
                      >
                        <BankLinkForm
                          clientSecret={linkClientSecret}
                          onCancel={() => setLinkClientSecret(null)}
                          onComplete={async () => {
                            setLinkClientSecret(null);

                            const prevIds = wallet.map((m) => m.id);
                            const prevDefault = walletDefaultId;

                            const maxAttempts = 10;
                            const delayMs = 700;

                            const sleep = (ms: number) =>
                              new Promise((resolve) =>
                                setTimeout(resolve, ms),
                              );

                            let updated = false;

                            for (
                              let attempt = 1;
                              attempt <= maxAttempts;
                              attempt++
                            ) {
                              try {
                                const res = await fetch(
                                  "/api/tenant/payment-methods",
                                  {
                                    cache: "no-store",
                                  },
                                );

                                if (res.ok) {
                                  const data = await res.json();
                                  const items: WalletMethod[] = Array.isArray(
                                    data?.items,
                                  )
                                    ? data.items
                                    : [];

                                  const newDefaultId =
                                    typeof data?.defaultPaymentMethodId ===
                                    "string"
                                      ? data.defaultPaymentMethodId
                                      : null;

                                  const newIds = items.map((m) => m.id);

                                  const idsChanged =
                                    newIds.length !== prevIds.length ||
                                    newIds.some(
                                      (id) => !prevIds.includes(id),
                                    ) ||
                                    prevIds.some(
                                      (id) => !newIds.includes(id),
                                    );

                                  const defaultChanged =
                                    newDefaultId !== prevDefault;

                                  if (
                                    idsChanged ||
                                    defaultChanged ||
                                    attempt === maxAttempts
                                  ) {
                                    setWallet(items);
                                    setWalletDefaultId(newDefaultId);

                                    if (items.length > 0) {
                                      const nextSelected =
                                        newDefaultId ??
                                        items[0].id ??
                                        null;
                                      setSelectedPaymentMethodId(
                                        nextSelected,
                                      );
                                    } else {
                                      setSelectedPaymentMethodId(null);
                                    }

                                    updated = true;
                                    break;
                                  }
                                }
                              } catch {
                                // ignore
                              }

                              await sleep(delayMs);
                            }

                            if (!updated) {
                              console.warn(
                                "[bank-link] No visible wallet update after polling payment methods",
                              );
                            }
                          }}
                        />
                      </Elements>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {/* Payment selector */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-1">
          <CardShell
            title="What would you like to pay today?"
            subtitle={
              inStep1
                ? "This payment goes toward the amount required before your landlord signs your lease,"
                : inStep2
                ? "This payment goes toward what’s still owed before you move in,"
                : `You don't owe anything new right now, you're current on rent, and your next rent of ${money(
                    monthlyRentBaseCents,
                  )} is scheduled for ${nextRentDueLabel},`
            }
          >
            {loading ? (
              <SkeletonOverview />
            ) : inStep1 ? (
              // STEP 1 MODE
              <div className="flex flex-col gap-4 text-xs sm:text-sm text-slate-700">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-900">
                      Amount required for this step
                    </span>
                    <span className="text-sm font-semibold text-slate-900">
                      {money(signingRequiredCents)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Already paid</span>
                    <span className="font-medium text-slate-700">
                      {money(signingPaidCents)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">
                      Remaining for Step 1
                    </span>
                    <span className="text-sm font-semibold text-slate-900">
                      {money(step1PayAmountCents)}
                    </span>
                  </div>
                </div>

                <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                  <p className="font-semibold text-slate-900">
                    This payment will be split automatically:
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {step1OperatingRemaining > 0 && (
                      <li>
                        •{" "}
                        <span className="font-semibold text-slate-900">
                          {money(step1OperatingRemaining)}
                        </span>{" "}
                        toward{" "}
                        <span className="font-semibold text-slate-900">
                          rent and permitted fees
                        </span>{" "}
                        in your landlord’s operating account,
                      </li>
                    )}
                    {step1DepositRemaining > 0 && (
                      <li>
                        •{" "}
                        <span className="font-semibold text-slate-900">
                          {money(step1DepositRemaining)}
                        </span>{" "}
                        toward your{" "}
                        <span className="font-semibold text-slate-900">
                          security deposit
                        </span>{" "}
                        in a separate deposit account,
                      </li>
                    )}
                  </ul>
                  <p className="mt-2 text-[10px] text-slate-500">
                    You can’t change this amount during Step 1—your landlord
                    needs the full remaining signing amount before they’ll sign
                    your lease,
                  </p>
                </div>

                <div className="mt-1 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                  <p>
                    You’re about to pay{" "}
                    <span className="font-semibold text-slate-900">
                      {money(step1PayAmountCents)}
                    </span>{" "}
                    from{" "}
                    <span className="font-semibold text-slate-900">
                      {activeMethod
                        ? `${activeMethod.bankName} •••• ${
                            activeMethod.last4 ?? "••••"
                          }`
                        : "your selected bank account"}
                    </span>
                    ,
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-[10px] text-slate-500">
                    You’ll confirm this payment in the next step,
                  </div>
                  <button
                    type="button"
                    disabled={!canPayStep1 || !activeMethod}
                    onClick={async () => {
                      if (
                        !step1PayAmountCents ||
                        !selectedPaymentMethodId ||
                        !activeMethod
                      )
                        return;
                      setCreatingSession(true);
                      try {
                        const res = await fetch(
                          "/api/tenant/payments/session?debug=1",
                          {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                              appId,
                              firmId: firmId ?? null,
                              type: "operating",
                              amountCents: step1PayAmountCents,
                              reason: "signing_combined",
                              paymentMethodId: activeMethod.id,
                              splitHint: {
                                operatingCents:
                                  step1OperatingRemaining,
                                depositCents: step1DepositRemaining,
                              },
                            }),
                          },
                        );

                        const data = await res.json();
                        if (!res.ok) {
                          console.error(
                            "Failed to create signing payment session",
                            data,
                          );
                          return;
                        }

                        if (data?.mode === "signing_combined") {
                          console.log(
                            "Signing combined result",
                            data.summary,
                          );
                        } else if (data?.clientSecret) {
                          console.log(
                            "Payment session clientSecret (signing)",
                            data.clientSecret,
                          );
                        }
						// Show success modal
						setLastPayment({
						  amountCents: step1PayAmountCents,
						  bankLabel: activeBankLabelForModal,
						});
						setShowPaymentModal(true);
						
						await refreshReceipts();
                      } catch (err) {
                        console.error(
                          "Error creating signing payment session",
                          err,
                        );
                      } finally {
                        setCreatingSession(false);
                      }
                    }}
                    className={clsx(
                      "rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-black disabled:opacity-60",
                    )}
                  >
                    {creatingSession
                      ? "Starting payment…"
                      : `Pay ${money(step1PayAmountCents)}`}
                  </button>
                </div>
              </div>
            ) : inStep2 ? (
              // STEP 2 MODE
              <div className="flex flex-col gap-4 text-xs sm:text-sm text-slate-700">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-900">
                      Amount required before you move in
                    </span>
                    <span className="text-sm font-semibold text-slate-900">
                      {money(moveInStepTwoPlannedCents)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">
                      Already paid toward this step
                    </span>
                    <span className="font-medium text-slate-700">
                      {money(
                        Math.max(
                          0,
                          moveInStepTwoPlannedCents -
                            step2PayAmountCents,
                        ),
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">
                      Remaining for this step
                    </span>
                    <span className="text-sm font-semibold text-slate-900">
                      {money(step2PayAmountCents)}
                    </span>
                  </div>
                </div>

                <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                  <p className="font-semibold text-slate-900">
                    This payment will be split automatically:
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {step2OperatingRemaining > 0 && (
                      <li>
                        •{" "}
                        <span className="font-semibold text-slate-900">
                          {money(step2OperatingRemaining)}
                        </span>{" "}
                        toward{" "}
                        <span className="font-semibold text-slate-900">
                          rent and permitted fees
                        </span>{" "}
                        in your landlord’s operating account,
                      </li>
                    )}
                    {step2DepositRemaining > 0 && (
                      <li>
                        •{" "}
                        <span className="font-semibold text-slate-900">
                          {money(step2DepositRemaining)}
                        </span>{" "}
                        toward your{" "}
                        <span className="font-semibold text-slate-900">
                          security deposit
                        </span>{" "}
                        in a separate deposit account,
                      </li>
                    )}
                  </ul>
                  <p className="mt-2 text-[10px] text-slate-500">
                    You can’t change this amount during this step—your landlord
                    needs the full remaining pre-move-in amount before you move
                    in,
                  </p>
                </div>

                <div className="mt-1 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                  <p>
                    You’re about to pay{" "}
                    <span className="font-semibold text-slate-900">
                      {money(step2PayAmountCents)}
                    </span>{" "}
                    from{" "}
                    <span className="font-semibold text-slate-900">
                      {activeMethod
                        ? `${activeMethod.bankName} •••• ${
                            activeMethod.last4 ?? "••••"
                          }`
                        : "your selected bank account"}
                    </span>
                    ,
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-[10px] text-slate-500">
                    You’ll confirm this payment on the next screen,
                  </div>
                  <button
                    type="button"
                    disabled={!canPayStep2 || !activeMethod}
                    onClick={async () => {
                      if (
                        !step2PayAmountCents ||
                        !selectedPaymentMethodId ||
                        !activeMethod
                      )
                        return;
                      setCreatingSession(true);
                      try {
                        const res = await fetch(
                          "/api/tenant/payments/session?debug=1",
                          {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                              appId,
                              firmId: firmId ?? null,
                              type: "operating",
                              amountCents: step2PayAmountCents,
                              reason: "movein_combined",
                              paymentMethodId: activeMethod.id,
                              splitHint: {
                                operatingCents:
                                  step2OperatingRemaining,
                                depositCents: step2DepositRemaining,
                              },
                            }),
                          },
                        );

                        const data = await res.json();
                        if (!res.ok) {
                          console.error(
                            "Failed to create move-in payment session",
                            data,
                          );
                          return;
                        }

                        if (data?.mode === "movein_combined") {
                          console.log(
                            "Move-in combined result",
                            data.summary,
                          );
                        } else if (data?.clientSecret) {
                          console.log(
                            "Payment session clientSecret (move-in)",
                            data.clientSecret,
                          );
                        }
						
						// Show success modal
						setLastPayment({
						  amountCents: step2PayAmountCents,
						  bankLabel: activeBankLabelForModal,
						});
						setShowPaymentModal(true);
											
						await refreshReceipts();
                      } catch (err) {
                        console.error(
                          "Error creating move-in payment session",
                          err,
                        );
                      } finally {
                        setCreatingSession(false);
                      }
                    }}
                    className={clsx(
                      "rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-black disabled:opacity-60",
                    )}
                  >
                    {creatingSession
                      ? "Starting payment…"
                      : `Pay ${money(step2PayAmountCents)}`}
                  </button>
                </div>
              </div>
            ) : (

              // STEP 3 MODE – no new required amount, optional rent prepayment
              <div className="flex flex-col gap-4 text-xs sm:text-sm text-slate-700">
                {/* Where you stand on rent */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-900">
                      Amount due right now
                    </span>
                    <span className="text-sm font-semibold text-slate-900">
                      {money(0)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">
                      You are fully paid through
                    </span>
                    <span className="font-medium text-slate-700">
                      {currentThroughLabel}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">
                      Next rent due on
                    </span>
                    <span className="text-right font-medium text-slate-700">
                      <span>{nextRentDueLabel}</span>
                      <span className="ml-1 inline-block text-[11px] text-slate-500">
                        · {money(monthlyRentBaseCents)}
                      </span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">
                      Monthly rent amount
                    </span>
                    <span className="text-sm font-semibold text-slate-900">
                      {money(monthlyRentBaseCents)}
                    </span>
                  </div>
                </div>

                {/* Months selector */}
                {maxMonthsPayable > 0 && (
                  <div className="mt-1 flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">
                      How many months of rent would you like to pay now?
                    </span>
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setMonthsToPrepay((m) => Math.max(1, m - 1))
                        }
                        className="flex h-6 w-6 items-center justify-center rounded border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        −
                      </button>
                      <span className="min-w-[2rem] text-center text-[11px] font-semibold text-slate-900">
                        {clampedMonthsToPrepay}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setMonthsToPrepay((m) =>
                            Math.min(maxMonthsPayable, m + 1),
                          )
                        }
                        className="flex h-6 w-6 items-center justify-center rounded border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}

                {/* How this payment is applied */}
                <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                  <p className="font-semibold text-slate-900">
                    This payment will be applied to your monthly rent:
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    <li>
                      •{" "}
                      <span className="font-semibold text-slate-900">
                        {money(step3PayAmountCents)}
                      </span>{" "}
                      toward{" "}
                      <span className="font-semibold text-slate-900">
                        {clampedMonthsToPrepay === 1
                          ? "1 month of rent"
                          : `${clampedMonthsToPrepay} months of rent`}
                      </span>
                      , starting with your next scheduled rent charges,
                    </li>
                  </ul>
                  <p className="mt-2 text-[10px] text-slate-500">
                    Your landlord will still expect rent on the normal schedule
                    in your lease, this payment simply moves some of those
                    future rent amounts forward, so you stay ahead,
                  </p>
                </div>

                {/* "You’re about to pay" summary */}
                <div className="mt-1 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                  <p>
                    You’re about to pay{" "}
                    <span className="font-semibold text-slate-900">
                      {money(step3PayAmountCents)}
                    </span>{" "}
                    from{" "}
                    <span className="font-semibold text-slate-900">
                      {activeMethod
                        ? `${activeMethod.bankName} •••• ${
                            activeMethod.last4 ?? "••••"
                          }`
                        : "your selected bank account"}
                    </span>
                    {clampedMonthsToPrepay > 0 && (
                      <>
                        , covering{" "}
                        <span className="font-semibold text-slate-900">
                          {clampedMonthsToPrepay === 1
                            ? "1 month of rent"
                            : `${clampedMonthsToPrepay} months of rent`}
                        </span>
                        ,
                      </>
                    )}
                  </p>
                </div>

                {/* CTA */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-[10px] text-slate-500">
                    You’ll confirm this rent payment on the next screen,
                  </div>
                  <button
                    type="button"
                    disabled={
                      !step3PayAmountCents || !activeMethod || creatingSession
                    }
                    onClick={async () => {
                      if (
                        !step3PayAmountCents ||
                        !selectedPaymentMethodId ||
                        !activeMethod
                      ) {
                        return;
                      }
                      setCreatingSession(true);
                      try {
                        const res = await fetch(
                          "/api/tenant/payments/session?debug=1",
                          {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                              appId,
                              firmId: firmId ?? null,
                              type: "operating", // reuse operating bucket, tagged as rent
                              amountCents: step3PayAmountCents,
                              reason: "monthly_rent",
                              paymentMethodId: activeMethod.id,
                              months: clampedMonthsToPrepay,
                            }),
                          },
                        );

                        const data = await res.json();
                        if (!res.ok) {
                          console.error(
                            "Failed to create monthly rent payment session",
                            data,
                          );
                          return;
                        }

                        if (data?.mode === "monthly_rent") {
                          console.log(
                            "Monthly rent result",
                            data.summary,
                          );
                        } else if (data?.clientSecret) {
                          console.log(
                            "Payment session clientSecret (rent)",
                            data.clientSecret,
                          );
                        }
						
						// Show success modal
						setLastPayment({
						  amountCents: step3PayAmountCents,
						  bankLabel: activeBankLabelForModal,
						});
						setShowPaymentModal(true);
											
						await refreshReceipts();
                      } catch (err) {
                        console.error(
                          "Error creating monthly rent payment session",
                          err,
                        );
                      } finally {
                        setCreatingSession(false);
                      }
                    }}
                    className={clsx(
                      "rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-black disabled:opacity-60",
                    )}
                  >
                    {creatingSession
                      ? "Starting rent payment…"
                      : `Pay ${money(step3PayAmountCents)} for rent`}
                  </button>
                </div>
              </div>


            )}
          </CardShell>
        </section>

        {/* Payment history */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">
              Payment history
            </h2>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-slate-600/40 bg-slate-800/60 px-3 py-1 text-[11px] font-medium text-slate-100 shadow-sm hover:bg-slate-700/70"
            >
              <span>Download statement</span>
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-800/60 bg-slate-950/60 shadow-sm">
            <div className="hidden grid-cols-[1.2fr_2fr_1fr_1fr_1.3fr] bg-slate-900/60 px-4 py-2 text-[11px] font-medium text-slate-300 sm:grid">
              <span>Date</span>
              <span>Description</span>
              <span className="text-right">Amount</span>
              <span className="text-center">Status</span>
              <span className="text-right">Action</span>
            </div>

            {loading ? (
              <SkeletonHistoryRows />
            ) : receipts.length === 0 ? (
              <div className="px-4 py-4 text-xs text-slate-300">
                No payments recorded for this lease yet,
              </div>
            ) : (
              <ul className="divide-y divide-slate-800/70 text-xs sm:text-sm">
                {receipts.map((r) => {
                  const date = new Date(r.createdAt);
                  const dateStr = date.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  });

                  const isSuccess = r.status === "succeeded";
                  const isProcessing =
                    r.status === "processing" || r.status === "created";

                  return (
                    <li
                      key={r.id}
                      className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[1.2fr_2fr_1fr_1fr_1.3fr] sm:items-center"
                    >
                      <span className="text-slate-300">{dateStr}</span>
                      <span className="text-slate-300/90 capitalize">
                        {r.kind === "upfront"
                          ? "Move-in payment"
                          : r.kind === "deposit"
                          ? "Security deposit"
                          : r.kind === "rent"
                          ? "Rent payment"
                          : "Fee payment"}
                      </span>
                      <span className="text-right font-medium text-slate-100">
                        {money(r.amountCents)}
                      </span>
                      <span className="flex items-center sm:justify-center">
                        <span
                          className={clsx(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                            isSuccess
                              ? "bg-emerald-500/10 text-emerald-300"
                              : isProcessing
                              ? "bg-slate-500/10 text-slate-200"
                              : "bg-rose-500/10 text-rose-300",
                          )}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          {r.status}
                        </span>
                      </span>
                      <span className="flex items-center justify-between gap-2 text-right text-[11px] text-slate-300 sm:justify-end">
                        {r.receiptUrl ? (
                          <a
                            href={r.receiptUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="underline underline-offset-2 hover:text-slate-100"
                          >
                            View receipt
                          </a>
                        ) : (
                          <span className="text-slate-500">No receipt</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
		{showPaymentModal && lastPayment && (
		  <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm px-4">
			<div className="relative w-full max-w-sm rounded-2xl bg-gradient-to-b from-white to-slate-50 p-5 shadow-2xl ring-1 ring-black/5">
			  {/* Top-right close */}
			  <button
				type="button"
				onClick={() => setShowPaymentModal(false)}
				className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
				aria-label="Close payment confirmation"
			  >
				<X className="h-3.5 w-3.5" />
			  </button>

			  {/* Icon + heading */}
			  <div className="flex items-start gap-3">
				<div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
				  <CheckCircle2 className="h-5 w-5" />
				</div>
				<div>
				  <h2 className="text-sm font-semibold text-slate-900">
					Payment request received
				  </h2>
				  <p className="mt-1 text-[11px] text-slate-600">
					We’ve received your payment request, for{" "}
					<span className="font-semibold text-slate-900">
					  {money(lastPayment.amountCents)}
					</span>
					, from{" "}
					<span className="font-semibold text-slate-900">
					  {lastPayment.bankLabel}
					</span>
					, we’ll submit this through the ACH network, please allow
					2–3 business days, for funds to clear, and for your payment
					status to update,
				  </p>
				</div>
			  </div>

			  {/* Key details pill */}
			  <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-600 ring-1 ring-slate-100">
				<div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
				  <span className="text-slate-500">Amount</span>
				  <span className="font-semibold text-slate-900">
					{money(lastPayment.amountCents)}
				  </span>

				  <span className="text-slate-500">From</span>
				  <span className="font-medium text-slate-900">
					{lastPayment.bankLabel}
				  </span>

				  <span className="text-slate-500">Timing</span>
				  <span className="text-slate-700">
					Typically 2–3 business days, depending on your bank,
				  </span>
				</div>
			  </div>

			  {/* Hint + actions */}
			  <p className="mt-3 text-[10px] text-slate-500">
				You can always check the latest status in the payment history
				table on this page, once your bank finishes processing, this
				payment will move from “processing” to “succeeded” or “failed,”
			  </p>

			  <div className="mt-4 flex items-center justify-end gap-2">
				<button
				  type="button"
				  onClick={() => setShowPaymentModal(false)}
				  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
				>
				  Close
				</button>
				<button
				  type="button"
				  onClick={() => setShowPaymentModal(false)}
				  className="rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white shadow-sm hover:bg-black"
				>
				  Got it
				</button>
			  </div>
			</div>
		  </div>
		)}
    </main>
  );
}

/* ─────────────────────────────────────────────────────────────
   Skeleton helpers
───────────────────────────────────────────────────────────── */

function SkeletonOverview() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex items-center justify-between text-xs sm:text-sm text-slate-700"
        >
          <span className="h-3 w-24 rounded bg-slate-100" />
          <span className="h-3 w-16 rounded bg-slate-100" />
        </div>
      ))}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="h-5 w-20 rounded-full bg-slate-100" />
        <span className="h-5 w-24 rounded-full bg-slate-100" />
      </div>
    </div>
  );
}

function MiniCharge({
  label,
  charge,
}: {
  label: string;
  charge?: Charge;
}) {
  const amount = charge?.amountCents ?? 0;
  const remaining = Math.max(0, charge?.remainingCents ?? amount);
  const paid = amount > 0 ? amount - remaining : 0;
  const fullyPaid = amount > 0 && remaining === 0;

  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-[11px] font-medium text-slate-700">
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline justify-between text-[11px] text-slate-600">
        <span>Total {money(amount)}</span>
        <span
          className={clsx(
            "font-semibold",
            fullyPaid ? "text-emerald-600" : "text-slate-900",
          )}
        >
          {fullyPaid ? "Paid" : `${money(remaining)} left`}
        </span>
      </div>
      {paid > 0 && !fullyPaid && (
        <div className="mt-0.5 text-[10px] text-slate-500">
          {money(paid)} already paid
        </div>
      )}
    </div>
  );
}

function SkeletonUpcoming() {
  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between">
          <span className="h-3 w-24 rounded bg-slate-100" />
          <span className="h-3 w-16 rounded bg-slate-100" />
        </div>
        <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100" />
      </div>
      <div className="grid grid-cols-2 gap-3 pt-1">
        <div className="h-14 rounded-lg bg-slate-100" />
        <div className="h-14 rounded-lg bg-slate-100" />
      </div>
    </div>
  );
}

function SkeletonHistoryRows() {
  return (
    <ul className="divide-y divide-slate-800/70 text-xs sm:text-sm">
      {[1, 2, 3].map((i) => (
        <li
          key={i}
          className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[1.2fr_2fr_1fr_1fr_1.3fr] sm:items-center"
        >
          <span className="h-3 w-20 rounded bg-slate-800/70" />
          <span className="h-3 w-32 rounded bg-slate-800/70" />
          <span className="h-3 w-12 justify-self-end rounded bg-slate-800/70" />
          <span className="h-5 w-16 rounded-full bg-slate-800/70" />
          <span className="h-3 w-20 justify-self-end rounded bg-slate-800/70" />
        </li>
      ))}
    </ul>
  );
}
