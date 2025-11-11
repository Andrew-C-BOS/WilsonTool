// app/tenant/applications/ApplicationsDesktop.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

/* Types (household-scoped app list) */
type AppStatus =
  | "draft"
  | "new"
  | "in_review"
  | "needs_approval"
  | "approved_pending_lease"
  | "approved_pending_payment"
  | "approved_ready_to_lease"
  | "countersign_ready"        // ← NEW
  | "leased"
  | "rejected";

type TenantApp = {
  id: string;
  formId: string;
  formName: string;
  property?: string;
  unit?: string;
  status: AppStatus;
  updatedAt: string; // YYYY-MM-DD
  submittedAt?: string;
};

function clsx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

/* Compact status badge */
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
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        "max-w-full truncate",
        map[tone]
      )}
    >
      {children}
    </span>
  );
}

function StatusChip({ status }: { status: AppStatus }) {
  const tone =
    status === "draft" ? "gray" :
    status === "new" ? "blue" :
    status === "in_review" ? "amber" :
    status === "needs_approval" ? "violet" :
    status === "approved_pending_payment" ? "violet" :
    status === "approved_ready_to_lease" ? "emerald" :
    status === "approved_pending_lease" ? "emerald" :
    status === "countersign_ready" ? "emerald" :     // ← NEW
    status === "leased" ? "emerald" :
    "rose";

  const label =
    status === "draft" ? "Draft" :
    status === "new" ? "New" :
    status === "in_review" ? "In review" :
    status === "needs_approval" ? "Needs approval" :
    status === "approved_pending_payment" ? "Approved · Pending payment" :
    status === "approved_ready_to_lease" ? "Approved · Ready to lease" :
    status === "approved_pending_lease" ? "Approved" :
    status === "countersign_ready" ? "Ready to countersign" :  // ← NEW
    status === "leased" ? "Leased" :
    "Rejected";

  return <Badge tone={tone as any}>{label}</Badge>;
}

/** Toast */
function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div
      className="fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-1.5rem)] sm:w-auto sm:bottom-4"
      role="status"
      aria-live="polite"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto rounded-md bg-gray-900 text-white text-sm px-4 py-2 shadow-lg">
        {text}
        <button className="ml-3 underline underline-offset-2" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** Bottom-sheet on mobile, centered on desktop (used for Join modal) */
function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          "fixed inset-x-0 bottom-0 top-auto w-full rounded-t-2xl bg-white shadow-xl ring-1 ring-gray-200",
          "sm:left-1/2 sm:top-16 sm:bottom-auto sm:w-[92%] sm:max-w-md sm:-translate-x-1/2 sm:rounded-xl"
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 hover:bg-gray-50 active:opacity-80"
          >
            Close
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/* Minimal demo fallback, shown until API returns */
const DEMO_APPS: TenantApp[] = [];

// If you need to hardcode a firm for now:
const DEFAULT_FIRM_ID = "firm_mhgg3yc9e79wis";

