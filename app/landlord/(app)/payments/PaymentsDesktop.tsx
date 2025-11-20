"use client";
import { useStripeConnect } from "./useStripeConnect";
import { useCallback, useEffect, useMemo, useState } from "react";

/* ── UI helpers ───────────────────────────────────────────── */
function Badge({ children, tone = "gray" }:{children:React.ReactNode; tone?: "gray"|"green"|"amber"|"red"}) {
  const map:any = { gray:"bg-gray-100 text-gray-800", green:"bg-emerald-50 text-emerald-800", amber:"bg-amber-50 text-amber-800", red:"bg-rose-50 text-rose-700" };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${map[tone]}`}>{children}</span>;
}
function Row({ label, children }:{label:string; children:React.ReactNode}) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-40 text-gray-700">{label}</div>
      <div className="text-gray-900">{children}</div>
    </div>
  );
}

/* ── local helpers ────────────────────────────────────────── */
function onlyDigits(s: string) { return s.replace(/\D/g, ""); }
function last4(s?: string) { const d = onlyDigits(s ?? ""); return d.slice(-4); }
function maskAccountVisual(s: string) {
  // Visual mask: group in 4s for readability (does not affect stored value)
  const d = onlyDigits(s);
  return d.replace(/(.{4})/g, "$1 ").trim();
}
function unmaskAccountVisual(s: string) {
  return onlyDigits(s);
}
function fmtPctFromHundredths(n?: number | null) {
  if (n === undefined || n === null || Number.isNaN(n)) return "";
  return (Number(n) / 100).toFixed(2) + "%";
}

/* ── Escrow disclosure hook — no firmId needed ────────────── */
type EscrowDisclosure = {
  bankName: string;
  accountType: string;
  accountIdentifier: string;   // full, digits only
  accountLast4: string;        // derived
  bankAddress: string;
  interestHundredths?: number; // e.g., 250 => 2.50%
};

function useEscrowDisclosure() {
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<EscrowDisclosure | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/landlord/escrow-disclosure?debug=1`, { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        const d = j?.disclosure ?? null;
        if (d) {
          setData({
            bankName: d.bankName ?? "",
            accountType: d.accountType ?? "Interest-bearing escrow",
            accountIdentifier: onlyDigits(d.accountIdentifier ?? ""),
            accountLast4: last4(d.accountIdentifier) || d.accountLast4 || "",
            bankAddress: d.bankAddress ?? "",
            interestHundredths: typeof d.interestHundredths === "number" ? d.interestHundredths : undefined,
          });
        } else {
          setData(null);
        }
      } else if (r.status === 404) {
        setData(null);
      } else {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || "Failed to load escrow disclosure");
      }
    } catch (e:any) {
      setError(e.message || "Failed to load escrow disclosure");
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(async (next: EscrowDisclosure) => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        bankName: next.bankName,
        accountType: next.accountType,
        accountIdentifier: onlyDigits(next.accountIdentifier),
        accountLast4: last4(next.accountIdentifier), // convenience; server may derive too
        bankAddress: next.bankAddress,
        interestHundredths: typeof next.interestHundredths === "number" ? next.interestHundredths : undefined,
      };
      const r = await fetch(`/api/landlord/escrow-disclosure?debug=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Failed to save escrow disclosure");
      setData(payload);
      return { ok: true };
    } catch (e:any) {
      setError(e.message || "Failed to save escrow disclosure");
      return { ok: false, error: e.message };
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { loading, saving, error, data, refresh, save };
}

/* ── Escrow Disclosure Form ───────────────────────────────── */
function EscrowDisclosureForm() {
  const { loading, saving, error, data, save } = useEscrowDisclosure();
  const [form, setForm] = useState<EscrowDisclosure>({
    bankName: "",
    accountType: "Interest-bearing escrow",
    accountIdentifier: "",
    accountLast4: "",
    bankAddress: "",
    interestHundredths: undefined,
  });
  const [toast, setToast] = useState<string | null>(null);
  const [showFull, setShowFull] = useState<boolean>(false);

  useEffect(() => {
    if (data) setForm(prev => ({ ...prev, ...data }));
  }, [
    data?.bankName, data?.accountType, data?.accountIdentifier, data?.accountLast4, data?.bankAddress, data?.interestHundredths
  ]);

  function update<K extends keyof EscrowDisclosure>(k: K, v: EscrowDisclosure[K]) {
    setForm(p => {
      const next = { ...p, [k]: v };
      if (k === "accountIdentifier") {
        const raw = onlyDigits(String(v ?? ""));
        next.accountLast4 = last4(raw);
      }
      return next;
    });
  }

  const accountMasked = useMemo(() => maskAccountVisual(form.accountIdentifier || ""), [form.accountIdentifier]);
  const interestPreview = useMemo(() => fmtPctFromHundredths(form.interestHundredths ?? null), [form.interestHundredths]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.bankName?.trim()) return setToast("Please enter a bank name.");
    if (!form.accountType?.trim()) return setToast("Please enter the account type.");
    const rawAcct = onlyDigits(form.accountIdentifier || "");
    if (rawAcct.length < 5) return setToast("Full account number appears too short. Please enter the complete account number.");
    if (!form.bankAddress?.trim()) return setToast("Please enter the bank address.");

    // interestHundredths is optional, but if present must be a finite integer
    if (form.interestHundredths !== undefined && form.interestHundredths !== null) {
      const intVal = Number(form.interestHundredths);
      if (!Number.isInteger(intVal) || !Number.isFinite(intVal) || intVal < 0 || intVal > 5000) {
        // cap to something sane (0.00%..50.00%) — adjust if your product needs a wider range
        return setToast("Interest must be an integer in hundredths of a percent (e.g., 250 for 2.50%).");
      }
    }

    const r = await save({
      bankName: form.bankName.trim(),
      accountType: form.accountType.trim(),
      accountIdentifier: rawAcct,           // full
      accountLast4: last4(rawAcct),         // derived
      bankAddress: form.bankAddress.trim(),
      interestHundredths: form.interestHundredths ?? undefined,
    } as EscrowDisclosure);

    if ((r as any)?.ok) setToast("Saved.");
  }

  return (
    <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="mb-2 text-xs text-amber-900">
        <p className="font-medium">
          Massachusetts requires disclosure of the <b>bank name & address, full account number, deposit amount, and deposit date</b> within 30 days.
        </p>
        <p className="mt-1">
          Interest is stored in <b>hundredths of a percent</b>. For example, <b>250 =&nbsp;2.50%</b>, <b>500 =&nbsp;5.00%</b>.
        </p>
      </div>

      {error && <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">{error}</div>}

      <form onSubmit={onSave} className="grid grid-cols-1 gap-3 text-sm">
        <div className="grid grid-cols-1 gap-1">
          <label className="text-xs text-gray-700">Bank name</label>
          <input className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                 value={form.bankName || ""} onChange={(e)=>update("bankName", e.target.value)}
                 placeholder="Eastern Bank" disabled={saving || loading}/>
        </div>

        <div className="grid grid-cols-1 gap-1">
          <label className="text-xs text-gray-700">Account type</label>
          <input className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                 value={form.accountType || ""} onChange={(e)=>update("accountType", e.target.value)}
                 placeholder="Interest-bearing escrow" disabled={saving || loading}/>
        </div>

        {/* Full Account Number (masked visually, stored raw digits) */}
        <div className="grid grid-cols-1 gap-1">
          <label className="text-xs text-gray-700 flex items-center justify-between">
            <span>Full account number</span>
            <span className="flex items-center gap-2">
              <input id="show-full" type="checkbox" className="h-3.5 w-3.5"
                     checked={showFull} onChange={()=>setShowFull(s=>!s)} />
              <label htmlFor="show-full" className="text-[11px] text-gray-600">Show digits</label>
            </span>
          </label>

          <input
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm font-mono"
            value={showFull ? form.accountIdentifier : accountMasked}
            onChange={(e) => {
              const raw = unmaskAccountVisual(e.target.value);
              update("accountIdentifier", raw);
            }}
            placeholder="1234 5678 9012 3456"
            inputMode="numeric"
            autoComplete="off"
            disabled={saving || loading}
          />
          <div className="text-[11px] text-gray-600">We store the digits you enter; display is masked for readability. Last 4 is derived automatically.</div>
        </div>

        {/* Derived last 4 (read-only) */}
        <div className="grid grid-cols-1 gap-1">
          <label className="text-xs text-gray-700">Account last 4 (derived)</label>
          <input className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm font-mono"
                 value={form.accountLast4 || ""} readOnly />
        </div>

        <div className="grid grid-cols-1 gap-1">
          <label className="text-xs text-gray-700">Bank address</label>
          <input className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                 value={form.bankAddress || ""} onChange={(e)=>update("bankAddress", e.target.value)}
                 placeholder="250 Cambridge St, Boston, MA 02114" disabled={saving || loading}/>
        </div>

        {/* Interest in hundredths-of-a-percent */}
        <div className="grid grid-cols-1 gap-1">
          <label className="text-xs text-gray-700">
            Annual interest (hundredths of a percent)
            <span className="ml-1 text-gray-500">(e.g., 250 =&nbsp;2.50%)</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              className="w-36 rounded-md border border-gray-300 px-2 py-1.5 text-sm font-mono"
              value={form.interestHundredths ?? ""}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, "");
                update("interestHundredths", raw === "" ? undefined : Number(raw));
              }}
              placeholder="250"
              inputMode="numeric"
              disabled={saving || loading}
            />
            <span className="text-xs text-gray-600">Preview: <span className="font-medium">{interestPreview || "—"}</span></span>
          </div>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button type="submit" disabled={saving || loading}
                  className="rounded-md bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60">
            {saving ? "Saving…" : "Save disclosure"}
          </button>
          {toast && <span className="text-xs text-gray-600">{toast}</span>}
        </div>
      </form>
    </div>
  );
}

/* ── Account Card ─────────────────────────────────────────── */
function AccountCard({ title, subtitle, kind, firmId }:{
  title:string; subtitle:string; kind:"operating"|"escrow"; firmId?:string;
}) {
  const { loading, status, err, ensureAccount, startOnboarding, refresh } = useStripeConnect(firmId, kind);
  const hasAcct = !!status?.accountId;
  const needsOnboarding = hasAcct && (!(status?.detailsSubmitted) || !(status?.payoutsEnabled) || !(status?.chargesEnabled));
  const isActive = hasAcct && !!status?.detailsSubmitted && !!status?.payoutsEnabled && !!status?.chargesEnabled;

  const openDashboard = useCallback(async () => {
    if (status?.dashboardUrl) { window.location.href = status.dashboardUrl!; return; }
    try {
      const r = await fetch(`/api/stripe/connect/login?kind=${kind}${firmId ? `&firmId=${encodeURIComponent(firmId)}` : ""}`, { method:"POST" });
      const j = await r.json();
      if (!r.ok || !j?.url) throw new Error(j?.error || "Failed to create dashboard link");
      window.location.href = j.url;
    } catch (e) {
      console.error("openDashboard failed", e);
      alert("Could not open Stripe dashboard.");
    }
  }, [status?.dashboardUrl, kind, firmId]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">{title}</div>
          <div className="text-xs text-gray-600">{subtitle}</div>
        </div>
        <button onClick={refresh} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs hover:bg-gray-50">Refresh</button>
      </div>

      <div className="mt-4 space-y-3 text-sm">
        {loading ? (
          <div className="text-gray-600">Loading Stripe status…</div>
        ) : err ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-rose-800">{err}</div>
        ) : (
          <>
            <Row label="Account"><span className="font-mono">{status?.accountId || "—"}</span></Row>
            <Row label="Details submitted"><Badge tone={status?.detailsSubmitted ? "green" : "amber"}>{status?.detailsSubmitted ? "Yes" : "Pending"}</Badge></Row>
            <Row label="Charges enabled"><Badge tone={status?.chargesEnabled ? "green" : "amber"}>{status?.chargesEnabled ? "Enabled" : "Disabled"}</Badge></Row>
            <Row label="Payouts enabled"><Badge tone={status?.payoutsEnabled ? "green" : "amber"}>{status?.payoutsEnabled ? "Enabled" : "Disabled"}</Badge></Row>

            <div className="mt-4 flex flex-wrap gap-2">
              {!hasAcct && (
                <button onClick={ensureAccount} className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700">
                  Create Stripe account
                </button>
              )}
              {hasAcct && needsOnboarding && (
                <button onClick={startOnboarding} className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700">
                  Link account
                </button>
              )}
              {hasAcct && (
                <button onClick={openDashboard} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900 hover:bg-gray-50">
                  Open Stripe dashboard
                </button>
              )}
            </div>

            {kind === "escrow" && (
              <>
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  Keep this bank set to your MA interest-bearing escrow account; do not commingle deposits with operating funds.
                </div>
                <EscrowDisclosureForm />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────── */
export default function PaymentsDesktop({ firmId }: { firmId?: string }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-gray-50 p-4 text-xs text-gray-600">
        Route rent and fees to <span className="font-medium">Operating</span>, route security deposits to <span className="font-medium">Escrow</span>.
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <AccountCard title="Operating payouts (Rent, Fees)" subtitle="Connect Stripe to receive rent and other operating funds." kind="operating" firmId={firmId} />
        <AccountCard title="Escrow payouts (Security Deposits)" subtitle="Connect Stripe to receive tenant deposits into a separate escrow account." kind="escrow" firmId={firmId} />
      </div>
    </div>
  );
}
