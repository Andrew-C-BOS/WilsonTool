// app/landlord/leases/[id]/overview/LeaseOverviewDesktop.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type LeaseStatus = "scheduled" | "active" | "ended" | "canceled" | string;

type LeaseDoc = {
  _id: string;
  firmId: string;
  appId: string;
  building?: {
    addressLine1?: string;
    addressLine2?: string | null;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  } | null;
  createdAt?: string;
  updatedAt?: string;
  householdId?: string;
  monthlyRent?: number; // cents
  moveInDate?: string;  // YYYY-MM-DD
  moveOutDate?: string | null;
  propertyId?: string | null;
  signed?: boolean;
  signedAt?: string | null;
  status: LeaseStatus;
  unitId?: string | null;
  unitNumber?: string | null;
  checklist?: Array<{
    key: string;
    label: string;
    dueAt: string | null;
    completedAt: string | null;
    notes: string | null;
  }>;
  // Enrichments (from API or derived)
  buildingLabel?: string;
  householdName?: string | null;
};

type AppLite = {
  id: string;
  answers?: Record<string, any>;
  answersByMember?: Record<
    string,
    { role: "primary" | "co_applicant" | "cosigner"; email?: string; answers?: Record<string, any> }
  >;
  members?: Array<{ name?: string; role?: string; email?: string }>;
};

function clsx(...xs: (string | false | null | undefined)[]) { return xs.filter(Boolean).join(" "); }
const moneyFmt = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const fmtDate = (s?: string | null) => (!s ? "—" : (Number.isNaN(new Date(s).getTime()) ? s : new Date(s).toLocaleDateString()));

function householdNameFromApp(app?: AppLite | null): string | null {
  if (!app) return null;
  const pri = app.answers?.primary?.q_name || app.answers?.primary?.name;
  if (pri && String(pri).trim()) return String(pri).trim();

  const abm = app.answersByMember || {};
  const names: string[] = [];
  for (const [, bucket] of Object.entries(abm)) {
    const nm = (bucket as any)?.answers?.q_name || (bucket as any)?.answers?.name;
    const role = String((bucket as any)?.role || "").toLowerCase();
    if (nm && ["primary", "co_applicant", "cosigner"].includes(role)) names.push(String(nm));
  }
  const uniq = Array.from(new Set(names.map((x) => x.trim()).filter(Boolean)));
  if (uniq.length) return uniq.join(" & ");

  const mnames = (app.members || []).map((m) => String(m?.name || "")).filter((x) => x.trim());
  if (mnames.length) return mnames.join(" & ");

  return null;
}

/* ─────────────────────────────────────────────────────────────
   Network helpers
   1) Try the intended API path.
   2) Try common variants (overview/:id, singular lease).
   3) Fall back to legacy non-/api JSON route.
───────────────────────────────────────────────────────────── */
async function tryFetchJson(url: string) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { ok: false as const, status: res.status, data: null };
    const data = await res.json().catch(() => null);
    return { ok: true as const, status: 200, data };
  } catch {
    return { ok: false as const, status: 0, data: null };
  }
}

function withFirmId(base: string, firmId?: string) {
  if (!firmId) return base;
  return `${base}${base.includes("?") ? "&" : "?"}firmId=${encodeURIComponent(firmId)}`;
}

async function fetchOverviewRobust(leaseId: string, firmId?: string): Promise<LeaseDoc | null> {
  // 1) Intended path (matches your screenshot):
  const primary = withFirmId(`/api/landlord/leases/${encodeURIComponent(leaseId)}/overview`, firmId);

  // 2) Common variants people accidentally create:
  const alt1   = withFirmId(`/api/landlord/leases/overview/${encodeURIComponent(leaseId)}`, firmId); // swapped segment order
  const alt2   = withFirmId(`/api/landlord/lease/${encodeURIComponent(leaseId)}/overview`, firmId);  // singular "lease"

  for (const u of [primary, alt1, alt2]) {
    // Dev aid: log exactly what we’re calling
    if (typeof window !== "undefined") console.log("[lease-overview] GET", u);
    const r = await tryFetchJson(u);
    if (r.ok && r.data?.lease) return r.data.lease as LeaseDoc;
  }
  return null;
}

async function fetchLeaseLegacy(leaseId: string, firmId?: string): Promise<LeaseDoc | null> {
  const url = withFirmId(`/landlord/leases/${encodeURIComponent(leaseId)}`, firmId);
  if (typeof window !== "undefined") console.log("[lease-legacy] GET", url);
  const r = await tryFetchJson(url);
  if (!r.ok || !r.data?.lease) return null;
  return r.data.lease as LeaseDoc;
}

async function fetchApp(appId: string, firmId?: string): Promise<AppLite | null> {
  const url = withFirmId(`/api/landlord/applications/${encodeURIComponent(appId)}`, firmId);
  if (typeof window !== "undefined") console.log("[app] GET", url);
  const r = await tryFetchJson(url);
  const a = r.ok ? r.data?.application : null;
  if (!a) return null;
  return {
    id: String(a.id ?? a._id),
    answers: a.answers ?? {},
    answersByMember: a.answersByMember ?? {},
    members: a.members ?? [],
  };
}

