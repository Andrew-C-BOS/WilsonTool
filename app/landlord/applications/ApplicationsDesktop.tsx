// app/landlord/applications/ApplicationsDesktop.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/* ------------------------------------------
   Types used by this UI
------------------------------------------- */
type MemberRole = "primary" | "co-applicant" | "cosigner";
type AppStatus =
  | "new"
  | "in_review"
  | "needs_approval"
  | "approved_pending_lease"
  | "rejected";

type Household = {
  id: string;          // householdId
  appId: string;       // applicationId (for Review & Chat)
  submittedAt: string;
  status: AppStatus;
  // keeping members for future use, but we won't render them now
  members: {
    name: string;
    email: string;
    role: MemberRole;
    state?: "invited" | "complete" | "missing_docs";
  }[];
};

type FirmMeta = { firmId: string; firmName: string; firmSlug?: string } | null;

/* ------------------------------------------
   Small UI primitives
------------------------------------------- */
function clsx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}
function Badge({
  children,
  tone = "gray",
}: {
  children: React.ReactNode;
  tone?: "gray" | "blue" | "amber" | "violet" | "emerald" | "rose";
}) {
  const map = {
    gray: "bg-gray-100 text-gray-800 ring-gray-200",
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    violet: "bg-violet-50 text-violet-800 ring-violet-200",
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    rose: "bg-rose-50 text-rose-700 ring-rose-200",
  } as const;
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", map[tone])}>
      {children}
    </span>
  );
}
function StatusChip({ status }: { status: AppStatus }) {
  const tone =
    status === "new"
      ? "blue"
      : status === "in_review"
      ? "amber"
      : status === "needs_approval"
      ? "violet"
      : status === "approved_pending_lease"
      ? "emerald"
      : "rose";
  const label =
    status === "new"
      ? "New"
      : status === "in_review"
      ? "In review"
      : status === "needs_approval"
      ? "Needs approval"
      : status === "approved_pending_lease"
      ? "Approved"
      : "Rejected";
  return <Badge tone={tone as any}>{label}</Badge>;
}
function formatDate(s: string): string {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString();
}

/* ------------------------------------------
   Data wiring
------------------------------------------- */
const ENDPOINT = (cursor?: string, firmId?: string) => {
  const qp = new URLSearchParams();
  qp.set("limit", "50");
  if (cursor) qp.set("cursor", cursor);
  if (firmId) qp.set("firmId", firmId);
  return `/api/landlord/applications?${qp.toString()}`;
};

function getId(raw: any): string | null {
  const candidate = raw?.id ?? raw?.hhId ?? raw?.householdId ?? raw?._id ?? null;
  if (!candidate) return null;
  if (typeof candidate === "object" && candidate.$oid) return String(candidate.$oid);
  if (typeof candidate === "object" && typeof candidate.toString === "function") {
    const s = candidate.toString();
    if (s && s !== "[object Object]") return s;
  }
  return String(candidate);
}
function getAppId(raw: any): string | null {
  const candidate = raw?.appId ?? raw?.applicationId ?? raw?.application_id ?? raw?._id ?? null;
  if (!candidate) return null;
  if (typeof candidate === "object" && candidate.$oid) return String(candidate.$oid);
  if (typeof candidate === "object" && typeof candidate.toString === "function") {
    const s = candidate.toString();
    if (s && s !== "[object Object]") return s;
  }
  return String(candidate);
}
function normalizeStatus(v: any): AppStatus {
  const s = String(v ?? "").toLowerCase();
  const map: Record<string, AppStatus> = {
    new: "new",
    pending: "in_review",
    review: "in_review",
    in_review: "in_review",
    needs_approval: "needs_approval",
    approved: "approved_pending_lease",
    approved_pending_lease: "approved_pending_lease",
    reject: "rejected",
    rejected: "rejected",
  };
  return map[s] ?? "in_review";
}
function toISO(x: any): string {
  if (!x) return "";
  const d = new Date(x);
  return isNaN(d.getTime()) ? String(x) : d.toISOString();
}

