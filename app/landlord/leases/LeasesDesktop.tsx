// app/landlord/leases/LeasesDesktop.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type LeaseStatus = "scheduled" | "active" | "ended" | "canceled" | string;

type LeaseRow = {
  id: string;                // leaseId
  appId: string;
  householdId: string;
  householdName?: string | null;
  unitNumber?: string | null;
  moveInDate: string;        // YYYY-MM-DD
  moveOutDate?: string | null;
  signed: boolean;
  status: LeaseStatus;
  updatedAt?: string;

  // enrichment from API
  buildingKey?: string;      // canonical address key
  buildingLabel?: string;    // human-friendly address label
};

type ReadyApp = {
  appId: string;
  householdId?: string;
  status: string;
  updatedAt?: string;
  formName?: string;
};

function clsx(...xs: (string | false | null | undefined)[]) { return xs.filter(Boolean).join(" "); }
function fmtDate(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString();
}
function daysUntil(ymd?: string | null) {
  if (!ymd) return Infinity;
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return Infinity;
  const tgt = new Date(Date.UTC(y, m - 1, d));
  const now = new Date();
  return Math.floor((tgt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}
function inWindow(ymd?: string | null, from = 0, to = 7) {
  const n = daysUntil(ymd);
  return n >= from && n <= to;
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  active: "Active",
  ended: "Ended",
  canceled: "Canceled",
};

const ENDPOINT = (firmId?: string, status?: string, cursor?: string) => {
  const qp = new URLSearchParams();
  if (firmId) qp.set("firmId", firmId);
  if (status && status !== "all") qp.set("status", status);
  if (cursor) qp.set("cursor", cursor);
  return `/api/landlord/leases/list?${qp.toString()}`;
};

const APPS_ENDPOINT = (firmId?: string) => {
  const qp = new URLSearchParams();
  qp.set("limit", "200");
  if (firmId) qp.set("firmId", firmId);
  return `/api/landlord/applications?${qp.toString()}`;
};

export default function LeasesDesktop() {
  const sp = useSearchParams();
  const firmIdFromUrl = sp.get("firmId") || undefined;

  const [rows, setRows] = useState<LeaseRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyMore, setBusyMore] = useState(false);

  const [readyApps, setReadyApps] = useState<ReadyApp[]>([]);
  const [loadingReady, setLoadingReady] = useState(true);

  type Tab = "all" | "scheduled" | "active" | "ended" | "canceled";
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [onlyUnsigned, setOnlyUnsigned] = useState(false);
  const [upcoming, setUpcoming] = useState<"none" | "7" | "30">("none");

  async function load(first = false) {
    const url = ENDPOINT(firmIdFromUrl, tab, first ? undefined : cursor || undefined);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      if (first) { setRows([]); setCursor(null); }
      setLoading(false); setBusyMore(false);
      return;
    }
    const j = await res.json();
    const list: any[] = Array.isArray(j.leases) ? j.leases : [];
    const mapped: LeaseRow[] = list.map((r) => ({
      id: String(r._id),
      appId: String(r.appId),
      householdId: String(r.householdId ?? ""),
      householdName: r.householdName ?? null,
      unitNumber: r.unitNumber ?? null,
      moveInDate: String(r.moveInDate ?? ""),
      moveOutDate: r.moveOutDate ? String(r.moveOutDate) : null,
      signed: !!r.signed,
      status: String(r.status ?? "scheduled"),
      updatedAt: r.updatedAt ? String(r.updatedAt) : undefined,
      buildingKey: r.buildingKey ?? undefined,
      buildingLabel: r.buildingLabel ?? undefined,
    }));
    if (first) setRows(mapped);
    else setRows((prev) => [...prev, ...mapped]);
    setCursor(j?.nextCursor ? String(j.nextCursor) : null);
    setLoading(false); setBusyMore(false);
  }

  useEffect(() => {
    setLoading(true); setRows([]); setCursor(null);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmIdFromUrl, tab]);

  // Ready-to-lease apps (no lease yet)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingReady(true);
      try {
        const res = await fetch(APPS_ENDPOINT(firmIdFromUrl), { cache: "no-store" });
        const j = await res.json();
        const apps: any[] = Array.isArray(j.households) ? j.households : [];
        const leaseAppIds = new Set(rows.map(r => r.appId));
        const ready = apps
          .map(a => ({
            appId: String(a.appId ?? a._id ?? ""),
            householdId: String(a.householdId ?? a.id ?? ""),
            status: String(a.status ?? ""),
            updatedAt: a.updatedAt ? String(a.updatedAt) : undefined,
            formName: a.formName ? String(a.formName) : undefined,
          }))
          .filter(a =>
            (a.status === "approved_ready_to_lease" || a.status === "approved_pending_lease")
            && a.appId && !leaseAppIds.has(a.appId)
          )
          .slice(0, 8);
        if (!cancelled) setReadyApps(ready);
      } catch {
        if (!cancelled) setReadyApps([]);
      } finally {
        if (!cancelled) setLoadingReady(false);
      }
    })();
  }, [firmIdFromUrl, rows]);

  /* ─────────── search / quick filters ─────────── */
  const filtered = useMemo(() => {
    let base = rows;
    if (q.trim()) {
      const t = q.toLowerCase();
      base = base.filter(r =>
        [
          r.buildingLabel, r.unitNumber, r.status, r.moveInDate, r.moveOutDate, r.appId, r.householdName
        ].filter(Boolean).join(" ").toLowerCase().includes(t)
      );
    }
    if (onlyUnsigned) base = base.filter(r => !r.signed);
    if (upcoming !== "none") {
      const win = upcoming === "7" ? 7 : 30;
      base = base.filter(r => inWindow(r.moveInDate, 0, win));
    }
    // sort by building then soonest move-in
    return [...base].sort((a, b) => {
      const ba = (a.buildingLabel || "").localeCompare(b.buildingLabel || "");
      if (ba !== 0) return ba;
      const da = daysUntil(a.moveInDate);
      const db = daysUntil(b.moveInDate);
      if (da !== db) return da - db;
      return String(a.unitNumber ?? "").localeCompare(String(b.unitNumber ?? ""));
    });
  }, [rows, q, onlyUnsigned, upcoming]);

  // group by building
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; items: LeaseRow[] }>();
    for (const r of filtered) {
      const key = r.buildingKey || (r.buildingLabel || "UNKNOWN");
      const label = r.buildingLabel || "Unknown address";
      if (!m.has(key)) m.set(key, { label, items: [] });
      m.get(key)!.items.push(r);
    }
    return Array.from(m.values());
  }, [filtered]);

  /* ─────────── render ─────────── */
  return (
    <>
      {/* Ready-to-lease callout */}
      <div className="mb-4">
        {loadingReady ? (
          <div className="rounded-md border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
            Checking for applications that are ready to be leased…
          </div>
        ) : readyApps.length > 0 ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="text-sm font-medium text-emerald-900">
              {readyApps.length} application{readyApps.length > 1 ? "s" : ""} ready to be leased
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {readyApps.map(a => (
                <div key={a.appId} className="rounded-lg border border-emerald-200 bg-white p-3 text-sm">
                  <div className="font-medium text-gray-900">{a.formName ?? "Application"}</div>
                  <div className="mt-0.5 text-gray-600">App <span className="font-mono">{a.appId}</span></div>
                  <div className="mt-2">
                    <Link
                      href={`/landlord/reviews/${encodeURIComponent(a.appId)}${firmIdFromUrl ? `?firmId=${encodeURIComponent(firmIdFromUrl)}` : ""}`}
                      className="inline-flex items-center rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      Review &amp; assign
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* Toolbar */}
      <div className="sticky top-0 z-30 -mx-6 mb-4 border-b border-gray-200 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="mx-auto max-w-[1100px] px-6 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Tabs */}
            <div className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5">
              {(["all","scheduled","active","ended","canceled"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={clsx("px-4 py-2 text-sm rounded-md transition whitespace-nowrap",
                    tab === t ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-50")}
                  aria-pressed={tab === t}
                >
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {/* Right controls */}
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300"
                  checked={onlyUnsigned}
                  onChange={(e) => setOnlyUnsigned(e.target.checked)}
                />
                Unsigned only
              </label>
              <select
                value={upcoming}
                onChange={(e) => setUpcoming(e.target.value as any)}
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
                aria-label="Upcoming move-ins"
              >
                <option value="none">All move-ins</option>
                <option value="7">Move-ins next 7 days</option>
                <option value="30">Move-ins next 30 days</option>
              </select>
              <div className="relative">
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search building / unit / name / status"
                  className="w-72 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="pointer-events-none absolute right-2 top-2.5 text-gray-400">
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M21 21l-4.3-4.3M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" stroke="currentColor" strokeWidth="2" fill="none" />
                  </svg>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Grouped by building */}
      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-8 text-sm text-gray-600">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-12 text-center text-sm text-gray-600">
          No leases found,
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.label} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <header className="flex items-center justify-between gap-4 bg-gray-50 px-5 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900">{g.label}</div>
                  <div className="text-xs text-gray-600">
                    {g.items.length} unit{g.items.length === 1 ? "" : "s"}
                  </div>
                </div>
              </header>

              <div className="overflow-x-auto">
                <table className="min-w-full table-auto divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                      <th className="px-5 py-3 w-[120px]">Unit</th>
                      <th className="px-5 py-3 min-w-[180px]">Household</th>
                      <th className="px-5 py-3 w-[130px]">Move in</th>
                      <th className="px-5 py-3 w-[130px]">Move out</th>
                      <th className="px-5 py-3 w-[120px]">Status</th>
                      <th className="px-5 py-3 w-[110px]">Signed</th>
                      <th className="px-5 py-3 min-w-[240px]">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {g.items.map((r) => {
                      const soon = inWindow(r.moveInDate, 0, 7);
                      const statusCls =
                        r.status === "active" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" :
                        r.status === "scheduled" ? "bg-blue-50 text-blue-700 ring-blue-200" :
                        r.status === "ended" ? "bg-gray-100 text-gray-800 ring-gray-200" :
                        r.status === "canceled" ? "bg-rose-50 text-rose-700 ring-rose-200" :
                        "bg-gray-100 text-gray-800 ring-gray-200";

                      return (
                        <tr key={r.id} className={clsx(soon && "bg-amber-50/20")}>
                          <td className="px-5 py-3 align-top text-sm text-gray-900">
                            <div className="font-medium">{r.unitNumber ?? "—"}</div>
                            {soon && (
                              <div className="mt-0.5 text-[11px] text-amber-700">Move-in soon</div>
                            )}
                          </td>
                          <td className="px-5 py-3 align-top text-sm text-gray-800">
                            {r.householdName || "Household"}
                          </td>
                          <td className="px-5 py-3 align-top text-sm text-gray-700">{fmtDate(r.moveInDate)}</td>
                          <td className="px-5 py-3 align-top text-sm text-gray-700">{fmtDate(r.moveOutDate)}</td>
                          <td className="px-5 py-3 align-top text-sm">
                            <span className={clsx("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", statusCls)}>
                              {STATUS_LABEL[r.status] ?? r.status}
                            </span>
                          </td>
                          <td className="px-5 py-3 align-top text-sm">
                            {r.signed ? <span className="text-emerald-700">Signed</span> : <span className="text-gray-600">Not signed</span>}
                          </td>
                          <td className="px-5 py-3 align-top">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                href={`/landlord/reviews/${encodeURIComponent(r.appId)}${firmIdFromUrl ? `?firmId=${encodeURIComponent(firmIdFromUrl)}` : ""}`}
                                className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50"
                              >
                                View application
                              </Link>
<Link
  href={`/landlord/leases/${encodeURIComponent(r.id)}/overview${firmIdFromUrl ? `?firmId=${encodeURIComponent(firmIdFromUrl)}` : ""}`}
  className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
>
  Lease overview
</Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Pagination */}
      {cursor && (
        <div className="flex justify-center my  -6">
          <button
            disabled={busyMore}
            onClick={async () => { setBusyMore(true); await load(false); }}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-60"
          >
            {busyMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}
