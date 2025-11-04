// app/tenant/applications/ApplicationsRouter.tsx
"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const ApplicationsDesktop = dynamic(
  () => import("./ApplicationsDesktop"),
  { ssr: false, loading: () => <div className="px-4 text-sm text-gray-600">Loading…</div> }
);

const ApplicationsMobile = dynamic(
  () => import("./ApplicationsMobile"),
  { ssr: false, loading: () => <div className="px-4 text-sm text-gray-600">Loading…</div> }
);

export default function ApplicationsRouter() {
  const params = useSearchParams();
  const forced = params?.get("view"); // "mobile" | "desktop" | null

  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);

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

  // Handy force‑switch for QA: ?view=mobile or ?view=desktop
  if (forced === "mobile") return <ApplicationsMobile />;
  if (forced === "desktop") return <ApplicationsDesktop />;

  if (!mounted) return null; // avoid hydration flicker
  return isMobile ? <ApplicationsMobile /> : <ApplicationsDesktop />;
}