export default function ApplicationsClient() {
  const [apps, setApps] = useState<TenantApp[]>(DEMO_APPS);
  const [toast, setToast] = useState<string | null>(null);

  // “Join with a code”
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");

  // Chat button loading guard
  const [chatBusyId, setChatBusyId] = useState<string | null>(null);
  // Pay button loading guard
  const [payBusyId, setPayBusyId] = useState<string | null>(null);

  // Filters
  type Tab = "all" | "in_progress" | "submitted" | "approved" | "rejected";
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/tenant/applications?me=1", { cache: "no-store" });
        if (res.ok) {
          const j = await res.json();
          if (j?.ok && Array.isArray(j.apps)) {
            const compact = (j.apps as any[]).map((a) => ({
              id: String(a.id),
              formId: String(a.formId),
              formName: String(a.formName ?? "Application"),
              property: a.property ?? undefined,
              unit: a.unit ?? undefined,
              status: a.status as AppStatus,
              updatedAt: String(a.updatedAt ?? ""),
              submittedAt: a.submittedAt ? String(a.submittedAt) : undefined,
            })) as TenantApp[];
            setApps(compact);
          }
        }
      } catch {}
    })();
  }, []);

  // any leased?
  const leasedApp = useMemo(() => apps.find((a) => a.status === "leased") || null, [apps]);

  const filtered = useMemo(() => {
    let arr = [...apps];
    if (tab !== "all") {
      if (tab === "in_progress") {
        arr = arr.filter((a) => ["draft", "new", "in_review", "needs_approval"].includes(a.status));
      } else if (tab === "submitted") {
        arr = arr.filter((a) => ["in_review", "needs_approval"].includes(a.status));
      } else if (tab === "approved") {
        // do NOT include leased in "approved" — it's a final state
        arr = arr.filter((a) =>
          [
            "approved_pending_lease",
            "approved_pending_payment",
            "approved_ready_to_lease",
            "countersign_ready",     // ← NEW (still approved category)
          ].includes(a.status)
        );
      } else if (tab === "rejected") {
        arr = arr.filter((a) => a.status === "rejected");
      }
    }
    if (q.trim()) {
      const t = q.toLowerCase();
      arr = arr.filter((a) =>
        [a.formName, a.property, a.unit, a.status].join(" ").toLowerCase().includes(t)
      );
    }
    return arr.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")); // recent first
  }, [apps, tab, q]);

  function onJoin() {
    const code = joinCode.trim();
    if (!code) return setToast("Enter an invite code,");
    window.location.href = `/tenant/apply?form=${encodeURIComponent(code)}`;
  }

  // Pay hold / Payments: direct redirect to the payments page with appId
  async function onPayHold(appId: string) {
    if (payBusyId) return;
    setPayBusyId(appId);
    try {
      // You can include firmId when available; for now appId is sufficient
      const url = `/tenant/payments?appId=${encodeURIComponent(appId)}`;
      window.location.href = url;
    } catch {
      setToast("Something went wrong starting your payment,");
      setPayBusyId(null);
    }
  }

  return (
    <>
      {/* Top actions */}
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        {/* Strong nudge if they have a lease */}
        {leasedApp && (
          <div className="mt-4 mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-emerald-900">You have an active lease</div>
                <p className="mt-0.5 text-xs text-emerald-800">
                  Manage move-in tasks, payments, and messages in your lease hub.
                </p>
              </div>
              <Link
                href={`/tenant/lease?app=${encodeURIComponent(leasedApp.id)}`}
                className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700"
                aria-label="Go to your lease"
              >
                Go to your lease
              </Link>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
          {/* Back to search */}
          <Link
            href="/tenant/applications/search"
            className="rounded-lg border border-blue-300 bg-blue-50 text-blue-800 font-medium px-4 py-3 text-center hover:bg-blue-100 active:opacity-90"
            aria-label="Back to application search"
          >
            Search For Applications
          </Link>

          {/* Join button */}
          <button
            onClick={() => setJoinOpen(true)}
            className="rounded-lg border border-gray-300 bg-white text-gray-900 font-medium px-4 py-3 hover:bg-gray-50 active:opacity-90"
          >
            Join with a code
          </button>

          {/* Spacer to keep grid balance on sm+ */}
          <div className="rounded-lg border border-transparent px-4 py-3" />
        </div>

        {/* Filters + search */}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="rounded-lg border border-gray-300 bg-white p-0.5 overflow-x-auto max-w-full">
            <div className="inline-flex min-w-max">
              {(
                [
                  { id: "all", label: "All" },
                  { id: "in_progress", label: "In progress" },
                  { id: "submitted", label: "Submitted" },
                  { id: "approved", label: "Approved" },
                  { id: "rejected", label: "Rejected" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={clsx(
                    "px-3 py-2 text-sm rounded-md",
                    tab === t.id
                      ? "bg-gray-900 text-white"
                      : "text-gray-700 hover:bg-gray-50 active:opacity-90"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative w-full sm:w-auto">
            <label htmlFor="app-search" className="sr-only">Search applications</label>
            <input
              id="app-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by form, property, unit"
              className="w-full sm:w-72 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="pointer-events-none absolute right-2 top-2.5 text-gray-400">
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21 21l-4.3-4.3M10 18a8 8 0 110-16 8 8 0 010 16z" stroke="currentColor" strokeWidth="2" fill="none" />
              </svg>
            </span>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="mx-auto max-w-3xl px-4 sm:px-6 mt-5">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
            No applications yet, join with a code to get started,
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((a) => {
              const isPendingPayment = a.status === "approved_pending_payment";
              const isCountersignReady = a.status === "countersign_ready"; // ← NEW
              const isLeased = a.status === "leased";
              const openLabel = isPendingPayment ? "Review" : "Open";

              return (
                <div key={a.id} className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 line-clamp-2">
                        {a.formName}
                      </div>
                      <div className="text-xs text-gray-600 mt-0.5 truncate">
                        {a.property ? `${a.property}${a.unit ? ` · Unit ${a.unit}` : ""}` : "Portfolio"}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <StatusChip status={a.status} />
                        <span className="text-[11px] text-gray-500">Updated {a.updatedAt}</span>
                      </div>
                    </div>

                    <div className="sm:text-right flex gap-2 sm:gap-3">
                      {/* If leased, strongly direct to lease hub */}
                      {isLeased ? (
                        <Link
                          href={`/tenant/lease?app=${encodeURIComponent(a.id)}`}
                          className="inline-flex justify-center rounded-md bg-emerald-600 text-white text-sm font-medium px-3 py-2 hover:bg-emerald-700 active:opacity-90"
                          title="View your lease"
                        >
                          View lease
                        </Link>
                      ) : (
                        <>
                          {/* Chat */}
                          <button
                            disabled={chatBusyId === a.id}
                            onClick={async () => {
                              if (chatBusyId) return;
                              setChatBusyId(a.id);
                              try {
                                const res = await fetch("/api/tenant/chat/open", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ appId: a.id }),
                                });
                                const j = await res.json();

                                if (!res.ok || !j?.ok) {
                                  setChatBusyId(null);
                                  return;
                                }

                                const threadId = j.threadId ? String(j.threadId) : "";
                                const url =
                                  (j.redirect && typeof j.redirect === "string" && j.redirect.includes("/tenant/chat/"))
                                    ? j.redirect
                                    : threadId
                                    ? `/tenant/chat/${encodeURIComponent(threadId)}`
                                    : null;

                                if (!url) {
                                  setChatBusyId(null);
                                  return;
                                }

                                window.location.href = url;
                              } catch {
                                setChatBusyId(null);
                              }
                            }}
                            className={clsx(
                              "inline-flex justify-center rounded-md border border-gray-300 bg-white text-sm font-medium px-3 py-2 text-gray-900 hover:bg-gray-50 active:opacity-90",
                              chatBusyId === a.id && "opacity-60 cursor-not-allowed"
                            )}
                          >
                            {chatBusyId === a.id ? "Opening…" : "Chat"}
                          </button>

                          {/* Open/Review application */}
                          <Link
                            href={`/tenant/apply?form=${encodeURIComponent(a.formId)}&app=${encodeURIComponent(a.id)}`}
                            className="inline-flex justify-center rounded-md bg-gray-900 text-white text-sm font-medium px-3 py-2 hover:bg-black active:opacity-90"
                          >
                            {openLabel}
                          </Link>

                          {/* Payments button:
                              - show for approved_pending_payment (legacy hold)
                              - show for countersign_ready (graceful path to payments before lease exists) */}
                          {(isPendingPayment || isCountersignReady) && (
                            <button
                              disabled={payBusyId === a.id}
                              onClick={() => onPayHold(a.id)}
                              className={clsx(
                                "inline-flex justify-center rounded-md border border-blue-300 bg-blue-50 text-blue-800 text-sm font-medium px-3 py-2 hover:bg-blue-100 active:opacity-90",
                                payBusyId === a.id && "opacity-60 cursor-not-allowed"
                              )}
                              title={isCountersignReady ? "Go to payments" : "Go to your holding payment"}
                            >
                              {payBusyId === a.id
                                ? "Starting…"
                                : isCountersignReady
                                ? "Payments"
                                : "Pay hold"}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Join modal */}
      <Modal open={joinOpen} title="Join an existing application" onClose={() => setJoinOpen(false)}>
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Enter the application code, we’ll attach the application to your household,
          </p>
          <label htmlFor="invite-code" className="sr-only">Invite code</label>
          <input
            id="invite-code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="Invite code"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            inputMode="text"
            autoCapitalize="characters"
          />
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setJoinOpen(false)} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm active:opacity-90">
              Cancel
            </button>
            <button onClick={onJoin} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 active:opacity-90">
              Continue
            </button>
          </div>
          <p className="text-xs text-gray-500">If you have a link, open it directly, we’ll handle the rest,</p>
        </div>
      </Modal>

      {toast && <Toast text={toast} onClose={() => setToast(null)} />}
    </>
  );
}
