// app/landlord/applications/ApplicationsDesktop.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/* ------------------------------------------
   New canonical statuses (steps)
------------------------------------------- */
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

type MemberRole = "primary" | "co-applicant" | "cosigner";

type Household = {
  id: string;
  appId: string;
  submittedAt: string;
  status: AppStatus;
  members: { name: string; email: string; role: MemberRole }[];
};

type FirmMeta = { firmId: string; firmName: string; firmSlug?: string } | null;

/* ------------------------------------------
   Utils
------------------------------------------- */
function clsx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}
function formatDate(s: string) {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString();
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
function getId(raw: any): string | null {
  const c = raw?.id ?? raw?.hhId ?? raw?.householdId ?? raw?._id ?? null;
  if (!c) return null;
  if (typeof c === "object" && c.$oid) return String(c.$oid);
  if (typeof c === "object" && typeof c.toString === "function") {
    const s = c.toString();
    if (s && s !== "[object Object]") return s;
  }
  return String(c);
}
function getAppId(raw: any): string | null {
  const c = raw?.appId ?? raw?.applicationId ?? raw?.application_id ?? raw?._id ?? null;
  if (!c) return null;
  if (typeof c === "object" && c.$oid) return String(c.$oid);
  if (typeof c === "object" && typeof c.toString === "function") {
    const s = c.toString();
    if (s && s !== "[object Object]") return s;
  }
  return String(c);
}

/* ------------------------------------------
   Stage model (one group per step)
------------------------------------------- */
type StageKey =
  | "draft"
  | "submitted"
  | "admin_screened"
  | "approved_high"
  | "terms_set"
  | "min_due"
  | "min_paid"
  | "countersigned"
  | "occupied"
  | "closed";

const STAGE_ORDER: { key: StageKey; label: string; match: (s: AppStatus) => boolean }[] = [
  { key: "draft",          label: "Draft",         match: (s) => s === "draft" },
  { key: "submitted",      label: "Submitted",     match: (s) => s === "submitted" },
  { key: "admin_screened", label: "In Review",     match: (s) => s === "admin_screened" },
  { key: "approved_high",  label: "Approved",      match: (s) => s === "approved_high" },
  { key: "terms_set",      label: "Terms Set",     match: (s) => s === "terms_set" },
  { key: "min_due",        label: "Payment Due",   match: (s) => s === "min_due" },
  { key: "min_paid",       label: "Ready to Sign", match: (s) => s === "min_paid" },
  { key: "countersigned",  label: "Countersigned", match: (s) => s === "countersigned" },
  { key: "occupied",       label: "Occupied",      match: (s) => s === "occupied" },
  { key: "closed",         label: "Closed",        match: (s) => s === "rejected" || s === "withdrawn" },
];

function labelForStatus(s: AppStatus): string {
  const hit = STAGE_ORDER.find((stage) => stage.match(s));
  if (hit) return hit.label;
  // sensible fallback, capitalized
  return s.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ------------------------------------------
   Color system per status (outline + light shade)
------------------------------------------- */
function colorClassesForStatus(s: AppStatus) {
  // map to tailwind colors used in badges
  if (s === "draft")             return { border: "border-gray-300",    bg: "bg-gray-50" };
  if (s === "submitted")         return { border: "border-blue-300",    bg: "bg-blue-50" };
  if (s === "admin_screened")    return { border: "border-amber-300",   bg: "bg-amber-50" };
  if (s === "approved_high")     return { border: "border-violet-300",  bg: "bg-violet-50" };
  if (s === "terms_set")         return { border: "border-violet-300",  bg: "bg-violet-50" };
  if (s === "min_due")           return { border: "border-violet-300",  bg: "bg-violet-50" };
  if (s === "min_paid")          return { border: "border-emerald-300", bg: "bg-emerald-50" };
  if (s === "countersigned")     return { border: "border-emerald-300", bg: "bg-emerald-50" };
  if (s === "occupied")          return { border: "border-emerald-300", bg: "bg-emerald-50" };
  if (s === "rejected" || s === "withdrawn")
                                 return { border: "border-rose-300",    bg: "bg-rose-50" };
  return { border: "border-gray-200", bg: "bg-white" };
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

function coerceToHouseholdUI(raw: any): Household | null {
  const id = getId(raw);
  const appId = getAppId(raw);
  if (!id || !appId) return null;
  const submittedAt = toISO(raw.submittedAt ?? raw.createdAt ?? raw.updatedAt);
  const status = String(raw.status ?? "submitted") as AppStatus;
  const membersRaw: any[] = Array.isArray(raw.members) ? raw.members : [];
  const members = membersRaw.map((m) => ({
    name:
      val(m.name) ??
      val(m.fullName) ??
      (val(m.firstName) && val(m.lastName)
        ? `${val(m.firstName)} ${val(m.lastName)}`
        : undefined) ??
      val(m.email) ??
      "—",
    email: val(m.email) ?? val(m.mail) ?? "—",
    role: "co-applicant" as MemberRole,
  }));
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
      ? {
          firmId: String(j.firm.firmId),
          firmName: String(j.firm.firmName ?? "—"),
          firmSlug: j.firm.firmSlug,
        }
      : null;
    return { rows, nextCursor, firm };
  } catch {
    return { rows: [], nextCursor: null, firm: null };
  }
}

/* ------------------------------------------
   Card (full width + colored outline/shade)
------------------------------------------- */
function AppCard({
  hh,
  onReview,
  leaseHref,
  holdingHref,
  handoffHref,
}: {
  hh: Household;
  onReview: (hh: Household) => void;
  leaseHref: string;
  holdingHref: string;
  handoffHref: string;
}) {
  const primary = hh.members?.[0];
  const colors = colorClassesForStatus(hh.status);
  const isMinDue = hh.status === "min_due";
  const isMinPaid = hh.status === "min_paid";
  const isCountersigned = hh.status === "countersigned";

  return (
    <div
      className={clsx(
        "w-full rounded-md border p-3 shadow-sm hover:shadow transition",
        colors.border,
        colors.bg
      )}
    >
      {/* Header row: title + status chip */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-gray-900 truncate">
            Household {hh.id}
          </div>
        </div>
        <span className="inline-flex items-center rounded-full bg-white/60 px-2 py-0.5 text-[10px] text-gray-700 ring-1 ring-gray-200">
          {labelForStatus(hh.status)}
        </span>
      </div>

      {/* Middle row: compact meta */}
      <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        <div className="min-w-0">
          <div className="text-[11px] text-gray-600 break-all">App: {hh.appId}</div>
          {primary && (
            <div className="text-[11px] text-gray-600 truncate">
              {primary.name} • {primary.email}
            </div>
          )}
        </div>
        <div className="sm:text-right text-[11px] text-gray-500">
          Updated {formatDate(hh.submittedAt)}
        </div>
      </div>

      {/* Footer row: details left (hint), actions right */}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        {/* Hint / stage note (optional; compact) */}
        <div className="hidden sm:block text-[10px] text-gray-500">
          {hh.status === "min_paid"
            ? "Ready to countersign"
            : hh.status === "min_due"
            ? "Payment gate open"
            : hh.status === "admin_screened"
            ? "In review"
            : hh.status === "approved_high"
            ? "Approved"
            : hh.status === "terms_set"
            ? "Terms configured"
            : ""}
        </div>

        {/* Actions (right-aligned) */}
		<div className="flex flex-wrap items-center justify-end gap-1.5">
		  {/* Review button */}
		  <button
			onClick={() => onReview(hh)}
			className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-900 hover:bg-gray-50"
			title="Open review"
		  >
			Review
		  </button>
			{/* Chat */}
		  <Link
			href={{ pathname: "/landlord/chat", query: { appId: hh.appId, hh: hh.id } }}
			className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-900 hover:bg-gray-50"
		  >
			Chat
		  </Link>

		  {/* Countersigned: show BOTH setup + wrap-up */}
		  {isCountersigned && (
			<>
			  <Link
				href={leaseHref}
				className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
				title="Lease setup"
			  >
				Lease setup
			  </Link>
			  <Link
				href={handoffHref}
				className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
				title="Lease wrap-up"
			  >
				Wrap up
			  </Link>
			</>
		  )}

		  {/* min_paid: ONLY show wrap-up */}
		  {isMinPaid && (
			<Link
			  href={handoffHref}
			  className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
			  title="Lease wrap-up"
			>
			  Wrap up
			</Link>
		  )}

		  {/* min_due: holding/payments */}
		  {isMinDue && (
			<Link
			  href={holdingHref}
			  className="rounded border border-violet-300 bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-800 hover:bg-violet-100"
			  title="Holding / Payment"
			>
			  Holding / Payment
			</Link>
		  )}


		</div>

      </div>
    </div>
  );
}

/* ------------------------------------------
   Page (groups only; no extra filters)
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { rows, nextCursor, firm } = await fetchHouseholds(undefined, firmIdFromUrl);
      if (!cancelled) {
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
    const { rows: more, nextCursor } = await fetchHouseholds(cursor, firmIdFromUrl);
    setRows((prev) => [...prev, ...more]);
    setCursor(nextCursor);
    setBusyMore(false);
  }

  // helpers for actions
  const REVIEW_BASE = "/landlord/reviews";
  function onReview(hh: Household) {
    if (!hh?.appId) return;
    const href = `${REVIEW_BASE}/${encodeURIComponent(hh.appId)}${
      firmIdFromUrl ? `?firmId=${encodeURIComponent(firmIdFromUrl)}` : ""
    }`;
    router.push(href);
  }
  const holdingHrefFor = (hh: Household) =>
    firmIdFromUrl
      ? `/landlord/leases/${encodeURIComponent(hh.appId)}/holding?firmId=${encodeURIComponent(
          firmIdFromUrl
        )}`
      : `/landlord/leases/${encodeURIComponent(hh.appId)}/holding`;
  const leaseHrefFor = (hh: Household) =>
    firmIdFromUrl
      ? `/landlord/leases/${encodeURIComponent(hh.appId)}/setup?firmId=${encodeURIComponent(
          firmIdFromUrl
        )}`
      : `/landlord/leases/${encodeURIComponent(hh.appId)}/setup`;
  const handoffHrefFor = (hh: Household) =>
    firmIdFromUrl
      ? `/landlord/leases/${encodeURIComponent(hh.appId)}/handoff?firmId=${encodeURIComponent(
          firmIdFromUrl
        )}`
      : `/landlord/leases/${encodeURIComponent(hh.appId)}/handoff`;

  // group strictly by steps (no other filters)
  const groups = useMemo(() => {
    const buckets: Record<StageKey, Household[]> = {
      draft: [],
      submitted: [],
      admin_screened: [],
      approved_high: [],
      terms_set: [],
      min_due: [],
      min_paid: [],
      countersigned: [],
      occupied: [],
      closed: [],
    };
    for (const h of rows) {
      const slot = STAGE_ORDER.find((s) => s.match(h.status))?.key as StageKey | undefined;
      if (slot) buckets[slot].push(h);
    }
    // default sort: most recent per group
    (Object.keys(buckets) as StageKey[]).forEach((k) => {
      buckets[k].sort((a, b) => (b.submittedAt || "").localeCompare(a.submittedAt || ""));
    });
    return buckets;
  }, [rows]);

  const formsHref = firmIdFromUrl
    ? `/landlord/forms?firmId=${encodeURIComponent(firmIdFromUrl)}`
    : "/landlord/forms";

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 pb-8">
      {/* Header */}
      <div className="mt-4 mb-2 flex items-center justify-between">
        <div>
          <div className="text-base font-semibold text-gray-900">
            {firm?.firmName ?? "Applications"}
          </div>
          {firm?.firmSlug && (
            <div className="text-xs text-gray-600">Firm: {firm.firmSlug}</div>
          )}
        </div>
        <Link
          href={formsHref}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
          title="Open application forms"
        >
          Forms
        </Link>
      </div>

      {/* Flow legend (once) */}
      <div className="mb-3 text-[11px] text-gray-600">
        <span className="font-medium text-gray-800">Flow:</span>{" "}
        Draft → Submitted → In Review → Approved → Terms Set → Payment Due → Ready to Sign →
        Countersigned → Occupied → Closed
      </div>

      {loading ? (
        <div className="px-6 py-8 text-sm text-gray-600">Loading…</div>
      ) : (
        <div className="mt-4 space-y-6">
          {STAGE_ORDER.map(({ key, label }) => {
            const items = groups[key] ?? [];
            return (
              <section key={key}>
                <div className="mb-2 text-sm font-semibold text-gray-900">
                  {label}{" "}
                  <span className="ml-1 inline-flex items-center rounded-full bg-gray-100 text-gray-700 ring-1 ring-gray-200 px-2 py-0.5 text-[11px]">
                    {items.length}
                  </span>
                </div>

                {items.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-xs text-gray-600">
                    No applications in this step.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {items.map((hh) => (
                      <AppCard
                        key={hh.appId}
                        hh={hh}
                        onReview={onReview}
                        leaseHref={leaseHrefFor(hh)}
                        holdingHref={holdingHrefFor(hh)}
                        handoffHref={handoffHrefFor(hh)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

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
