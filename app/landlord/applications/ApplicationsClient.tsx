"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

/* ------------------------------------------
   Demo data: forms, households
   (replace with real queries next)
------------------------------------------- */
type MemberRole = "primary" | "co-applicant" | "cosigner";
type AppStatus =
  | "new"
  | "in_review"
  | "needs_approval"
  | "approved_pending_lease"
  | "rejected";

type Household = {
  id: string;
  property: string;
  unit: string;
  submittedAt: string;
  status: AppStatus;
  members: {
    name: string;
    email: string;
    role: MemberRole;
    state?: "invited" | "complete" | "missing_docs";
  }[];
};

type FormSummary = {
  id: string;
  name: string;
  scope: "portfolio" | "property";
  property?: string;
};

const DEMO_FORMS: FormSummary[] = [
  {
    id: "form_portfolio_default",
    name: "Standard Rental Application",
    scope: "portfolio",
  },
  {
    id: "form_cambridge_flats",
    name: "Cambridge Flats Application",
    scope: "property",
    property: "Cambridge Flats",
  },
];

const DEMO_HOUSEHOLDS: Household[] = [
  {
    id: "hh_001",
    property: "Cambridge Flats",
    unit: "A1",
    submittedAt: "2025-10-30",
    status: "in_review",
    members: [
      {
        name: "Jane Smith",
        email: "jane@example.com",
        role: "primary",
        state: "complete",
      },
      {
        name: "Alex Carter",
        email: "alex@example.com",
        role: "co-applicant",
        state: "missing_docs",
      },
    ],
  },
  {
    id: "hh_002",
    property: "Cambridge Flats",
    unit: "A2",
    submittedAt: "2025-10-29",
    status: "needs_approval",
    members: [
      {
        name: "Mark Lee",
        email: "mark@example.com",
        role: "primary",
        state: "complete",
      },
      {
        name: "Rita Lee",
        email: "rita@example.com",
        role: "cosigner",
        state: "complete",
      },
    ],
  },
  {
    id: "hh_003",
    property: "Riverside Lofts",
    unit: "3C",
    submittedAt: "2025-10-28",
    status: "new",
    members: [
      {
        name: "Priya Patel",
        email: "priya@example.com",
        role: "primary",
        state: "invited",
      },
    ],
  },
];

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
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        map[tone]
      )}
    >
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

function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div className="rounded-md bg-gray-900 text-white text-sm px-4 py-2 shadow-lg">
        {text}{" "}
        <button className="ml-3 underline" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="absolute left-1/2 top-16 -translate-x-1/2 w-[92%] max-w-xl rounded-xl bg-white shadow-xl ring-1 ring-gray-200"
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------
   Main component
