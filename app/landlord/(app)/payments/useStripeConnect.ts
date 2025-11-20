"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

export type ConnectStatus = {
  ok: boolean;
  accountId?: string | null;
  detailsSubmitted?: boolean;
  payoutsEnabled?: boolean;
  chargesEnabled?: boolean;
  dashboardUrl?: string | null;
};

export function useStripeConnect(firmId?: string, kind: "operating" | "escrow" = "operating") {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (firmId) p.set("firmId", firmId);
    if (kind) p.set("kind", kind);
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [firmId, kind]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/stripe/connect/status${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed to load status");
      setStatus(j as ConnectStatus);
    } catch (e: any) {
      setErr(e.message || "Failed to load status");
    } finally {
      setLoading(false);
    }
  }, [qs]);

  const ensureAccount = useCallback(async () => {
    setErr(null);
    const r = await fetch(`/api/stripe/connect/init${qs}`, { method: "POST" });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || "Failed to create Stripe account");
    await refresh();
    return j;
  }, [qs, refresh]);

  const startOnboarding = useCallback(async () => {
    setErr(null);
    // Guard: must have an account first
    if (!status?.accountId) {
      throw new Error("Create Stripe account first");
    }
    const r = await fetch(`/api/stripe/connect/link${qs}`, { method: "POST" });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || "Failed to create onboarding link");
    window.location.href = j.url; // redirect to Stripe onboarding
  }, [qs, status?.accountId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { loading, status, err, ensureAccount, startOnboarding, refresh };
}