/* ─────────────────────────────────────────────────────────────
   Component
───────────────────────────────────────────────────────────── */
export default function LeaseOverviewDesktop({ leaseId, firmId }: { leaseId: string; firmId?: string }) {
  const [loading, setLoading] = useState(true);
  const [lease, setLease] = useState<LeaseDoc | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);

      // 1) Try the enriched API first (your file path shows this should exist)
      let l = await fetchOverviewRobust(leaseId, firmId);

      // 2) Fall back to legacy JSON route and derive enrichments
      if (!l) {
        const legacy = await fetchLeaseLegacy(leaseId, firmId);
        if (legacy) {
          // derive household name
          if (legacy.appId) {
            const a = await fetchApp(legacy.appId, firmId);
            legacy.householdName = householdNameFromApp(a);
          }
          // derive building label
          const b = legacy.building;
          if (b) {
            const line1 = (b.addressLine1 || "").trim();
            const line2 = (b.addressLine2 || "").trim();
            const citySt = [b.city, b.state].filter(Boolean).join(", ");
            const zip = (b.postalCode || "").trim();
            legacy.buildingLabel = [line1, line2, citySt, zip].filter(Boolean).join(" • ");
          }
          l = legacy;
        }
      }

      if (!cancel) {
        setLease(l);
        setLoading(false);
        if (!l) setToast("Lease not found,");
      }
    })();
    return () => { cancel = true; };
  }, [leaseId, firmId]);

  const buildingLabel = useMemo(() => lease?.buildingLabel || "Unknown address", [lease]);

  const statusPill = (status?: string) => {
    const cls = clsx(
      "inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
      status === "active" && "bg-emerald-50 text-emerald-800 ring-emerald-200",
      status === "scheduled" && "bg-blue-50 text-blue-700 ring-blue-200",
      status === "ended" && "bg-gray-100 text-gray-800 ring-gray-200",
      status === "canceled" && "bg-rose-50 text-rose-700 ring-rose-200",
      !["active", "scheduled", "ended", "canceled"].includes(String(status || "")) &&
        "bg-gray-100 text-gray-800 ring-gray-200"
    );
    const label = (status && status[0].toUpperCase() + status.slice(1)) || "—";
    return <span className={cls}>{label}</span>;
  };

  const rentLabel = moneyFmt.format(((lease?.monthlyRent ?? 0) / 100));

  return (
    <main className="mx-auto w-full max-w-5xl px-6 pb-10">
      {/* Header */}
      <div className="mt-6 mb-4">
        <div className="text-xs text-gray-500">Lease</div>
        <div className="mt-1 text-lg font-semibold text-gray-900 break-words">{buildingLabel}</div>
        <div className="mt-0.5 text-sm text-gray-700">
          Unit <span className="font-medium">{lease?.unitNumber ?? "—"}</span>
          <span className="mx-2">•</span>
          {statusPill(lease?.status)}
        </div>
      </div>

      {/* Top facts */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Household" value={lease?.householdName || "Household"} />
        <Fact label="Monthly rent" value={rentLabel} />
        <Fact label="Move-in" value={fmtDate(lease?.moveInDate)} />
        <Fact label="Move-out" value={fmtDate(lease?.moveOutDate ?? null)} />
      </div>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        {lease?.appId && (
          <Link
            href={`/landlord/reviews/${encodeURIComponent(lease.appId)}${firmId ? `?firmId=${encodeURIComponent(firmId)}` : ""}`}
            className="rounded-md bg-white px-3 py-2 text-xs font-medium text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50"
          >
            View application
          </Link>
        )}
        <Link
          href={`/landlord/leases${firmId ? `?firmId=${encodeURIComponent(firmId)}` : ""}`}
          className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800"
        >
          Lease overview
        </Link>
      </div>

      {/* Divider */}
      <div className="my-6 h-px w-full bg-gray-200" />

      {/* Checklist */}
      <section>
        <div className="text-sm font-semibold text-gray-900">Move-in checklist</div>
        {loading ? (
          <div className="mt-3 text-sm text-gray-600">Loading…</div>
        ) : !lease?.checklist || lease.checklist.length === 0 ? (
          <div className="mt-3 text-sm text-gray-600">No checklist items,</div>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {lease.checklist.map((it) => {
              const done = !!it.completedAt;
              return (
                <li key={it.key} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className={clsx("text-sm", done ? "text-gray-600 line-through" : "text-gray-900")}>
                      {it.label}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      Due {fmtDate(it.dueAt)}{it.notes ? ` • ${it.notes}` : ""}
                    </div>
                  </div>
                  <span
                    className={clsx(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] ring-1",
                      done ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200"
                    )}
                  >
                    {done ? "Completed" : "Pending"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
          <div className="rounded-md bg-gray-900 text-white text-sm px-4 py-2 shadow-lg">
            {toast}{" "}
            <button className="ml-3 underline" onClick={() => setToast(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function Fact({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-base font-semibold text-gray-900 break-words">
        {value == null || value === "" ? "—" : String(value)}
      </div>
    </div>
  );
}
