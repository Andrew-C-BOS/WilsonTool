"use client";

import Link from "next/link";
import { Home, Calendar, FileText, Camera, Phone } from "lucide-react";

type SessionUser = { email: string | null };

// Match the desktop state shape (kept local here for convenience)
type HomeState = {
  nextAction?: {
    kind:
      | "configure_household"
      | "start_application"
      | "continue_application"
      | "submit_application"
      | "pay_holding_fee"
      | "sign_lease"
      | "complete_movein_checklist"
      | "done";
    href: string;
    label: string;
    sublabel?: string;
    progress: number;
    context?: Record<string, string | number | boolean | null | undefined>;
  };
  secondary?: { href: string; label: string }[];
  context?: {
    tenantName?: string;
    propertyLine?: string;
    moveInDateISO?: string;
    applicationStatus?: "approved" | "submitted" | "draft" | "none";
    depositDueCents?: number;
    depositDueByISO?: string;
    leaseStatus?: "pending_signature" | "signed" | "none";
    inspectionUnlocked?: boolean;
    propertyManagerName?: string;
    propertyManagerEmail?: string;
    propertyManagerPhone?: string;
  };
};

type Props = {
  user: SessionUser;
  state?: HomeState | null;
};

export default function TenantMobile({ user, state }: Props) {
  const a = state?.nextAction;
  const ctx = state?.context ?? {};

  const displayName =
    (typeof ctx.tenantName === "string" && ctx.tenantName.trim()) || null;
  const email = user.email ?? "—";

  const hasProperty = !!ctx.propertyLine;
  const hasMoveInDate = !!ctx.moveInDateISO;

  const appStatus = ctx.applicationStatus ?? "none";
  const leaseStatus = ctx.leaseStatus ?? "none";

  const contact = pickContact(leaseStatus, {
    propertyManagerName: ctx.propertyManagerName,
    propertyManagerEmail: ctx.propertyManagerEmail,
    propertyManagerPhone: ctx.propertyManagerPhone,
  });

  const depositDueCents = ctx.depositDueCents ?? null;
  const depositDueBy = ctx.depositDueByISO
    ? niceShortDate(ctx.depositDueByISO)
    : null;

  const isActionReady = !!a && a.kind !== "done";
  const primaryHref = isActionReady ? a!.href : "/tenant/applications";
  const primaryLabel = isActionReady ? a!.label : "View applications";

  const secondary =
    state?.secondary && state.secondary.length
      ? state.secondary
      : DEFAULT_SECONDARY;

  const inspectionLocked =
    ctx.inspectionUnlocked === true
      ? false
      : a?.kind !== "pay_holding_fee" && leaseStatus !== "signed"
      ? true
      : false;

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#e6edf1] px-4 py-5">
      <div className="mx-auto flex max-w-md flex-col gap-5">
        {/* Header / profile card */}
        <section className="rounded-2xl bg-white/95 p-4 shadow-sm ring-1 ring-slate-100">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
              {displayName
                ? displayName[0]?.toUpperCase()
                : (email ?? "?")[0]?.toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="text-xs font-medium text-slate-500">
                Signed in as
              </div>
              <div className="text-sm font-semibold text-slate-900">
                {displayName || email}
              </div>
            </div>
          </div>

          {hasProperty && (
            <div className="mt-4 flex items-start gap-2 text-xs text-slate-700">
              <Home className="mt-0.5 h-4 w-4 text-blue-500" />
              <div>
                <div className="font-semibold text-slate-900">
                  Your new home
                </div>
                <div>{ctx.propertyLine}</div>
              </div>
            </div>
          )}

          {hasMoveInDate && (
            <div className="mt-3 flex items-start gap-2 text-xs text-slate-700">
              <Calendar className="mt-0.5 h-4 w-4 text-blue-500" />
              <div>
                <div className="font-semibold text-slate-900">Move-in date</div>
                <div>{niceDate(ctx.moveInDateISO!)}</div>
              </div>
            </div>
          )}

          {isActionReady && (
            <div className="mt-4 inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-800 ring-1 ring-amber-100">
              <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
              Next step: {a!.label}
            </div>
          )}
        </section>

        {/* Next step / primary action */}
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <div className="text-sm font-semibold text-slate-900">
            {isActionReady ? "Next step" : "You’re all caught up"}
          </div>
          <p className="mt-1 text-xs text-slate-600">
            {isActionReady
              ? a!.sublabel ??
                "Complete this step to keep your move-in on track."
              : "Review your applications, payments, or documents at any time."}
          </p>

          {(a?.kind === "pay_holding_fee" && depositDueCents !== null) && (
            <div className="mt-3 text-sm font-semibold text-slate-900">
              {toMoney(depositDueCents)}
              {depositDueBy && (
                <span className="ml-2 text-xs font-normal text-slate-500">
                  Due by {depositDueBy}
                </span>
              )}
            </div>
          )}

          <Link
            href={primaryHref}
            className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm active:scale-[0.98] transition-transform"
          >
            {primaryLabel}
          </Link>
        </section>

        {/* Journey status (Application / Lease / Inspection) */}
        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <JourneyRow
            icon={<FileText className="h-4 w-4 text-blue-500" />}
            label="Application"
            status={badgeForApp(appStatus)}
            desc={copyForApp(appStatus)}
            href="/tenant/applications"
          />
          <JourneyRow
            icon={<FileText className="h-4 w-4 text-emerald-500" />}
            label="Lease"
            status={
              leaseStatus === "signed"
                ? "Signed"
                : leaseStatus === "pending_signature"
                ? "Pending signature"
                : "Not ready yet"
            }
            desc={
              leaseStatus === "signed"
                ? "View your signed lease and documents."
                : leaseStatus === "pending_signature"
                ? "Sign your lease to finalize your move-in."
                : "Your lease will be ready once your application is approved."
            }
            href="/tenant/lease"
          />
          <JourneyRow
            icon={<Camera className="h-4 w-4 text-purple-500" />}
            label="Pre-move-in inspection"
            status={inspectionLocked ? "Locked" : "Available"}
            desc={
              inspectionLocked
                ? "Unlocks after your security deposit is processed."
                : "Walk through and record the condition of your new home."
            }
            href={inspectionLocked ? undefined : "/tenant/inspection/start"}
          />
        </section>

        {/* Info + contact */}
        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
          <div>
            <h3 className="mb-1 flex items-center text-sm font-semibold text-slate-900">
              <Calendar className="mr-2 h-4 w-4 text-indigo-500" />
              Important information
            </h3>
            <ul className="space-y-1 text-xs text-slate-700">
              <li className="flex justify-between">
                <span className="font-medium">Key collection</span>
                <span>Move-in day, leasing office</span>
              </li>
              <li className="flex justify-between">
                <span className="font-medium">Inspection deadline</span>
                <span>48 hours after move-in</span>
              </li>
            </ul>
            <Link
              href="/tenant/documents/requirements"
              className="mt-2 inline-block text-xs font-medium text-blue-600 hover:underline"
            >
              View required documentation
            </Link>
          </div>

          <div className="h-px bg-slate-100" />

          <div>
            <h3 className="mb-1 flex items-center text-sm font-semibold text-slate-900">
              <Phone className="mr-2 h-4 w-4 text-indigo-500" />
              Need help? Contact us
            </h3>
            <div className="space-y-0.5 text-xs text-slate-700">
              <p>
                <span className="font-medium">Property manager:</span>{" "}
                {contact.managerName}
              </p>
              <p>
                <span className="font-medium">Email:</span>{" "}
                <a
                  className="text-blue-600 hover:underline"
                  href={`mailto:${contact.email}`}
                >
                  {contact.email}
                </a>
              </p>
              <p>
                <span className="font-medium">Phone:</span>{" "}
                <a
                  className="text-blue-600 hover:underline"
                  href={`tel:${contact.phone}`}
                >
                  {contact.phone}
                </a>
              </p>
            </div>
          </div>
        </section>

        {/* Quick nav cards */}
        <section className="space-y-3">
          {secondary.slice(0, 3).map((s) => (
            <MobileCard
              key={s.href}
              href={s.href}
              title={s.label}
              desc={
                s.href.includes("applications")
                  ? "Start or review applications."
                  : s.href.includes("payments")
                  ? "Make payments and view receipts."
                  : s.href.includes("documents")
                  ? "View your lease and stored documents."
                  : "Open this section."
              }
            />
          ))}
        </section>
      </div>
    </main>
  );
}

