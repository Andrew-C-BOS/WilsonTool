"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation"; 

/* ─────────────────────────────────────────────────────────────
   New canonical statuses (tenant-facing)
───────────────────────────────────────────────────────────── */
type AppStatus =
  | "draft"
  | "submitted"
  | "admin_screened"
  | "approved_high"
  | "terms_set"
  | "min_due"
  | "min_paid"
  | "countersigned"
  | "occupied"
  | "rejected"
  | "withdrawn";

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

/* ─────────────────────────────────────────────────────────────
   Status presentation
───────────────────────────────────────────────────────────── */
type Tone = "gray" | "blue" | "amber" | "violet" | "emerald" | "rose";

const STATUS_TONE: Record<AppStatus, Tone> = {
  draft: "gray",
  submitted: "blue",
  admin_screened: "amber",
  approved_high: "violet",
  terms_set: "violet",
  min_due: "violet",
  min_paid: "emerald",
  countersigned: "emerald",
  occupied: "emerald",
  rejected: "rose",
  withdrawn: "rose",
};

const STATUS_LABEL: Record<AppStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  admin_screened: "In review",
  approved_high: "Approved",
  terms_set: "Terms set",
  min_due: "Approved · Payment due",
  min_paid: "Approved · Awaiting Landlord Countersign",
  countersigned: "Lease countersigned",
  occupied: "Active lease",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

function Badge({ children, tone = "gray" }: { children: React.ReactNode; tone?: Tone }) {
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
        map[tone],
      )}
    >
      {children}
    </span>
  );
}

