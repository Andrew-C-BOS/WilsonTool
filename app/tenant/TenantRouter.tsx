"use client";

import { useEffect, useState } from "react";
import TenantDesktop from "./TenantDesktop";
import TenantMobile from "./TenantMobile";

type SessionUser = { email: string | null };
type HomeState = {
  nextAction: {
    kind:
      | "configure_household"
      | "start_application"
      | "continue_application"
      | "submit_application"
      | "pay_holding_fee"
      | "sign_lease"
      | "complete_movein_checklist"
      | "done";
    href: string;
    label: string;
    sublabel?: string;
    progress: number; // 0..6
    context?: Record<string, string>;
  };
  secondary: { href: string; label: string }[];
};

export default function TenantRouter({
  user,
  state,
}: {
  user: SessionUser;
  state: HomeState | null;
}) {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener?.("change", update);
    (mql as any).addListener?.(update);
    return () => {
      mql.removeEventListener?.("change", update);
      (mql as any).removeListener?.(update);
    };
  }, []);

  if (isMobile === null) return <div className="text-gray-600 text-sm px-4 py-3">Loading…</div>;

  return isMobile ? <TenantMobile user={user} /> : <TenantDesktop user={user} state={state} />;
}
