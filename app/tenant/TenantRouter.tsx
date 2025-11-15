// app/tenant/TenantRouter.tsx
"use client";

import { useEffect, useState } from "react";
import TenantDesktop from "./TenantDesktop";
import TenantMobile from "./TenantMobile";
import type { TenantHomeState } from "@/lib/tenant/homeViewState";

type SessionUser = { email: string | null };

export default function TenantRouter({
  user,
  state,
}: {
  user: SessionUser;
  state: TenantHomeState | null;
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

  if (isMobile === null) {
    return (
      <div className="px-4 py-3 text-sm text-gray-600">
        Loading…
      </div>
    );
  }

  return isMobile ? (
    <TenantMobile user={user} state={state} />
  ) : (
    <TenantDesktop user={user} state={state} />
  );
}
