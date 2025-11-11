"use client";

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";

/* ─────────────────────────────────────────────────────────────
   Types (aligned to new API)
───────────────────────────────────────────────────────────── */
type Building = {
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string; // 2-letter US state
  postalCode: string;
  country?: string | null; // default "US"
};

type PaymentPlan = {
  monthlyRentCents: number;
  termMonths: number;
  startDate: string; // YYYY-MM-DD
  securityCents: number;
  keyFeeCents: number;
  requireFirstBeforeMoveIn: boolean;
  requireLastBeforeMoveIn: boolean;
  countersignUpfrontThresholdCents: number;
  countersignDepositThresholdCents: number;
  upfrontTotals: {
    firstCents: number;
    lastCents: number;
    keyCents: number;
    securityCents: number;
    otherUpfrontCents: number;
    totalUpfrontCents: number;
  };
  priority: string[];
};

type AppLite = {
  id: string;
  status?: string | null; // e.g. "countersign_ready"
  building?: Building | null;
  unit?: { unitNumber?: string | null } | null;
  protoLease?: {
    monthlyRent?: number | null; // cents
    termMonths?: number | null;
    moveInDate?: string | null; // YYYY-MM-DD
  } | null;
  countersign?: {
    allowed?: boolean | null;
    upfrontMinCents?: number | null;
    depositMinCents?: number | null;
  } | null;
  paymentPlan?: PaymentPlan | null;
};

/* ─────────────────────────────────────────────────────────────
   Tiny utils
───────────────────────────────────────────────────────────── */
function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

const moneyFmt = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function dollarsToCents(s: string) {
  const n = Number((s || "0").replace(/[^\d. -]/g, ""));
  return Math.round((Number.isFinite(n) ? n : 0) * 100);
}