function StatusChip({ status }: { status: AppStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
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

/** Bottom-sheet modal */
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
          "sm:left-1/2 sm:top-16 sm:bottom-auto sm:w-[92%] sm:max-w-md sm:-translate-x-1/2 sm:rounded-xl",
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

/* Minimal demo fallback */
const DEMO_APPS: TenantApp[] = [];

/* Helpers: category filters & button visibility */
type Tab = "all" | "in_progress" | "submitted" | "approved" | "rejected";

const IN_PROGRESS: AppStatus[] = ["draft", "submitted", "admin_screened"];
const SUBMITTED: AppStatus[] = ["submitted", "admin_screened"];
const APPROVED: AppStatus[] = ["approved_high", "terms_set", "min_due", "min_paid"];
const REJECTED: AppStatus[] = ["rejected", "withdrawn"];

const showPaymentsButton = (s: AppStatus) => s === "min_due";
/*const showSignButton = (s: AppStatus) => s === "min_paid";*/
const showSignButton = (_s: AppStatus) => false;
const isLeaseActiveStatus = (s: AppStatus) => s === "countersigned" || s === "occupied";

// Applications that the tenant is allowed to withdraw
const WITHDRAWABLE: AppStatus[] = [
  "draft",
  "submitted",
  "admin_screened",
  "approved_high",
  "terms_set",
  "min_due",
];

const canWithdrawStatus = (s: AppStatus) => WITHDRAWABLE.includes(s);

/* ─────────────────────────────────────────────────────────────
   UI fragments
───────────────────────────────────────────────────────────── */

function HeroSection({
  hasAnyApps,
  activeLease,
  onOpenJoin,
}: {
  hasAnyApps: boolean;
  activeLease: TenantApp | null;
  onOpenJoin: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl p-4 sm:px-6">
      <header className="rounded-3xl bg-gradient-to-r from-indigo-50 via-sky-50 to-rose-50 p-6 shadow-sm ring-1 ring-indigo-100/60">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-indigo-700">
              <span className="inline-flex items-center rounded-full bg-indigo-600 px-3 py-1 text-[11px] font-semibold text-white shadow-sm">
                Step 2 · Application
              </span>
              <span className="hidden text-indigo-500 sm:inline">
                Manage Household Applications
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-gray-900">
              Your applications
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-600">
              Track where you’ve applied, review details, and move into payments or signing when
              a property manager approves your household,
            </p>
          </div>

          {activeLease && (
            <div className="mt-2 w-full sm:mt-0 sm:w-auto">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">You have an active lease</div>
                    <p className="mt-0.5 text-[11px] text-emerald-800">
                      Manage move-in tasks, payments, and messages in your lease hub,
                    </p>
                  </div>
                  <Link
                    href={`/tenant/lease?app=${encodeURIComponent(activeLease.id)}`}
                    className="mt-0.5 inline-flex items-center rounded-md bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700"
                  >
                    Go to lease
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Primary CTAs */}
        <div
          className={clsx(
            "mt-5 grid gap-2 grid-cols-1 sm:grid-cols-2",
          )}
        >
          <Link
            href="/tenant/applications/search"
            className={clsx(
              "flex items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold",
              "border border-gray-900 bg-gray-900 text-white hover:bg-black active:opacity-90",
              !hasAnyApps && "sm:col-span-1",
            )}
            aria-label="Search for applications"
          >
            Search for applications
          </Link>

          <JoinButton hasAnyApps={hasAnyApps} onClick={onOpenJoin} />
        </div>
      </header>
    </div>
  );
}

function JoinButton({
  hasAnyApps,
  onClick,
}: {
  hasAnyApps: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold",
        "border border-gray-300 bg-white text-gray-900 hover:bg-gray-50 active:opacity-90",
        !hasAnyApps && "sm:col-span-1",
      )}
      type="button"
    >
      Join with a code
    </button>
  );
}

/** Tabs + search */
function FiltersBar({
  hasAnyApps,
  tab,
  onTabChange,
  q,
  onSearchChange,
}: {
  hasAnyApps: boolean;
  tab: Tab;
  onTabChange: (next: Tab) => void;
  q: string;
  onSearchChange: (next: string) => void;
}) {
  if (!hasAnyApps) return null;

  return (
    <div className="mx-auto max-w-3xl p-4 pt-0 sm:px-6">
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="rounded-lg border border-gray-200 bg-white p-0.5 overflow-x-auto max-w-full shadow-sm">
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
                onClick={() => onTabChange(t.id)}
                className={clsx(
                  "px-3 py-2 text-xs sm:text-sm rounded-md",
                  tab === t.id
                    ? "bg-gray-900 text-white"
                    : "text-gray-700 hover:bg-gray-50 active:opacity-90",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative w-full sm:w-auto">
          <label htmlFor="app-search" className="sr-only">
            Search applications
          </label>
          <input
            id="app-search"
            value={q}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by form, property, unit"
            className="w-full sm:w-72 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="pointer-events-none absolute right-2 top-2.5 text-gray-400">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M21 21l-4.3-4.3M10 18a8 8 0 110-16 8 8 0 010 16z"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
              />
            </svg>
          </span>
        </div>
      </div>
    </div>
  );
}

const STATUS_CARD_THEME: Record<
  AppStatus,
  {
    accent: string;    // gradient on the top bar
    border: string;    // base/hover border colors
    chipText: string;  // subtle status text color
  }
> = {
  draft: {
    accent: "from-slate-200 via-slate-100 to-slate-200",
    border: "border-slate-200 hover:border-slate-300",
    chipText: "text-slate-500",
  },
  submitted: {
    accent: "from-sky-300 via-sky-200 to-sky-300",
    border: "border-sky-100 hover:border-sky-200",
    chipText: "text-sky-600",
  },
  admin_screened: {
    accent: "from-amber-300 via-amber-200 to-amber-300",
    border: "border-amber-100 hover:border-amber-200",
    chipText: "text-amber-700",
  },
  approved_high: {
    accent: "from-violet-300 via-violet-200 to-violet-300",
    border: "border-violet-100 hover:border-violet-200",
    chipText: "text-violet-700",
  },
  terms_set: {
    accent: "from-violet-300 via-violet-200 to-violet-300",
    border: "border-violet-100 hover:border-violet-200",
    chipText: "text-violet-700",
  },
  min_due: {
    accent: "from-blue-400 via-indigo-300 to-blue-400",
    border: "border-blue-100 hover:border-blue-200",
    chipText: "text-blue-700",
  },
  min_paid: {
    accent: "from-emerald-400 via-emerald-300 to-emerald-400",
    border: "border-emerald-100 hover:border-emerald-200",
    chipText: "text-emerald-700",
  },
  countersigned: {
    accent: "from-emerald-400 via-emerald-300 to-emerald-400",
    border: "border-emerald-100 hover:border-emerald-200",
    chipText: "text-emerald-700",
  },
  occupied: {
    accent: "from-emerald-400 via-emerald-300 to-emerald-400",
    border: "border-emerald-100 hover:border-emerald-200",
    chipText: "text-emerald-700",
  },
  rejected: {
    accent: "from-rose-300 via-rose-200 to-rose-300",
    border: "border-rose-100 hover:border-rose-200",
    chipText: "text-rose-700",
  },
	withdrawn: {
	  accent: "from-rose-800 via-rose-400 to-rose-800",
	  border: "border-rose-200 hover:border-rose-300",
	  chipText: "text-rose-600",
	},
};

/** Application card */
function ApplicationCard({
  app,
  isLeaseActive,
  showPayments,
  isMinPaid,
  busy,
  canWithdraw,
  onOpen,
  onPay,
  onWithdraw,
  onChat,
}: {
  app: TenantApp;
  isLeaseActive: boolean;
  showPayments: boolean;
  isMinPaid: boolean;
  busy: {
    chat: boolean;
    withdraw: boolean;
    open: boolean;
    pay: boolean;
  };
  canWithdraw: boolean;
  onOpen: () => void;
  onPay: () => void;
  onWithdraw: () => void;
  onChat: () => void;
}) {
  const { id, formName, property, unit, status, updatedAt } = app;

  const openLabel =
    status === "submitted" || status === "admin_screened" ? "Review" : "Open";

  const theme = STATUS_CARD_THEME[status];

  const containerClasses = clsx(
    "group relative overflow-hidden",
    "rounded-2xl border bg-white/90 shadow-sm backdrop-blur-sm",
    "transition-all duration-200 ease-out",
    theme.border,
    "hover:-translate-y-[1px] hover:shadow-[0_18px_45px_rgba(15,23,42,0.12)]",
  );

  return (
    <div className={containerClasses}>
      {/* Accent bar */}
      <div
        className={clsx(
          "pointer-events-none absolute inset-x-4 top-0 h-1 rounded-b-full bg-gradient-to-r opacity-90",
          theme.accent,
        )}
      />

      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-4">
          {/* Top: title + meta */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              {/* Single status pill above title */}
              <div className="mb-1 flex items-center gap-2 text-[11px] font-medium">
                <span
                  className={clsx(
                    "inline-flex items-center rounded-full bg-gray-50 px-2 py-0.5 ring-1 ring-inset ring-gray-200",
                    theme.chipText,
                  )}
                >
                  {STATUS_LABEL[status]}
                </span>
                {isLeaseActive && (
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    Lease hub
                  </span>
                )}
              </div>

              <h2 className="text-sm sm:text-[15px] font-semibold text-gray-900 line-clamp-2">
                {formName}
              </h2>

              {(property || unit) && (
                <p className="mt-1 text-xs text-gray-600 line-clamp-2">
                  {property}
                  {property && unit && " · "}
                  {unit && <span className="text-gray-500">Unit {unit}</span>}
                </p>
              )}

              {/* Meta row – no second status chip */}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                <span>Updated {updatedAt}</span>
              </div>
            </div>
          </div>

          {/* Bottom: actions row */}
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:text-right">
            {isLeaseActive ? (
              <>
                <div className="flex flex-wrap gap-1.5 text-[11px] text-gray-500">
                  <span>Lease is active for this application,</span>
                </div>
                <div className="flex flex-wrap gap-2 justify-end">
                  <Link
                    href={`/tenant/lease?app=${encodeURIComponent(id)}`}
                    className="inline-flex justify-center rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 active:opacity-90"
                    title="View your lease"
                  >
                    View lease
                  </Link>
                </div>
              </>
            ) : (
              <>
                {/* Left utilities: Chat & Withdraw */}
                <div className="flex flex-wrap gap-1.5">
				<button
				  disabled={busy.chat}
				  onClick={onChat}
				  className={clsx(
					"group relative flex items-center justify-center rounded-full border border-gray-200 bg-white",
					"h-7 px-2 overflow-hidden transition-all duration-300 ease-out",
					"hover:px-3 hover:border-gray-300 hover:bg-gray-50",
					busy.chat && "opacity-60 cursor-not-allowed",
				  )}
				  title="Chat with your property manager"
				>
				  {/* Icon – starts centered, nudges left on hover */}
				  <span
					className={clsx(
					  "text-[13px] transition-transform duration-300",
					  "group-hover:-translate-x-0.5", // tiny nudge left on hover
					)}
					aria-hidden
				  >
					💬
				  </span>

				  {/* Label – hidden & width-collapsed by default, expands on hover */}
				  <span
					className={clsx(
					  "ml-0 text-[11px] font-medium text-gray-700 whitespace-nowrap",
					  "max-w-0 opacity-0 -translate-x-1",
					  "transition-all duration-300 ease-out",
					  "group-hover:max-w-xs group-hover:opacity-100 group-hover:translate-x-0 group-hover:ml-1",
					)}
				  >
					Chat
				  </span>
				</button>

                  {canWithdraw && (
					<button
					  disabled={busy.withdraw}
					  onClick={onWithdraw}
					  className={clsx(
						"group relative flex items-center justify-center rounded-full border border-rose-200 bg-white",
						"h-7 px-2 overflow-hidden transition-all duration-300 ease-out",
						"hover:px-3 hover:border-rose-300 hover:bg-rose-50",
						busy.withdraw && "opacity-60 cursor-not-allowed",
					  )}
					  title="Withdraw this application"
					>
					  {/* Icon – centered idle, nudges left on hover */}
					  <span
						className={clsx(
						  "text-[12px] transition-transform duration-300 text-rose-600",
						  "group-hover:-translate-x-0.5",
						)}
						aria-hidden
					  >
						✕
					  </span>

					  {/* Label – hidden idle, expands on hover */}
					  <span
						className={clsx(
						  "ml-0 text-[11px] font-medium text-rose-700 whitespace-nowrap",
						  "max-w-0 opacity-0 -translate-x-1",
						  "transition-all duration-300 ease-out",
						  "group-hover:max-w-xs group-hover:opacity-100 group-hover:translate-x-0 group-hover:ml-1",
						)}
					  >
						Withdraw
					  </span>
					</button>
                  )}
                </div>

                {/* Right: single primary CTA cluster */}
                <div className="flex flex-wrap gap-2 justify-end">
                  {showPayments ? (
                    <>
                      <button
                        disabled={busy.open}
                        onClick={onOpen}
                        className={clsx(
                          "inline-flex justify-center rounded-full border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 active:opacity-90",
                          busy.open && "opacity-60 cursor-not-allowed",
                        )}
                        title="Review application"
                      >
                        {busy.open ? "Opening…" : "Review"}
                      </button>

                      <button
                        disabled={busy.pay}
                        onClick={onPay}
                        className={clsx(
                          "inline-flex justify-center rounded-full border border-blue-500 bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 active:opacity-90",
                          busy.pay && "opacity-60 cursor-not-allowed",
                        )}
                        title="Go to payments"
                      >
                        {busy.pay ? "Starting…" : "Payments"}
                      </button>
                    </>
                  ) : isMinPaid ? (
                    <>
                      <button
                        disabled={busy.open}
                        onClick={onOpen}
                        className={clsx(
                          "inline-flex justify-center rounded-full border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 active:opacity-90",
                          busy.open && "opacity-60 cursor-not-allowed",
                        )}
                        title="Review application"
                      >
                        {busy.open ? "Opening…" : "Review"}
                      </button>

                      <Link
                        href={`/tenant/lease?app=${encodeURIComponent(id)}`}
                        className="inline-flex justify-center rounded-full bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 active:opacity-90"
                        title="Go to your lease hub"
                      >
                        Go to lease hub
                      </Link>
                    </>
                  ) : (
                    <button
                      disabled={busy.open}
                      onClick={onOpen}
                      className={clsx(
                        "inline-flex justify-center rounded-full bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-black active:opacity-90",
                        busy.open && "opacity-60 cursor-not-allowed",
                      )}
                      title="Open application"
                    >
                      {busy.open ? "Opening…" : openLabel}
                    </button>
                  )}

                  {showSignButton(status) && (
                    <Link
                      href={`/tenant/lease?app=${encodeURIComponent(id)}`}
                      className="inline-flex justify-center rounded-full border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 active:opacity-90"
                      title="Continue to signing"
                    >
                      Sign
                    </Link>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


/** Applications list + empty / no-results state */
function ApplicationsList({
  apps,
  filtered,
  hasAnyApps,
  chatBusyId,
  payBusyId,
  openBusyId,
  withdrawBusyId,
  onOpenApp,
  onPayHold,
  onWithdraw,
  onChat,
}: {
  apps: TenantApp[];
  filtered: TenantApp[];
  hasAnyApps: boolean;
  chatBusyId: string | null;
  payBusyId: string | null;
  openBusyId: string | null;
  withdrawBusyId: string | null;
  onOpenApp: (app: TenantApp) => void;
  onPayHold: (app: TenantApp) => void;
  onWithdraw: (app: TenantApp) => void;
  onChat: (app: TenantApp) => void;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 mt-5">
      {filtered.length === 0 ? (
        hasAnyApps ? (
          // No results for current filters/search
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700 shadow-sm">
            <div className="font-semibold text-gray-900">No applications match this view,</div>
            <p className="mt-1 text-xs text-gray-600">
              Try adjusting your filters or clearing the search above,
            </p>
          </div>
        ) : (
          <div />
        )
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => {
            const showPayments = showPaymentsButton(a.status);
            const isMinPaid = a.status === "min_paid";

            return (
              <ApplicationCard
                key={a.id}
                app={a}
                isLeaseActive={isLeaseActiveStatus(a.status)}
                showPayments={showPayments}
                isMinPaid={isMinPaid}
                busy={{
                  chat: chatBusyId === a.id,
                  withdraw: withdrawBusyId === a.id,
                  open: openBusyId === a.id,
                  pay: payBusyId === a.id,
                }}
                canWithdraw={canWithdrawStatus(a.status)}
                onOpen={() => onOpenApp(a)}
                onPay={() => onPayHold(a)}
                onWithdraw={() => onWithdraw(a)}
                onChat={() => onChat(a)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Join modal */
function JoinModal({
  open,
  joinCode,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  joinCode: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Modal open={open} title="Join an existing application" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-gray-700">
          Enter the application code, we’ll attach the application to your household,
        </p>
        <label htmlFor="invite-code" className="sr-only">
          Invite code
        </label>
        <input
          id="invite-code"
          value={joinCode}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Form ID or code"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          inputMode="text"
          autoCapitalize="characters"
        />
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm active:opacity-90"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 active:opacity-90"
          >
            Continue
          </button>
        </div>
        <p className="text-xs text-gray-500">
          If you have a link, open it directly, we’ll handle the rest,
        </p>
      </div>
    </Modal>
  );
}

/* ─────────────────────────────────────────────────────────────
   Main component (now much slimmer)
───────────────────────────────────────────────────────────── */

export default function ApplicationsClient() {
  const [apps, setApps] = useState<TenantApp[]>(DEMO_APPS);
  const [toast, setToast] = useState<string | null>(null);

  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");

  const [chatBusyId, setChatBusyId] = useState<string | null>(null);
  const [payBusyId, setPayBusyId] = useState<string | null>(null);
  const [openBusyId, setOpenBusyId] = useState<string | null>(null);
  const [withdrawBusyId, setWithdrawBusyId] = useState<string | null>(null);
  
  const searchParams = useSearchParams();
  const openSearchOnLoad =
    searchParams.get("openSearch") === "1"

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
              property: a.property ?? a.building?.addressLine1 ?? undefined,
              unit: a.unit?.unitNumber ?? a.unitNumber ?? undefined,
              status: a.status as AppStatus,
              updatedAt: String(a.updatedAt ?? ""),
              submittedAt: a.submittedAt ? String(a.submittedAt) : undefined,
            })) as TenantApp[];
            setApps(compact);
          }
        }
      } catch {
        // ignore for now
      }
    })();
  }, []);
  
	useEffect(() => {
	  if (!openSearchOnLoad) return;

	  const id = window.setTimeout(() => {
		const el = document.getElementById("app-search");
		if (el instanceof HTMLInputElement) {
		  el.focus();
		  el.select();
		}
	  }, 0);

	  return () => window.clearTimeout(id);
	}, [openSearchOnLoad]);
	
	useEffect(() => {
	  if (!openSearchOnLoad) return;
	  setJoinOpen(true);
	}, [openSearchOnLoad]);

  const hasAnyApps = apps.length > 0;

  const activeLease = useMemo(
    () => apps.find((a) => isLeaseActiveStatus(a.status)) || null,
    [apps],
  );

  const filtered = useMemo(() => {
    let arr = [...apps];
    if (tab !== "all") {
      if (tab === "in_progress") arr = arr.filter((a) => IN_PROGRESS.includes(a.status));
      else if (tab === "submitted") arr = arr.filter((a) => SUBMITTED.includes(a.status));
      else if (tab === "approved") arr = arr.filter((a) => APPROVED.includes(a.status));
      else if (tab === "rejected") arr = arr.filter((a) => REJECTED.includes(a.status));
    }
    if (q.trim()) {
      const t = q.toLowerCase();
      arr = arr.filter((a) =>
        [a.formName, a.property, a.unit, STATUS_LABEL[a.status]].join(" ").toLowerCase().includes(t),
      );
    }
    return arr.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")); // newest first
  }, [apps, tab, q]);

  /* Core actions */

  async function goToApply(formId: string, appId?: string) {
    if (appId) {
      window.location.href = `/tenant/apply?form=${encodeURIComponent(formId)}&app=${encodeURIComponent(appId)}`;
      return;
    }
    try {
      const res = await fetch(
        `/api/tenant/applications/resolve?form=${encodeURIComponent(formId)}&create=1`,
        {
          method: "GET",
          cache: "no-store",
        },
      );
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok || !j?.form || !(j?.app && j?.app?.id)) {
        setToast(j?.error ? `Could not open application, ${j.error}` : "Could not open application,");
        return;
      }
      const nextFormId = String(j.form._id ?? j.form.id ?? formId);
      const nextAppId = String(j.app.id);
      window.location.href = `/tenant/apply?form=${encodeURIComponent(nextFormId)}&app=${encodeURIComponent(nextAppId)}`;
    } catch {
      setToast("Network error, please try again,");
    }
  }

  function handleJoinSubmit() {
    const code = joinCode.trim();
    if (!code) {
      setToast("Enter an invite code,");
      return;
    }

    (async () => {
      setJoinOpen(false);
      try {
        const res = await fetch(
          `/api/tenant/applications/resolve?form=${encodeURIComponent(code)}&create=1`,
          {
            method: "GET",
            cache: "no-store",
          },
        );
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) {
          setToast(j?.error === "form_not_found" ? "Form not found," : "Could not start application,");
          return;
        }
        const fId = String(j.form._id ?? j.form.id ?? code);
        const aId = String(j.app?.id ?? "");
        if (!aId) {
          setToast("Could not create application,");
          return;
        }
        window.location.href = `/tenant/apply?form=${encodeURIComponent(fId)}&app=${encodeURIComponent(aId)}`;
      } catch {
        setToast("Network error, please try again,");
      }
    })();
  }

  async function handlePayHold(app: TenantApp) {
    if (payBusyId) return;
    setPayBusyId(app.id);
    try {
      const url = `/tenant/payments?appId=${encodeURIComponent(app.id)}`;
      window.location.href = url;
    } catch {
      setToast("Something went wrong starting your payment,");
      setPayBusyId(null);
    }
  }

  async function handleWithdraw(app: TenantApp) {
    if (withdrawBusyId) return;
    setWithdrawBusyId(app.id);

    try {
      const res = await fetch("/api/tenant/applications/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: app.id }),
      });

      const j = await res.json().catch(() => null);

      if (!res.ok || !j?.ok) {
        setToast(
          j?.error
            ? `Could not withdraw application, ${j.error}`
            : "Could not withdraw application,",
        );
        setWithdrawBusyId(null);
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      setApps((prev) =>
        prev.map((x) =>
          x.id === app.id ? { ...x, status: "withdrawn", updatedAt: today } : x,
        ),
      );

      setToast("Application withdrawn,");
      setTimeout(() => {
        window.location.reload();
      }, 150);
    } catch {
      setToast("Network error, please try again,");
    } finally {
      setWithdrawBusyId(null);
    }
  }

  async function handleChat(app: TenantApp) {
    if (chatBusyId) return;
    setChatBusyId(app.id);
    try {
      const res = await fetch("/api/tenant/chat/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: app.id }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) {
        setChatBusyId(null);
        return;
      }
      const threadId = j.threadId ? String(j.threadId) : "";
      const url =
        j.redirect &&
        typeof j.redirect === "string" &&
        j.redirect.includes("/tenant/chat/")
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
  }

  function handleOpenApp(app: TenantApp) {
    if (openBusyId) return;
    setOpenBusyId(app.id);
    (async () => {
      try {
        await goToApply(app.formId, app.id);
      } finally {
        setOpenBusyId(null);
      }
    })();
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#e6edf1]">
      {/* Hero + primary actions */}
      <HeroSection
		  hasAnyApps={hasAnyApps}
		  activeLease={activeLease}
		  onOpenJoin={() => setJoinOpen(true)}
		/>

      {/* Filters + search */}
      <FiltersBar
        hasAnyApps={hasAnyApps}
        tab={tab}
        onTabChange={setTab}
        q={q}
        onSearchChange={setQ}
      />

      {/* List / empty states */}
      <ApplicationsList
        apps={apps}
        filtered={filtered}
        hasAnyApps={hasAnyApps}
        chatBusyId={chatBusyId}
        payBusyId={payBusyId}
        openBusyId={openBusyId}
        withdrawBusyId={withdrawBusyId}
        onOpenApp={handleOpenApp}
        onPayHold={handlePayHold}
        onWithdraw={handleWithdraw}
        onChat={handleChat}
      />

      {/* Join modal */}
      <JoinModal
        open={joinOpen}
        joinCode={joinCode}
        onChange={setJoinCode}
        onClose={() => setJoinOpen(false)}
        onSubmit={handleJoinSubmit}
      />

      {toast && <Toast text={toast} onClose={() => setToast(null)} />}
    </main>
  );
}
