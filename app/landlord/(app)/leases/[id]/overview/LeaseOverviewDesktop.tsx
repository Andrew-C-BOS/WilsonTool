// app/landlord/leases/[id]/overview/LeaseOverviewDesktop.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type LeaseStatus = "scheduled" | "active" | "ended" | "canceled" | string;

type LeaseDoc = {
  _id: string;
  firmId: string;
  appId: string;
  building?: {
    addressLine1?: string;
    addressLine2?: string | null;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  } | null;
  createdAt?: string;
  updatedAt?: string;
  householdId?: string;
  monthlyRent?: number; // cents
  moveInDate?: string; // YYYY-MM-DD
  moveOutDate?: string | null;
  propertyId?: string | null;
  signed?: boolean;
  signedAt?: string | null;
  status: LeaseStatus;
  unitId?: string | null;
  unitNumber?: string | null;
  checklist?: Array<{
    key: string;
    label: string;
    dueAt: string | null;
    completedAt: string | null;
    notes: string | null;
  }>;
  // Enrichments (from API or derived)
  buildingLabel?: string;
  householdName?: string | null;
};

type AppLite = {
  id: string;
  answers?: Record<string, any>;
  answersByMember?: Record<
    string,
    { role: "primary" | "co_applicant" | "cosigner"; email?: string; answers?: Record<string, any> }
  >;
  members?: Array<{ name?: string; role?: string; email?: string }>;
};

type InspectionStatus = "none" | "draft" | "submitted";

type InspectionSummary = {
  status: InspectionStatus;
  lastInspectionAt: string | null;
};

function clsx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}
const moneyFmt = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const fmtDate = (s?: string | null) =>
  !s ? "—" : Number.isNaN(new Date(s).getTime()) ? s : new Date(s).toLocaleDateString();

/* ─────────────────────────────────────────────────────────────
   Network helpers
───────────────────────────────────────────────────────────── */
async function tryFetchJson(url: string) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { ok: false as const, status: res.status, data: null };
    const data = await res.json().catch(() => null);
    return { ok: true as const, status: 200, data };
  } catch {
    return { ok: false as const, status: 0, data: null };
  }
}

function withFirmId(base: string, firmId?: string) {
  if (!firmId) return base;
  return `${base}${base.includes("?") ? "&" : "?"}firmId=${encodeURIComponent(firmId)}`;
}

async function fetchOverviewRobust(leaseId: string, firmId?: string): Promise<LeaseDoc | null> {
  const primary = withFirmId(`/api/landlord/leases/${encodeURIComponent(leaseId)}/overview`, firmId);
  const alt1 = withFirmId(`/api/landlord/leases/overview/${encodeURIComponent(leaseId)}`, firmId);
  const alt2 = withFirmId(`/api/landlord/lease/${encodeURIComponent(leaseId)}/overview`, firmId);

  for (const u of [primary, alt1, alt2]) {
    if (typeof window !== "undefined") console.log("[lease-overview] GET", u);
    const r = await tryFetchJson(u);
    if (r.ok && r.data?.lease) return r.data.lease as LeaseDoc;
  }
  return null;
}

async function fetchLeaseLegacy(leaseId: string, firmId?: string): Promise<LeaseDoc | null> {
  const url = withFirmId(`/landlord/leases/${encodeURIComponent(leaseId)}`, firmId);
  if (typeof window !== "undefined") console.log("[lease-legacy] GET", url);
  const r = await tryFetchJson(url);
  if (!r.ok || !r.data?.lease) return null;
  return r.data.lease as LeaseDoc;
}

async function fetchApp(appId: string, firmId?: string): Promise<AppLite | null> {
  const url = withFirmId(`/api/landlord/applications/${encodeURIComponent(appId)}`, firmId);
  if (typeof window !== "undefined") console.log("[app] GET", url);
  const r = await tryFetchJson(url);
  const a = r.ok ? r.data?.application : null;
  if (!a) return null;
  return {
    id: String(a.id ?? a._id),
    answers: a.answers ?? {},
    answersByMember: a.answersByMember ?? {},
    members: a.members ?? [],
  };
}