// Helper: treat empty strings as undefined, so ?? works as intended
const val = (s: unknown): string | undefined => {
  const t = typeof s === "string" ? s : s == null ? undefined : String(s);
  return t && t.trim() ? t : undefined;
};

function coerceToHouseholdUI(raw: any): Household | null {
  const id = getId(raw);
  const appId = getAppId(raw);
  if (!id || !appId) return null;

  const submittedAt = toISO(raw.submittedAt ?? raw.createdAt ?? raw.updatedAt);
  const status = normalizeStatus(raw.status ?? raw.workflowStatus ?? raw.state ?? raw.phase);
  const membersRaw: any[] = Array.isArray(raw.members) ? raw.members : [];
  const members = membersRaw.map((m) => {
    const name =
      val(m.name) ??
      val(m.fullName) ??
      (val(m.firstName) && val(m.lastName) ? `${val(m.firstName)} ${val(m.lastName)}` : undefined) ??
      val(m.email) ??
      "—";
    const email = val(m.email) ?? val(m.mail) ?? "—";
    return { name, email, role: "co-applicant" as MemberRole };
  });

  return { id, appId, submittedAt, status, members };
}

async function fetchHouseholds(
  cursor?: string,
  firmId?: string
): Promise<{ rows: Household[]; nextCursor: string | null; firm: FirmMeta }> {
  try {
    const res = await fetch(ENDPOINT(cursor, firmId), { cache: "no-store" });
    if (!res.ok) return { rows: [], nextCursor: null, firm: null };
    const j = await res.json();
    const list: any[] = Array.isArray(j.households) ? j.households : [];
    const rows = list.map(coerceToHouseholdUI).filter(Boolean) as Household[];
    const nextCursor = j?.nextCursor ? String(j.nextCursor) : null;
    const firm: FirmMeta = j?.firm
      ? { firmId: String(j.firm.firmId), firmName: String(j.firm.firmName ?? "—"), firmSlug: j.firm.firmSlug }
      : null;
    return { rows, nextCursor, firm };
  } catch {
    return { rows: [], nextCursor: null, firm: null };
  }
}

