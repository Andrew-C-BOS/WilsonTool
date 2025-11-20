"use client";

import type React from "react";
import type { LeaseDoc } from "./LeaseRouter";
import { useEffect, useMemo, useState } from "react";
import SecurityDepositDisclosureModal from "../../components/modals/SecurityDepositDisclosureModal";

function clsx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

/* ------- tiny formatters ------- */
const moneyFmt = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const dateFmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});
const toDate = (s?: string | null) => {
  if (!s) return null;
  const str = String(s);

  // Always pull out the calendar part if it looks like YYYY-MM-DD...
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const [, y, mm, d] = m;
    return new Date(Number(y), Number(mm) - 1, Number(d)); // local calendar date
  }

  // Fallback for weird formats
  const d2 = new Date(str);
  return Number.isNaN(d2.getTime()) ? null : d2;
};
const asMoney = (cents?: number | null) => moneyFmt.format((cents ?? 0) / 100);

/* date helpers */
function addMonths(d: Date, months: number) {
  return new Date(d.getFullYear(), d.getMonth() + months, d.getDate());
}

/* Hard target for payments portal (relative path only) */
const PAYMENTS_URL = "/tenant/payments";

/* ------- status pill ------- */
function StatusPill({ status }: { status: string }) {
  const tone =
    status === "scheduled"
      ? "emerald"
      : status === "active"
      ? "blue"
      : status === "ended"
      ? "gray"
      : "gray";

  const map: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    blue: "bg-blue-50 text-blue-800 ring-blue-200",
    gray: "bg-gray-100 text-gray-800 ring-gray-200",
  };

  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        map[tone],
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
}

/* ------- router-agnostic Payments link (GET form) ------- */
function PaymentsLink({
  appId,
  firmId,
  type,
  children,
  className,
  newTab,
  "data-testid": dataTestId,
}: {
  appId?: string | null;
  firmId?: string | null;
  type?: "" | "upfront" | "deposit";
  children: React.ReactNode;
  className?: string;
  newTab?: boolean;
  "data-testid"?: string;
}) {
  return (
    <form
      method="GET"
      action={PAYMENTS_URL}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noreferrer" : undefined}
    >
      {appId ? <input type="hidden" name="appId" value={appId} /> : null}
      {firmId ? <input type="hidden" name="firmId" value={firmId} /> : null}
      {type ? <input type="hidden" name="type" value={type} /> : null}
      <button
        type="submit"
        data-testid={dataTestId}
        className={
          className ??
          "inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
        }
      >
        {children}
      </button>
    </form>
  );
}

/* ------- disclosure status types/helpers ------- */
type DisclosureSummary = {
  ok: boolean;
  paid: boolean;
  paymentId: string | null;
  amountCents: number | null;
  currency: string;
  bankReceiptDueISO: string | null;
  disclosureReady: boolean;
  receiptPath: string | null;
  escrowSummary: {
    bankName: string | null;
    bankAddress: string | null;
    accountIdentifier: string | null;
    accountLast4: string | null;
    interestRate: number | null;
  };
};

