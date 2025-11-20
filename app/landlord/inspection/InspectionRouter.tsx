// app/landlord/inspection/InspectionRouter.tsx
"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

type Issue = {
  id: string;
  room: string;
  category: string;
  description: string;
  severity: "low" | "medium" | "high";
  photos: string[]; // URLs for now
  createdAt: string;
};

export type InspectionDoc = {
  _id: string;
  householdId: string | null;
  leaseId: string;
  status: "draft" | "submitted";
  items: Issue[];
  createdAt: string;
  updatedAt: string;
};

type Envelope =
  | { ok: true; inspection: InspectionDoc }
  | { ok: false; error: string };

const Desktop = dynamic(() => import("./InspectionDesktop"), { ssr: false });
const Mobile = dynamic(() => import("./InspectionMobile"), { ssr: false });

export default function InspectionRouter() {
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [doc, setDoc] = useState<InspectionDoc | null>(null);
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
    (async () => {
      try {
        // landlord version of the inspection doc
        const res = await fetch("/api/landlord/inspection", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: Envelope = await res.json();
        if (!("ok" in data) || !data.ok) throw new Error((data as any)?.error || "load_failed");
        setDoc(data.inspection);
      } catch (e) {
        console.error(e);
        setErr("Couldn’t load inspection,");
      }
    })();
  }, []);

  if (!mounted) return null;
  if (err) return <div className="px-4 text-sm text-rose-700">{err}</div>;
  if (!doc) return <div className="px-4 text-sm text-gray-600">Loading,</div>;

  const View = isMobile ? Mobile : Desktop;
  return <View doc={doc} onChange={setDoc} />;
}