function centsToDollarsString(n: number | null | undefined) {
  const v = Number(n ?? 0) / 100;
  return v.toFixed(2);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function addMonthsEndMinusOneDay(startISO: string, months: number) {
  const [y, m, d] = startISO.split("-").map(Number);
  if (!y || !m || !d) return "";
  const end = new Date(Date.UTC(y, m - 1, d));
  end.setUTCMonth(end.getUTCMonth() + months);
  end.setUTCDate(end.getUTCDate() - 1);
  return `${end.getUTCFullYear()}-${pad2(end.getUTCMonth() + 1)}-${pad2(end.getUTCDate())}`;
}

function addMonthsSameDay(startISO: string, months: number) {
  const [y, m, d] = startISO.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function monthLabelUTC(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  if (!y || !m) return "";
  const dt = new Date(Date.UTC(y, m - 1, 1));
  return dt.toLocaleString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}

function stateValid(s: string) {
  return /^[A-Z]{2}$/.test((s || "").trim());
}

/* ─────────────────────────────────────────────────────────────
   Data (now returns paymentPlan + countersign)
───────────────────────────────────────────────────────────── */
async function fetchApp(appId: string, firmId?: string): Promise<AppLite | null> {
  try {
    const qs = firmId ? `?firmId=${encodeURIComponent(firmId)}` : "";
    const res = await fetch(`/api/landlord/applications/${encodeURIComponent(appId)}${qs}`, { cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json();
    const a = j?.application;
    if (!a) return null;

    return {
      id: String(a.id ?? a._id),
      status: a?.status ?? null,
      building: a?.building ?? null,
      unit: a?.unit ?? null,
      protoLease: a?.protoLease ?? null,
      countersign: a?.countersign ?? null,
      paymentPlan: a?.paymentPlan ?? null,
    };
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────────────────────
   UI: Switch (accessible)
───────────────────────────────────────────────────────────── */
function Switch({
  checked,
  onChange,
  label,
  id,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: React.ReactNode;
  id: string;
  disabled?: boolean;
}) {
  const toggle = () => {
    if (!disabled) onChange(!checked);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!disabled && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      toggle();
    }
  };
  return (
    <div className={clsx("flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3", disabled && "opacity-70")}>
      <span
        id={`${id}-label`}
        onClick={toggle}
        className={clsx("text-sm leading-5 select-none", !disabled && "cursor-pointer")}
      >
        {label}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-labelledby={`${id}-label`}
        aria-checked={checked}
        aria-disabled={disabled || undefined}
        onClick={toggle}
        onKeyDown={onKeyDown}
        disabled={!!disabled}
        className={clsx(
          "relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full p-1 transition-colors duration-200",
          disabled ? "bg-gray-200" : checked ? "bg-emerald-600" : "bg-gray-300"
        )}
      >
        <span
          aria-hidden="true"
          className={clsx(
            "h-5 w-5 rounded-full bg-white shadow transition-transform duration-200",
            checked ? "translate-x-4" : "translate-x-0"
          )}
        />
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Payment Calendar (read-only visual)
───────────────────────────────────────────────────────────── */
function PaymentCalendar({
  moveIn,
  termMonths,
  monthlyRentCents,
  requireFirst,
  requireLast,
  securityCents = 0,
  keyFeeCents = 0,
}: {
  moveIn: string;
  termMonths: string;
  monthlyRentCents: number;
  requireFirst: boolean;
  requireLast: boolean;
  securityCents?: number;
  keyFeeCents?: number;
}) {
  const rows = useMemo(() => {
    const t = Number(termMonths || 0);
    if (!moveIn || !Number.isFinite(t) || t <= 0) return [];
    const out: { label: string; iso: string; badge?: "first" | "last" }[] = [];
    for (let i = 0; i < t; i++) {
      const iso = addMonthsSameDay(moveIn, i);
      let badge: "first" | "last" | undefined;
      if (i === 0 && requireFirst) badge = "first";
      if (i === t - 1 && requireLast) badge = "last";
      out.push({ label: monthLabelUTC(iso), iso, badge });
    }
    return out;
  }, [moveIn, termMonths, requireFirst, requireLast]);

  if (!rows.length || !Number.isFinite(monthlyRentCents) || monthlyRentCents <= 0) return null;

  const preMove: { key: "first" | "last" | "key" | "deposit"; label: string; amount: number }[] = [];
  if (requireFirst) preMove.push({ key: "first", label: "First month", amount: monthlyRentCents });
  if (requireLast) preMove.push({ key: "last", label: "Last month", amount: monthlyRentCents });
  if (keyFeeCents > 0) preMove.push({ key: "key", label: "Key fee", amount: keyFeeCents });
  if (securityCents > 0) preMove.push({ key: "deposit", label: "Security deposit", amount: securityCents });

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm">
      <div className="font-semibold text-gray-900">Payment calendar</div>

      {preMove.length > 0 && (
        <>
          <div className="mt-3 text-xs font-medium uppercase tracking-wide text-gray-500">Payments before move-in</div>
          <ul className="mt-2 divide-y divide-gray-100">
            {preMove.map((p) => (
              <li key={p.key} className="flex items-center justify-between gap-3 py-2 px-1">
                <div className="flex items-center gap-2">
                  <span
                    className={clsx(
                      "rounded-full px-2 py-0.5 text-[11px] ring-1",
                      p.key === "first" && "bg-emerald-50 text-emerald-700 ring-emerald-200",
                      p.key === "last" && "bg-blue-50 text-blue-700 ring-blue-200",
                      p.key === "key" && "bg-violet-50 text-violet-700 ring-violet-200",
                      p.key === "deposit" && "bg-amber-50 text-amber-900 ring-amber-200"
                    )}
                  >
                    {p.key === "first" ? "First" : p.key === "last" ? "Last" : p.key === "key" ? "Key" : "Deposit"}
                  </span>
                  <span className="text-gray-900">{p.label}</span>
                </div>
                <span className="tabular-nums text-gray-800">{moneyFmt.format(p.amount / 100)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className={clsx("text-xs font-medium uppercase tracking-wide text-gray-500", preMove.length ? "mt-5" : "mt-3")}>
        Rent schedule
      </div>
      <ul className="mt-2 divide-y divide-gray-100">
        {rows.map((r, idx) => (
          <li key={r.iso + idx} className="flex items-center justify-between gap-3 py-2 px-1">
            <div className="min-w-0">
              <div className="text-gray-900">
                {r.label} <span className="text-gray-500">Rent</span>
              </div>
              <div className="text-[11px] text-gray-500">{r.iso}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {r.badge === "first" && (
                <span className="rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-2 py-0.5 text-[11px]">First</span>
              )}
              {r.badge === "last" && (
                <span className="rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-200 px-2 py-0.5 text-[11px]">Last</span>
              )}
              <span className="tabular-nums text-gray-800">{moneyFmt.format((monthlyRentCents || 0) / 100)}</span>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[11px] text-gray-500">
        Months are shown from move-in through move-out. “First” and “Last” indicate required pre-move-in payments.
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Page
───────────────────────────────────────────────────────────── */
export default function LeaseSetupDesktop() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();

  const rawId = (params as Record<string, string | string[] | undefined>)?.id;
  const appId = Array.isArray(rawId) ? rawId[0] : (rawId as string | undefined);
  const firmId = search.get("firmId") || undefined;

  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [app, setApp] = useState<AppLite | null>(null);

  // Address & Unit
  const [addr1, setAddr1] = useState("");
  const [addr2, setAddr2] = useState("");
  const [city, setCity] = useState("");
  const [stateUS, setStateUS] = useState("");
  const [zip, setZip] = useState("");
  const [unitNumber, setUnitNumber] = useState("");

  // Financials
  const [rentDollars, setRentDollars] = useState("");
  const [termMonths, setTermMonths] = useState("");
  const [moveIn, setMoveIn] = useState("");
  const [moveOut, setMoveOut] = useState("");

  const [securityDollars, setSecurityDollars] = useState("");
  const [keyFeeDollars, setKeyFeeDollars] = useState("");
  const [requireFirstBeforeMoveIn, setRequireFirstBeforeMoveIn] = useState(true);
  const [requireLastBeforeMoveIn, setRequireLastBeforeMoveIn] = useState(false);
  const [countersignUpfrontDollars, setCountersignUpfrontDollars] = useState("");
  const [countersignDepositDollars, setCountersignDepositDollars] = useState("");

  // Create-lease UI
  const [creating, setCreating] = useState(false);

  // Derived cents
  const rentCents = useMemo(() => dollarsToCents(rentDollars), [rentDollars]);
  const keyFeeCents = useMemo(() => dollarsToCents(keyFeeDollars), [keyFeeDollars]);
  const securityCents = useMemo(() => dollarsToCents(securityDollars), [securityDollars]);

  // Upfront max: prefer server total, fall back to client calc
  const upfrontMaxCents = useMemo(() => {
    const serverTotal = app?.paymentPlan?.upfrontTotals?.totalUpfrontCents;
    if (typeof serverTotal === "number" && serverTotal > 0) return serverTotal;
    return (requireFirstBeforeMoveIn ? rentCents : 0)
      + (requireLastBeforeMoveIn ? rentCents : 0)
      + (keyFeeCents || 0);
  }, [
    app?.paymentPlan?.upfrontTotals?.totalUpfrontCents,
    requireFirstBeforeMoveIn,
    requireLastBeforeMoveIn,
    rentCents,
    keyFeeCents,
  ]);

  const depositMaxCents = useMemo(() => {
    const serverDep = app?.paymentPlan?.securityCents;
    if (typeof serverDep === "number" && serverDep >= 0) return serverDep;
    return securityCents;
  }, [app?.paymentPlan?.securityCents, securityCents]);

  // Clamp countersign inputs when max changes
  useEffect(() => {
    const up = dollarsToCents(countersignUpfrontDollars);
    if (up > upfrontMaxCents) setCountersignUpfrontDollars(centsToDollarsString(upfrontMaxCents));
    if (up < 0) setCountersignUpfrontDollars("0.00");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upfrontMaxCents]);

  useEffect(() => {
    const dep = dollarsToCents(countersignDepositDollars);
    if (dep > depositMaxCents) setCountersignDepositDollars(centsToDollarsString(depositMaxCents));
    if (dep < 0) setCountersignDepositDollars("0.00");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositMaxCents]);

  // Prefill from API (prefer paymentPlan values)
  useEffect(() => {
    (async () => {
      if (!appId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      const a = await fetchApp(appId, firmId);
      setApp(a);

      const b = a?.building;
      if (b) {
        setAddr1(b.addressLine1 || "");
        setAddr2(b.addressLine2 || "");
        setCity(b.city || "");
        setStateUS((b.state || "").toUpperCase());
        setZip(b.postalCode || "");
      }
      setUnitNumber(a?.unit?.unitNumber || "");

      const plan = a?.paymentPlan ?? null;
      if (plan) {
        setRentDollars(centsToDollarsString(plan.monthlyRentCents));
        setTermMonths(String(plan.termMonths || ""));
        setMoveIn(plan.startDate || "");
        setSecurityDollars(centsToDollarsString(plan.securityCents));
        setKeyFeeDollars(centsToDollarsString(plan.keyFeeCents));
        setRequireFirstBeforeMoveIn(Boolean(plan.requireFirstBeforeMoveIn));
        setRequireLastBeforeMoveIn(Boolean(plan.requireLastBeforeMoveIn));
        setCountersignUpfrontDollars(centsToDollarsString(plan.countersignUpfrontThresholdCents));
        setCountersignDepositDollars(centsToDollarsString(plan.countersignDepositThresholdCents));
      } else {
        // Fallback to protoLease if plan missing
        if (a?.protoLease?.monthlyRent != null) setRentDollars(centsToDollarsString(a.protoLease.monthlyRent || 0));
        if (a?.protoLease?.termMonths != null) setTermMonths(String(a.protoLease.termMonths));
        if (a?.protoLease?.moveInDate) setMoveIn(a.protoLease.moveInDate);
      }

      setLoading(false);
    })();
  }, [appId, firmId]);

  // Auto compute moveOut when moveIn/term changes
  useEffect(() => {
    const m = Number(termMonths);
    if (moveIn && Number.isFinite(m) && m > 0) {
      setMoveOut(addMonthsEndMinusOneDay(moveIn, m));
    } else {
      setMoveOut("");
    }
  }, [moveIn, termMonths]);

  // Lock rule: only when countersign is truly allowed
  const isLocked = app?.countersign?.allowed === true;

  // Should we show "Create lease"?
  const canCreateLease = app?.countersign?.allowed === true || app?.status === "countersign_ready";

  async function onSave() {
    if (!appId || isLocked) return;

    if (!addr1.trim() || !city.trim() || !stateValid(stateUS) || !zip.trim()) {
      setToast("Please fill a valid address: street, city, state (2 letters), ZIP,");
      return;
    }
    if (rentCents <= 0) {
      setToast("Monthly rent must be positive,");
      return;
    }

    // 1) Save basics
    const building: Building = {
      addressLine1: addr1.trim(),
      addressLine2: addr2 ? addr2 : null,
      city: city.trim(),
      state: stateUS.toUpperCase(),
      postalCode: zip.trim(),
      country: "US",
    };

    const basicsUrl = `/api/landlord/leases/${encodeURIComponent(appId)}/unit${
      firmId ? `?${new URLSearchParams({ firmId }).toString()}` : ""
    }`;

    let basicsRes: Response | null = null;
    try {
      basicsRes = await fetch(basicsUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          building,
          unit: { unitNumber: unitNumber || null },
          lease: {
            monthlyRent: rentCents,
            termMonths: termMonths ? Number(termMonths) : null,
            moveInDate: moveIn || null,
          },
        }),
      });
    } catch {
      basicsRes = null;
    }

    if (!basicsRes || !basicsRes.ok) {
      let msg = "Failed to save address/unit/lease,";
      try {
        const j = await basicsRes?.json();
        if (j?.error) msg = String(j.error);
      } catch {}
      setToast(msg);
      return;
    }

    // 2) Save plan (with countersign thresholds)
    const planUrl = `/api/landlord/applications/${encodeURIComponent(appId)}/plan${
      firmId ? `?${new URLSearchParams({ firmId }).toString()}` : ""
    }`;

    let planRes: Response | null = null;
    try {
      planRes = await fetch(planUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          monthlyRentCents: rentCents,
          termMonths: termMonths ? Number(termMonths) : 12,
          startDate: moveIn || null,
          securityCents: securityCents,
          keyFeeCents: keyFeeCents,
          requireFirstBeforeMoveIn: requireFirstBeforeMoveIn,
          requireLastBeforeMoveIn: requireLastBeforeMoveIn,
          countersignUpfrontThresholdCents: dollarsToCents(countersignUpfrontDollars),
          countersignDepositThresholdCents: dollarsToCents(countersignDepositDollars),
        }),
      });
    } catch {
      planRes = null;
    }

    if (!planRes || !planRes.ok) {
      let msg = "Saved basics, but failed to save the financial plan,";
      try {
        const j = await planRes?.json();
        if (j?.error) msg = String(j.error);
      } catch {}
      setToast(msg);
      return;
    }

    setToast("Lease basics saved,");
    setTimeout(() => setToast(null), 1200);
  }

  // Compute a safe moveOut for creation if needed
  const computedMoveOut = useMemo(() => {
    const m = Number(termMonths);
    return moveIn && Number.isFinite(m) && m > 0 ? addMonthsSameDay(moveIn, m) : null;
  }, [moveIn, termMonths]);

  // Create lease via legacy route
  async function onCreateLease() {
    if (!appId) return;
    try {
      setCreating(true);

      const plan = app?.paymentPlan ?? null;
      const monthlyRent = plan?.monthlyRentCents ?? dollarsToCents(rentDollars); // cents
      const moveInDate = plan?.startDate ?? moveIn;
      const moveOutDate = computedMoveOut;

      if (!moveInDate) {
        setToast("Move-in date is required to create a lease,");
        return;
      }
      if (!(monthlyRent > 0)) {
        setToast("Monthly rent must be positive to create a lease,");
        return;
      }

      const res = await fetch("/api/landlord/leases/by-app/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appId,
          ...(firmId ? { firmId } : {}),
          building: {
            addressLine1: addr1,
            addressLine2: addr2 || null,
            city,
            state: stateUS,
            postalCode: zip,
            country: "US",
          },
          unitNumber,
          monthlyRent,   // cents
          moveInDate,    // YYYY-MM-DD
          moveOutDate,   // optional YYYY-MM-DD
          signed: false,
        }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setToast(`Create lease failed, ${j?.error ?? res.status}`);
        return;
      }

      const j = await res.json();
      const leaseId = j?.lease?._id;
      setToast("Lease created,");
      if (leaseId) router.push(`/landlord/leases/${encodeURIComponent(leaseId)}`);
    } finally {
      setCreating(false);
    }
  }

  const monthlyRentCents = useMemo(() => rentCents, [rentCents]);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 pb-8">
      <div className="mt-5 mb-4">
        <div className="text-base font-semibold text-gray-900">Lease setup</div>
        <div className="text-xs text-gray-600">Application {appId}</div>
        {isLocked && (
          <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
            Tenant’s holding funds are confirmed — <strong>countersign ready.</strong> Lease basics are now read-only.
          </div>
        )}
      </div>

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">Loading…</div>
      ) : (
        <div className="grid grid-cols-12 gap-6">
          {/* Left: Address / Unit / Financials */}
          <section className="col-span-12 lg:col-span-8 space-y-4">
            {/* Address & Unit */}
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="text-sm font-semibold text-gray-900">Address &amp; Unit</div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="text-sm">
                  Street
                  <input
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    value={addr1}
                    onChange={(e) => setAddr1(e.target.value)}
                    disabled={isLocked}
                  />
                </label>
                <label className="text-sm">
                  Address line 2
                  <input
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    value={addr2}
                    onChange={(e) => setAddr2(e.target.value)}
                    placeholder="Apt / Suite"
                    disabled={isLocked}
                  />
                </label>
                <label className="text-sm">
                  City
                  <input
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    disabled={isLocked}
                  />
                </label>
                <label className="text-sm">
                  State
                  <input
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm uppercase"
                    value={stateUS}
                    onChange={(e) => setStateUS(e.target.value.toUpperCase())}
                    maxLength={2}
                    disabled={isLocked}
                  />
                </label>
                <label className="text-sm">
                  ZIP
                  <input
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    value={zip}
                    onChange={(e) => setZip(e.target.value)}
                    inputMode="numeric"
                    disabled={isLocked}
                  />
                </label>
                <label className="text-sm">
                  Unit
                  <input
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    value={unitNumber}
                    onChange={(e) => setUnitNumber(e.target.value)}
                    disabled={isLocked}
                  />
                </label>
              </div>
            </div>

            {/* Financials */}
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="text-sm font-semibold text-gray-900">Financials</div>

              <div className="mt-3 grid grid-cols-3 gap-3">
                <label className="text-sm col-span-1">
                  Monthly rent ($)
                  <input
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    inputMode="decimal"
                    value={rentDollars}
                    onChange={(e) => setRentDollars(e.target.value)}
                    disabled={isLocked}
                  />
                </label>
                <label className="text-sm col-span-1">
                  Security deposit ($)
                  <input
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    inputMode="decimal"
                    value={securityDollars}
                    onChange={(e) => setSecurityDollars(e.target.value)}
                    disabled={isLocked}
                  />
                </label>
                <label className="text-sm col-span-1">
                  Key fee ($)
                  <input
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    inputMode="decimal"
                    value={keyFeeDollars}
                    onChange={(e) => setKeyFeeDollars(e.target.value)}
                    disabled={isLocked}
                  />
                </label>

                <label className="text-sm col-span-1">
                  Move-in date
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    value={moveIn}
                    onChange={(e) => setMoveIn(e.target.value)}
                    disabled={isLocked}
                  />
                </label>
                <label className="text-sm col-span-1">
                  Term (months)
                  <input
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    inputMode="numeric"
                    placeholder="12"
                    value={termMonths}
                    onChange={(e) => setTermMonths(e.target.value)}
                    disabled={isLocked}
                  />
                </label>
                <label className="text-sm col-span-1">
                  Move-out (auto)
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    value={moveOut}
                    onChange={(e) => setMoveOut(e.target.value)}
                    readOnly
                    disabled
                  />
                </label>
              </div>

              <div className="mt-3 space-y-3">
                <Switch
                  id="req-first"
                  checked={requireFirstBeforeMoveIn}
                  onChange={setRequireFirstBeforeMoveIn}
                  label={
                    <>
                      Require <span className="font-medium">first month</span> before move-in
                    </>
                  }
                  disabled={isLocked}
                />
                <Switch
                  id="req-last"
                  checked={requireLastBeforeMoveIn}
                  onChange={setRequireLastBeforeMoveIn}
                  label={
                    <>
                      Require <span className="font-medium">last month</span> before move-in
                    </>
                  }
                  disabled={isLocked}
                />
              </div>

              {/* Countersign thresholds */}
              <div className="mt-4 space-y-3">
                <label className="block text-sm">
                  Countersign minimum — standard payments ($)
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={(upfrontMaxCents / 100).toFixed(2)}
                    className="mt-1 block w-full rounded-md border px-2 py-1.5 text-sm border-gray-300"
                    value={countersignUpfrontDollars}
                    onChange={(e) => setCountersignUpfrontDollars(e.target.value)}
                    placeholder="0.00"
                    disabled={isLocked || upfrontMaxCents <= 0}
                  />
                  <div className="mt-1 text-[11px] text-gray-500">
                    Max: <span className="font-medium">{moneyFmt.format(upfrontMaxCents / 100)}</span>
                  </div>
                </label>

                <label className="block text-sm">
                  Countersign minimum — security deposit ($)
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={(depositMaxCents / 100).toFixed(2)}
                    className="mt-1 block w-full rounded-md border px-2 py-1.5 text-sm border-gray-300"
                    value={countersignDepositDollars}
                    onChange={(e) => setCountersignDepositDollars(e.target.value)}
                    placeholder="0.00"
                    disabled={isLocked || depositMaxCents <= 0}
                  />
                  <div className="mt-1 text-[11px] text-gray-500">
                    Max: <span className="font-medium">{moneyFmt.format(depositMaxCents / 100)}</span>
                  </div>
                </label>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                onClick={() => router.back()}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium hover:bg-gray-50"
              >
                {isLocked ? "Back" : "Cancel"}
              </button>

              {!isLocked ? (
                <button
                  onClick={onSave}
                  className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700"
                >
                  Save lease &amp; plan
                </button>
              ) : (
                <button
                  className="rounded-md bg-gray-200 px-3 py-2 text-xs font-medium text-gray-500 cursor-not-allowed"
                  disabled
                >
                  Locked (countersign ready)
                </button>
              )}

              {canCreateLease && (
                <button
                  onClick={onCreateLease}
                  disabled={creating}
                  className={clsx(
                    "rounded-md px-3 py-2 text-xs font-medium text-white",
                    creating ? "bg-gray-400 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700"
                  )}
                >
                  {creating ? "Creating…" : "Create lease"}
                </button>
              )}
            </div>
          </section>

          {/* Right: snapshot + calendar */}
          <aside className="col-span-12 lg:col-span-4 space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm">
              <div className="font-semibold text-gray-900">Application snapshot</div>
              <dl className="mt-2 space-y-1">
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Status</dt>
                  <dd className="text-gray-900">{app?.status || "—"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Unit</dt>
                  <dd className="text-gray-900">{app?.unit?.unitNumber || "—"}</dd>
                </div>

                {/* Prefer plan values for display */}
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Rent (plan)</dt>
                  <dd className="text-gray-900">
                    {app?.paymentPlan
                      ? moneyFmt.format((app.paymentPlan.monthlyRentCents || 0) / 100)
                      : app?.protoLease?.monthlyRent != null
                        ? moneyFmt.format((app.protoLease.monthlyRent || 0) / 100)
                        : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Move-in (plan)</dt>
                  <dd className="text-gray-900">{app?.paymentPlan?.startDate || app?.protoLease?.moveInDate || "—"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Term (months)</dt>
                  <dd className="text-gray-900">
                    {app?.paymentPlan?.termMonths ?? app?.protoLease?.termMonths ?? "—"}
                  </dd>
                </div>

                {typeof app?.countersign?.upfrontMinCents === "number" && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-gray-500">CS min (standard)</dt>
                    <dd className="text-gray-900">{moneyFmt.format((app.countersign!.upfrontMinCents || 0) / 100)}</dd>
                  </div>
                )}
                {typeof app?.countersign?.depositMinCents === "number" && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-gray-500">CS min (deposit)</dt>
                    <dd className="text-gray-900">{moneyFmt.format((app.countersign!.depositMinCents || 0) / 100)}</dd>
                  </div>
                )}
                {typeof app?.countersign?.allowed === "boolean" && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-gray-500">Countersign allowed</dt>
                    <dd className={clsx("text-gray-900", app.countersign!.allowed ? "text-emerald-700" : "text-amber-700")}>
                      {app.countersign!.allowed ? "Yes" : "Not yet"}
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            <PaymentCalendar
              moveIn={moveIn}
              termMonths={termMonths}
              monthlyRentCents={monthlyRentCents}
              requireFirst={requireFirstBeforeMoveIn}
              requireLast={requireLastBeforeMoveIn}
              securityCents={app?.paymentPlan?.securityCents ?? securityCents}
              keyFeeCents={app?.paymentPlan?.keyFeeCents ?? dollarsToCents(keyFeeDollars)}
            />
          </aside>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
          <div className="rounded-md bg-gray-900 text-white text-sm px-4 py-2 shadow-lg">
            {toast}{" "}
            <button className="ml-3 underline" onClick={() => setToast(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