const fetchDisclosureSummary = async (
  appId: string,
  firmId?: string | null,
): Promise<DisclosureSummary | null> => {
  const qs = new URLSearchParams({ appId });
  if (firmId) qs.set("firmId", firmId);
  const res = await fetch(`/api/tenant/deposit/disclosure?${qs.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json();
};

/* ------- landlord doc type ------- */
type LandlordDoc = {
  id: string;
  title: string;
  externalDescription?: string | null;
  url?: string | null;
  s3Key?: string | null;
};

/* ------- main ------- */
export default function LeaseDesktop({
  lease,
  onLeaseUpdated,
}: {
  lease: LeaseDoc;
  onLeaseUpdated: (next: LeaseDoc) => void;
}) {
  const [toast, setToast] = useState<string | null>(null);
  
  const [inspectionOpen, setInspectionOpen] = useState(false);
  const [inspectionAvailable, setInspectionAvailable] = useState<
    boolean | null
  >(null);

  // app/firm IDs for payments — prefer lease fields, else lift from /api/tenant/lease
  const [resolvedAppId, setResolvedAppId] = useState<string | null>(() => {
    const a = (lease as any)?.appId || (lease as any)?.applicationId;
    return a ? String(a) : null;
  });
  const [resolvedFirmId, setResolvedFirmId] = useState<string | null>(() => {
    const f = (lease as any)?.firmId;
    return f ? String(f) : null;
  });

  // track docs separately so we can hydrate from /api/tenant/lease
  const [landlordDocs, setLandlordDocs] = useState<LandlordDoc[]>(() => {
    const raw = ((lease as any).documents ?? []) as LandlordDoc[];
    return raw;
  });

  // payment calendar toggle
  const [showCalendar, setShowCalendar] = useState(false);

  // Lease ID for document download routes
  const leaseId = useMemo(() => {
    const raw = (lease as any)?._id ?? (lease as any)?.id;
    return raw ? String(raw) : "";
  }, [lease]);

  useEffect(() => {
    // If appId already present on the lease prop, we’re done.
    const a = (lease as any)?.appId || (lease as any)?.applicationId;
    const f = (lease as any)?.firmId;
    if (a) {
      setResolvedAppId(String(a));
      if (f) setResolvedFirmId(String(f));
      if (Array.isArray((lease as any).documents)) {
        setLandlordDocs(((lease as any).documents ?? []) as LandlordDoc[]);
      }
      return;
    }

    // Otherwise, lift from /api/tenant/lease by matching this lease’s _id.
    let abort = false;
    (async () => {
      try {
        const res = await fetch("/api/tenant/lease", { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json().catch(() => null);
        const all: any[] = j?.leases?.all ?? [];
        const me = all.find(
          (x) => String(x?._id) === String((lease as any)?._id),
        );
        if (!abort && me) {
          if (me.appId) setResolvedAppId(String(me.appId));
          if (me.firmId) setResolvedFirmId(String(me.firmId));
          if (Array.isArray(me.documents)) {
            setLandlordDocs(me.documents as LandlordDoc[]);
          }
        }
      } catch {
        /* ignore, non-blocking */
      }
    })();

    return () => {
      abort = true;
    };
  }, [lease]);
  
  useEffect(() => {
    if (!leaseId) return;

    let abort = false;

    (async () => {
      try {
        // Use debug=1 so the route returns JSON we can safely ignore,
        // we only care whether it exists (2xx) or not (404),
        const res = await fetch(
          `/api/receipts/statement-of-condition/${encodeURIComponent(
            leaseId,
          )}?debug=1`,
          { cache: "no-store" },
        );

        if (abort) return;

        if (res.ok) {
          setInspectionAvailable(true);
        } else if (res.status === 404) {
          setInspectionAvailable(false);
        } else {
          setInspectionAvailable(false);
        }
      } catch {
        if (!abort) setInspectionAvailable(false);
      }
    })();

    return () => {
      abort = true;
    };
  }, [leaseId]);

  function flash(msg: string) {
    setToast(msg);
    (window as any).clearTimeout((flash as any)._t);
    (flash as any)._t = window.setTimeout(() => setToast(null), 1600);
  }

  async function toggleChecklist(key: string, done: boolean) {
    const prev = lease;
    const next: LeaseDoc = {
      ...prev,
      checklist: (prev.checklist ?? []).map((it) =>
        it.key === key
          ? { ...it, completedAt: done ? new Date().toISOString() : null }
          : it,
      ),
    };
    onLeaseUpdated(next);
    try {
      const res = await fetch("/api/tenant/lease/checklist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, done }),
      });
      if (!res.ok) throw new Error("update_failed");
      flash("Saved,");
    } catch {
      onLeaseUpdated(prev);
      flash("Couldn’t save,");
    }
  }

  /* ------- disclosure modal state & handler ------- */
  const [discOpen, setDiscOpen] = useState(false);
  const [disc, setDisc] = useState<DisclosureSummary | null>(null);
  const canQueryDisclosure = Boolean(resolvedAppId && resolvedFirmId);

  async function openDisclosure() {
    if (!resolvedAppId) return;
    const j = await fetchDisclosureSummary(resolvedAppId, resolvedFirmId);
    setDisc(j);
    setDiscOpen(true);
  }

  const moveIn = toDate((lease as any).moveInDate ?? lease.startDate ?? null);
  const moveOut = toDate((lease as any).moveOutDate ?? lease.endDate ?? null);

  const addressLines = useMemo(() => {
    const a = lease.address || ({} as any);
    const L1 = a.addressLine1 ?? "—";
    const L2 = a.addressLine2 ? (
      <>
        <br />
        {a.addressLine2}
      </>
    ) : null;
    const cityStateZip =
      [a.city, a.state].filter(Boolean).join(", ") +
      (a.postalCode ? ` ${a.postalCode}` : "");
    return (
      <div>
        {L1}
        {L2}
        <br />
        {cityStateZip || "—"}
      </div>
    );
  }, [lease.address]);

  const paymentFiles = lease.files ?? [];

  const buildingLine1 =
    (lease as any)?.building?.addressLine1 ??
    lease.address?.addressLine1 ??
    "Your lease";

  const unitLabel =
    (lease as any)?.unitNumber ??
    (lease as any)?.unit?.unitNumber ??
    lease.unitLabel ??
    "";

  // Tenant members for Parties card
  const tenantMembers = ((lease as any).tenantMembers ?? []) as {
    userId?: string | null;
    role?: string | null;
    email?: string | null;
    legalName?: string | null;
    displayName?: string | null;
  }[];

  // Payment plan → premium calendar rows
  const paymentPlan = (lease as any).paymentPlan as
    | {
        monthlyRentCents?: number;
        termMonths?: number;
        startDate?: string;
        securityCents?: number;
        upfrontTotals?: {
          firstCents?: number;
          lastCents?: number;
          keyCents?: number;
          securityCents?: number;
          otherUpfrontCents?: number;
          totalUpfrontCents?: number;
        };
      }
    | undefined;

  const paymentCalendar = useMemo(() => {
    if (!paymentPlan) return [];

    const term = paymentPlan.termMonths ?? 0;
    const rentCents = paymentPlan.monthlyRentCents ?? lease.rentCents ?? 0;
    const start = toDate(paymentPlan.startDate ?? lease.startDate);
    if (!start || term <= 0 || rentCents <= 0) return [];

    const rows: {
      label: string;
      due: Date | null;
      amountCents: number;
      kind: "upfront" | "deposit" | "rent";
    }[] = [];

    // Upfront / deposit row from plan if present
    const securityCents = paymentPlan.securityCents ?? 0;
    if (securityCents > 0) {
      rows.push({
        label: "Security deposit",
        due: moveIn ?? start,
        amountCents: securityCents,
        kind: "deposit",
      });
    }

    // Monthly rent rows
    for (let i = 0; i < term; i++) {
      const dueDate = addMonths(start, i);
      rows.push({
        label: `Month ${i + 1} rent`,
        due: dueDate,
        amountCents: rentCents,
        kind: "rent",
      });
    }

    return rows;
  }, [paymentPlan, lease.rentCents, lease.startDate, moveIn]);

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#e6edf1]">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Big shell card, similar to tenant home */}
        <div className="rounded-3xl bg-[#f4fafc] p-6 shadow-[0_18px_45px_rgba(15,23,42,0.16)] sm:p-7 lg:p-8">
          {/* Header */}
          <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-3 rounded-full bg-slate-100 px-3 py-1">
                {/* Dark side: building chip */}
                <span className="inline-flex items-center justify-center rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold text-white">
                  {buildingLine1}
                </span>
                {/* Light side: unit label */}
                <div className="text-xs font-medium text-slate-600">
                  {unitLabel ? `Unit ${unitLabel}` : "Lease"}
                </div>
              </div>
              <h1 className="mt-3 text-xl font-semibold text-slate-900 sm:text-2xl">
                My lease
              </h1>
              <p className="mt-1 text-xs text-slate-600">
                View your lease details, manage payments, and stay on top of
                your move-in checklist.
              </p>
            </div>

            <div className="flex flex-col items-end gap-2 text-right">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200 shadow-sm">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  className="h-3.5 w-3.5 text-slate-500"
                >
                  <path
                    d="M4 8.5V7a6 6 0 1 1 12 0v1.5M5 9h10l-.7 7.02A1.5 1.5 0 0 1 12.8 17H7.2a1.5 1.5 0 0 1-1.49-1.35L5 9Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="leading-none">
                  Handled securely through MILO
                </span>
              </div>
            </div>
          </header>

          {/* Optional top banner inside shell */}
          {moveIn && (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
              Lease starts {dateFmt.format(moveIn)}. Make sure payments and
              checklist items are completed before move-in.
            </div>
          )}

          {/* Main grid */}
          <div className="grid grid-cols-12 gap-6 lg:gap-8">
            {/* Summary + payments + docs */}
            <section className="col-span-12 lg:col-span-7 space-y-4">
              <Card
                title="Lease summary"
                right={<StatusPill status={lease.status || "scheduled"} />}
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Info label="Unit / Rent">
                    <div className="leading-6">
                      <div className="font-medium">
                        {lease.unitLabel ?? "—"}
                      </div>
                      <div className="text-gray-700">
                        {asMoney(lease.rentCents)} / month
                      </div>
                    </div>
                  </Info>

                  <Info label="Term">
                    {moveIn ? dateFmt.format(moveIn) : "—"}{" "}
                    <span className="text-gray-400">→</span>{" "}
                    {moveOut ? dateFmt.format(moveOut) : "open-ended"}
                  </Info>

					<Info label="Parties">
					  <div className="space-y-3 text-sm text-slate-900">
						{/* Tenant / household */}
						<div>
						  <div>Tenant, {lease.parties?.tenantName ?? "—"}</div>

						  {tenantMembers.length > 0 && (
							<div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
							  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
								{(lease.parties?.tenantName ?? "Household")} members
							  </p>
							  <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
								{tenantMembers.map((m, idx) => (
								  <li
									key={m.userId ?? m.email ?? idx}
									className="flex items-center justify-between gap-2"
								  >
									<span className="truncate">
									  {m.displayName ??
										m.legalName ??
										m.email ??
										"Member"}
									</span>
									<span className="text-[10px] capitalize text-slate-500">
									  {m.role ?? "member"}
									</span>
								  </li>
								))}
							  </ul>
							</div>
						  )}
						</div>

						{/* Landlord */}
						<div>
						  Landlord, {lease.parties?.landlordName ?? "—"}
						</div>
					  </div>
					</Info>

                  <Info label="Deposit">
                    {lease.depositCents != null
                      ? asMoney(lease.depositCents)
                      : "—"}
                  </Info>

                  <Info className="sm:col-span-2" label="Address">
                    {addressLines}
                  </Info>
                </div>
              </Card>

              {/* Payments entry point */}
              <Card
                title="Payments"
                subtitle="Manage up-front and monthly payments for this lease,"
              >
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <p className="text-sm text-gray-700">
                        Review what you owe, see what you’ve already paid, and
                        make secure payments for your move-in and ongoing rent.
                      </p>
                      <p className="flex items-center gap-1 text-[11px] text-slate-500">
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 20 20"
                          className="h-3.5 w-3.5"
                        >
                          <path
                            d="M4 8.5V7a6 6 0 1 1 12 0v1.5M5 9h10l-.7 7.02A1.5 1.5 0 0 1 12.8 17H7.2a1.5 1.5 0 0 1-1.49-1.35L5 9Z"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        Payments are processed over encrypted connections,
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={openDisclosure}
                        disabled={!canQueryDisclosure}
                        className={clsx(
                          "inline-flex items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold shadow-sm",
                          canQueryDisclosure
                            ? "bg-emerald-600 text-white hover:bg-emerald-700"
                            : "bg-gray-200 text-gray-500 cursor-not-allowed",
                        )}
                        title={
                          canQueryDisclosure
                            ? "View Security Deposit Disclosure"
                            : "Disclosure available after app & firm are resolved"
                        }
                      >
                        Deposit disclosure
                      </button>

                      <PaymentsLink
                        appId={resolvedAppId}
                        firmId={resolvedFirmId}
                        className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
                        data-testid="open-payments-main"
                      >
                        Open payments
                      </PaymentsLink>
                    </div>
                  </div>

                  {/* Premium payment calendar */}
                  {paymentCalendar.length > 0 && (
                    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setShowCalendar((v) => !v)}
                        className="flex w-full items-center justify-between text-left text-xs font-medium text-slate-700"
                      >
                        <span className="flex items-center gap-2">
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 20 20"
                            className="h-4 w-4 text-slate-500"
                          >
                            <path
                              d="M6 3.5V5m8-1.5V5M4.5 8.5h11M5 5h10a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 15 16H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 5Z"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          Payment schedule
                          <span className="text-[11px] font-normal text-slate-500">
                            ({paymentCalendar.filter((r) => r.kind === "rent")
                              .length ?? 0}{" "}
                            rent payments)
                          </span>
                        </span>
                        <span
                          className={clsx(
                            "inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] text-slate-500 transition-transform",
                            showCalendar ? "rotate-90" : "",
                          )}
                        >
                          ▶
                        </span>
                      </button>

                      {showCalendar && (
                        <div className="mt-2 rounded-lg bg-white/90 ring-1 ring-slate-100">
                          <ul className="divide-y divide-slate-100 text-xs">
                            {paymentCalendar.map((row, idx) => (
                              <li
                                key={`${row.label}-${idx}`}
                                className="flex items-center justify-between px-3 py-2"
                              >
                                <div>
                                  <div className="font-medium text-slate-800">
                                    {row.label}
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                    {row.due
                                      ? `Due ${dateFmt.format(row.due)}`
                                      : "Due before move-in"}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-sm font-semibold text-slate-900">
                                    {asMoney(row.amountCents)}
                                  </div>
                                  <div className="text-[11px] uppercase tracking-wide text-slate-400">
                                    {row.kind === "deposit"
                                      ? "Deposit"
                                      : "Rent"}
                                  </div>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </Card>
			  
			  

              {/* Files / Documents */}
              <Card
                title="Lease documents"
                subtitle="View your lease, disclosures, and other files shared with you,"
              >
                {/* Landlord inspection / Statement of Condition */}
                {inspectionAvailable && leaseId && (
                  <div className="mb-3 flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 sm:flex-row sm:items-center sm:justify-between">
                    <div className="max-w-md">
                      The landlord’s pre–move in inspection and Statement of
                      Condition are available for this lease,
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setInspectionOpen(true)}
                        className="inline-flex items-center justify-center rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-slate-800"
                      >
                        View inspection here
                      </button>
                      <a
                        href={`/api/receipts/statement-of-condition/${encodeURIComponent(
                          leaseId,
                        )}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Open in new tab
                      </a>
                    </div>
                  </div>
                )}

                {landlordDocs.length === 0 && paymentFiles.length === 0 ? (
                  <Empty hint="No documents shared yet," />
                ) : (
                  <div className="space-y-6">
                    {landlordDocs.length > 0 && (
                      <section>
                        <div className="mb-2 flex items-center justify-between">
                          <div>
                            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                              Shared by your landlord
                            </p>
                            <p className="text-xs text-gray-500">
                              Lease documents and required disclosures
                            </p>
                          </div>
                        </div>

                        <div className="space-y-2">
                          {landlordDocs.map((doc) => {
                            const href = leaseId
                              ? `/api/tenant/lease/document?leaseId=${encodeURIComponent(
                                  leaseId,
                                )}&docId=${encodeURIComponent(doc.id)}`
                              : "#";

                            const isDisabled = !leaseId;
                            const Tag: any = isDisabled ? "div" : "a";

                            return (
                              <Tag
                                key={doc.id}
                                href={isDisabled ? undefined : href}
                                target={isDisabled ? undefined : "_blank"}
                                rel={isDisabled ? undefined : "noreferrer"}
                                aria-disabled={isDisabled || undefined}
                                className={clsx(
                                  "group flex items-center justify-between rounded-xl border px-3.5 py-3 text-sm shadow-sm transition",
                                  "bg-white/90 border-slate-200",
                                  !isDisabled &&
                                    "hover:border-blue-200 hover:bg-blue-50/80 hover:shadow-md",
                                  isDisabled && "cursor-not-allowed opacity-60",
                                )}
                              >
                                <div className="flex min-w-0 items-center gap-3">
                                  <div className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-slate-900 text-slate-50 shadow-sm ring-1 ring-slate-900/10 group-hover:bg-blue-600 group-hover:ring-blue-500 transition">
                                    <svg
                                      aria-hidden="true"
                                      viewBox="0 0 20 20"
                                      className="h-4 w-4"
                                    >
                                      <path
                                        d="M5 2.75A1.75 1.75 0 0 1 6.75 1h4.19c.46 0 .9.18 1.23.51l2.32 2.32c.33.33.51.77.51 1.23v11.19A1.75 1.75 0 0 1 13.25 18h-6.5A1.75 1.75 0 0 1 5 16.25v-13.5Z"
                                        fill="currentColor"
                                      />
                                      <path
                                        d="M11.5 1.5V4a1 1 0 0 0 1 1h2.5"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        strokeLinecap="round"
                                      />
                                    </svg>
                                  </div>

                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className="truncate font-medium text-slate-900 group-hover:text-blue-800">
                                        {doc.title}
                                      </p>
                                      <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                                        PDF
                                      </span>
                                    </div>
                                    {doc.externalDescription && (
                                      <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">
                                        {doc.externalDescription}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                {!isDisabled && (
                                  <div className="ml-3 flex flex-none items-center gap-1 text-[11px] font-medium text-blue-700 group-hover:text-blue-800">
                                    <span>Open</span>
                                    <svg
                                      aria-hidden="true"
                                      viewBox="0 0 20 20"
                                      className="h-3.5 w-3.5"
                                    >
                                      <path
                                        d="M7.25 4.5h8.25m0 0v8.25m0-8.25L9 11.25"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.4"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                  </div>
                                )}
                              </Tag>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    {paymentFiles.length > 0 && (
                      <section>
                        <div className="mb-2 flex items-center justify-between">
                          <div>
                            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                              Additional files
                            </p>
                            <p className="text-xs text-gray-500">
                              Receipts, payment confirmations, and other uploads
                            </p>
                          </div>
                        </div>

                        <div className="space-y-2">
                          {paymentFiles.map((f) => (
                            <a
                              key={f.url}
                              href={f.url}
                              target="_blank"
                              rel="noreferrer"
                              className="group flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-sm shadow-sm transition hover:border-blue-200 hover:bg-blue-50/70 hover:shadow-md"
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                <div className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-slate-50 text-slate-600 ring-1 ring-slate-200 group-hover:bg-blue-600 group-hover:text-white group-hover:ring-blue-500 transition">
                                  <span className="text-[10px] font-semibold uppercase">
                                    File
                                  </span>
                                </div>
                                <p className="truncate text-slate-900 group-hover:text-blue-800">
                                  {f.name}
                                </p>
                              </div>

                              <div className="ml-3 flex flex-none items-center gap-1 text-[11px] font-medium text-blue-700 group-hover:text-blue-800">
                                <span>Open</span>
                                <svg
                                  aria-hidden="true"
                                  viewBox="0 0 20 20"
                                  className="h-3.5 w-3.5"
                                >
                                  <path
                                    d="M7.25 4.5h8.25m0 0v8.25m0-8.25L9 11.25"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.4"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </div>
                            </a>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                )}
              </Card>
            </section>

            {/* Checklist */}
            <aside className="col-span-12 lg:col-span-5">
              <Card
                title="Move-in checklist"
                subtitle="Mark completed items as you go,"
              >
                {(lease.checklist ?? []).length ? (
                  <ul className="mt-1 divide-y divide-gray-100">
                    {(lease.checklist ?? []).map((it) => {
                      const done = !!it.completedAt;
                      const isInspection = it.key === "schedule_walkthrough";
                      const isPayUpfront = it.key === "pay_upfront";
                      const isPayDeposit = it.key === "pay_deposit";
                      const isPaymentTask = isPayUpfront || isPayDeposit;
                      const due = toDate(it.dueAt);
                      const doneAt = toDate(it.completedAt ?? undefined);

                      return (
                        <li key={it.key} className="py-3 flex items-start gap-3">
                          <label className="flex items-start gap-3 cursor-pointer select-none">
                            <input
                              aria-label={it.label}
                              type="checkbox"
                              className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              checked={done}
                              onChange={(e) =>
                                toggleChecklist(it.key, e.currentTarget.checked)
                              }
                            />
                            <div className="flex-1">
                              <div
                                className={clsx(
                                  "text-sm font-medium",
                                  done && "line-through text-gray-500",
                                )}
                              >
                                {it.label}
                              </div>
                              <div className="mt-0.5 text-xs text-gray-500">
                                {due ? `Due ${dateFmt.format(due)}` : ""}
                                {due && doneAt ? " · " : ""}
                                {doneAt
                                  ? `Completed ${dateFmt.format(doneAt)}`
                                  : ""}
                              </div>

                              {/* Inspection link */}
                              {isInspection && (
                                <div className="mt-2">
                                  <a
                                    href="/tenant/inspection"
                                    className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50"
                                  >
                                    Open pre-move inspection
                                  </a>
                                </div>
                              )}

                              {/* Payment task links */}
                              {isPaymentTask && (
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <PaymentsLink
                                    appId={resolvedAppId}
                                    firmId={resolvedFirmId}
                                    type={isPayUpfront ? "upfront" : "deposit"}
                                    className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                                    data-testid={`open-payments-${
                                      isPayUpfront ? "upfront" : "deposit"
                                    }`}
                                  >
                                    Open payments
                                  </PaymentsLink>

                                  {isPayDeposit && (
                                    <button
                                      type="button"
                                      onClick={openDisclosure}
                                      disabled={!canQueryDisclosure}
                                      className={clsx(
                                        "inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50",
                                        !canQueryDisclosure &&
                                          "opacity-70 cursor-not-allowed",
                                      )}
                                    >
                                      View deposit disclosure
                                    </button>
                                  )}

                                  <span className="text-[11px] text-gray-600">
                                    {isPayUpfront
                                      ? "Up-front charges"
                                      : "Security deposit"}
                                  </span>
                                </div>
                              )}

                              {it.notes ? (
                                <div className="mt-1 text-xs text-gray-700">
                                  {it.notes}
                                </div>
                              ) : null}
                            </div>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <Empty hint="No checklist items yet," />
                )}
              </Card>
            </aside>
          </div>

          {toast && <Toast text={toast} onClose={() => setToast(null)} />}

          {/* Modal mount */}
          {discOpen && (
            <SecurityDepositDisclosureModal
              open={discOpen}
              onClose={() => setDiscOpen(false)}
              receiptPath={disc?.receiptPath ?? null}
              disclosureReady={!!disc?.disclosureReady}
              bankReceiptDueISO={disc?.bankReceiptDueISO ?? null}
            />
          )}
		  
		 {inspectionOpen && leaseId && (
            <InspectionModal
              leaseId={leaseId}
              onClose={() => setInspectionOpen(false)}
            />
          )}
        </div>
      </div>
    </main>
  );
}

/* ------- small building blocks ------- */

function Card({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/95 shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 text-xs text-slate-600">{subtitle}</p>
          )}
        </div>
        {right}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function Info({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-slate-200 bg-slate-50/80 p-3",
        className,
      )}
    >
      <div className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-sm text-slate-900">{children}</div>
    </div>
  );
}

function Empty({ hint }: { hint: string }) {
  return (
    <div className="text-sm text-gray-600">
      {hint}{" "}
      <span className="text-gray-400">
        Your landlord may share documents here later,
      </span>
    </div>
  );
}

function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div
      className="fixed bottom-0 left-1/2 z-50 -translate-x-1/2 w-[calc(100%-1.5rem)] sm:w-auto sm:bottom-4"
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

function InspectionModal({
  leaseId,
  onClose,
}: {
  leaseId: string;
  onClose: () => void;
}) {
  const src = `/api/receipts/statement-of-condition/${encodeURIComponent(
    leaseId,
  )}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-3 py-6 sm:px-6">
      <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 sm:px-5">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-900">
              Move in inspection and Statement of Condition
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              This view is for your records only, your lease and any signed
              addenda always control,
            </p>
          </div>
          <div className="ml-3 flex items-center gap-2">
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
            >
              Open in new tab
            </a>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-md bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden bg-slate-50">
          <iframe
            src={src}
            title="Statement of Condition"
            className="h-[70vh] w-full border-0 bg-white"
          />
        </div>
      </div>
    </div>
  );
}