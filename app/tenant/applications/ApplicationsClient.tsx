"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

/* Types */
type MemberRole = "primary" | "co_applicant" | "cosigner";
type AppStatus = "draft" | "new" | "in_review" | "needs_approval" | "approved_pending_lease" | "rejected";
type Member = { name: string; email: string; role: MemberRole; state?: "invited"|"complete"|"missing_docs" };
type TenantApp = {
  id: string; formId: string; formName: string;
  property?: string; unit?: string;
  role: MemberRole; status: AppStatus; updatedAt: string; submittedAt?: string;
  members: Member[];
  tasks?: { myIncomplete?: number; householdIncomplete?: number; missingDocs?: number };
};
type FormSummary = { id: string; name: string; scope: "portfolio" | "property"; property?: string };

function clsx(...xs: (string | false | null | undefined)[]) { return xs.filter(Boolean).join(" "); }

/** Slightly roomier badge, truncates gracefully on small screens */
function Badge({ children, tone = "gray" }: { children: React.ReactNode; tone?: "gray"|"blue"|"amber"|"violet"|"emerald"|"rose" }) {
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
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset max-w-full truncate",
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
    status === "approved_pending_lease" ? "emerald" :
    "rose";
  const label =
    status === "draft" ? "Draft" :
    status === "new" ? "New" :
    status === "in_review" ? "In review" :
    status === "needs_approval" ? "Needs approval" :
    status === "approved_pending_lease" ? "Approved" :
    "Rejected";
  return <Badge tone={tone as any}>{label}</Badge>;
}

/** Toast respects iOS safe areas, improves a11y on mobile */
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
        <button
          className="ml-3 underline underline-offset-2"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}

/** Bottom‑sheet on mobile, classic dialog on larger screens */
function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          // Mobile: full‑width bottom sheet
          "fixed inset-x-0 bottom-0 top-auto w-full rounded-t-2xl bg-white shadow-xl ring-1 ring-gray-200",
          // Larger screens: centered card
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

/* Demo data fallback */
const DEMO_FORMS: FormSummary[] = [
  { id: "form_portfolio_default", name: "Standard Rental Application", scope: "portfolio" },
];
const DEMO_APPS: TenantApp[] = [
  {
    id: "hh_demo_001", formId: "form_portfolio_default", formName: "Standard Rental Application",
    property: "Cambridge Flats", unit: "A2", role: "primary", status: "in_review",
    updatedAt: "2025-10-30", submittedAt: "2025-10-29",
    members: [
      { name: "You", email: "you@example.com", role: "primary", state: "complete" },
      { name: "Alex Carter", email: "alex@example.com", role: "co_applicant", state: "missing_docs" },
    ],
    tasks: { myIncomplete: 0, householdIncomplete: 1, missingDocs: 1 },
  },
  {
    id: "hh_demo_002", formId: "form_portfolio_default", formName: "Standard Rental Application",
    property: "Riverside Lofts", unit: "3C", role: "cosigner", status: "draft",
    updatedAt: "2025-10-28",
    members: [{ name: "Jane Smith", email: "jane@example.com", role: "primary", state: "invited" }],
    tasks: { myIncomplete: 1, householdIncomplete: 1, missingDocs: 0 },
  },
];

