"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const HomeDesktop = dynamic(() => import("./HomeDesktop"), { ssr: false });
const HomeMobile  = dynamic(() => import("./HomeMobile"),  { ssr: false });

export default function HomeRouter() {
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

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

  if (!mounted) return null;
  const View = isMobile ? HomeMobile : HomeDesktop;
  return <View />;
}