------------------------------------------- */
export default function ApplicationsClient() {
  // In real code, compute from org_memberships; for now, toggle here if needed
  const isAdmin = true;

  const [tab, setTab] = useState<
    "all" | "new" | "in_review" | "needs_approval" | "approved"
  >("all");
  const [q, setQ] = useState("");

  const [toast, setToast] = useState<string | null>(null);

  // Modals still used: invite, members, chat (form modals removed)
  const [inviteOpen, setInviteOpen] = useState<null | { hhId: string }>(null);
  const [chatOpen, setChatOpen] = useState<null | { hhId: string }>(null);
  const [membersOpen, setMembersOpen] = useState<null | { hh: Household }>(
    null
  );

  const filtered = useMemo(() => {
    let rows = DEMO_HOUSEHOLDS;
    if (tab !== "all") {
      if (tab === "approved")
        rows = rows.filter((r) => r.status === "approved_pending_lease");
      else rows = rows.filter((r) => r.status === tab);
    }
    if (q.trim()) {
      const t = q.toLowerCase();
      rows = rows.filter((h) =>
        [h.property, h.unit, h.status, ...h.members.map((m) => m.name), ...h.members.map((m) => m.email)]
          .join(" ")
          .toLowerCase()
          .includes(t)
      );
    }
    return rows;
  }, [tab, q]);

  /* -------------- Action handlers (stub) -------------- */
  function onReview(hh: Household) {
    setToast(
      `Open review for household in ${hh.property} ${hh.unit}, documents by member, notes next,`
    );
  }
  function onPrelimAccept(hh: Household) {
    setToast(
      `Preliminary acceptance recorded for household ${hh.id}, approver will finalize,`
    );
  }
  function onFullAccept(hh: Household) {
    setToast(
      `Approval queued for household ${hh.id}, lease generation up next,`
    );
  }
  function onInviteMemberSubmit(e: React.FormEvent) {
    e.preventDefault();
    setInviteOpen(null);
    setToast("Invite sent, member will join, upload docs, complete tasks,");
  }

  /* -------------- Render -------------- */
  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between mb-4">
        <div className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5">
          {([
            { id: "all", label: "All" },
            { id: "new", label: "New" },
            { id: "in_review", label: "Needs review" },
            { id: "needs_approval", label: "Needs approval" },
            { id: "approved", label: "Approved" },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                "px-3 py-1.5 text-sm rounded-md transition",
                tab === t.id
                  ? "bg-gray-900 text-white"
                  : "text-gray-700 hover:bg-gray-50"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search households, members, properties, units"
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

          <div className="flex gap-2">
            {/* Share form → to your forms list (with a query to open share UI) */}
            <Link
              href="/landlord/forms"
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
            >
              Manage Application
            </Link>

            {/* Admin-only: New application form → builder */}
            {isAdmin && (
              <Link
                href="/landlord/forms/builder"
                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                New application form
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Table: household-first */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
              <th className="px-4 py-3">Household</th>
              <th className="px-4 py-3">Property / Unit</th>
              <th className="px-4 py-3">Members</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Submitted</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-sm text-gray-600"
                >
                  No households match your filters, share a form, invite a
                  member, start a review,
                </td>
              </tr>
            ) : (
              filtered.map((hh) => {
                const primary = hh.members.find((m) => m.role === "primary");
                const others = hh.members.filter((m) => m.role !== "primary");
                return (
                  <tr key={hh.id} className="hover:bg-gray-50/60">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {primary ? primary.name : "Primary pending"}
                        {others.length > 0 && (
                          <span className="text-gray-500">
                            {" "}
                            + {others.length} others
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        {primary?.email || "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900">{hh.property}</div>
                      <div className="text-xs text-gray-500">Unit {hh.unit}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {hh.members.map((m, i) => (
                          <Badge
                            key={i}
                            tone={
                              m.role === "primary"
                                ? "blue"
                                : m.role === "cosigner"
                                ? "violet"
                                : "gray"
                            }
                          >
                            {m.role.replace("-", " ")}
                          </Badge>
                        ))}
                      </div>
                      <button
                        onClick={() => setMembersOpen({ hh })}
                        className="mt-1 text-xs text-gray-600 underline hover:text-gray-800"
                      >
                        View members
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <StatusChip status={hh.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {hh.submittedAt}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => onReview(hh)}
                          className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50"
                        >
                          Review
                        </button>
                        <button
                          onClick={() => setInviteOpen({ hhId: hh.id })}
                          className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50"
                        >
                          Invite member
                        </button>
                        <button
                          onClick={() => onPrelimAccept(hh)}
                          className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                        >
                          Prelim accept
                        </button>
                        <button
                          onClick={() => onFullAccept(hh)}
                          className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-100"
                        >
                          Fully accept
                        </button>
                        <button
                          onClick={() => setChatOpen({ hhId: hh.id })}
                          className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50"
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

      {/* -------- Modals (kept) -------- */}

      {/* Invite Member (co-applicant / cosigner) */}
      <Modal
        open={!!inviteOpen}
        title="Invite household member"
        onClose={() => setInviteOpen(null)}
      >
        <form onSubmit={onInviteMemberSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-700 mb-1">Role</label>
            <select
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              defaultValue="co-applicant"
            >
              <option value="co-applicant">Co-applicant</option>
              <option value="cosigner">Cosigner</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">Email</label>
            <input
              type="email"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="person@example.com"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">
              Message (optional)
            </label>
            <textarea
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              rows={3}
              placeholder="Please join this application, complete your section, upload your documents,"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setInviteOpen(null)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Send invite
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            We’ll create a tokenized invite, we’ll track acceptance, we’ll mark
            member state,
          </p>
        </form>
      </Modal>

      {/* Members viewer */}
      <Modal
        open={!!membersOpen}
        title="Household members"
        onClose={() => setMembersOpen(null)}
      >
        {membersOpen && (
          <div className="space-y-3">
            {membersOpen.hh.members.map((m, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-md border border-gray-200 p-3"
              >
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {m.name}{" "}
                    <span className="text-xs text-gray-500">({m.email})</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge
                      tone={
                        m.role === "primary"
                          ? "blue"
                          : m.role === "cosigner"
                          ? "violet"
                          : "gray"
                      }
                    >
                      {m.role}
                    </Badge>
                    {m.state && (
                      <Badge
                        tone={
                          m.state === "complete"
                            ? "emerald"
                            : m.state === "missing_docs"
                            ? "amber"
                            : "gray"
                        }
                      >
                        {m.state.replace("_", " ")}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs hover:bg-gray-50">
                    Resend invite
                  </button>
                  <button className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs hover:bg-gray-50">
                    Request docs
                  </button>
                </div>
              </div>
            ))}
            <p className="text-xs text-gray-500">
              All members must complete required items, approvals remain gated
              until then,
            </p>
          </div>
        )}
      </Modal>

      {/* Chat */}
      <Modal
        open={!!chatOpen}
        title="Chat with household"
        onClose={() => setChatOpen(null)}
      >
        <div className="space-y-3">
          <div className="rounded-md border border-gray-200 p-3 text-sm text-gray-600">
            Threaded messages will live here, group-wide, time-stamped, files
            supported,
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">Message</label>
            <textarea
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              rows={3}
              placeholder="Thanks for applying, welcome aboard, please upload your latest paystubs,"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() =>
                setToast("Message queued, real-time chat coming soon,")
              }
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Send
            </button>
          </div>
        </div>
      </Modal>

      {toast && <Toast text={toast} onClose={() => setToast(null)} />}
    </>
  );
}
