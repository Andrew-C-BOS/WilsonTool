// app/landlord/applications/ApplicationsDesktop.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/* ------------------------------------------
   Types used by this UI
------------------------------------------- */
type AppStatus =
  | "new"
  | "in_review"
  | "needs_approval"
  | "approved_pending_payment"
  | "approved_pending_funds"
  | "accepted_held"
  | "approved_ready_to_lease"
  | "approved_pending_lease"
  | "countersign_ready"        // ← NEW
  | "rejected"
  | string;

type MemberRole = "primary" | "co-applicant" | "cosigner";

type Household = {
  id: string;          // householdId
  appId: string;       // applicationId (for Review & Chat)
  submittedAt: string;
  status: AppStatus;
  members: {
    name: string;
    email: string;
    role: MemberRole;
    state?: "invited" | "complete" | "missing_docs";
  }[];
};

type FirmMeta = { firmId: string; firmName: string; firmSlug?: string } | null;

/* ------------------------------------------
   Visual primitives
------------------------------------------- */
function clsx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}
function formatDate(s: string): string {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString();
}

/* ------------------------------------------
   Funnel steps (labels only; status strings unchanged)
------------------------------------------- */
// Include an explicit Countersign step
const STEPS: { key: AppStatus; label: string }[] = [
  { key: "new",                      label: "New" },
  { key: "in_review",                label: "Review" },
  { key: "needs_approval",           label: "Decision" },
  { key: "approved_pending_payment", label: "Payment" },
  { key: "approved_pending_funds",   label: "Funds Processing" },
  { key: "accepted_held",            label: "Held" },
  { key: "approved_ready_to_lease",  label: "Ready to Lease" },
  { key: "approved_pending_lease",   label: "Pending Lease" },
  { key: "countersign_ready",        label: "Countersign" }, // ← NEW
];
// Some apps may be “rejected” (terminal)
const TERMINAL_REJECTED = "rejected";

