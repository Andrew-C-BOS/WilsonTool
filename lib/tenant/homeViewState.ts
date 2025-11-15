// lib/tenant/homeViewState.ts
import { getDb } from "@/lib/db";

export type TenantViewMode =
  | "household_setup"
  | "application_zero"
  | "application_draft" // at least one qualifying app, all drafts
  | "application_active" // has submitted / approved, but no lease yet
  | "lease_pending"
  | "lease_signed"
  | "done";

// The three primary flow states we care about for now
export type TenantPrimaryKind =
  | "configure_household"
  | "start_application"
  | "continue_application"
  | "wait_accept"
  | "min_due"
  | "min_paid"
  | "countersigned";

export type TenantHomeState = {
  // High-level view mode (you can revisit this mapping later)
  viewMode: TenantViewMode;

  // New simple flow state instead of nextAction.kind
  primaryKind: TenantPrimaryKind;

  // Keep a simple secondary nav for now
  secondary: { href: string; label: string }[];

  context: {
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
    hasQualifyingApplication?: boolean;
    allQualifyingDrafts?: boolean;
  };
};

// Minimal shape of your user object you pass in
type MinimalUser = { _id: any; email: string | null };

/**
 * Single builder to aggregate all server-side state your UI needs.
 */
export async function buildTenantHomeState(
  user: MinimalUser,
): Promise<TenantHomeState> {
  const db = await getDb();
  const userId = String(user._id);

  // Collections
  const memberships = db.collection("household_memberships" as any);
  const households = db.collection("households" as any);
  const invites = db.collection("household_invites" as any);
  const appsCol = db.collection("applications" as any);

  // 1) Household + memberships
  const membership = await memberships.findOne({
    userId,
    active: true,
  });

  const householdId = membership?.householdId ?? null;
  const household = householdId
    ? await households.findOne({ _id: householdId })
    : null;

  const displayName = (household?.displayName ??
    (household as any)?.name ??
    "") as string;

  const hasHouseholdName =
    !!household &&
    typeof displayName === "string" &&
    displayName.trim().length > 0;

  const inviteCount =
    householdId && invites
      ? await invites.countDocuments({ householdId })
      : 0;

  const hasHouseholdInvites = inviteCount > 0;

  // 2) Applications
  const allApps = householdId
    ? await appsCol
        .find({ householdId, archived: { $ne: true } })
        .sort({ updatedAt: -1 })
        .toArray()
    : [];

  // Qualifying = NOT rejected/withdrawn
  const qualifying = allApps.filter(
    (a: any) => a.state !== "rejected" && a.state !== "withdrawn",
  );

  const hasQualifyingApplication = qualifying.length > 0;
  const allQualifyingDrafts =
    qualifying.length > 0 && qualifying.every((a: any) => a.status === "draft");

  // Simple applicationStatus for downstream
  let applicationStatus: TenantHomeState["context"]["applicationStatus"] = "none";
  if (qualifying.length > 0) {
    if (qualifying.every((a: any) => a.state === "draft")) {
      applicationStatus = "draft";
    } else if (qualifying.some((a: any) => a.state === "submitted")) {
      applicationStatus = "submitted";
    } else if (qualifying.some((a: any) => a.state === "approved")) {
      applicationStatus = "approved";
    }
  }

  const hasHouseholdConfig = hasHouseholdName || hasHouseholdInvites;

  const hasSubmittedOrScreened = qualifying.some(
    (a: any) =>
      a.status === "submitted" ||
      a.status === "admin_screened" ||
      a.status === "approved_high",
  );

  const hasMinDue = qualifying.some((a: any) => a.status === "min_due");
  const hasMinPaid = qualifying.some((a: any) => a.status === "min_paid");
  const hasCountersigned = qualifying.some(
    (a: any) => a.status === "countersigned",
  );

  let primaryKind: TenantPrimaryKind = "configure_household";

  if (hasHouseholdConfig) {
    if (!hasQualifyingApplication) {
      // No active apps at all → you’re ready to start one
      primaryKind = "start_application";
    } else if (hasCountersigned) {
      // Most advanced, lease fully countersigned
      primaryKind = "countersigned";
    } else if (hasMinPaid) {
      // Minimum paid, waiting on next steps
      primaryKind = "min_paid";
    } else if (hasMinDue) {
      // Payment required
      primaryKind = "min_due";
    } else if (hasSubmittedOrScreened) {
      // Submitted or further along, but no minimum due yet
      primaryKind = "wait_accept";
    } else if (allQualifyingDrafts) {
      // Only drafts left at this point → continue application
      primaryKind = "continue_application";
    } else {
      // Fallback: weird mix, treat as start_application
      primaryKind = "start_application";
    }
  }

  // Derive a coarse viewMode from those same flags
  let viewMode: TenantViewMode = "household_setup";

  if (hasHouseholdConfig && !hasQualifyingApplication) {
    viewMode = "application_zero";
  } else if (hasQualifyingApplication && allQualifyingDrafts) {
    viewMode = "application_draft";
  } else if (
    hasQualifyingApplication &&
    (hasSubmittedOrScreened || hasMinDue || hasMinPaid)
  ) {
    viewMode = "application_active";
  }

  if (hasMinDue || hasMinPaid) {
    viewMode = "lease_pending";
  }

  if (hasCountersigned) {
    viewMode = "lease_signed";
  }

  // No "done" state wired yet, you can add a condition later
  // if (someCondition) viewMode = "done";

  // Tenant display name
  let tenantName: string | undefined =
    (household?.primaryTenantName as string | undefined) ?? undefined;
  if (!tenantName && displayName.trim()) tenantName = displayName;
  if (!tenantName && user.email) tenantName = user.email;

  const secondary: { href: string; label: string }[] = [
    { href: "/tenant/applications", label: "Go to applications" },
    { href: "/tenant/payments", label: "Make a payment" },
    { href: "/tenant/documents", label: "View documents" },
  ];

  return {
    viewMode,
    primaryKind,
    secondary,
    context: {
      tenantName,
      applicationStatus,
      // Household flags & app flags
      householdHasName: hasHouseholdName,
      householdHasInvites: hasHouseholdInvites,
      hasQualifyingApplication,
      allQualifyingDrafts,
      // The rest are left undefined for now, by design
    },
  };
}
