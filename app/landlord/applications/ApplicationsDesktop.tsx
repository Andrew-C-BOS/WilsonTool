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
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
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
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      <div
        role="status"
        aria-live="polite"
        className="rounded-md bg-gray-900 text-white text-sm px-4 py-2 shadow-lg"
      >
        {text}{" "}
        <button className="ml-3 underline underline-offset-2" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** Desktop modal, centered dialog */
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
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className="absolute left-1/2 top-16 -translate-x-1/2 w-[92%] max-w-3xl rounded-2xl bg-white shadow-xl ring-1 ring-gray-200"
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------
   Data wiring: fetch, normalize, paginate
------------------------------------------- */

// Robust ID coercion for strings, ObjectId instances, Mongo exports
function getId(raw: any): string | null {
  const candidate =
    raw?.id ??
    raw?.hhId ??
    raw?.householdId ??
    raw?.applicationGroupId ??
    raw?._id ??
    null;
  if (!candidate) return null;

  // JSON export: { _id: { $oid: "..." } }
  if (typeof candidate === "object" && candidate.$oid) {
    return String(candidate.$oid);
  }
  // If Mongoose ObjectId slipped through, toString() gives hex, not [object Object]
  if (typeof candidate === "object" && typeof candidate.toString === "function") {
    const s = candidate.toString();
    if (s && s !== "[object Object]") return s;
  }
  return String(candidate);
}

// Accept firmId to keep server-side scoping aligned with the rest of the app
const ENDPOINT = (cursor?: string, firmId?: string) => {
  const qp = new URLSearchParams();
  qp.set("limit", "50");
  if (cursor) qp.set("cursor", cursor);
  if (firmId) qp.set("firmId", firmId);
  return `/api/landlord/applications?${qp.toString()}`;
};

function normalizeRole(v: any): MemberRole {
  const raw = String(v ?? "").toLowerCase();
  const s = raw.replace("_", "-");
  if (s === "primary" || s === "co-applicant" || s === "cosigner") return s as MemberRole;
  if (v === true || String(v) === "primary") return "primary";
  return "co-applicant";
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
  try {
    const d = new Date(x);
    return isNaN(d.getTime()) ? String(x) : d.toISOString();
  } catch {
    return String(x);
  }
}
function coerceToHouseholdUI(raw: any): Household | null {
  if (!raw) return null;
  const id = getId(raw);
  if (!id) return null;

  const property =
    raw.property?.name ??
    raw.propertyName ??
    raw.property_title ??
    raw.property ??
    "";
  const unit =
    raw.unit?.label ??
    raw.unitLabel ??
    raw.unitNumber ??
    raw.unit_name ??
    raw.unit ??
    "";
  const submittedAt = toISO(
    raw.submittedAt ?? raw.createdAt ?? raw.updatedAt ?? raw.reviewStartedAt
  );
  const status = normalizeStatus(
    raw.status ?? raw.workflowStatus ?? raw.state ?? raw.phase
  );
  const membersRaw: any[] =
    (Array.isArray(raw.members) && raw.members) ||
    (Array.isArray(raw.applicants) && raw.applicants) ||
    (Array.isArray(raw.people) && raw.people) ||
    [];
  const members = membersRaw.map((m) => {
  
const name =
  m.name ??
  m.fullName ??
  (m.firstName && m.lastName ? `${m.firstName} ${m.lastName}` : "");
  
    const email = m.email ?? m.mail ?? "";
    const state =
      m.state ??
      (m.complete ? "complete" : m.missingDocuments ? "missing_docs" : undefined);
    const role =
      normalizeRole(m.role ?? m.type ?? (m.isPrimary ? "primary" : undefined));
    return { name: name || email || "—", email: email || "—", role, state };
  });

  return {
    id: String(id),
    property: String(property || "—"),
    unit: String(unit || "—"),
    submittedAt,
    status,
    members,
  };
}

async function fetchHouseholds(
  cursor?: string,
  firmId?: string
): Promise<{ rows: Household[]; nextCursor: string | null }> {
  const url = ENDPOINT(cursor, firmId);
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { rows: [], nextCursor: null };
    const j = await res.json();
    const list: any[] =
      (Array.isArray(j.households) && j.households) ||
      (Array.isArray(j.items) && j.items) ||
      (Array.isArray(j.apps) && j.apps) ||
      (Array.isArray(j.data) && j.data) ||
      [];
    const rows = list.map(coerceToHouseholdUI).filter(Boolean) as Household[];
    const nextCursor =
      (j as any).nextCursor ?? (j as any).cursor ?? (j as any).next ?? null;
    return { rows, nextCursor: nextCursor ? String(nextCursor) : null };
  } catch {
    return { rows: [], nextCursor: null };
  }
}

function formatDate(s: string): string {
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString();
  } catch {
    return s;
  }
}

