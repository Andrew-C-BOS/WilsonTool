// app/join/[code]/JoinRouter.tsx
"use client"
import { useEffect, useState } from "react";
import JoinDesktop from "./JoinDesktop";
import JoinMobile from "./JoinMobile";

export default function JoinRouter({ code }: { code: string }) {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 640px)");
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
    return <div className="px-4 py-3 text-sm text-gray-600">Loading…</div>;
  }

  return isMobile ? <JoinMobile code={code} /> : <JoinDesktop code={code} />;
}
