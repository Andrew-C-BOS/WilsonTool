// app/landlord/leases/[id]/handoff/LeaseHandoffDesktop.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/* ---------- Tiny utils ---------- */

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

const moneyFmt = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/* ---------- Types ---------- */

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

type CanonicalStatus =
  | AppStatus
  | "countersign_ready"; // extra alias for some flows

const STATUS_LABELS: Record<CanonicalStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  admin_screened: "In review",
  approved_high: "Approved",
  terms_set: "Terms set",
  min_due: "Payment due",
  min_paid: "Ready to sign",
  countersigned: "Countersigned",
  occupied: "Occupied",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  countersign_ready: "Countersign ready",
};

function prettyStatus(raw: string | null | undefined): string {
  if (!raw) return "—";
  const s = raw as CanonicalStatus;
  if (s in STATUS_LABELS) return STATUS_LABELS[s];
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type Building = {
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string | null;
};

type PaymentPlan = {
  monthlyRentCents: number;
  termMonths: number;
  startDate: string;
  securityCents: number;
  keyFeeCents: number;
  requireFirstBeforeMoveIn: boolean;
  requireLastBeforeMoveIn: boolean;
  countersignUpfrontThresholdCents: number;
  countersignDepositThresholdCents: number;
  upfrontTotals: {
    firstCents: number;
    lastCents: number;
    keyCents: number;
    securityCents: number;
    otherUpfrontCents: number;
    totalUpfrontCents: number;
  };
  priority: string[];
};

type AppLite = {
  id: string;
  status?: string | null;
  building?: Building | null;
  unit?: { unitNumber?: string | null } | null;
  paymentPlan?: PaymentPlan | null;
  countersign?: {
    allowed?: boolean | null;
    upfrontMinCents?: number | null;
    depositMinCents?: number | null;
  } | null;
};

type ChecklistItem = {
  id: string;
  label: string;
  helpText?: string;
  kind: "template" | "custom";
  selected: boolean;
};

type FirmDoc = {
  id: string;
  title: string;
  externalDescription?: string | null;
};

/* ---------- Data fetch ---------- */

async function fetchApp(appId: string, firmId?: string): Promise<AppLite | null> {
  try {
    const qs = firmId ? `?firmId=${encodeURIComponent(firmId)}` : "";
    const res = await fetch(
      `/api/landlord/applications/${encodeURIComponent(appId)}${qs}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    const j = await res.json();
    const a = j?.application;
    if (!a) return null;

    return {
      id: String(a.id ?? a._id),
      status: a?.status ?? null,
      building: a?.building ?? null,
      unit: a?.unit ?? null,
      paymentPlan: a?.paymentPlan ?? null,
      countersign: a?.countersign ?? null,
    };
  } catch {
    return null;
  }
}

async function fetchFirmDocuments(firmId?: string): Promise<FirmDoc[]> {
  try {
    const qs = firmId ? `?firmId=${encodeURIComponent(firmId)}` : "";
    const res = await fetch(`/api/landlord/documents${qs}`, { cache: "no-store" });
    if (!res.ok) return [];
    const j = await res.json();
    const list: any[] = Array.isArray(j.documents) ? j.documents : [];
    return list.map((d) => ({
      id: String(d.id ?? d._id ?? ""),
      title: String(d.title || "Untitled document"),
      externalDescription: d.externalDescription ?? null,
    }));
  } catch {
    return [];
  }
}

/* ---------- Component ---------- */

export default function LeaseHandoffDesktop({
  appId,
  firmId,
}: {
  appId: string;
  firmId?: string;
}) {
  const router = useRouter();

  const [app, setApp] = useState<AppLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  // AppFolio completion toggle
  const [completedInAppFolio, setCompletedInAppFolio] = useState<"yes" | "no" | null>(null);

  // Firm docs
  const [docs, setDocs] = useState<FirmDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set()); // doc IDs
  const [sending, setSending] = useState(false);

  // Tenant checklist: templates + custom
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>(() => {
    const mk = (id: string, label: string, helpText: string): ChecklistItem => ({
      id,
      label,
      helpText,
      kind: "template",
      selected: false,
    });
    return [
	  mk(
		"schedule_walkthrough",
		"Schedule pre-move walkthrough",
		"Let the tenant pick a time for a condition walkthrough so they can document the unit before move-in."
	  ),
	  mk(
		"pay_upfront",
		"Complete up-front payments",
		"Ask the tenant to pay any required up-front charges (first month, last month, key fees, etc.) before move-in."
	  ),
	  mk(
		"pay_deposit",
		"Pay security deposit",
		"Prompt the tenant to pay the security deposit so you can provide a compliant deposit receipt and disclosure."
	  ),
      mk(
        "renter_insurance",
        "Upload renter’s insurance policy",
        "Ask the tenant to upload a PDF or photo showing active coverage for the lease start date."
      ),
      mk(
        "appfolio_portal",
        "Activate AppFolio tenant portal",
        "Confirm the tenant has logged into AppFolio and can see their balance, messages, and maintenance."
      ),
      mk(
        "move_in_time",
        "Confirm move-in date and time",
        "Have the tenant confirm their expected move-in time so you can coordinate keys and access."
      ),
      mk(
        "contact_phone",
        "Confirm best phone number",
        "Collect a reliable phone number for day-of move coordination or urgent issues."
      ),
      mk(
        "vehicle_info",
        "Provide vehicle and plate information",
        "If parking is included, collect car make, model, and license plate for your records."
      ),
      mk(
        "mailing_address",
        "Confirm mailing address for notices",
        "If different from the premises, ask where legal notices and mail should be sent."
      ),
      mk(
        "utilities",
        "Confirm utilities setup",
        "Ask the tenant to confirm they have scheduled gas/electric/internet setup before move-in."
      ),
      mk(
        "keys_fobs",
        "Acknowledge key / fob policy",
        "Clarify how many keys/fobs will be issued, replacement fees, and any building access rules."
      ),
      mk(
        "pet_info",
        "Provide pet information (if applicable)",
        "Collect details on any pets, including type, weight, and any documentation you require."
      ),
      mk(
        "emergency_contacts",
        "Add an emergency contact",
        "Ask the tenant to provide a contact for emergencies or welfare checks."
      ),
    ];
  });
  const [newChecklistLabel, setNewChecklistLabel] = useState("");
  const [newChecklistHelp, setNewChecklistHelp] = useState("");

  // Fetch app
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const a = await fetchApp(appId, firmId);
      if (!cancelled) {
        setApp(a);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appId, firmId]);

  // Fetch firm documents
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setDocsLoading(true);
      const rows = await fetchFirmDocuments(firmId);
      if (!cancelled) {
        setDocs(rows);
        setDocsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firmId]);

  const status = (app?.status || "submitted") as AppStatus;
  const statusLabel = prettyStatus(app?.status);

  const isMinPaid = status === "min_paid";
  const isCountersigned = status === "countersigned";

  function toggleDoc(docId: string) {
    setSelectedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  }

  function toggleChecklist(id: string) {
    setChecklistItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, selected: !item.selected } : item
      )
    );
  }

  function addCustomChecklistItem() {
    const label = newChecklistLabel.trim();
    const help = newChecklistHelp.trim();
    if (!label) return;
    const id = `custom_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    setChecklistItems((prev) => [
      ...prev,
      {
        id,
        label,
        helpText: help || undefined,
        kind: "custom",
        selected: true,
      },
    ]);
    setNewChecklistLabel("");
    setNewChecklistHelp("");
  }

  async function onSend() {
    if (!app) return;
    if (!selectedDocs.size) {
      setToast("Select at least one document to send,");
      setTimeout(() => setToast(null), 1200);
      return;
    }

    const selectedChecklist = checklistItems.filter((i) => i.selected);

    try {
      setSending(true);
      const body = {
        appId: app.id,
        firmId: firmId ?? null,
        completedInAppFolio: completedInAppFolio === "yes",
        // Send list of doc IDs
        docs: Array.from(selectedDocs),
        checklist: selectedChecklist.map((i) => ({
          id: i.id,
          label: i.label,
          helpText: i.helpText ?? null,
          kind: i.kind,
        })),
      };

      // Stub endpoint – wire server-side later
      const res = await fetch("/api/landlord/leases/handoff/send-docs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => null);

      if (!res || !res.ok) {
        let msg = "Failed to send documents,";
        try {
          const j = await res?.json();
          if (j?.error) msg = String(j.error);
        } catch {}
        setToast(msg);
        return;
      }

      setToast("Documents and checklist queued for tenant,");
      setTimeout(() => {
        setToast(null);
        const appsHref = firmId
          ? `/landlord/applications?firmId=${encodeURIComponent(firmId)}`
          : "/landlord/applications";
        router.push(appsHref);
      }, 900);
    } finally {
      setSending(false);
    }
  }

  const rentDisplay = useMemo(() => {
    const cents = app?.paymentPlan?.monthlyRentCents ?? null;
    return cents && cents > 0 ? moneyFmt.format(cents / 100) : "—";
  }, [app?.paymentPlan?.monthlyRentCents]);

  const countersignSummary = useMemo(() => {
    const up = app?.paymentPlan?.countersignUpfrontThresholdCents ?? 0;
    const dep = app?.paymentPlan?.countersignDepositThresholdCents ?? 0;
    if (!up && !dep) return "No countersign minimum configured,";
    const parts = [];
    if (up > 0) parts.push(`standard payments ${moneyFmt.format(up / 100)}`);
    if (dep > 0) parts.push(`deposit ${moneyFmt.format(dep / 100)}`);
    return `Countersign minimum: ${parts.join(" + ")}`;
  }, [
    app?.paymentPlan?.countersignUpfrontThresholdCents,
    app?.paymentPlan?.countersignDepositThresholdCents,
  ]);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 pb-8 space-y-6">
      {/* Header */}
      <header className="mt-5 mb-2">
        <h1 className="text-base font-semibold text-gray-900">Lease wrap-up</h1>
        <p className="mt-1 text-xs text-gray-600">
          Application {appId} · Status: <span className="font-medium">{statusLabel}</span>
        </p>
      </header>

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
          Loading…
        </div>
      ) : !app ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
          Application not found,
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-6">
          {/* Left */}
          <section className="col-span-12 lg:col-span-8 space-y-4">
            {/* Status context / warnings */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm space-y-3">
              {isMinPaid && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                  <div className="font-semibold text-amber-900">
                    Tenant has paid the countersign minimum,
                  </div>
                  <p className="mt-1">
                    The tenant has paid part of their upfront rent and/or fees in order to reach
                    the countersign threshold.{" "}
                    <span className="font-medium">
                      If you cannot complete the lease for any reason, you are responsible for
                      refunding the tenant&apos;s paid rent / fee amounts promptly.
                    </span>{" "}
                    Security deposits may be subject to separate legal rules and timelines.
                  </p>
                </div>
              )}

              {isCountersigned && (
                <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
                  <div className="font-semibold text-emerald-900">
                    Lease is countersigned,
                  </div>
                  <p className="mt-1">
                    The lease is fully countersigned in MILO. Use this screen to confirm that your
                    AppFolio lease is complete and to send key documents and a checklist back to the
                    tenant.
                  </p>
                </div>
              )}

              {!isMinPaid && !isCountersigned && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-700">
                  <div className="font-semibold text-gray-900">
                    This handoff screen is typically used after countersign,
                  </div>
                  <p className="mt-1">
                    Status is currently{" "}
                    <span className="font-medium">{statusLabel}</span>. Once the tenant reaches the
                    countersign minimum and you countersign the lease, you can use this screen to
                    confirm AppFolio setup and configure tenant-facing documents and checklist
                    items.
                  </p>
                </div>
              )}

              <dl className="mt-3 space-y-1 text-xs text-gray-700">
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Property</dt>
                  <dd className="text-right">
                    {app.building
                      ? `${app.building.addressLine1}${
                          app.building.addressLine2 ? `, ${app.building.addressLine2}` : ""
                        }, ${app.building.city}, ${app.building.state} ${app.building.postalCode}${
                          app.unit?.unitNumber ? ` — ${app.unit.unitNumber}` : ""
                        }`
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Monthly rent</dt>
                  <dd className="text-right">{rentDisplay}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Countersign rules</dt>
                  <dd className="text-right">{countersignSummary}</dd>
                </div>
              </dl>
            </div>

            {/* AppFolio completion */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm space-y-3">
              <div className="text-sm font-semibold text-gray-900">
                AppFolio lease completion
              </div>
              <p className="mt-1 text-xs text-gray-600">
                Confirm whether you have fully created and finalized this lease in AppFolio
                (including all signatures and move-in details).
              </p>

              <div className="mt-3 space-y-2">
                <label className="flex items-center gap-2 text-xs text-gray-900 cursor-pointer">
                  <input
                    type="radio"
                    name="appfolio-complete"
                    className="h-3.5 w-3.5 border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    checked={completedInAppFolio === "yes"}
                    onChange={() => setCompletedInAppFolio("yes")}
                  />
                  <span>Yes, the lease is fully completed in AppFolio,</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-900 cursor-pointer">
                  <input
                    type="radio"
                    name="appfolio-complete"
                    className="h-3.5 w-3.5 border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    checked={completedInAppFolio === "no"}
                    onChange={() => setCompletedInAppFolio("no")}
                  />
                  <span>No, I still need to finish the lease in AppFolio,</span>
                </label>
              </div>

              {completedInAppFolio === "no" && (
                <p className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  You can still send documents now, but you should complete the AppFolio lease as
                  soon as possible so your accounting and tenant portal stay in sync.
                </p>
              )}
            </div>

            {/* Documents (from landlord_documents) */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm space-y-3">
              <div className="text-sm font-semibold text-gray-900">
                Documents to send to tenant
              </div>
              <p className="mt-1 text-xs text-gray-600">
                These are documents your firm has uploaded (e.g., mold disclosures, house rules,
                move-in instructions). Select which ones you want MILO to send with this lease.
              </p>

              <div className="mt-3 space-y-2">
                {docsLoading ? (
                  <div className="text-[11px] text-gray-500">Loading firm documents…</div>
                ) : docs.length === 0 ? (
                  <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
                    No firm documents found. Upload documents on the{" "}
                    <span className="font-medium">Landlord documents</span> page to make them
                    available here.
                  </div>
                ) : (
                  docs.map((doc) => (
                    <label
                      key={doc.id}
                      className="flex items-start gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-900 cursor-pointer hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-3.5 w-3.5 border-gray-300 text-emerald-600 focus:ring-emerald-500"
                        checked={selectedDocs.has(doc.id)}
                        onChange={() => toggleDoc(doc.id)}
                      />
                      <span className="flex-1">
                        <span className="font-medium">{doc.title}</span>
                        {doc.externalDescription && (
                          <span className="block text-[11px] text-gray-500 mt-0.5">
                            {doc.externalDescription}
                          </span>
                        )}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>

            {/* Checklist */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm space-y-3">
              <div className="text-sm font-semibold text-gray-900">
                Tenant checklist
              </div>
              <p className="mt-1 text-xs text-gray-600">
                Configure the items you want the tenant to complete before or shortly after
                move-in. Templates are provided below, and you can add your own custom items with
                optional instructions.
              </p>

              <div className="mt-3 space-y-2">
                {checklistItems.map((item) => (
                  <label
                    key={item.id}
                    className="flex items-start gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-900 cursor-pointer hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3.5 w-3.5 border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      checked={item.selected}
                      onChange={() => toggleChecklist(item.id)}
                    />
                    <span className="flex-1">
                      <span className="font-medium">
                        {item.label}
                        {item.kind === "custom" && (
                          <span className="ml-1 inline-flex items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-600">
                            Custom
                          </span>
                        )}
                      </span>
                      {item.helpText && (
                        <span className="block text-[11px] text-gray-500 mt-0.5">
                          {item.helpText}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>

              {/* Add custom item */}
              <div className="mt-3 flex flex-col gap-2 text-xs">
                <label className="font-medium text-gray-900">Add a custom checklist item</label>
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    className="rounded-md border border-gray-300 px-2 py-1.5 text-xs"
                    placeholder="Item title (e.g., Upload pet vaccination records)"
                    value={newChecklistLabel}
                    onChange={(e) => setNewChecklistLabel(e.target.value)}
                  />
                  <input
                    type="text"
                    className="rounded-md border border-gray-300 px-2 py-1.5 text-xs"
                    placeholder="Optional help text shown under the title"
                    value={newChecklistHelp}
                    onChange={(e) => setNewChecklistHelp(e.target.value)}
                  />
                </div>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={addCustomChecklistItem}
                    className="rounded-md bg-white border border-gray-300 px-2.5 py-1.5 text-[11px] font-medium text-gray-900 hover:bg-gray-50"
                  >
                    Add item
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => router.back()}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium hover:bg-gray-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={onSend}
                  disabled={sending}
                  className={clsx(
                    "rounded-md px-3 py-2 text-xs font-medium text-white",
                    sending
                      ? "bg-gray-400 cursor-not-allowed"
                      : "bg-emerald-600 hover:bg-emerald-700"
                  )}
                >
                  {sending ? "Sending…" : "Send docs & checklist"}
                </button>
              </div>
            </div>
          </section>

          {/* Right: snapshot */}
          <aside className="col-span-12 lg:col-span-4 space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm">
              <div className="font-semibold text-gray-900">Lease snapshot</div>
              <dl className="mt-2 space-y-1 text-xs">
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Status</dt>
                  <dd className="text-gray-900">{statusLabel}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Unit</dt>
                  <dd className="text-gray-900">{app.unit?.unitNumber || "—"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Rent</dt>
                  <dd className="text-gray-900">{rentDisplay}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Move-in</dt>
                  <dd className="text-gray-900">
                    {app.paymentPlan?.startDate || "—"}
                  </dd>
                </div>
              </dl>
            </div>
          </aside>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
          <div className="rounded-md bg-gray-900 text-white text-sm px-4 py-2 shadow-lg">
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