/* ------------------------------------------
   Desktop component (cleaned)
------------------------------------------- */
export default function ApplicationsDesktop() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const firmIdFromUrl = searchParams.get("firmId") || undefined;

  const [firm, setFirm] = useState<FirmMeta>(null);
  const [rows, setRows] = useState<Household[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyMore, setBusyMore] = useState(false);

  // filters
  const [tab, setTab] = useState<"all" | "new" | "in_review" | "needs_approval" | "approved">(
    "all"
  );
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { rows, nextCursor, firm } = await fetchHouseholds(undefined, firmIdFromUrl);
      if (!cancelled) {
        rows.sort((a, b) => (b.submittedAt || "").localeCompare(a.submittedAt || ""));
        setRows(rows);
        setCursor(nextCursor);
        setFirm(firm);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firmIdFromUrl]);

  async function loadMore() {
    if (!cursor) return;
    setBusyMore(true);
    const { rows: nextRows, nextCursor } = await fetchHouseholds(cursor, firmIdFromUrl);
    const merged = [...rows, ...nextRows].sort(
      (a, b) => (b.submittedAt || "").localeCompare(a.submittedAt || "")
    );
    setRows(merged);
    setCursor(nextCursor);
    setBusyMore(false);
  }

  const filtered = useMemo(() => {
    let r = [...rows];
    if (tab !== "all") {
      if (tab === "approved") r = r.filter((x) => x.status === "approved_pending_lease");
      else r = r.filter((x) => x.status === (tab as AppStatus));
    }
    if (q.trim()) {
      const t = q.toLowerCase();
      r = r.filter((h) => [h.id, h.status, h.submittedAt].join(" ").toLowerCase().includes(t));
    }
    return r;
  }, [rows, tab, q]);

  const REVIEW_BASE = "/landlord/reviews";
  function onReview(hh: Household) {
    if (!hh?.appId) return;
    const href =
      `${REVIEW_BASE}/${encodeURIComponent(hh.appId)}` +
      (firmIdFromUrl ? `?firmId=${encodeURIComponent(firmIdFromUrl)}` : "");
    router.push(href);
  }

  const manageHref =
    `/landlord/forms${firmIdFromUrl ? `?firmId=${encodeURIComponent(firmIdFromUrl)}` : ""}`;

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 pb-8">
      {/* Firm header */}
      <div className="mt-4 mb-2">
        <div className="text-base font-semibold text-gray-900">
          {firm?.firmName ?? "Applications"}
        </div>
        {firm?.firmSlug && (
          <div className="text-xs text-gray-600">Firm: {firm.firmSlug}</div>
        )}
      </div>

      {/* Toolbar */}
      <div className="sticky top-0 z-30 -mx-6 border-b border-gray-200 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="mx-auto max-w-[1100px] px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            {/* Tabs */}
            <div className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5">
              {(
                [
                  { id: "all", label: "All" },
                  { id: "new", label: "New" },
                  { id: "in_review", label: "In review" },
                  { id: "needs_approval", label: "Needs approval" },
                  { id: "approved", label: "Approved" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={clsx(
                    "px-4 py-2 text-sm rounded-md transition whitespace-nowrap",
                    tab === t.id ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-50"
                  )}
                  aria-pressed={tab === t.id}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Right-side: Search + Manage forms */}
            <div className="flex items-center gap-3">
              {/* Search */}
              <div className="relative">
                <input
                  type="search"
                  inputMode="search"
                  enterKeyHint="search"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by household id or status"
                  className="w-72 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="pointer-events-none absolute right-2 top-2.5 text-gray-400">
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M21 21l-4.3-4.3M10 18a 8 8 0 1 0 0-16 8 8 0 0 0 0 16z"
                      stroke="currentColor"
                      strokeWidth="2"
                      fill="none"
                    />
                  </svg>
                </span>
              </div>

              {/* Manage application forms */}
              <Link
                href={manageHref}
                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
              >
                Manage application forms
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="mt-6">
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full table-auto divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                <th className="px-6 py-3 min-w-[280px]">Household</th>
                <th className="px-6 py-3 w-[160px]">Status</th>
                <th className="px-6 py-3 w-[160px]">Submitted</th>
                <th className="px-6 py-3 min-w-[280px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-sm text-gray-600">
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-sm text-gray-600">
                    No applications yet,
                  </td>
                </tr>
              ) : (
                filtered.map((hh) => (
                  <tr key={hh.id} className="hover:bg-gray-50/60">
                    <td className="px-6 py-4 align-top">
                      <div className="font-medium text-gray-900 truncate">
                        Household {hh.id}
                      </div>
                    </td>
                    <td className="px-6 py-4 align-top">
                      <StatusChip status={hh.status} />
                    </td>
                    <td className="px-6 py-4 align-top text-sm text-gray-700">
                      {formatDate(hh.submittedAt)}
                    </td>
                    <td className="px-6 py-4 align-top">
                      <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                        {/* Review uses appId */}
                        <button
                          onClick={() => onReview(hh)}
                          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50"
                        >
                          Review
                        </button>
                        {/* Chat uses appId + household fallback */}
                        <button
                          onClick={() => {
                            const url = new URL("/landlord/chat", window.location.origin);
                            url.searchParams.set("appId", (hh as any).appId);
                            url.searchParams.set("hh", hh.id);
                            window.location.href = url.toString();
                          }}
                          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50"
                        >
                          Chat
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {cursor && (
        <div className="flex justify-center my-6">
          <button
            disabled={busyMore}
            onClick={loadMore}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-60"
          >
            {busyMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </main>
  );
}
