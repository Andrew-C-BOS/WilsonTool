// app/landlord/leases/LeasesMobile.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type LeaseStatus = "scheduled" | "active" | "ended" | "canceled" | string;

type LeaseRow = {
  id: string;
  appId: string;
  householdId: string;
  unitNumber?: string | null;
  moveInDate: string;
  moveOutDate?: string | null;
  signed: boolean;
  status: LeaseStatus;
  updatedAt?: string;
};

function fmtDate(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString();
}

const ENDPOINT = (firmId?: string, status?: string, cursor?: string) => {
  const qp = new URLSearchParams();
  if (firmId) qp.set("firmId", firmId);
  if (status && status !== "all") qp.set("status", status);
  if (cursor) qp.set("cursor", cursor);
  return `/api/landlord/leases/list?${qp.toString()}`;
};

export default function LeasesMobile() {
  const sp = useSearchParams();
  const firmIdFromUrl = sp.get("firmId") || undefined;

  const [rows, setRows] = useState<LeaseRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  type Tab = "all" | "scheduled" | "active" | "ended" | "canceled";
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");

  async function load(first = false) {
    const url = ENDPOINT(firmIdFromUrl, tab, first ? undefined : cursor || undefined);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) { if (first) setRows([]); setLoading(false); return; }
    const j = await res.json();
    const list: any[] = Array.isArray(j.leases) ? j.leases : [];
    const mapped: LeaseRow[] = list.map((r) => ({
      id: String(r._id),
      appId: String(r.appId),
      householdId: String(r.householdId ?? ""),
      unitNumber: r.unitNumber ?? null,
      moveInDate: String(r.moveInDate ?? ""),
      moveOutDate: r.moveOutDate ? String(r.moveOutDate) : null,
      signed: !!r.signed,
      status: String(r.status ?? "scheduled"),
      updatedAt: r.updatedAt ? String(r.updatedAt) : undefined,
    }));
    if (first) setRows(mapped);
    else setRows((prev) => [...prev, ...mapped]);
    setCursor(j?.nextCursor ? String(j.nextCursor) : null);
    setLoading(false);
  }

  useEffect(() => {
    setLoading(true);
    setRows([]);
    setCursor(null);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmIdFromUrl, tab]);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const t = q.toLowerCase();
    return rows.filter((r) =>
      [r.unitNumber, r.status, r.moveInDate, r.moveOutDate, r.appId, r.householdId]
        .join(" ")
        .toLowerCase()
        .includes(t)
    );
  }, [rows, q]);

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="rounded-lg border border-gray-300 bg-white p-0.5 overflow-x-auto max-w-full">
        <div className="inline-flex min-w-max">
          {(["all","scheduled","active","ended","canceled"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                "px-3 py-2 text-sm rounded-md",
                tab === t ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-50 active:opacity-90"
              )}
            >
              {t === "all" ? "All" : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by unit, app, household, status"
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="pointer-events-none absolute right-2 top-2.5 text-gray-400">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 21l-4.3-4.3M10 18a8 8 0 110-16 8 8 0 010 16z" stroke="currentColor" strokeWidth="2" fill="none" />
          </svg>
        </span>
      </div>

      {/* List */}
      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
          No leases found,
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <div key={r.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-sm font-semibold text-gray-900">
                {r.unitNumber ?? "Unit —"}
              </div>
              <div className="mt-0.5 text-xs text-gray-600 break-all">
                App: {r.appId} · HH: {r.householdId}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-gray-800">
                <div>Move in: <strong>{fmtDate(r.moveInDate)}</strong></div>
                <div>Move out: <strong>{fmtDate(r.moveOutDate)}</strong></div>
                <div>Status: <strong>{r.status}</strong></div>
                <div>Signed: <strong>{r.signed ? "Yes" : "No"}</strong></div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Link
                  href={`/landlord/reviews/${encodeURIComponent(r.appId)}${firmIdFromUrl ? `?firmId=${encodeURIComponent(firmIdFromUrl)}` : ""}`}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50"
                >
                  View application
                </Link>
                <Link
                  href={`/landlord/leases/${encodeURIComponent(r.appId)}/holding${firmIdFromUrl ? `?firmId=${encodeURIComponent(firmIdFromUrl)}` : ""}`}
                  className="rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800 hover:bg-blue-100"
                >
                  Holding / Payment
                </Link>
                <Link
                  href={`/landlord/leases/${encodeURIComponent(r.id)}/edit${firmIdFromUrl ? `?firmId=${encodeURIComponent(firmIdFromUrl)}` : ""}`}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50"
                >
                  Edit
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// tiny clsx
function clsx(...xs: (string | false | null | undefined)[]) { return xs.filter(Boolean).join(" "); }