/* Small stepper */
function Stepper({ status }: { status: AppStatus }) {
  const idx = STEPS.findIndex(s => s.key === status);
  const rejected = status === TERMINAL_REJECTED;

  return (
    <div className="flex items-center gap-2">
      {rejected ? (
        <span className="rounded-full bg-rose-50 text-rose-700 ring-1 ring-rose-200 px-2.5 py-0.5 text-[11px] font-medium">
          Rejected
        </span>
      ) : (
        <div className="flex items-center gap-2">
          {STEPS.map((s, i) => {
            const done   = idx > i && idx !== -1;
            const active = idx === i;
            return (
              <div key={s.key} className="flex items-center gap-2">
                <span
                  className={clsx(
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                    done   && "bg-emerald-50 text-emerald-800 ring-emerald-200",
                    active && "bg-violet-50  text-violet-800  ring-violet-200",
                    !done && !active && "bg-gray-100 text-gray-700 ring-gray-200"
                  )}
                  title={s.key}
                >
                  {s.label}
                </span>
                {i < STEPS.length - 1 && <span className="h-px w-4 bg-gray-200" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* Suggested next action text */
function nextActionCopy(status: AppStatus): string {
  if (status === "new" || status === "in_review") return "Open review to screen this application.";
  if (status === "needs_approval") return "Make a decision, then choose the next step.";
  if (status === "approved_pending_payment") return "Send the tenant the holding link to collect funds.";
  if (status === "approved_pending_funds") return "Funds are processing; prepare lease details.";
  if (status === "accepted_held") return "Holding paid — unit reserved. Proceed to lease setup.";
  if (status === "approved_ready_to_lease") return "Ready to lease — prepare and send the lease.";
  if (status === "approved_pending_lease") return "Funds closed — finalize countersignature.";
  if (status === "countersign_ready") return "Tenant funds received. Create and send the lease for countersignature."; // ← NEW
  if (status === "rejected") return "Application closed.";
  return "Continue with the next step.";
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
function toISO(x: any): string {
  if (!x) return "";
  const d = new Date(x);
  return isNaN(d.getTime()) ? String(x) : d.toISOString();
}
const val = (s: unknown): string | undefined => {
  const t = typeof s === "string" ? s : s == null ? undefined : String(s);
  return t && t.trim() ? t : undefined;
};

function coerceToHouseholdUI(raw: any): Household | null {
  const id = getId(raw);
  const appId = getAppId(raw);
  if (!id || !appId) return null;

  const submittedAt = toISO(raw.submittedAt ?? raw.createdAt ?? raw.updatedAt);
  const status = String(raw.status ?? "in_review") as AppStatus;
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
   Component
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
  const [tab, setTab] = useState<"all" | "new" | "in_review" | "needs_approval" | "approved" | "rejected">("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { rows, nextCursor, firm } = await fetchHouseholds(undefined, firmIdFromUrl);
      if (!cancelled) {
        // Pin countersign_ready to the very top of the master list
        rows.sort((a, b) => {
          const aHot = a.status === "countersign_ready" ? 1 : 0;
          const bHot = b.status === "countersign_ready" ? 1 : 0;
          if (aHot !== bHot) return bHot - aHot;
          return (b.submittedAt || "").localeCompare(a.submittedAt || "");
        });
        setRows(rows);
        setCursor(nextCursor);
        setFirm(firm);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [firmIdFromUrl]);

  async function loadMore() {
    if (!cursor) return;
    setBusyMore(true);
    const { rows: nextRows, nextCursor } = await fetchHouseholds(cursor, firmIdFromUrl);
    const merged = [...rows, ...nextRows].sort((a, b) => {
      const aHot = a.status === "countersign_ready" ? 1 : 0;
      const bHot = b.status === "countersign_ready" ? 1 : 0;
      if (aHot !== bHot) return bHot - aHot;
      return (b.submittedAt || "").localeCompare(a.submittedAt || "");
    });
    setRows(merged);
    setCursor(nextCursor);
    setBusyMore(false);
  }

  // Quick helpers
  const REVIEW_BASE = "/landlord/reviews";
  function onReview(hh: Household) {
    if (!hh?.appId) return;
    const href =
      `${REVIEW_BASE}/${encodeURIComponent(hh.appId)}` +
      (firmIdFromUrl ? `?firmId=${encodeURIComponent(firmIdFromUrl)}` : "");
    router.push(href);
  }
  function holdingHrefFor(hh: Household) {
    const base = `/landlord/leases/${encodeURIComponent(hh.appId)}/holding`;
    return firmIdFromUrl ? `${base}?firmId=${encodeURIComponent(firmIdFromUrl)}` : base;
  }
  function leaseHrefFor(hh: Household) {
    const base = `/landlord/leases/${encodeURIComponent(hh.appId)}/setup`;
    return firmIdFromUrl ? `${base}?firmId=${encodeURIComponent(firmIdFromUrl)}` : base;
  }

  // Priority list & quick actions
  const countersignReady = useMemo(
    () => rows.filter(r => r.status === "countersign_ready"),
    [rows]
  );

  const filtered = useMemo(() => {
    let r = [...rows];
    if (tab !== "all") {
      if (tab === "approved") {
        // Include the whole approved cluster plus countersign_ready
        r = r.filter((x) =>
          x.status.startsWith("approved_") || x.status === "accepted_held" || x.status === "countersign_ready"
        );
      } else if (tab === "rejected") {
        r = r.filter((x) => x.status === "rejected");
      } else {
        r = r.filter((x) => x.status === tab);
      }
    }
    if (q.trim()) {
      const t = q.toLowerCase();
      r = r.filter((h) =>
        [h.id, h.appId, h.status, h.submittedAt].join(" ").toLowerCase().includes(t)
      );
    }
    // Keep countersign_ready pinned within the filtered view too
    r.sort((a, b) => {
      const aHot = a.status === "countersign_ready" ? 1 : 0;
      const bHot = b.status === "countersign_ready" ? 1 : 0;
      if (aHot !== bHot) return bHot - aHot;
      return (b.submittedAt || "").localeCompare(a.submittedAt || "");
    });
    return r;
  }, [rows, tab, q]);

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 pb-8">
      {/* Firm header */}
      <div className="mt-4 mb-2">
        <div className="text-base font-semibold text-gray-900">
          {firm?.firmName ?? "Applications"}
        </div>
        {firm?.firmSlug && <div className="text-xs text-gray-600">Firm: {firm.firmSlug}</div>}
      </div>

      {/* Priority callout for countersign-ready */}
      {!!countersignReady.length && (
        <div className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-emerald-900">
                {countersignReady.length} {countersignReady.length === 1 ? "household" : "households"} ready to countersign
              </div>
              <p className="mt-0.5 text-xs text-emerald-800">
                Tenants have paid the holding funds. Create and send the lease for countersignature.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  // Focus the first one immediately
                  const first = countersignReady[0];
                  if (first) {
                    const href = `${leaseHrefFor(first)}`;
                    window.location.href = href;
                  }
                }}
                className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700"
              >
                Open first
              </button>
              <button
                onClick={() => setQ("countersign_ready")}
                className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
              >
                Show only these
              </button>
            </div>
          </div>
        </div>
      )}

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
                  { id: "needs_approval", label: "Decision" },
                  { id: "approved", label: "Approved" },
                  { id: "rejected", label: "Rejected" },
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

            {/* Right: Search */}
            <div className="relative">
              <input
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoCapitalize="none"
                autoCorrect="off"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by household id, app id, or status"
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

      {/* Table */}
      <div className="mt-6">
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full table-auto divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                <th className="px-6 py-3 min-w-[280px]">Household</th>
                <th className="px-6 py-3 w-[360px]">Funnel</th>
                <th className="px-6 py-3 w-[160px]">Updated</th>
                <th className="px-6 py-3 min-w-[420px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-sm text-gray-600">Loading…</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-sm text-gray-600">No applications yet,</td>
                </tr>
              ) : (
                filtered.map((hh) => {
                  const isPendingPayment   = hh.status === "approved_pending_payment";
                  const isHeld             = hh.status === "accepted_held";
                  const isCountersignReady = hh.status === "countersign_ready";

                  const holdingHref = holdingHrefFor(hh);
                  const leaseHref   = leaseHrefFor(hh);
                  const hint        = nextActionCopy(hh.status);

                  return (
                    <tr
                      key={hh.id}
                      className={clsx(
                        "hover:bg-gray-50/60",
                        isCountersignReady && "bg-emerald-50/50"
                      )}
                    >
                      <td className="px-6 py-4 align-top">
                        <div className="font-medium text-gray-900 truncate">
                          Household {hh.id}
                        </div>
                        <div className="mt-1 text-xs text-gray-600 break-all">App: {hh.appId}</div>
                        {isCountersignReady && (
                          <div className="mt-2 inline-flex items-center rounded-full bg-emerald-100 text-emerald-900 px-2 py-0.5 text-[11px] ring-1 ring-emerald-200">
                            Ready to countersign
                          </div>
                        )}
                      </td>

                      <td className="px-6 py-4 align-top">
                        <Stepper status={hh.status} />
                        <div className="mt-1 text-[11px] text-gray-500">{hint}</div>
                      </td>

                      <td className="px-6 py-4 align-top text-sm text-gray-700">
                        {formatDate(hh.submittedAt)}
                      </td>

                      <td className="px-6 py-4 align-top">
                        <div className="flex flex-wrap items-center gap-2 whitespace-nowrap">
                         
						  {/* Lease setup fast-path when funds are held or ready to countersign */}
                          {(isHeld || isCountersignReady) && (
                            <Link
                              href={leaseHref}
                              className={clsx(
                                "rounded-md px-3 py-1.5 text-xs font-medium",
                                "border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                              )}
                              title="Proceed to lease setup"
                            >
                              Lease setup
                            </Link>
                          )}
						  {/* Review (always) */}
                          <button
                            onClick={() => onReview(hh)}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50"
                            title="Open application review"
                          >
                            Review
                          </button>

                          {/* Holding / Payment manager when awaiting tenant payment */}
                          {isPendingPayment && (
                            <Link
                              href={holdingHref}
                              className="rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800 hover:bg-blue-100"
                              title="Open holding setup / tenant payment link"
                            >
                              Holding / Payment
                            </Link>
                          )}



                          {/* Chat */}
                          <button
                            onClick={() => {
                              const url = new URL("/landlord/chat", window.location.origin);
                              url.searchParams.set("appId", (hh as any).appId);
                              url.searchParams.set("hh", hh.id);
                              if (firmIdFromUrl) url.searchParams.set("firmId", firmIdFromUrl);
                              window.location.href = url.toString();
                            }}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50"
                          >
                            Chat
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {cursor && (
        <div className="flex justify-center my  -6">
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