/* ------------------------------------------
   Desktop component
------------------------------------------- */
export default function ApplicationsDesktop() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const firmIdFromUrl = searchParams.get("firmId") || undefined; // carry org/firm context

  const [isAdmin, setIsAdmin] = useState(true);

  const [tab, setTab] = useState<"all" | "new" | "in_review" | "needs_approval" | "approved">(
    "all"
  );
  const [q, setQ] = useState("");

  const [rows, setRows] = useState<Household[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyMore, setBusyMore] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Modals
  const [inviteOpen, setInviteOpen] = useState<null | { hhId: string }>(null);
  const [chatOpen, setChatOpen] = useState<null | { hhId: string }>(null);
  const [membersOpen, setMembersOpen] = useState<null | { hh: Household }>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      const { rows, nextCursor } = await fetchHouseholds(undefined, firmIdFromUrl);
      if (!cancelled) {
        const sorted = [...rows].sort(
          (a, b) =>
            (b.submittedAt || "").localeCompare(a.submittedAt || "") ||
            a.property.localeCompare(b.property) ||
            a.unit.localeCompare(b.unit)
        );
        setRows(sorted);
        setCursor(nextCursor);
        setLoading(false);
      }
    })();

    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (res.ok) {
          const me = await res.json();
          const roles: string[] =
            me?.orgRoles || me?.roles || me?.memberships?.map((m: any) => m.role) || [];
          if (Array.isArray(roles)) {
            setIsAdmin(roles.some((r) => /admin|owner|manager/i.test(String(r))));
          }
        }
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [firmIdFromUrl]); // refetch if firm context changes

  async function loadMore() {
    if (!cursor) return;
    setBusyMore(true);
    const { rows: nextRows, nextCursor } = await fetchHouseholds(cursor, firmIdFromUrl);
    const merged = [...rows, ...nextRows].sort(
      (a, b) =>
        (b.submittedAt || "").localeCompare(a.submittedAt || "") ||
        a.property.localeCompare(b.property) ||
        a.unit.localeCompare(b.unit)
    );
    setRows(merged);
    setCursor(nextCursor);
    setBusyMore(false);
  }

  const filtered = useMemo(() => {
    let r = [...rows];
    if (tab !== "all") {
      if (tab === "approved") {
        r = r.filter((x) => x.status === "approved_pending_lease");
      } else {
        r = r.filter((x) => x.status === (tab as AppStatus));
      }
    }
    if (q.trim()) {
      const t = q.toLowerCase();
      r = r.filter((h) =>
        [h.property, h.unit, h.status, ...h.members.map((m) => m.name), ...h.members.map((m) => m.email)]
          .join(" ")
          .toLowerCase()
          .includes(t)
      );
    }
    return r;
  }, [rows, tab, q]);

  /* -------------- Actions -------------- */

  // Navigate to the review page for a given application/household
  const REVIEW_BASE = "/landlord/reviews"; // change this if your route differs
  function onReview(hh: Household) {
    const id = hh?.id;
    if (!id || id === "undefined") {
      setToast("This record is missing an application id, please refresh,");
      return;
    }
    const href =
      `${REVIEW_BASE}/${encodeURIComponent(id)}` +
      (firmIdFromUrl ? `?firmId=${encodeURIComponent(firmIdFromUrl)}` : "");
    router.push(href);
  }

  async function postDecision(hhId: string, action: "preliminary_accept" | "approve") {
    const candidates = [
      { url: `/api/landlord/applications/${encodeURIComponent(hhId)}/decision`, body: { action } },
      { url: `/api/applications/${encodeURIComponent(hhId)}/decision`, body: { action } },
      { url: `/api/landlord/applications/${encodeURIComponent(hhId)}/${action}`, body: {} },
    ];
    for (const c of candidates) {
      try {
        const res = await fetch(c.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(c.body),
        });
        if (res.ok) return true;
      } catch {}
    }
    return false;
  }

  async function onPrelimAccept(hh: Household) {
    const ok = await postDecision(hh.id, "preliminary_accept");
    setToast(
      ok
        ? `Preliminary acceptance recorded for ${hh.property} ${hh.unit}, approver will finalize,`
        : `Could not record preliminary acceptance right now, please retry,`
    );
  }

  async function onFullAccept(hh: Household) {
    const ok = await postDecision(hh.id, "approve");
    setToast(
      ok ? `Approval queued for ${hh.property} ${hh.unit}, lease generation up next,` : `Could not approve right now, please retry,`
    );
  }

  function onInviteMemberSubmit(e: React.FormEvent) {
    e.preventDefault();
    setInviteOpen(null);
    setToast("Invite sent, member will join, upload docs, complete tasks,");
  }

  /* -------------- Render (desktop only) -------------- */
  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 pb-8">
      {/* Sticky toolbar */}
      <div className="sticky top-0 z-30 -mx-6 border-b border-gray-200 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="mx-auto max-w-[1400px] px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            {/* Tabs / chips */}
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
                    "px-4 py-2 text-sm rounded-md transition whitespace-nowrap",
                    tab === t.id ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-50"
                  )}
                  aria-pressed={tab === t.id}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Search + actions */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <input
                  type="search"
                  inputMode="search"
                  enterKeyHint="search"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search households, members, properties, units"
                  className="w-80 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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

              <Link
                href="/landlord/forms"
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
              >
                Manage Application
              </Link>
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
      </div>

      {/* Table */}
      <div className="mt-6">
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full table-auto divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                <th className="px-6 py-3 min-w-[280px]">Household</th>
                <th className="px-6 py-3 min-w-[220px]">Property / Unit</th>
                <th className="px-6 py-3 min-w-[260px]">Members</th>
                <th className="px-6 py-3 w-[140px]">Status</th>
                <th className="px-6 py-3 w-[140px]">Submitted</th>
                <th className="px-6 py-3 min-w-[520px]">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-sm text-gray-600">
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-sm text-gray-600">
                    No households match your filters, share a form, invite a member, start a review,
                  </td>
                </tr>
              ) : (
                filtered.map((hh) => {
                  const primary = hh.members.find((m) => m.role === "primary");
                  const others = hh.members.filter((m) => m.role !== "primary");
                  const hasId = Boolean(hh.id);
                  return (
                    <tr key={hh.id} className="hover:bg-gray-50/60">
                      <td className="px-6 py-4 align-top">
                        <div className="font-medium text-gray-900 truncate">
                          {primary ? primary.name : "Primary pending"}
                          {others.length > 0 && (
                            <span className="text-gray-500"> + {others.length} others</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 truncate">{primary?.email || "—"}</div>
                      </td>

                      <td className="px-6 py-4 align-top">
                        <div className="text-gray-900 truncate">{hh.property || "—"}</div>
                        <div className="text-xs text-gray-500">Unit {hh.unit || "—"}</div>
                      </td>

                      <td className="px-6 py-4 align-top">
                        <div className="flex flex-wrap gap-1">
                          {hh.members.map((m, i) => (
                            <Badge
                              key={i}
                              tone={m.role === "primary" ? "blue" : m.role === "cosigner" ? "violet" : "gray"}
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

                      <td className="px-6 py-4 align-top">
                        <StatusChip status={hh.status} />
                      </td>

                      <td className="px-6 py-4 align-top text-sm text-gray-700">
                        {formatDate(hh.submittedAt)}
                      </td>

                      <td className="px-6 py-4 align-top">
                        <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                          <button
                            onClick={() => onReview(hh)}
                            disabled={!hasId}
                            title={hasId ? `Review ${hh.id}` : "Missing application id"}
                            className={clsx(
                              "rounded-md border px-3 py-1.5 text-xs font-medium",
                              hasId
                                ? "border-gray-300 bg-white text-gray-900 hover:bg-gray-50"
                                : "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
                            )}
                            data-id={hh.id}
                            aria-label={`Review application ${hh.id}`}
                          >
                            Review
                          </button>
                          <button
                            onClick={() => setInviteOpen({ hhId: hh.id })}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50"
                          >
                            Invite member
                          </button>
                          <button
                            onClick={() => onPrelimAccept(hh)}
                            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                          >
                            Prelim accept
                          </button>
                          <button
                            onClick={() => onFullAccept(hh)}
                            className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-100"
                          >
                            Fully accept
                          </button>
                          <button
                            onClick={() => setChatOpen({ hhId: hh.id })}
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

      {/* -------- Modals -------- */}
      <Modal open={!!inviteOpen} title="Invite household member" onClose={() => setInviteOpen(null)}>
        <form onSubmit={onInviteMemberSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-700 mb-1">Role</label>
            <select className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" defaultValue="co-applicant">
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
            <label className="block text-sm text-gray-700 mb-1">Message (optional)</label>
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
            <button type="submit" className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
              Send invite
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            We’ll create a tokenized invite, we’ll track acceptance, we’ll mark member state,
          </p>
        </form>
      </Modal>

      <Modal open={!!membersOpen} title="Household members" onClose={() => setMembersOpen(null)}>
        {membersOpen && (
          <div className="space-y-3">
            {membersOpen.hh.members.map((m, i) => (
              <div key={i} className="flex items-center justify-between rounded-md border border-gray-200 p-3">
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {m.name} <span className="text-xs text-gray-500">({m.email})</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge tone={m.role === "primary" ? "blue" : m.role === "cosigner" ? "violet" : "gray"}>{m.role}</Badge>
                    {m.state && (
                      <Badge tone={m.state === "complete" ? "emerald" : m.state === "missing_docs" ? "amber" : "gray"}>
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
              All members must complete required items, approvals remain gated until then,
            </p>
          </div>
        )}
      </Modal>

      <Modal open={!!chatOpen} title="Chat with household" onClose={() => setChatOpen(null)}>
        <div className="space-y-3">
          <div className="rounded-md border border-gray-200 p-3 text-sm text-gray-600">
            Threaded messages will live here, group-wide, time-stamped, files supported,
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
              onClick={() => setToast("Message queued, real-time chat coming soon,")}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Send
            </button>
          </div>
        </div>
      </Modal>

      {toast && <Toast text={toast} onClose={() => setToast(null)} />}
    </main>
  );
}
