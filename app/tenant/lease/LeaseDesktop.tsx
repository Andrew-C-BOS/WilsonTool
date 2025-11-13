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
const toDate = (s?: string | null) => (s ? new Date(s) : null);
const asMoney = (cents?: number | null) => moneyFmt.format((cents ?? 0) / 100);

/* Hard target for payments portal */
const PAYMENTS_URL = "http://localhost:3000/tenant/payments";

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
        map[tone]
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
          "inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
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
  firmId?: string | null
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
  url?: string | null;   // present in API payload, but we route via our API
  s3Key?: string | null; // present in API payload
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
      // docs may already be on the lease prop
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
          (x) => String(x?._id) === String((lease as any)?._id)
        );
        if (!abort && me) {
          if (me.appId) setResolvedAppId(String(me.appId));
          if (me.firmId) setResolvedFirmId(String(me.firmId));

          // pull normalized documents (with S3 info) from the API payload
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

  function flash(msg: string) {
    setToast(msg);
    (window as any).clearTimeout((flash as any)._t);
    (flash as any)._t = window.setTimeout(() => setToast(null), 1600);
  }

  async function toggleChecklist(key: string, done: boolean) {
    // optimistic
    const prev = lease;
    const next: LeaseDoc = {
      ...prev,
      checklist: (prev.checklist ?? []).map((it) =>
        it.key === key
          ? { ...it, completedAt: done ? new Date().toISOString() : null }
          : it
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

  const moveIn = toDate(lease.startDate);
  const moveOut = toDate(lease.endDate);

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

  return (
    <div className="mx-auto max-w-6xl p-6 grid grid-cols-12 gap-8">
      {/* Summary */}
      <section className="col-span-12 lg:col-span-7 space-y-4">
        <Card
          title="Lease summary"
          right={<StatusPill status={lease.status || "scheduled"} />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Info label="Unit / Rent">
              <div className="leading-6">
                <div className="font-medium">{lease.unitLabel ?? "—"}</div>
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
              <div className="leading-6">
                <div>Tenant, {lease.parties?.tenantName ?? "—"}</div>
                <div>Landlord, {lease.parties?.landlordName ?? "—"}</div>
              </div>
            </Info>

            <Info label="Deposit">
              {lease.depositCents != null ? asMoney(lease.depositCents) : "—"}
            </Info>

            <Info className="sm:col-span-2" label="Address">
              {addressLines}
            </Info>
          </div>
        </Card>

        {/* Payments entry point */}
        <Card title="Payments">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-gray-700">
              View and complete your up-front and monthly payments.
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openDisclosure}
                disabled={!canQueryDisclosure}
                className={clsx(
                  "inline-flex items-center rounded-md px-3 py-2 text-xs font-medium",
                  canQueryDisclosure
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "bg-gray-200 text-gray-500 cursor-not-allowed"
                )}
                title={
                  canQueryDisclosure
                    ? "View Security Deposit Disclosure"
                    : "Disclosure available after app & firm are resolved"
                }
              >
                Deposit Disclosure
              </button>

              <PaymentsLink
                appId={resolvedAppId}
                firmId={resolvedFirmId}
                className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
                data-testid="open-payments-main"
              >
                Open Payments
              </PaymentsLink>
            </div>
          </div>
        </Card>

        {/* Files / Documents */}
<Card title="Lease documents">
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
                    leaseId
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
                    "group flex items-center justify-between rounded-lg border px-3.5 py-3 text-sm shadow-sm transition",
                    "bg-gray-50/80 border-gray-200",
                    !isDisabled &&
                      "hover:border-blue-200 hover:bg-blue-50/70 hover:shadow-md",
                    isDisabled && "cursor-not-allowed opacity-60"
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {/* File icon */}
                    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-white shadow-sm ring-1 ring-gray-100 group-hover:bg-blue-600 group-hover:text-white group-hover:ring-blue-500 transition">
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
                        <p className="truncate font-medium text-gray-900 group-hover:text-blue-800">
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
                className="group flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3.5 py-3 text-sm shadow-sm transition hover:border-blue-200 hover:bg-blue-50/60 hover:shadow-md"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-gray-50 text-gray-500 ring-1 ring-gray-200 group-hover:bg-blue-600 group-hover:text-white group-hover:ring-blue-500 transition">
                    <span className="text-[10px] font-semibold uppercase">
                      File
                    </span>
                  </div>
                  <p className="truncate text-gray-900 group-hover:text-blue-800">
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
        <Card title="Move-in checklist" subtitle="Mark completed items as you go">
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
                        className="mt-1 h-5 w-5 rounded border-gray-300"
                        checked={done}
                        onChange={(e) =>
                          toggleChecklist(it.key, e.currentTarget.checked)
                        }
                      />
                      <div className="flex-1">
                        <div
                          className={clsx(
                            "font-medium",
                            done && "line-through text-gray-500"
                          )}
                        >
                          {it.label}
                        </div>
                        <div className="text-xs text-gray-500">
                          {due ? `Due ${dateFmt.format(due)}` : ""}
                          {due && doneAt ? " · " : ""}
                          {doneAt ? `Completed ${dateFmt.format(doneAt)}` : ""}
                        </div>

                        {/* Inspection link (existing behavior) */}
                        {isInspection && (
                          <div className="mt-2">
                            <a
                              href="/tenant/inspection"
                              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50"
                            >
                              Open Pre-Move Inspection
                            </a>
                          </div>
                        )}

                        {/* Payment task links (deep-link to specific payment type) */}
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
                              Open Payments
                            </PaymentsLink>

                            {isPayDeposit && (
                              <button
                                type="button"
                                onClick={openDisclosure}
                                disabled={!canQueryDisclosure}
                                className={clsx(
                                  "inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50",
                                  !canQueryDisclosure &&
                                    "opacity-70 cursor-not-allowed"
                                )}
                              >
                                View Deposit Disclosure
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
                          <div className="text-sm mt-1">{it.notes}</div>
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
    </div>
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
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 text-xs text-gray-600">{subtitle}</p>
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
        "rounded-lg border border-gray-200 bg-white p-3",
        className
      )}
    >
      <div className="text-[11px] uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-1 text-sm text-gray-900">{children}</div>
    </div>
  );
}

function Empty({ hint }: { hint: string }) {
  return <div className="text-sm text-gray-600">{hint}</div>;
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
