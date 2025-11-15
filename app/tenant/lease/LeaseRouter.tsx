"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

/* ---------- Shared types ---------- */
export type ChecklistItem = {
  key: string;
  label: string;
  dueAt?: string | null;
  completedAt?: string | null;
  notes?: string | null;
};

export type LeasePartyInfo = {
  tenantName?: string | null;
  landlordName?: string | null;
};

export type TenantMember = {
  userId?: string | null;
  role?: string | null;
  email?: string | null;
  legalName?: string | null;
  displayName?: string | null;
};

export type PaymentPlan = {
  monthlyRentCents?: number;
  termMonths?: number;
  startDate?: string;
  securityCents?: number;
  keyFeeCents?: number;
  requireFirstBeforeMoveIn?: boolean;
  requireLastBeforeMoveIn?: boolean;
  countersignUpfrontThresholdCents?: number;
  countersignDepositThresholdCents?: number;
  upfrontTotals?: {
    firstCents?: number;
    lastCents?: number;
    keyCents?: number;
    securityCents?: number;
    otherUpfrontCents?: number;
    totalUpfrontCents?: number;
  };
  priority?: string[];
};

export type CountersignInfo = {
  allowed?: boolean;
  upfrontMinCents?: number;
  depositMinCents?: number;
};

/* ---------- UI LeaseDoc ---------- */
export type LeaseDoc = {
  _id: string;
  householdId: string;
  propertyId: string;
  unitLabel?: string | null;
  rentCents: number;
  depositCents?: number | null;
  // We’ll store date-only strings here (YYYY-MM-DD) from the API
  startDate: string;
  endDate?: string | null;
  status: "draft" | "active" | "terminated";
  parties?: LeasePartyInfo | null;
  address: {
    addressLine1: string;
    addressLine2?: string | null;
    city: string;
    state: string;
    postalCode: string;
  };
  files?: { name: string; url: string }[];
  checklist?: ChecklistItem[];

  // extra enriched fields we get from the API
  tenantMembers?: TenantMember[];
  paymentPlan?: PaymentPlan | null;
  countersign?: CountersignInfo | null;
};

/* ---------- API Types (what /api/tenant/lease returns) ---------- */
type LeaseAPI = {
  _id: string;
  firmId?: string | null;
  appId?: string | null;
  householdId: string;
  monthlyRent: number; // cents
  moveInDate: string; // "YYYY-MM-DD"
  moveOutDate?: string | null; // "YYYY-MM-DD" | null
  propertyId?: string | null;
  signed?: boolean;
  signedAt?: string | null;
  status:
    | "scheduled"
    | "active"
    | "draft"
    | "terminated"
    | "pending"
    | "signed";
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

  // Enriched fields from the lease API
  depositCents?: number | null;
  parties?: LeasePartyInfo | null;
  tenantMembers?: TenantMember[];
  paymentPlan?: PaymentPlan | null;
  countersign?: CountersignInfo | null;

  // Plus documents, etc., which LeaseDesktop reads as `(lease as any).documents`
  documents?: any[];
};

type LeaseEnvelope =
  | {
      ok: true;
      leases: {
        current: LeaseAPI | null;
        upcoming: LeaseAPI[];
        past: LeaseAPI[];
        all: LeaseAPI[];
      };
    }
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
// For YYYY-MM-DD strings, don't convert to full ISO timestamps – just pass through
const toISO = (ymd?: string | null) => (ymd ? ymd : null);

const formatYmd = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(y, m - 1, d));
};

/** Map raw API lease → UI LeaseDoc shape your components expect. */
function mapToUiLease(raw: LeaseAPI): LeaseDoc {
  // Tenant-facing status: treat scheduled/signed as "active" for now
  let uiStatus: LeaseDoc["status"] = "draft";
  if (
    raw.status === "active" ||
    raw.status === "scheduled" ||
    raw.status === "signed"
  ) {
    uiStatus = "active";
  } else if (raw.status === "terminated") {
    uiStatus = "terminated";
  }

  const startDate =
    toISO(raw.moveInDate) ?? new Date().toISOString().slice(0, 10);

  const leaseDoc: LeaseDoc = {
    _id: raw._id,
    householdId: raw.householdId,
    propertyId: raw.propertyId ?? "",
    unitLabel: raw.unitNumber ?? null,
    rentCents: raw.monthlyRent ?? 0,
    depositCents:
      raw.depositCents != null ? raw.depositCents : null,

    startDate,
    endDate: toISO(raw.moveOutDate),
    status: uiStatus,

    parties: raw.parties ?? null,

    address: {
      addressLine1: raw.building?.addressLine1,
      addressLine2: raw.building?.addressLine2 ?? null,
      city: raw.building?.city,
      state: raw.building?.state,
      postalCode: raw.building?.postalCode,
    },

    files: raw.files ?? [],
    checklist: raw.checklist ?? [],

    tenantMembers: raw.tenantMembers ?? [],
    paymentPlan: raw.paymentPlan ?? null,
    countersign: raw.countersign ?? null,
  };

  // You can log here if you want to sanity-check the mapping:
  // console.log("[LeaseRouter][mapToUiLease]", { raw, leaseDoc });

  return leaseDoc;
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
        if (!("ok" in data) || !data.ok) {
          throw new Error((data as any)?.error || "load_failed");
        }

        console.log("[LeaseRouter][rawEnvelope]", data);

        const current = data.leases.current;
        const firstUpcoming = data.leases.upcoming?.[0] ?? null;

        if (current) {
          const uiLease = mapToUiLease(current);
          console.log("[LeaseRouter][mappedCurrent]", uiLease);
          setLease(uiLease);
          setBanner(
            current.moveInDate
              ? `Lease starts ${formatYmd(current.moveInDate)},`
              : null,
          );
        } else if (firstUpcoming) {
          const uiLease = mapToUiLease(firstUpcoming);
          console.log("[LeaseRouter][mappedUpcoming]", uiLease);
          setLease(uiLease);
          const start = firstUpcoming.moveInDate;
          setBanner(
            start ? `Lease starts ${formatYmd(start)},` : "Upcoming lease,",
          );
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
  if (!lease)
    return (
      <div className="px-4 text-sm text-gray-600">No lease to show,</div>
    );

  const View = isMobile ? LeaseMobile : LeaseDesktop;

  return (
    <>
      {/* If you want to surface the banner on the page, you can pass it as a prop later */}
      <View lease={lease} onLeaseUpdated={setLease} />
    </>
  );
}
