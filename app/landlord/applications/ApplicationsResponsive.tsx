// app/landlord/applications/ApplicationsResponsive.tsx

"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// Lazy chunks; each renders only when chosen:
const ApplicationsDesktop = dynamic(() => import("./ApplicationsDesktop"), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading desktop…</div>,
});
const ApplicationsMobile = dynamic(() => import("./ApplicationsMobile"), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading mobile…</div>,
});

// Small hook, reliable, easy to test:
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${breakpoint - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, [breakpoint]);
  return isMobile;
}

export default function ApplicationsResponsive() {
  const isMobile = useIsMobile(768);

  // First paint on client, quick, unobtrusive,:
  if (isMobile === null) {
    return <div className="text-sm text-gray-500">Loading…</div>;
  }

  return isMobile ? <ApplicationsMobile /> : <ApplicationsDesktop />;
}
