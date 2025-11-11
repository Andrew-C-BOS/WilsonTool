"use client";

import Link from "next/link";
import {
  Home,
  CheckCircle,
  FileText,
  CreditCard,
  Camera,
  Calendar,
  Phone,
} from "lucide-react";

type SessionUser = { email: string | null };

// Server-provided state (same shape you shared), all optional-safe.
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

export default function TenantDesktop({
  user,
  state,
}: {
  user: SessionUser;
  state: HomeState | null;
}) {
  const a = state?.nextAction;

  // Display context
  const ctx = state?.context ?? {};
  const tenantName = ctx.tenantName ?? user.email ?? "Welcome";
  const hasProperty = !!ctx.propertyLine;
  const hasMoveInDate = !!ctx.moveInDateISO;
  
  
const displayName =
  (typeof ctx.tenantName === "string" && ctx.tenantName.trim()) || null;


  // Primary CTA
  const isActionReady = !!a && a.kind !== "done";
  const primaryHref = isActionReady ? a!.href : "/tenant/applications";
  const primaryLabel = isActionReady ? a!.label : "View applications";
  const primaryTone =
    isActionReady && a?.kind === "pay_holding_fee" ? "indigo" : isActionReady ? "gray" : "outline";

  // 4-phase journey: Household → Application → Lease → Move-In
  const phase = phaseFromKind(a?.kind);

  // Status signals
  const appStatus = ctx.applicationStatus ?? "none";
  const leaseStatus = ctx.leaseStatus ?? "none";
  const isZeroState =
    (a?.kind === "configure_household" || !a?.kind) &&
    appStatus === "none" &&
    leaseStatus === "none";

  // Deposit info (used if pay_holding_fee is next)
  const depositDueCents = ctx.depositDueCents ?? null;
  const depositDueBy = ctx.depositDueByISO ? niceShortDate(ctx.depositDueByISO) : null;

  // Inspection availability
  const inspectionLocked =
    ctx.inspectionUnlocked === true
      ? false
      : a?.kind !== "pay_holding_fee" && leaseStatus !== "signed"
      ? true
      : false;

  // Contacts — MILO fallback until lease signed, or PM provided
  const contact = pickContact(leaseStatus, {
    propertyManagerName: ctx.propertyManagerName,
    propertyManagerEmail: ctx.propertyManagerEmail,
    propertyManagerPhone: ctx.propertyManagerPhone,
  });

  // Secondary links
  const secondary = (state?.secondary?.length ? state!.secondary : DEFAULT_SECONDARY).slice(0, 3);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <header className="mb-8 rounded-xl bg-white p-6 shadow">
          <h1 className="text-2xl font-semibold text-gray-900">
			{displayName ? `Welcome ${displayName}!` : "Welcome!"}
		  </h1>

        {/* Only show property line if known */}
        {hasProperty && (
          <p className="mt-2 text-indigo-600 font-medium flex items-center">
            <Home className="mr-2 h-5 w-5" />
            <span>Your New Home:</span>
            <span className="ml-2 font-semibold text-gray-800">{ctx.propertyLine}</span>
          </p>
        )}

        {/* Only show move-in date if known */}
        {hasMoveInDate && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Move-In Date:
            </span>
            <span className="ml-2 text-lg font-bold text-gray-900">
              {niceDate(ctx.moveInDateISO!)}
            </span>
          </div>
        )}
      </header>

      {/* Stepper (Desktop-only) */}
      <div className="relative mb-12 hidden sm:flex">
        <Stepper current={isZeroState ? 1 : phase} />
      </div>

      {/* ———————————————————————————————————————————————
          ZERO-STATE: no household, no application
          Show: Configure Household (primary), and Add Application card (two buttons)
          Hide: Lease Application card, and Inspection card
      ——————————————————————————————————————————————— */}
      {isZeroState ? (
        <section className="grid gap-6 sm:grid-cols-1">
          {/* Configure household as the primary action */}
          <ActionCard
            tone="emphasis"
            badgeText="Start Here"
            titleIcon={<FileText className="text-gray-500" />}
            title="Configure your household"
            desc="Add members, confirm contact details, set preferences."
            href={a?.href ?? "/tenant/household"}
            ctaLabel={a?.label ?? "Configure household"}
          />

          {/* Add an Application: two clear choices */}
          <div className="transform rounded-xl bg-white p-6 shadow transition-all hover:shadow-lg">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center text-xl font-semibold text-gray-900">
                <span className="mr-3 h-6 w-6">
                  <FileText className="text-indigo-500" />
                </span>
                Add an application
              </h2>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-semibold text-gray-700">
                Step 2
              </span>
            </div>
            <p className="mt-4 text-gray-600">
              Join with a code from your property manager, or, search for a property and start fresh.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Link
                href="/tenant/applications/join"
                className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:bg-black"
              >
                Enter invite code
              </Link>
              <Link
                href="/tenant/applications/search"
                className="inline-flex items-center justify-center rounded-lg border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900 hover:bg-gray-50"
              >
                Search Applications
              </Link>
            </div>
          </div>
        </section>
      ) : (
        /* ———————————————————————————————————————————
           STANDARD STATE (non-zero): original cards
        ———————————————————————————————————————————— */
        <section className="grid gap-6 sm:grid-cols-2">
          {/* Card 1: Application status */}
          <Card
            tone={appStatus === "approved" ? "success" : "neutral"}
            badgeText={badgeForApp(appStatus)}
            titleIcon={<FileText className={iconTone(appStatus)} />}
            title="Lease Application"
            desc={copyForApp(appStatus)}
            cta={
              appStatus === "approved" ? (
                <Link
                  href="/tenant/applications"
                  className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                >
                  View submitted details
                </Link>
              ) : appStatus === "submitted" ? (
                <Link
                  href={isActionReady ? primaryHref : "/tenant/applications"}
                  className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                >
                  Review status
                </Link>
              ) : (
                <Link
                  href="/tenant/applications/new"
                  className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                >
                  Start application
                </Link>
              )
            }
          />

          {/* Card 2: Deposit / Primary Action */}
          <ActionCard
            tone={primaryTone === "indigo" ? "primary" : primaryTone === "gray" ? "emphasis" : "outline"}
            badgeText={isActionReady ? "Action Required" : "All Set"}
            titleIcon={
              <CreditCard className={primaryTone === "indigo" ? "text-indigo-500" : "text-gray-500"} />
            }
            title={isActionReady ? a!.label : "No immediate actions"}
            desc={
              isActionReady
                ? a!.sublabel ?? "Complete this next step, keep things moving."
                : "Explore your applications, payments, or documents, any time."
            }
            amountLabel={
              a?.kind === "pay_holding_fee" && depositDueCents !== null
                ? toMoney(depositDueCents)
                : undefined
            }
            amountSub={a?.kind === "pay_holding_fee" && depositDueBy ? `Due by ${depositDueBy}` : undefined}
            href={primaryHref}
            ctaLabel={isActionReady ? a!.label : "View applications"}
          />

          {/* Card 3: Pre-Move-In Inspection */}
          <Card
            tone={inspectionLocked ? "disabled" : "neutral"}
            badgeText={inspectionLocked ? "Locked" : "Available"}
            titleIcon={<Camera className={inspectionLocked ? "text-gray-500" : "text-indigo-500"} />}
            title="Pre-Move-In Inspection"
            desc={
              inspectionLocked
                ? "This unlocks after your security deposit is processed."
                : "Walk through, document the unit condition, upload photos."
            }
            cta={
              inspectionLocked ? (
                <span className="inline-flex cursor-not-allowed items-center justify-center rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-600">
                  Start Inspection (Locked)
                </span>
              ) : (
                <Link
                  href="/tenant/inspection/start"
                  className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black"
                >
                  Start Inspection
                </Link>
              )
            }
          />
        </section>
      )}

      {/* Supplementary info / Contact */}
      <section className="mt-12 grid gap-8 rounded-xl bg-white p-6 shadow sm:grid-cols-2">
        <div>
          <h3 className="mb-3 flex items-center text-lg font-semibold text-gray-900">
            <Calendar className="mr-2 h-5 w-5 text-indigo-500" />
            Important Information
          </h3>
          <ul className="space-y-2 text-gray-700">
            <li className="flex items-center justify-between">
              <span className="font-medium">Key Collection:</span>
              <span>Move-in day, Leasing Office</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="font-medium">Inspection Deadline:</span>
              <span>48 hours after move-in</span>
            </li>
          </ul>
          <Link
            href="/tenant/documents/requirements"
            className="mt-4 inline-block text-sm font-medium text-indigo-600 hover:underline"
          >
            View required documentation
          </Link>
        </div>

        <div>
          <h3 className="mb-3 flex items-center text-lg font-semibold text-gray-900">
            <Phone className="mr-2 h-5 w-5 text-indigo-500" />
            Need Help? Contact Us
          </h3>
          <div className="space-y-1 text-gray-700">
            <p>
              <span className="font-medium">Property Manager:</span> {contact.managerName}
            </p>
            <p>
              <span className="font-medium">Email:</span>{" "}
              <a className="text-indigo-600 hover:underline" href={`mailto:${contact.email}`}>
                {contact.email}
              </a>
            </p>
            <p>
              <span className="font-medium">Phone:</span>{" "}
              <a className="text-indigo-600 hover:underline" href={`tel:${contact.phone}`}>
                {contact.phone}
              </a>
            </p>
          </div>
        </div>
      </section>

      {/* Tertiary nav */}
      <section className="mt-8">
        <div className="grid gap-3 sm:grid-cols-3">
          {secondary.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="block rounded-xl border border-gray-200 bg-white p-4 transition hover:shadow-sm"
            >
              <div className="font-medium text-gray-900">{s.label}</div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

/* ———————————————————— Components ———————————————————— */

function Stepper({ current }: { current: 1 | 2 | 3 | 4 }) {
  const steps = [
    { label: "Household", idx: 1 },
    { label: "Application", idx: 2 },
    { label: "Lease", idx: 3 },
    { label: "Move-In", idx: 4 },
  ] as const;

  return (
    <div className="flex w-full items-start">
      {steps.map((s, i) => {
        const isDone = current > s.idx;
        const isCurrent = current === s.idx;

        return (
          <div key={s.idx} className="relative flex flex-1 flex-col items-center text-center">
            {/* Left line */}
            {i > 0 && (
              <div
                className={`absolute left-0 right-1/2 top-6 h-[2px] ${
                  current > steps[i - 1].idx ? "bg-green-500" : "bg-gray-200"
                }`}
              />
            )}
            {/* Right line */}
            {i < steps.length - 1 && (
              <div
                className={`absolute left-1/2 right-0 top-6 h-[2px] ${
                  current > s.idx ? "bg-green-500" : "bg-gray-200"
                }`}
              />
            )}
            {/* Circle */}
            <div
              className={[
                "z-10 flex h-12 w-12 items-center justify-center rounded-full font-bold transition",
                isDone
                  ? "bg-green-500 text-white"
                  : isCurrent
                  ? "bg-indigo-500 text-white ring-4 ring-indigo-200 shadow"
                  : "bg-gray-300 text-gray-700",
              ].join(" ")}
            >
              {isDone ? <CheckCircle className="h-6 w-6" /> : s.idx}
            </div>
            {/* Label */}
            <p
              className={[
                "mt-2 text-sm",
                isCurrent ? "font-semibold text-indigo-600" : "font-medium text-gray-600",
              ].join(" ")}
            >
              {s.label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function Card({
  tone,
  badgeText,
  titleIcon,
  title,
  desc,
  cta,
}: {
  tone: "success" | "neutral" | "disabled";
  badgeText: string;
  titleIcon: React.ReactNode;
  title: string;
  desc: string;
  cta?: React.ReactNode;
}) {
  const border =
    tone === "success"
      ? "border-l-4 border-green-500"
      : tone === "disabled"
      ? "border-l-4 border-gray-400 opacity-70"
      : "border-l-4 border-gray-200";
  return (
    <div className={`rounded-xl bg-white p-6 shadow ${border}`}>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center text-xl font-semibold text-gray-900">
          <span className="mr-3 h-6 w-6">{titleIcon}</span>
          {title}
        </h2>
        <span
          className={[
            "rounded-full px-3 py-1 text-sm font-medium",
            tone === "success"
              ? "bg-green-100 text-green-700"
              : tone === "disabled"
              ? "bg-gray-200 text-gray-600"
              : "bg-gray-100 text-gray-700",
          ].join(" ")}
        >
          {badgeText}
        </span>
      </div>
      <p className="mt-4 text-gray-600">{desc}</p>
      <div className="mt-6 flex justify-end">{cta}</div>
    </div>
  );
}

function ActionCard({
  tone,
  badgeText,
  titleIcon,
  title,
  desc,
  amountLabel,
  amountSub,
  href,
  ctaLabel,
}: {
  tone: "primary" | "emphasis" | "outline";
  badgeText: string;
  titleIcon: React.ReactNode;
  title: string;
  desc: string;
  amountLabel?: string;
  amountSub?: string;
  href: string;
  ctaLabel: string;
}) {
  const toneClasses =
    tone === "primary"
      ? { badge: "bg-indigo-100 text-indigo-700", btn: "bg-indigo-600 hover:bg-indigo-700 text-white" }
      : tone === "emphasis"
      ? { badge: "bg-gray-100 text-gray-700", btn: "bg-gray-900 hover:bg-black text-white" }
      : { badge: "bg-gray-100 text-gray-700", btn: "border border-gray-200 text-gray-900 hover:bg-gray-50" };

  return (
    <div className="transform rounded-xl bg-white p-6 shadow transition-all hover:shadow-lg">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center text-xl font-semibold text-gray-900">
          <span className="mr-3 h-6 w-6">{titleIcon}</span>
          {title}
        </h2>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${toneClasses.badge}`}>
          {badgeText}
        </span>
      </div>
      <p className="mt-4 text-gray-600">{desc}</p>

      {(amountLabel || amountSub) && (
        <div className="mt-4 text-2xl font-extrabold text-gray-900">
          {amountLabel}
          {amountSub && <span className="ml-2 text-base font-normal text-gray-500">{amountSub}</span>}
        </div>
      )}

      <div className="mt-6">
        <Link
          href={href}
          className={`inline-flex w-full items-center justify-center rounded-lg px-4 py-3 text-sm font-semibold ${toneClasses.btn}`}
        >
          {ctaLabel}
        </Link>
      </div>
    </div>
  );
}

/* ———————————————————— Helpers ———————————————————— */

// 1 Household, 2 Application, 3 Lease, 4 Move-In
function phaseFromKind(
  kind:
    | "configure_household"
    | "start_application"
    | "continue_application"
    | "submit_application"
    | "pay_holding_fee"
    | "sign_lease"
    | "complete_movein_checklist"
    | "done"
    | undefined
): 1 | 2 | 3 | 4 {
  switch (kind) {
    case "configure_household":
      return 1;
    case "start_application":
    case "continue_application":
    case "submit_application":
    case "pay_holding_fee":
      return 2;
    case "sign_lease":
      return 3;
    case "complete_movein_checklist":
    case "done":
    default:
      return 4;
  }
}

function niceDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}
function niceShortDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function toMoney(cents: number) {
  const dollars = Math.round(cents) / 100;
  return dollars.toLocaleString(undefined, { style: "currency", currency: "USD" });
}
function iconTone(appStatus: string) {
  return appStatus === "approved" ? "text-green-500" : "text-gray-500";
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
      return "Not Started";
  }
}
function copyForApp(appStatus: string) {
  switch (appStatus) {
    case "approved":
      return "Your rental application was reviewed and approved.";
    case "submitted":
      return "Your application is under review, we’ll notify you when it’s ready.";
    case "draft":
      return "Pick up where you left off, finish required questions and uploads.";
    default:
      return "Start your rental application to begin.";
  }
}

function pickContact(
  leaseStatus: "pending_signature" | "signed" | "none",
  pm: { propertyManagerName?: string; propertyManagerEmail?: string; propertyManagerPhone?: string }
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
  { href: "/tenant/applications", label: "Go to Applications" },
  { href: "/tenant/payments", label: "Make a Payment" },
  { href: "/tenant/documents", label: "View Documents" },
];
