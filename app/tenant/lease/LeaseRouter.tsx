"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

/* ---------- UI Types (unchanged) ---------- */
export type ChecklistItem = {
  key: string;
  label: string;
  dueAt?: string | null;
  completedAt?: string | null;
  notes?: string | null;
};

export type LeaseDoc = {
  _id: string;
  householdId: string;
  propertyId: string;
  unitLabel?: string | null;
  rentCents: number;
  depositCents?: number | null;
  startDate: string;           // ISO
  endDate?: string | null;     // ISO
  status: "draft" | "active" | "terminated";
  parties?: { tenantName?: string | null; landlordName?: string | null } | null;
  address: { addressLine1: string; addressLine2?: string | null; city: string; state: string; postalCode: string };
  files?: { name: string; url: string }[];
  checklist?: ChecklistItem[];
};

/* ---------- API Types (new) ---------- */
type LeaseAPI = {
  _id: string;
  firmId?: string | null;
  appId?: string | null;
  householdId: string;
  monthlyRent: number;          // cents
  moveInDate: string;           // "YYYY-MM-DD"
  moveOutDate?: string | null;  // "YYYY-MM-DD" | null
  propertyId?: string | null;
  signed?: boolean;
  signedAt?: string | null;
  status: "scheduled" | "active" | "draft" | "terminated" | "pending" | "signed";
  unitId?: string | null;
  unitNumber?: string | null;
  building: {
    addressLine1: string;
    addressLine2?: string | null;
    city: string;
    state: string;
    postalCode: string;
    country?: string | null;
  };
  checklist?: ChecklistItem[];
  files?: { name: string; url: string }[];
  createdAt?: string;
  updatedAt?: string;
};

type LeaseEnvelope =
  | { ok: true; leases: { current: LeaseAPI | null; upcoming: LeaseAPI[]; past: LeaseAPI[]; all: LeaseAPI[] } }
  | { ok: false; error: string };

/* ---------- Dynamic views ---------- */
const LeaseDesktop = dynamic(() => import("./LeaseDesktop"), {
  ssr: false,
  loading: () => <div className="px-4 text-sm text-gray-600">Loading…</div>,
});
const LeaseMobile = dynamic(() => import("./LeaseMobile"), {
  ssr: false,
  loading: () => <div className="px-4 text-sm text-gray-600">Loading…</div>,
});

/* ---------- Helpers ---------- */
const toISO = (ymd?: string | null) => (ymd ? new Date(ymd).toISOString() : null);

/** Map raw API lease → UI LeaseDoc shape your components expect. */
function mapToUiLease(raw: LeaseAPI): LeaseDoc {
  // Map API statuses to your UI’s union, conservatively
  let uiStatus: LeaseDoc["status"] = "draft";
  if (raw.status === "active") uiStatus = "active";
  else if (raw.status === "terminated") uiStatus = "terminated";
  // "scheduled" reads fine as draft in the UI, until you add a Scheduled pill

  return {
    _id: raw._id,
    householdId: raw.householdId,
    propertyId: raw.propertyId ?? "",
    unitLabel: raw.unitNumber ?? null,
    rentCents: raw.monthlyRent ?? 0,
    depositCents: null,
    startDate: toISO(raw.moveInDate) ?? new Date().toISOString(),
    endDate: toISO(raw.moveOutDate),
    status: uiStatus,
    parties: { tenantName: null, landlordName: null },
    address: {
      addressLine1: raw.building?.addressLine1,
      addressLine2: raw.building?.addressLine2 ?? null,
      city: raw.building?.city,
      state: raw.building?.state,
      postalCode: raw.building?.postalCode,
    },
    files: raw.files ?? [],
    checklist: raw.checklist ?? [],
  };
}

export default function LeaseRouter() {
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [lease, setLease] = useState<LeaseDoc | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // media query, mounted guard
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

  // one-time fetch, consume the envelope
  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/api/tenant/lease", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: LeaseEnvelope = await res.json();
        if (!("ok" in data) || !data.ok) throw new Error((data as any)?.error || "load_failed");

        const current = data.leases.current;
        const firstUpcoming = data.leases.upcoming?.[0] ?? null;

        if (current) {
          setLease(mapToUiLease(current));
          setBanner(null);
        } else if (firstUpcoming) {
          setLease(mapToUiLease(firstUpcoming));
          const start = firstUpcoming.moveInDate;
          setBanner(start ? `Lease starts ${new Date(start).toLocaleDateString()},` : "Upcoming lease,");
        } else {
          setLease(null);
        }
      } catch (e) {
        console.error("failed to load lease:", e);
        setErr("We couldn’t load your lease,");
      }
    };
    run();
  }, []);

  if (!mounted) return null;
  if (err) return <div className="px-4 text-sm text-rose-700">{err}</div>;
  if (!lease) return <div className="px-4 text-sm text-gray-600">No lease to show,</div>;

  const View = isMobile ? LeaseMobile : LeaseDesktop;

  return (
    <>
      {banner && (
        <div className="mx-4 mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {banner}
        </div>
      )}
      <View lease={lease} onLeaseUpdated={setLease} />
    </>
  );
}