export default function ApplicationsClient() {
  const [origin, setOrigin] = useState<string>("");
  const [forms, setForms] = useState<FormSummary[]>(DEMO_FORMS);
  const [apps, setApps] = useState<TenantApp[]>(DEMO_APPS);
  const [toast, setToast] = useState<string | null>(null);

  // join modal
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");

  // chat modal
  const [chatOpen, setChatOpen] = useState<null | { appId: string }>(null);

  // filters
  type Tab = "all" | "in_progress" | "submitted" | "approved" | "rejected";
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);

    // Try forms
    (async () => {
      try {
        const res = await fetch("/api/forms", { cache: "no-store" });
        if (res.ok) {
          const j = await res.json();
          if (j?.ok && Array.isArray(j.forms) && j.forms.length) {
            setForms(j.forms.map((f: any) => ({
              id: String(f._id ?? f.id),
              name: String(f.name ?? "Untitled"),
              scope: (f.scope ?? "portfolio") as "portfolio" | "property",
              property: f.propertyId ? String(f.propertyId) : undefined,
            })));
          }
        }
      } catch {}
    })();

    // Try my apps
    (async () => {
      try {
        const res = await fetch("/api/tenant/applications?me=1", { cache: "no-store" });
        if (res.ok) {
          const j = await res.json();
          if (j?.ok && Array.isArray(j.apps)) setApps(j.apps as TenantApp[]);
        }
      } catch {}
    })();
  }, []);

  const defaultFormId = forms[0]?.id || "form_portfolio_default";

  const filtered = useMemo(() => {
    let arr = [...apps];
    if (tab !== "all") {
      if (tab === "in_progress") {
        arr = arr.filter(a => ["draft","new","in_review","needs_approval"].includes(a.status));
      } else if (tab === "submitted") {
        arr = arr.filter(a => ["in_review","needs_approval"].includes(a.status));
      } else if (tab === "approved") {
        arr = arr.filter(a => a.status === "approved_pending_lease");
      } else if (tab === "rejected") {
        arr = arr.filter(a => a.status === "rejected");
      }
    }
    if (q.trim()) {
      const t = q.toLowerCase();
      arr = arr.filter(a =>
        [
          a.formName, a.property, a.unit, a.role, a.status,
          ...a.members.map(m => m.name), ...a.members.map(m => m.email),
        ].join(" ").toLowerCase().includes(t)
      );
    }
    return arr.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }, [apps, tab, q]);

  function onJoin() {
    const code = joinCode.trim();
    if (!code) return setToast("Enter an invite code,");
    window.location.href = `/tenant/apply?form=${encodeURIComponent(defaultFormId)}&invite=${encodeURIComponent(code)}`;
  }

  function shareLink(app: TenantApp) {
    const url = new URL(`/tenant/apply`, origin || "http://localhost:3000");
    url.searchParams.set("form", app.formId);
    url.searchParams.set("hh", app.id);
    return url.toString();
  }

  const last = filtered[0];

  return (
    <>
      {/* Quick actions */}
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
          <Link
            href={`/tenant/apply?form=${encodeURIComponent(defaultFormId)}`}
            className="rounded-lg bg-blue-600 text-white font-medium text-center px-4 py-3 hover:bg-blue-700 active:opacity-90"
          >
            Start new application
          </Link>
          <button
            onClick={() => setJoinOpen(true)}
            className="rounded-lg border border-gray-300 bg-white text-gray-900 font-medium px-4 py-3 hover:bg-gray-50 active:opacity-90"
          >
            Join with a code
          </button>
          {last ? (
            <Link
              href={`/tenant/apply?form=${encodeURIComponent(last.formId)}&hh=${encodeURIComponent(last.id)}`}
              className="rounded-lg border border-gray-300 bg-white text-gray-900 font-medium text-center px-4 py-3 hover:bg-gray-50 active:opacity-90"
            >
              Resume last application
            </Link>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-gray-50 text-gray-600 text-center px-4 py-3">
              No drafts yet
            </div>
          )}
        </div>

        {/* Filters + search */}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Scrollable pill group on small screens */}
          <div className="rounded-lg border border-gray-300 bg-white p-0.5 overflow-x-auto max-w-full">
            <div className="inline-flex min-w-max">
              {([
                { id: "all", label: "All" },
                { id: "in_progress", label: "In progress" },
                { id: "submitted", label: "Submitted" },
                { id: "approved", label: "Approved" },
                { id: "rejected", label: "Rejected" },
              ] as const).map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={clsx(
                    "px-3 py-2 text-sm rounded-md",
                    tab === t.id ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-50 active:opacity-90"
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
              placeholder="Search properties, members, units"
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
            No applications match your filters, start a new one, or join with a code,
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((a) => {
              const me = a.members.find(m => m.role === a.role) || a.members[0];
              const others = a.members.filter(m => m !== me);
              return (
                <div key={a.id} className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 line-clamp-2">{a.formName}</div>
                      <div className="text-xs text-gray-600 mt-0.5 truncate">
                        {a.property ? `${a.property}${a.unit ? ` · Unit ${a.unit}` : ""}` : "Portfolio"}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <StatusChip status={a.status} />
                        <Badge tone="gray">{a.role.replace("_", " ")}</Badge>
                        <span className="text-[11px] text-gray-500">Updated {a.updatedAt}</span>
                      </div>
                    </div>

                    <div className="sm:text-right">
                      <Link
                        href={`/tenant/apply?form=${encodeURIComponent(a.formId)}&hh=${encodeURIComponent(a.id)}`}
                        className="inline-flex justify-center rounded-md bg-gray-900 text-white text-sm font-medium px-3 py-2 hover:bg-black active:opacity-90"
                      >
                        Open
                      </Link>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500">Members</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {me && <Badge tone="blue">{me.name || "You"} · {me.role.replace("_"," ")}</Badge>}
                      {others.map((m, i) => (
                        <Badge key={i} tone={m.role === "cosigner" ? "violet" : "gray"}>
                          {m.name || m.email} · {m.role.replace("_"," ")}
                        </Badge>
                      ))}
                    </div>

                    {/* Mobile-first: stacks to 1 column, expands to 3 on sm+ */}
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-center">
                        <div className="text-xs text-gray-600">My tasks</div>
                        <div className="text-base font-semibold text-gray-900">{a.tasks?.myIncomplete ?? 0}</div>
                      </div>
                      <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-center">
                        <div className="text-xs text-gray-600">Household</div>
                        <div className="text-base font-semibold text-gray-900">{a.tasks?.householdIncomplete ?? 0}</div>
                      </div>
                      <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-center">
                        <div className="text-xs text-gray-600">Missing docs</div>
                        <div className="text-base font-semibold text-gray-900">{a.tasks?.missingDocs ?? 0}</div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => setChatOpen({ appId: a.id })}
                      className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 active:opacity-90"
                    >
                      Chat
                    </button>
                    <button
                      onClick={async () => {
                        try { await navigator.clipboard.writeText(shareLink(a)); setToast("Share link copied,"); }
                        catch { setToast(`Share link: ${shareLink(a)}`); }
                      }}
                      className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 active:opacity-90"
                    >
                      Copy link
                    </button>
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
            Enter the invite code you received, we’ll attach you to the right household,
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
            <button onClick={() => setJoinOpen(false)} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm active:opacity-90">Cancel</button>
            <button onClick={onJoin} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 active:opacity-90">Continue</button>
          </div>
          <p className="text-xs text-gray-500">If you have a link, you can just open it, we’ll handle the rest,</p>
        </div>
      </Modal>

      {/* Chat modal (stub) */}
      <Modal open={!!chatOpen} title="Household chat" onClose={() => setChatOpen(null)}>
        <div className="space-y-3">
          <div className="rounded-md border border-gray-200 p-3 text-sm text-gray-600">
            Messages will appear here, group‑wide, with timestamps and attachments,
          </div>
          <div>
            <label htmlFor="chat-message" className="block text-xs text-gray-700 mb-1">Message</label>
            <textarea id="chat-message" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" rows={3} placeholder="Thanks for the invite, I’ll upload my ID tonight," />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setToast("Message queued, realtime chat coming soon,")} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 active:opacity-90">
              Send
            </button>
          </div>
        </div>
      </Modal>

      {toast && <Toast text={toast} onClose={() => setToast(null)} />}
    </>
  );
}
