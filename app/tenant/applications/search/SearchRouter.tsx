// app/tenant/applications/search/SearchRouter.tsx
"use client";

import { useEffect, useState } from "react";
import SearchDesktop from "./SearchDesktop";
import SearchMobile from "./SearchMobile";

export default function SearchRouter() {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 640px)");
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener?.("change", update);
    (mql as any).addListener?.(update); // Safari fallback
    return () => {
      mql.removeEventListener?.("change", update);
      (mql as any).removeListener?.(update);
    };
  }, []);

  if (isMobile === null) {
    return <div className="px-4 py-3 text-sm text-gray-600">Loading…</div>;
  }

  return isMobile ? <SearchMobile /> : <SearchDesktop />;
}
