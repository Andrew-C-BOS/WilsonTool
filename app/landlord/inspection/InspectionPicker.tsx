// app/landlord/inspection/InspectionPicker.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type InspectionStatus = "none" | "draft" | "submitted";

type LeaseSummary = {
  id: string;
  buildingLabel: string;
  unitNumber: string | null;
  moveInDate: string | null;
  moveOutDate: string | null;
  status: string;

  // NEW
  inspectionStatus: InspectionStatus;
  lastInspectionAt: string | null;
};

function parseDateSafe(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

export default function InspectionPicker() {
  const router = useRouter();

  const [leases, setLeases] = useState<LeaseSummary[] | null>(null);
  const [leasesErr, setLeasesErr] = useState<string | null>(null);
  const [leasesLoading, setLeasesLoading] = useState(false);
  const [leaseSearch, setLeaseSearch] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLeasesLoading(true);
        setLeasesErr(null);
        const res = await fetch("/api/landlord/inspection/leases", { cache: "no-store" });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${txt}`);
        }
        const data: any = await res.json();
        if (!data?.ok || !Array.isArray(data.leases)) {
          throw new Error(data?.error || "bad_response");
        }
        setLeases(
          data.leases.map((l: any) => ({
            id: String(l.id ?? l._id),
            buildingLabel: String(l.buildingLabel ?? "Unknown address"),
            unitNumber: l.unitNumber ?? null,
            moveInDate: l.moveInDate ?? null,
            moveOutDate: l.moveOutDate ?? null,
            status: l.status ?? "scheduled",

            inspectionStatus: (l.inspectionStatus as InspectionStatus) ?? "none",
            lastInspectionAt: l.lastInspectionAt ?? null,
          })),
        );
      } catch (e: any) {
        console.error(e);
        setLeasesErr(e?.message || "Could not load leases");
      } finally {
        setLeasesLoading(false);
      }
    })();
  }, []);

  const filteredLeases = useMemo(() => {
    if (!leases) return [];
    const q = leaseSearch.trim().toLowerCase();
    const withParsed = leases.map((l) => ({
      ...l,
      moveIn: parseDateSafe(l.moveInDate),
    }));
    withParsed.sort((a, b) => {
      if (!a.moveIn && !b.moveIn) return 0;
      if (!a.moveIn) return 1;
      if (!b.moveIn) return -1;
      return a.moveIn.getTime() - b.moveIn.getTime();
    });
    if (!q) return withParsed;
    return withParsed.filter((l) => {
      const hay = `${l.buildingLabel} ${l.unitNumber || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [leases, leaseSearch]);

  function openLease(leaseId: string) {
    setBusy(true);
    router.push(`/landlord/inspection/${encodeURIComponent(leaseId)}`);
  }

  function inspectionStatusLabel(s: InspectionStatus) {
    if (s === "draft") return "Draft inspection";
    if (s === "submitted") return "Submitted inspection";
    return "No inspection yet";
  }

  function inspectionStatusClasses(s: InspectionStatus) {
    if (s === "submitted") {
      return "bg-emerald-50 text-emerald-700 border border-emerald-200";
    }
    if (s === "draft") {
      return "bg-amber-50 text-amber-800 border border-amber-200";
    }
    return "bg-gray-50 text-gray-600 border border-gray-200";
  }

  function lastInspectionLabel(lastInspectionAt: string | null) {
    if (!lastInspectionAt) return "";
    const d = parseDateSafe(lastInspectionAt);
    if (!d) return "";
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <div className="mx-auto max-w-md px-4 pb-24">
      {leasesErr && (
        <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {leasesErr}
        </div>
      )}

      <div className="mt-3 rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 px-4 py-4 text-white shadow-sm">
        <div className="text-[11px] uppercase tracking-wide text-slate-300">
          Inspector view
        </div>
        <div className="mt-1 text-base font-semibold">
          Pick a unit to inspect
        </div>
        <p className="mt-1 text-[11px] text-slate-300">
          Signed leases for your firm are shown by move-in date, so you can start
          with today’s move-ins and work ahead,
        </p>
      </div>

      <div className="mt-4">
        <input
          type="search"
          value={leaseSearch}
          onChange={(e) => setLeaseSearch(e.target.value)}
          placeholder="Search by address or unit…"
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {leasesLoading && (
        <div className="mt-4 text-sm text-gray-600">Loading leases…</div>
      )}

      {!leasesLoading && filteredLeases.length === 0 && (
        <div className="mt-4 text-sm text-gray-600">
          No upcoming signed leases found for your firm,
        </div>
      )}

      <div className="mt-4 space-y-3">
        {filteredLeases.map((l) => {
          const moveIn = parseDateSafe(l.moveInDate);
          const dateLabel = moveIn
            ? moveIn.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : "No move-in date";

          const now = new Date();
          const isToday =
            moveIn &&
            moveIn.getFullYear() === now.getFullYear() &&
            moveIn.getMonth() === now.getMonth() &&
            moveIn.getDate() === now.getDate();

          const inspLabel = inspectionStatusLabel(l.inspectionStatus);
          const inspClasses = inspectionStatusClasses(l.inspectionStatus);
          const lastInspLabel = lastInspectionLabel(l.lastInspectionAt);

          return (
            <button
              key={l.id}
              type="button"
              disabled={busy}
              onClick={() => openLease(l.id)}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-left shadow-sm ring-1 ring-transparent hover:border-blue-400 hover:ring-blue-100 transition disabled:opacity-60"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-gray-900">
                    {l.buildingLabel}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-600">
                    Unit <span className="font-medium">{l.unitNumber || "—"}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-gray-600">
                    Move-in <span className="font-medium">{dateLabel}</span>
                  </div>
                  {lastInspLabel && l.inspectionStatus !== "none" && (
                    <div className="mt-1 text-[11px] text-gray-500">
                      Last inspection{" "}
                      <span className="font-medium">{lastInspLabel}</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-end gap-1">
                  {/* Move-in status pill */}
                  <span
                    className={
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium " +
                      (isToday
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-gray-50 text-gray-700 border border-gray-200")
                    }
                  >
                    {isToday ? "Today" : l.status === "active" ? "Active" : "Scheduled"}
                  </span>

                  {/* Inspection status pill */}
                  <span
                    className={
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium " +
                      inspClasses
                    }
                  >
                    {inspLabel}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
