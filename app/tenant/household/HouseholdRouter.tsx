// app/tenant/household/HouseholdRouter.tsx
"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

export type MemberRole = "primary" | "co_applicant" | "cosigner";
export type MemberState = "invited" | "active" | "left";
export type Member = {
  id: string;
  name: string | null;
  email: string;
  role: MemberRole;
  state: MemberState;
};

export type HouseholdCluster = {
  householdId: string;
  displayName?: string | null;
  inviteCode: string;
  inviteUrl: string;
  members: Member[];
  pendingRequests: { id: string; email: string; requestedRole: MemberRole; at: string }[];
};

const HouseholdDesktop = dynamic(() => import("./HouseholdDesktop"), {
  ssr: false,
  loading: () => <div className="px-4 text-sm text-gray-600">Loading…</div>,
});
const HouseholdMobile = dynamic(() => import("./HouseholdMobile"), {
  ssr: false,
  loading: () => <div className="px-4 text-sm text-gray-600">Loading…</div>,
});

export default function HouseholdRouter() {
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);

  const [cluster, setCluster] = useState<HouseholdCluster | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const mql = window.matchMedia("(max-width: 639px)");
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mql.matches);
    try {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    } catch {
      // Safari
      // @ts-ignore
      mql.addListener(onChange);
      // @ts-ignore
      return () => mql.removeListener(onChange);
    }
  }, []);

  useEffect(() => {
    // Fetch the real household cluster
    const run = async () => {
      try {
        const res = await fetch("/api/tenant/household/cluster", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data?.ok) throw new Error(data?.error || "load_failed");
        setCluster(data.cluster as HouseholdCluster);
      } catch (e: any) {
        console.error("failed to load household cluster:", e);
        setErr("We couldn’t load your household,");
      }
    };
    run();
  }, []);

  if (!mounted) return null;

  if (err) {
    return <div className="px-4 text-sm text-rose-700">{err}</div>;
  }

  if (!cluster) {
    return <div className="px-4 text-sm text-gray-600">Loading your household…</div>;
  }

  return isMobile ? <HouseholdMobile cluster={cluster} /> : <HouseholdDesktop cluster={cluster} />;
}