/* ——— smaller mobile components ——— */

function JourneyRow({
  icon,
  label,
  status,
  desc,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  status: string;
  desc: string;
  href?: string;
}) {
  const content = (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-slate-50">
        {icon}
      </div>
      <div className="flex-1">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-900">{label}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
            {status}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-slate-600">{desc}</p>
      </div>
    </div>
  );

  if (!href) {
    return (
      <div className="rounded-xl bg-slate-50 px-3 py-2.5">{content}</div>
    );
  }

  return (
    <Link
      href={href}
      className="block rounded-xl bg-slate-50 px-3 py-2.5 active:scale-[0.98] transition-transform"
    >
      {content}
    </Link>
  );
}

function MobileCard({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl bg-white p-4 text-left text-sm shadow-sm ring-1 ring-slate-100 active:scale-[0.98] transition-transform"
    >
      <div className="font-semibold text-slate-900">{title}</div>
      <div className="mt-0.5 text-xs text-slate-600">{desc}</div>
    </Link>
  );
}

/* ——— helpers (mirroring desktop) ——— */

function niceDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
function niceShortDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function toMoney(cents: number) {
  const dollars = Math.round(cents) / 100;
  return dollars.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}
function badgeForApp(appStatus: string) {
  switch (appStatus) {
    case "approved":
      return "Approved";
    case "submitted":
      return "Submitted";
    case "draft":
      return "Draft";
    default:
      return "Not started";
  }
}
function copyForApp(appStatus: string) {
  switch (appStatus) {
    case "approved":
      return "Your rental application was reviewed and approved.";
    case "submitted":
      return "Your application is under review.";
    case "draft":
      return "Pick up where you left off and finish your application.";
    default:
      return "Start your rental application to begin.";
  }
}

function pickContact(
  leaseStatus: "pending_signature" | "signed" | "none" | undefined,
  pm: {
    propertyManagerName?: string;
    propertyManagerEmail?: string;
    propertyManagerPhone?: string;
  },
) {
  const milo = {
    managerName: "MILO Support",
    email: "support@milohomes.co",
    phone: "(617) 555-0100",
  };
  if (leaseStatus === "signed") {
    return {
      managerName: pm.propertyManagerName ?? milo.managerName,
      email: pm.propertyManagerEmail ?? milo.email,
      phone: pm.propertyManagerPhone ?? milo.phone,
    };
  }
  return {
    managerName: pm.propertyManagerName ?? milo.managerName,
    email: pm.propertyManagerEmail ?? milo.email,
    phone: pm.propertyManagerPhone ?? milo.phone,
  };
}

const DEFAULT_SECONDARY = [
  { href: "/tenant/applications", label: "Go to applications" },
  { href: "/tenant/payments", label: "Make a payment" },
  { href: "/tenant/documents", label: "View documents" },
];
