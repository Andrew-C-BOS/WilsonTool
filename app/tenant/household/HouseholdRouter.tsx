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
  pendingRequests: {
    id: string;
    email: string;
    requestedRole: MemberRole;
    at: string;
  }[];
};

type SessionUser = { email: string | null };

// minimal shape we actually use from the home view state
type HouseholdState = { primaryKind?: string } | null;

type HouseholdRouterProps = {
  user: SessionUser;
  state: HouseholdState;
};

// Props passed to Desktop + Mobile variants
type HouseholdViewProps = {
  cluster: HouseholdCluster;
  user: SessionUser;
  state: HouseholdState;
};

// Dynamically loaded views, explicitly typed with props
const HouseholdDesktop = dynamic<HouseholdViewProps>(
  () => import("./HouseholdDesktop"),
  {
    ssr: false,
    loading: () => (
      <div className="px-4 text-sm text-gray-600">
        Loading…
      </div>
    ),
  },
);

const HouseholdMobile = dynamic<HouseholdViewProps>(
  () => import("./HouseholdMobile"),
  {
    ssr: false,
    loading: () => (
      <div className="px-4 text-sm text-gray-600">
        Loading…
      </div>
    ),
  },
);

export default function HouseholdRouter({ user, state }: HouseholdRouterProps) {
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
      // Safari fallback
      // @ts-ignore
      mql.addListener(onChange);
      // @ts-ignore
      return () => mql.removeListener(onChange);
    }
  }, []);

  useEffect(() => {
    // Fetch the household cluster
    const run = async () => {
      try {
        const res = await fetch("/api/tenant/household/cluster", {
          cache: "no-store",
        });
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
    return (
      <div className="px-4 text-sm text-rose-700">
        {err}
      </div>
    );
  }

  if (!cluster) {
    return (
      <div className="px-4 text-sm text-gray-600">
        Loading your household…
      </div>
    );
  }

  // Pass `cluster`, plus server-provided `state` and `user`
  return isMobile ? (
    <HouseholdMobile cluster={cluster} state={state} user={user} />
  ) : (
    <HouseholdDesktop cluster={cluster} state={state} user={user} />
  );
}
