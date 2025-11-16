// app/tenant/applications/ApplicationsRouter.tsx
"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { TenantHomeState } from "@/lib/tenant/homeViewState";

type SessionUser = { email: string | null };

type ApplicationsRouterProps = {
  user: SessionUser;
  state: TenantHomeState | null;
};

// Shared view props for desktop + mobile
type ApplicationsViewProps = ApplicationsRouterProps;

// Dynamically loaded views, typed with the props they receive
const ApplicationsDesktop = dynamic<ApplicationsViewProps>(
  () => import("./ApplicationsDesktop"),
  {
    ssr: false,
    loading: () => (
      <div className="px-4 text-sm text-gray-600">
        Loading…
      </div>
    ),
  },
);

const ApplicationsMobile = dynamic<ApplicationsViewProps>(
  () => import("./ApplicationsMobile"),
  {
    ssr: false,
    loading: () => (
      <div className="px-4 text-sm text-gray-600">
        Loading…
      </div>
    ),
  },
);

export default function ApplicationsRouter({ user, state }: ApplicationsRouterProps) {
  const params = useSearchParams();
  const forced = params?.get("view"); // "mobile" | "desktop" | null

  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Handy debug
    // console.log("ApplicationsRouter user/state", user, state);
  }, [user, state]);

  useEffect(() => {
    setMounted(true);

    const mql = window.matchMedia("(max-width: 639px)"); // Tailwind 'sm' breakpoint
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);

    setIsMobile(mql.matches);

    try {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    } catch {
      // Older Safari
      // @ts-ignore
      mql.addListener(onChange);
      // @ts-ignore
      return () => mql.removeListener(onChange);
    }
  }, []);

  // Force-switch for QA: ?view=mobile or ?view=desktop
  if (forced === "mobile") {
    return <ApplicationsMobile user={user} state={state} />;
  }
  if (forced === "desktop") {
    return <ApplicationsDesktop user={user} state={state} />;
  }

  if (!mounted) {
    // Avoid hydration mismatch flicker
    return null;
  }

  return isMobile ? (
    <ApplicationsMobile user={user} state={state} />
  ) : (
    <ApplicationsDesktop user={user} state={state} />
  );
}