function householdNameFromApp(app?: AppLite | null): string | null {
  if (!app) return null;
  const pri = app.answers?.primary?.q_name || app.answers?.primary?.name;
  if (pri && String(pri).trim()) return String(pri).trim();

  const abm = app.answersByMember || {};
  const names: string[] = [];
  for (const [, bucket] of Object.entries(abm)) {
    const nm = (bucket as any)?.answers?.q_name || (bucket as any)?.answers?.name;
    const role = String((bucket as any)?.role || "").toLowerCase();
    if (nm && ["primary", "co_applicant", "cosigner"].includes(role)) names.push(String(nm));
  }
  const uniq = Array.from(new Set(names.map((x) => x.trim()).filter(Boolean)));
  if (uniq.length) return uniq.join(" & ");

  const mnames = (app.members || []).map((m) => String(m?.name || "")).filter((x) => x.trim());
  if (mnames.length) return mnames.join(" & ");

  return null;
}

/* ─────────────────────────────────────────────────────────────
   New: enable pre-move-in inspection (landlord link)
───────────────────────────────────────────────────────────── */
async function enablePreMoveInInspection(opts: {
  leaseId: string;
  firmId?: string;
  email: string;
}) {
  const { leaseId, firmId, email } = opts;
  const base = `/api/landlord/leases/${encodeURIComponent(leaseId)}/inspection/pre-movein`;
  const url = withFirmId(base, firmId);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      role: "landlord",
      kind: "pre_move_in",
    }),
  });

  if (!res.ok) {
    let msg = "Failed to send inspection link,";
    try {
      const data = await res.json();
      if (data?.error && typeof data.error === "string") msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
}

/* ─────────────────────────────────────────────────────────────
   New: fetch inspection summary for this lease
───────────────────────────────────────────────────────────── */
async function fetchInspectionSummary(leaseId: string): Promise<InspectionSummary | null> {
  const r = await tryFetchJson("/api/landlord/inspection/leases");
  if (!r.ok || !r.data?.leases) return null;
  const list = r.data.leases as any[];
  const row = list.find((l) => String(l.id ?? l._id) === leaseId);
  if (!row) return null;
  const status = (row.inspectionStatus as InspectionStatus) ?? "none";
  const lastInspectionAt = row.lastInspectionAt ?? null;
  return { status, lastInspectionAt };
}

/* ─────────────────────────────────────────────────────────────
   Component
───────────────────────────────────────────────────────────── */
export default function LeaseOverviewDesktop({ leaseId, firmId }: { leaseId: string; firmId?: string }) {
  const [loading, setLoading] = useState(true);
  const [lease, setLease] = useState<LeaseDoc | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // pre-move inspection email flow
  const [showInspectionPanel, setShowInspectionPanel] = useState(false);
  const [inspectionEmail, setInspectionEmail] = useState("");
  const [sendingInspection, setSendingInspection] = useState(false);

  // inspection summary for this lease
  const [insp, setInsp] = useState<InspectionSummary | null>(null);
  const [inspLoading, setInspLoading] = useState(false);
  const [inspErr, setInspErr] = useState<string | null>(null);

  // NEW: toggle for Statement of Condition iframe
  const [showCondition, setShowCondition] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);

      let l = await fetchOverviewRobust(leaseId, firmId);

      if (!l) {
        const legacy = await fetchLeaseLegacy(leaseId, firmId);
        if (legacy) {
          if (legacy.appId) {
            const a = await fetchApp(legacy.appId, firmId);
            legacy.householdName = householdNameFromApp(a);
          }
          const b = legacy.building;
          if (b) {
            const line1 = (b.addressLine1 || "").trim();
            const line2 = (b.addressLine2 || "").trim();
            const citySt = [b.city, b.state].filter(Boolean).join(", ");
            const zip = (b.postalCode || "").trim();
            legacy.buildingLabel = [line1, line2, citySt, zip].filter(Boolean).join(" • ");
          }
          l = legacy;
        }
      }

      if (!cancel) {
        setLease(l);
        setLoading(false);
        if (!l) setToast("Lease not found,");
      }
    })();
    return () => {
      cancel = true;
    };
  }, [leaseId, firmId]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setInspLoading(true);
      setInspErr(null);
      try {
        const s = await fetchInspectionSummary(leaseId);
        if (!cancel) setInsp(s);
      } catch (e: any) {
        console.error(e);
        if (!cancel) setInspErr(e?.message || "Couldn’t load inspection status,");
      } finally {
        if (!cancel) setInspLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [leaseId]);

  const buildingLabel = useMemo(() => lease?.buildingLabel || "Unknown address", [lease]);

  const statusPill = (status?: string) => {
    const cls = clsx(
      "inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
      status === "active" && "bg-emerald-50 text-emerald-800 ring-emerald-200",
      status === "scheduled" && "bg-blue-50 text-blue-700 ring-blue-200",
      status === "ended" && "bg-gray-100 text-gray-800 ring-gray-200",
      status === "canceled" && "bg-rose-50 text-rose-700 ring-rose-200",
      !["active", "scheduled", "ended", "canceled"].includes(String(status || "")) &&
        "bg-gray-100 text-gray-800 ring-gray-200",
    );
    const label = (status && status[0].toUpperCase() + status.slice(1)) || "—";
    return <span className={cls}>{label}</span>;
  };

  const rentLabel = moneyFmt.format((lease?.monthlyRent ?? 0) / 100);

  async function handleSendInspectionLink() {
    const email = inspectionEmail.trim();
    if (!email) {
      setToast("Enter an email to send the inspection link,");
      return;
    }
    try {
      setSendingInspection(true);
      await enablePreMoveInInspection({ leaseId, firmId, email });
      setToast("Pre-move-in inspection link sent,");
      setShowInspectionPanel(false);
      setInspectionEmail("");
    } catch (err: any) {
      setToast(err?.message || "Unable to send inspection link,");
    } finally {
      setSendingInspection(false);
    }
  }

  const inspLabel = (() => {
    if (!insp) return "No inspection yet";
    if (insp.status === "submitted") return "Submitted inspection";
    if (insp.status === "draft") return "Draft inspection";
    return "No inspection yet";
  })();

  const inspPillClasses = (() => {
    if (!insp || insp.status === "none") return "bg-gray-50 text-gray-700 border border-gray-200";
    if (insp.status === "submitted") return "bg-emerald-50 text-emerald-700 border border-emerald-200";
    return "bg-amber-50 text-amber-800 border border-amber-200";
  })();

  const inspLast = insp?.lastInspectionAt ? fmtDate(insp.lastInspectionAt) : null;

  const inspButtonLabel = (() => {
    if (!insp || insp.status === "none") return "Start inspection";
    if (insp.status === "draft") return "Continue inspection";
    return "View inspection";
  })();

  // URL for the Statement of Condition receipt, with firmId passthrough
  const statementUrl = useMemo(
    () =>
      withFirmId(
        `/api/receipts/statement-of-condition/${encodeURIComponent(leaseId)}`,
        firmId,
      ),
    [leaseId, firmId],
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-6 pb-10">
      {/* Header */}
      <div className="mt-6 mb-4">
        <div className="text-xs text-gray-500">Lease</div>
        <div className="mt-1 text-lg font-semibold text-gray-900 break-words">{buildingLabel}</div>
        <div className="mt-0.5 text-sm text-gray-700">
          Unit <span className="font-medium">{lease?.unitNumber ?? "—"}</span>
          <span className="mx-2">•</span>
          {statusPill(lease?.status)}
        </div>
      </div>

      {/* Top facts */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Household" value={lease?.householdName || "Household"} />
        <Fact label="Monthly rent" value={rentLabel} />
        <Fact label="Move-in" value={fmtDate(lease?.moveInDate)} />
        <Fact label="Move-out" value={fmtDate(lease?.moveOutDate ?? null)} />
      </div>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        {lease?.appId && (
          <Link
            href={`/landlord/reviews/${encodeURIComponent(lease.appId)}${
              firmId ? `?firmId=${encodeURIComponent(firmId)}` : ""
            }`}
            className="rounded-md bg-white px-3 py-2 text-xs font-medium text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50"
          >
            View application
          </Link>
        )}
        <Link
          href={`/landlord/leases${firmId ? `?firmId=${encodeURIComponent(firmId)}` : ""}`}
          className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800"
        >
          Lease overview
        </Link>

        {/* Pre-move-in inspection link */}
        <button
          type="button"
          onClick={() => setShowInspectionPanel((v) => !v)}
          className="rounded-md bg-white px-3 py-2 text-xs font-medium text-gray-900 ring-1 ring-indigo-300 hover:bg-indigo-50"
          disabled={!lease}
        >
          {showInspectionPanel ? "Cancel pre-move-in link" : "Send pre-move-in inspection link"}
        </button>
      </div>

      {/* Pre-move-in email panel */}
      {showInspectionPanel && (
        <div className="mt-3 max-w-xl rounded-lg border border-indigo-100 bg-indigo-50/80 px-4 py-3 text-xs text-gray-800">
          <div className="mb-1 font-semibold text-[11px] uppercase tracking-wide text-indigo-700">
            Pre-move-in inspection
          </div>
          <p className="mb-2 text-[11px] text-gray-700">
            Send a one-time link so a landlord staff member can walk the unit, take photos, and complete the
            pre-move-in inspection in the same flow as a tenant inspection,
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="email"
              value={inspectionEmail}
              onChange={(e) => setInspectionEmail(e.target.value)}
              placeholder="staff@example.com"
              className="w-full rounded-md border border-indigo-200 bg-white px-2.5 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
            />
            <button
              type="button"
              onClick={handleSendInspectionLink}
              disabled={sendingInspection}
              className={clsx(
                "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-semibold",
                sendingInspection
                  ? "bg-indigo-200 text-indigo-700 cursor-wait"
                  : "bg-indigo-600 text-white hover:bg-indigo-500",
              )}
            >
              {sendingInspection ? "Sending…" : "Send link"}
            </button>
          </div>
        </div>
      )}

      {/* Divider */}
      <div className="my-6 h-px w-full bg-gray-200" />

      {/* Inspection viewer */}
      <section className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900">Inspection</div>
            {inspLoading && (
              <div className="mt-1 text-[11px] text-gray-500">Loading inspection status…</div>
            )}
            {!inspLoading && inspErr && (
              <div className="mt-1 text-[11px] text-rose-600">{inspErr}</div>
            )}
            {!inspLoading && !inspErr && (
              <div className="mt-1 flex flex-col gap-0.5 text-[11px] text-gray-600">
                <span
                  className={clsx(
                    "inline-flex items-center rounded-full px-2 py-0.5 font-medium",
                    inspPillClasses,
                  )}
                >
                  {inspLabel}
                </span>
                {inspLast && (
                  <span className="text-[11px] text-gray-500">
                    Last updated <span className="font-medium">{inspLast}</span>
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <Link
              href={`/landlord/inspection/${encodeURIComponent(leaseId)}`}
              className={clsx(
                "inline-flex items-center rounded-md px-3 py-1.5 text-[11px] font-semibold ring-1",
                !insp || insp.status === "none"
                  ? "bg-blue-600 text-white ring-blue-600 hover:bg-blue-500"
                  : "bg-white text-blue-700 ring-blue-200 hover:bg-blue-50",
              )}
            >
              {inspButtonLabel}
            </Link>

            {/* NEW: button to toggle Statement of Condition iframe, only when submitted */}
            {insp?.status === "submitted" && (
              <button
                type="button"
                onClick={() => setShowCondition((v) => !v)}
                className={clsx(
                  "inline-flex items-center rounded-md px-3 py-1.5 text-[11px] font-semibold ring-1",
                  showCondition
                    ? "bg-emerald-600 text-white ring-emerald-600 hover:bg-emerald-500"
                    : "bg-white text-emerald-700 ring-emerald-200 hover:bg-emerald-50",
                )}
              >
                {showCondition ? "Hide Statement of Condition" : "View Statement of Condition"}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* NEW: Statement of Condition iframe */}
      {showCondition && (
        <section className="mb-6">
          <div className="mb-2 text-sm font-semibold text-gray-900">
            Statement of Condition (Massachusetts)
          </div>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <iframe
              src={statementUrl}
              className="h-[600px] w-full"
              loading="lazy"
              sandbox="allow-same-origin allow-scripts allow-forms"
            />
          </div>
          <p className="mt-1 text-[11px] text-gray-500">
            This preview loads the Massachusetts Statement of Condition generated from the completed
            pre-move-in inspection for this lease,
          </p>
        </section>
      )}

      {/* Checklist */}
      <section>
        <div className="text-sm font-semibold text-gray-900">Move-in checklist</div>
        {loading ? (
          <div className="mt-3 text-sm text-gray-600">Loading…</div>
        ) : !lease?.checklist || lease.checklist.length === 0 ? (
          <div className="mt-3 text-sm text-gray-600">No checklist items,</div>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {lease.checklist.map((it) => {
              const done = !!it.completedAt;
              return (
                <li key={it.key} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div
                      className={clsx("text-sm", done ? "text-gray-600 line-through" : "text-gray-900")}
                    >
                      {it.label}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      Due {fmtDate(it.dueAt)}
                      {it.notes ? ` • ${it.notes}` : ""}
                    </div>
                  </div>
                  <span
                    className={clsx(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] ring-1",
                      done
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                        : "bg-amber-50 text-amber-800 ring-amber-200",
                    )}
                  >
                    {done ? "Completed" : "Pending"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
          <div className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
            {toast}{" "}
            <button className="ml-3 underline" onClick={() => setToast(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function Fact({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 break-words text-base font-semibold text-gray-900">
        {value == null || value === "" ? "—" : String(value)}
      </div>
    </div>
  );
}
