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

type TenantDashboardMode = "household_setup" | "application_zero" | "standard";

type PrimaryKind =
  | "configure_household"
  | "start_application"
  | "continue_application"
  | "wait_accept"
  | "min_due"
  | "min_paid"
  | "countersigned";

// Server-provided state (must match page.tsx / homeViewState)
type HomeState = {
  // server view mode is a bit richer; we’ll map it into our narrower dashboard mode
  viewMode?: string;
  primaryKind?: PrimaryKind;
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

    householdHasName?: boolean;
    householdHasInvites?: boolean;
  };
};

type DashboardCardKind =
  | "householdConfig"
  | "applicationStart"
  | "primaryAction";

type DashboardCardDescriptor = {
  key: string;
  kind: DashboardCardKind;
  span?: 1 | 2 | 3; // grid span (lg:col-span-x)
};

export default function TenantDesktop({
  user,
  state,
}: {
  user: SessionUser;
  state: HomeState | null;
}) {
  // New: drive everything off primaryKind
  const primaryKind: PrimaryKind =
    (state?.primaryKind as PrimaryKind | undefined) ?? "configure_household";

  // Display context
  const ctx = state?.context ?? {};
  const hasProperty = !!ctx.propertyLine;
  const hasMoveInDate = !!ctx.moveInDateISO;

  const displayName =
    (typeof ctx.tenantName === "string" && ctx.tenantName.trim()) || null;

  // Household flags (server-driven)
  const hasHouseholdName = ctx.householdHasName === true;
  const hasHouseholdInvites = ctx.householdHasInvites === true;
  const householdFlagsKnown =
    ctx.householdHasName !== undefined ||
    ctx.householdHasInvites !== undefined;

  const appStatus = ctx.applicationStatus ?? "none";
  const leaseStatus = ctx.leaseStatus ?? "none";

  // needsHouseholdConfig is TRUE only when BOTH:
  //   - householdHasName is false
  //   - householdHasInvites is false
  const needsHouseholdConfig =
    householdFlagsKnown && !(hasHouseholdName || hasHouseholdInvites);

  // 4-phase journey: Household → Application → Lease → Move-In
  // For now we only meaningfully care about 1 vs 2.
  let currentStep: 1 | 2 | 3 | 4;
  switch (primaryKind) {
    case "configure_household":
      currentStep = 1;
      break;
    case "start_application":
    case "continue_application":
	case "wait_accept":
	  currentStep = 2;
      break;
	case "min_due":
	case "min_paid":
	  currentStep = 3;
      break;
	case "countersigned":
	  currentStep = 4;
      break;
    default:
      currentStep = 1;
      break;
  }

  // Primary CTA styling: simple mapping for now
  const primaryTone: "indigo" | "gray" | "outline" =
    primaryKind === "continue_application" ? "gray" : "outline";

  // Deposit info (may be undefined for now; kept for future)
  const depositDueCents = ctx.depositDueCents ?? null;
  const depositDueBy = ctx.depositDueByISO
    ? niceShortDate(ctx.depositDueByISO)
    : null;

  // Inspection availability (kept simple for now)
  const inspectionLocked =
    ctx.inspectionUnlocked === true ? false : leaseStatus !== "signed";

  // Contacts — MILO fallback until lease signed, or PM provided
  const contact = pickContact(leaseStatus as any, {
    propertyManagerName: ctx.propertyManagerName,
    propertyManagerEmail: ctx.propertyManagerEmail,
    propertyManagerPhone: ctx.propertyManagerPhone,
  });

  // Secondary links
  const secondary = (state?.secondary?.length
    ? state!.secondary
    : DEFAULT_SECONDARY
  ).slice(0, 3);

  // ----------------------- MODE + CARD LAYOUT -----------------------

  const derivedModeFromPrimary: TenantDashboardMode =
    primaryKind === "configure_household"
      ? "household_setup"
      : primaryKind === "start_application"
      ? "application_zero"
      : "standard";

  // Map server viewMode (rich) into our narrower dashboard mode
  const serverViewMode = state?.viewMode;
  let mode: TenantDashboardMode = derivedModeFromPrimary;
  if (serverViewMode === "household_setup") {
    mode = "household_setup";
  } else if (
    serverViewMode === "application_zero" ||
    serverViewMode === "application_draft"
  ) {
    mode = "application_zero";
  } else if (serverViewMode) {
    mode = "standard";
  }

  const cards: DashboardCardDescriptor[] = buildCardLayout(mode);

  const viewDebug = {
    serverMode: state?.viewMode ?? null,
    derivedModeFromPrimary,
    mode,
    primaryKind,
    needsHouseholdConfig,
    hasHouseholdName,
    hasHouseholdInvites,
    appStatus,
    leaseStatus,
    cards,
  };

  if (typeof window !== "undefined") {
    const w = window as any;

    w.__tenantDesktopDebug = {
      user,
      state,
      view: viewDebug,
    };

    // eslint-disable-next-line no-console
    if (console.groupCollapsed) {
      console.groupCollapsed("[TenantDesktop] props from TenantRouter");
      console.log("user:", user);
      console.log("state:", state);
      console.log("viewDebug:", viewDebug);
      console.groupEnd();
    } else {
      console.log("[TenantDesktop] user", user);
      console.log("[TenantDesktop] state", state);
      console.log("[TenantDesktop] viewDebug", viewDebug);
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#e6edf1]">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-3xl bg-[#f4fafc] p-6 shadow-[0_18px_45px_rgba(15,23,42,0.16)] sm:p-7 lg:p-8">
          {/* Header */}
          <header className="mb-8 grid gap-5 rounded-2xl bg-white/90 p-5 shadow-sm ring-1 ring-slate-100 sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
            <div>
              <div className="inline-flex items-center gap-3 rounded-full bg-slate-100 px-3 py-1">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-xs font-semibold text-white">
                  {displayName
                    ? displayName[0]?.toUpperCase()
                    : (user.email ?? "?")[0]?.toUpperCase()}
                </span>
                <div className="text-xs font-medium text-slate-600">
                  {displayName || user.email || "Tenant"}
                </div>
              </div>

              <h1 className="mt-3 text-xl font-semibold text-slate-900 sm:text-2xl">
                {hasProperty ? "Your upcoming move" : "Welcome to MILO"}
              </h1>

              {hasProperty && (
                <p className="mt-2 flex items-center text-sm font-medium text-blue-700">
                  <Home className="mr-2 h-4 w-4" />
                  <span>{ctx.propertyLine}</span>
                </p>
              )}
            </div>

            <div className="flex flex-col items-end justify-between gap-3 text-sm text-slate-600">
              {hasMoveInDate && (
                <div className="text-right">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Move-in date
                  </div>
                  <div className="text-lg font-bold text-slate-900">
                    {niceDate(ctx.moveInDateISO!)}
                  </div>
                </div>
              )}
              {primaryKind === "continue_application" && (
                <div className="mt-1 inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-100">
                  <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Next step: Complete your household&apos;s application
                </div>
              )}
			  {primaryKind === "wait_accept" && (
				  <div className="mt-1 inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800 ring-1 ring-blue-100">
					<span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
					Application submitted: waiting for landlord review
				  </div>
				)}
				{primaryKind === "min_due" && (
				  <div className="mt-1 inline-flex items-center whitespace-nowrap rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-800 ring-1 ring-indigo-100">
					<span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-indigo-500" />
					Application accepted: minimum upfront payment required
				  </div>
				)}
				{primaryKind === "min_paid" && (
				  <div className="mt-1 inline-flex items-center whitespace-nowrap rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-100">
					<span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
					Minimum payment received: waiting for landlord signature
				  </div>
				)}
            </div>
          </header>

          {/* Stepper (Desktop-only) */}
          <div className="relative mb-10 hidden sm:flex">
            <Stepper current={currentStep} />
          </div>

          {/* Card grid driven by card descriptors */}
          <section className="grid gap-5 lg:grid-cols-3">
            {cards.map((card) => {
              const spanCls =
                card.span === 3
                  ? "lg:col-span-3"
                  : card.span === 2
                  ? "lg:col-span-2"
                  : "lg:col-span-1";

              return (
                <div key={card.key} className={spanCls}>
                  {renderCard(card, {
					  mode,
					  primaryKind,
					  primaryTone,
					  depositDueCents,
					  depositDueBy: depositDueBy ?? null,
					  inspectionLocked,
					})}
                </div>
              );
            })}
          </section>

          {/* Supplementary info / Contact */}
			  {/* <section className="mt-10 grid gap-6 rounded-2xl bg-white/95 p-6 shadow-sm ring-1 ring-slate-100 sm:grid-cols-2">
            <div>
              <h3 className="mb-3 flex items-center text-base font-semibold text-slate-900">
                <Calendar className="mr-2 h-5 w-5 text-indigo-500" />
                Important information
              </h3>
              <ul className="space-y-2 text-sm text-slate-700">
                <li className="flex items-center justify-between">
                  <span className="font-medium">Key collection:</span>
                  <span>Move-in day, leasing office</span>
                </li>
                <li className="flex items-center justify-between">
                  <span className="font-medium">Inspection deadline:</span>
                  <span>48 hours after move-in</span>
                </li>
              </ul>
              <Link
                href="/tenant/documents/requirements"
                className="mt-4 inline-block text-sm font-medium text-blue-600 hover:underline"
              >
                View required documentation
              </Link>
            </div>

            <div>
              <h3 className="mb-3 flex items-center text-base font-semibold text-slate-900">
                <Phone className="mr-2 h-5 w-5 text-indigo-500" />
                Need help? Contact us
              </h3>
              <div className="space-y-1 text-sm text-slate-700">
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
			  </section> */}

          {/* Tertiary nav */}
			  {/*<section className="mt-8">
            <div className="grid gap-3 sm:grid-cols-3">
              {secondary.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  className="block rounded-2xl bg-white p-4 text-sm font-medium text-slate-900 shadow-sm ring-1 ring-slate-100 transition hover:shadow-md"
                >
                  {s.label}
                </Link>
              ))}
            </div>
			  </section>*/}
        </div>
      </div>
    </main>
  );
}

/* ——————————— Card layout helpers ——————————— */

function buildCardLayout(mode: TenantDashboardMode): DashboardCardDescriptor[] {
  if (mode === "household_setup") {
    // Household not done yet:
    // Show both cards as full-width, stacked vertically
    return [
      { key: "householdConfig", kind: "householdConfig", span: 3 },
      { key: "applicationStart", kind: "applicationStart", span: 3 },
    ];
  }

  if (mode === "application_zero") {
    // Household done, no app yet: one big "add application" card
    return [
      {
        key: "applicationStartFull",
        kind: "applicationStart",
        span: 3,
      },
    ];
  }

  // Standard state – here we just show a single primary action card
  return [{ key: "primaryAction", kind: "primaryAction", span: 3 }];
}

function renderCard(
  card: DashboardCardDescriptor,
  opts: {
    mode: TenantDashboardMode;
    primaryKind: PrimaryKind;
    primaryTone: "indigo" | "gray" | "outline";
    depositDueCents: number | null;
    depositDueBy: string | null;
    inspectionLocked: boolean;
  },
) {
  const { mode, primaryKind, primaryTone, depositDueCents, depositDueBy } = opts;

  switch (card.kind) {
    case "householdConfig":
      // Only render this in household_setup mode; for safety, guard it
      if (mode !== "household_setup") return null;
      return (
        <ActionCard
          tone="emphasis"
          badgeText="Step 1"
          titleIcon={<FileText className="text-slate-500" />}
          title="Name and set up your household"
          desc="Give your household a name and confirm your members. Once your household has a name, this step will be marked complete."
          href="/tenant/household"
          ctaLabel="Go to household setup"
        />
      );

    case "applicationStart":
      // When primaryKind === "start_application", this is the main card
      return (
        <AddApplicationCard highlightPrimary={mode === "application_zero"} />
      );

	case "primaryAction":
	  // "Complete application" state
	  if (primaryKind === "continue_application") {
		return (
		  <ActionCard
			tone={
			  primaryTone === "indigo"
				? "primary"
				: primaryTone === "gray"
				? "emphasis"
				: "outline"
			}
			badgeText="Step 2"
			titleIcon={<CreditCard className="text-slate-500" />}
			title="Complete your household’s application"
			desc="Your application will not be submitted until every household member has completed their portion. Review and finish all required sections."
			amountLabel={
			  depositDueCents !== null ? toMoney(depositDueCents) : undefined
			}
			amountSub={
			  depositDueCents !== null && depositDueBy
				? `Any upfront payments will be due by ${depositDueBy}`
				: undefined
			}
			href="/tenant/applications"
			ctaLabel="Go to application"
		  />
		);
	  }

	  // NEW: "wait_accept" state
	  if (primaryKind === "wait_accept") {
		return (
		  <ActionCard
			tone="outline"
			badgeText="Step 2"
			titleIcon={<FileText className="text-slate-500" />}
			title="Application submitted – Waiting for review"
			desc="Your landlord is reviewing your application. You can still view or complete other applications while you wait."
			href="/tenant/applications"
			ctaLabel="Go to applications"
		  />
		);
	  }
	  
	  if (primaryKind === "min_due") {
		return (
		  <ActionCard
			tone="primary"
			badgeText="Step 3"
			titleIcon={<CreditCard className="text-indigo-500" />}
			title="Application accepted – upfront payment required"
			desc="Your landlord has accepted your household’s application. They’ll fully sign the lease after a portion of the upfront costs is paid. Review the upfront amount, and reach out to your landlord or property manager if you need to discuss timing or arrangements."
			amountLabel={
			  depositDueCents !== null ? toMoney(depositDueCents) : undefined
			}
			amountSub={
			  depositDueCents !== null && depositDueBy
				? `Requested by ${depositDueBy}`
				: undefined
			}
			href="/tenant/applications"
			ctaLabel="Review upfront payment"
		  />
		);
	  }
	  
		if (primaryKind === "min_paid") {
		  return (
			<ActionCard
			  tone="emphasis"
			  badgeText="Step 3"
			  titleIcon={<CheckCircle className="text-emerald-500" />}
			  title="Minimum payment received – your lease is on the way"
			  desc="We’ve recorded your minimum upfront payment and linked it to your application. Your landlord is now reviewing and preparing your lease. As soon as they sign, you’ll see your lease here and receive an email confirmation. In the meantime, you can review your application and payment details, or reach out to your landlord or property manager with any questions."
			  href="/tenant/applications"
			  ctaLabel="View application & payments"
			/>
		  );
		}

if (primaryKind === "countersigned") {
  return (
    <ActionCard
      tone="primary"
      badgeText="Step 4"
      titleIcon={<CheckCircle className="text-emerald-600" />}
      title="Your lease has been fully signed"
      desc="Great news — your landlord has countersigned the lease. Before move-in, please make any remaining payments and complete all required checklist items. Your lease hub will guide you through everything you need."
      href="/tenant/lease"
      ctaLabel="Go to your lease"
    />
  );
}

	  // Fallback if we ever hit primaryAction in other modes
	  return (
		<ActionCard
		  tone="outline"
		  badgeText="Next step"
		  titleIcon={<FileText className="text-slate-500" />}
		  title="View your applications"
		  desc="Review your current applications or start a new one."
		  href="/tenant/applications"
		  ctaLabel="Go to applications"
		/>
	  );

    default:
      return null;
  }
}

/* ——————————— Extra small card components ——————————— */

function AddApplicationCard({ highlightPrimary }: { highlightPrimary?: boolean }) {
  return (
    <div className="transform rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 transition-all hover:shadow-md">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center text-base font-semibold text-slate-900">
          <span className="mr-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-500">
            <FileText className="h-4 w-4" />
          </span>
          Add an application
        </h2>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
          Step 2
        </span>
      </div>
      <p className="mt-3 text-sm text-slate-600">
        Join with a code from your property manager or search for a listing to
        start fresh.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Link
          href="/tenant/applications"
          className={`inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm ${
            highlightPrimary
              ? "bg-slate-900 text-white hover:bg-black"
              : "border border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
          }`}
        >
          Go To Application Page
        </Link>
        <Link
          href="/tenant/applications?openSearch=1"
          className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50"
        >
          Enter invite code
        </Link>
        <Link
          href="/tenant/applications/search"
          className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50"
        >
          Search applications
        </Link>
      </div>
    </div>
  );
}

/* ———————————————————— Core components (Card / ActionCard / Stepper) ———————————————————— */

function Stepper({ current }: { current: 1 | 2 | 3 | 4 }) {
  const steps = [
    { label: "Household", idx: 1 },
    { label: "Application", idx: 2 },
    { label: "Lease", idx: 3 },
    { label: "Move-in", idx: 4 },
  ] as const;

  return (
    <div className="flex w-full items-start">
      {steps.map((s, i) => {
        const isDone = current > s.idx;
        const isCurrent = current === s.idx;

        return (
          <div
            key={s.idx}
            className="relative flex flex-1 flex-col items-center text-center"
          >
            {/* Left line */}
            {i > 0 && (
              <div
                className={`absolute left-0 right-1/2 top-6 h-[2px] ${
                  current > steps[i - 1].idx ? "bg-emerald-500" : "bg-slate-200"
                }`}
              />
            )}
            {/* Right line */}
            {i < steps.length - 1 && (
              <div
                className={`absolute left-1/2 right-0 top-6 h-[2px] ${
                  current > s.idx ? "bg-emerald-500" : "bg-slate-200"
                }`}
              />
            )}
            {/* Circle */}
            <div
              className={[
                "z-10 flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold transition",
                isDone
                  ? "bg-emerald-500 text-white"
                  : isCurrent
                  ? "bg-indigo-500 text-white ring-4 ring-indigo-200 shadow"
                  : "bg-slate-300 text-slate-700",
              ].join(" ")}
            >
              {isDone ? <CheckCircle className="h-5 w-5" /> : s.idx}
            </div>
            {/* Label */}
            <p
              className={[
                "mt-2 text-xs sm:text-sm",
                isCurrent
                  ? "font-semibold text-indigo-600"
                  : "font-medium text-slate-600",
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
  const toneBg =
    tone === "success"
      ? "bg-emerald-50"
      : tone === "disabled"
      ? "bg-slate-50"
      : "bg-white";

  return (
    <div
      className={`rounded-2xl ${toneBg} p-5 shadow-sm ring-1 ring-slate-100`}
    >
      <div className="flex items-center justify-between">
        <h2 className="flex items-center text-base font-semibold text-slate-900">
          <span className="mr-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm">
            {titleIcon}
          </span>
          {title}
        </h2>
        <span
          className={[
            "rounded-full px-3 py-1 text-xs font-medium",
            tone === "success"
              ? "bg-emerald-100 text-emerald-700"
              : tone === "disabled"
              ? "bg-slate-200 text-slate-600"
              : "bg-slate-100 text-slate-700",
          ].join(" ")}
        >
          {badgeText}
        </span>
      </div>
      <p className="mt-3 text-sm text-slate-600">{desc}</p>
      {cta && <div className="mt-4 flex justify-end">{cta}</div>}
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
      ? {
          badge: "bg-indigo-100 text-indigo-700",
          btn: "bg-indigo-600 hover:bg-indigo-700 text-white",
        }
      : tone === "emphasis"
      ? {
          badge: "bg-slate-100 text-slate-700",
          btn: "bg-slate-900 hover:bg-black text-white",
        }
      : {
          badge: "bg-slate-100 text-slate-700",
          btn: "border border-slate-200 text-slate-900 hover:bg-slate-50",
        };

  return (
    <div className="transform rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 transition-all hover:shadow-md">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center text-base font-semibold text-slate-900">
          <span className="mr-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-500">
            {titleIcon}
          </span>
          {title}
        </h2>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${toneClasses.badge}`}
        >
          {badgeText}
        </span>
      </div>
      <p className="mt-3 text-sm text-slate-600">{desc}</p>

      {(amountLabel || amountSub) && (
        <div className="mt-4 text-2xl font-extrabold text-slate-900">
          {amountLabel}
          {amountSub && (
            <span className="ml-2 text-base font-normal text-slate-500">
              {amountSub}
            </span>
          )}
        </div>
      )}

      <div className="mt-5">
        <Link
          href={href}
          className={`inline-flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold ${toneClasses.btn}`}
        >
          {ctaLabel}
        </Link>
      </div>
    </div>
  );
}

/* ———————————————————— Helpers ———————————————————— */

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

function pickContact(
  leaseStatus: "pending_signature" | "signed" | "none",
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
