// lib/tenant/nextAction.ts
import { col } from "@/lib/collections";
import type { WithId } from "mongodb";

/** Step order (0..6) maps to your flow */
const ORDER = [
  "configure_household",
  "start_application",
  "continue_application",
  "submit_application",
  "pay_holding_fee",
  "sign_lease",
  "complete_movein_checklist",
  "done",
] as const;
type Step = typeof ORDER[number];

type Next = {
  kind: Step;
  href: string;
  label: string;
  sublabel?: string;
  progress: number; // 0..6
  context?: Record<string, string>;
};

type HomeState = {
  nextAction: Next;
  secondary: { href: string; label: string }[];
};

/** HREF + label mapping lives here, tweak paths as your routes stabilize */
function toAction(kind: Step, ctx: Record<string, string> = {}): Next {
  switch (kind) {
    case "configure_household":
      return {
        kind,
        href: "/tenant/household",
        label: "Configure household",
        sublabel: "Add members, confirm details, set your preferences.",
        progress: 0,
      };
    case "start_application":
      return {
        kind,
        href: "/tenant/applications/new",
        label: "Start an application",
        sublabel: "Pick a property, answer a few questions, save as you go.",
        progress: 1,
      };
    case "continue_application":
      return {
        kind,
        href: `/tenant/applications/${ctx.appId ?? ""}`,
        label: "Continue your application",
        sublabel: "Finish remaining questions, upload any documents.",
        progress: 2,
        context: ctx,
      };
    case "submit_application":
      return {
        kind,
        href: `/tenant/applications/${ctx.appId ?? ""}/review`,
        label: "Submit application",
        sublabel: "Review, fix any missing items, and submit.",
        progress: 3,
        context: ctx,
      };
    case "pay_holding_fee":
      return {
        kind,
        href: `/tenant/payments/holding?appId=${ctx.appId ?? ""}`,
        label: "Pay holding fee",
        sublabel: "Reserve the unit while your lease is prepared.",
        progress: 4,
        context: ctx,
      };
    case "sign_lease":
      return {
        kind,
        href: `/tenant/lease/sign?leaseId=${ctx.leaseId ?? ""}`,
        label: "Sign your lease",
        sublabel: "E-sign securely, receive a copy instantly.",
        progress: 5,
        context: ctx,
      };
    case "complete_movein_checklist":
      return {
        kind,
        href: `/tenant/movein/checklist?leaseId=${ctx.leaseId ?? ""}`,
        label: "Complete pre-move-in checklist",
        sublabel: "Upload renters insurance, schedule key pickup, confirm utilities.",
        progress: 6,
        context: ctx,
      };
    case "done":
    default:
      return {
        kind: "done",
        href: "/tenant/applications",
        label: "You’re all set",
        sublabel: "Nothing urgent right now. Explore applications, payments, documents.",
        progress: 6,
      };
  }
}

/** Core decision logic */
export async function getTenantHomeState(userId: string): Promise<HomeState> {
  // Collections you already have
  const memberships = await col("household_memberhsips" as any).catch(() => null);
  const households = await col("households" as any).catch(() => null);
  const apps = await col("applications" as any).catch(() => null);
  const payments = await col("payments" as any).catch(() => null);
  const leases = await col("leases" as any).catch(() => null);

  // 1) Household presence + completeness
  const membership: WithId<any> | null =
    memberships ? await memberships.findOne({ userId, active: true }) : null;
  const householdId = membership?.householdId ?? null;
  const household: WithId<any> | null =
    householdId && households ? await households.findOne({ _id: householdId }) : null;

  const householdComplete =
    !!household &&
    Array.isArray(household.members) &&
    household.members.length > 0 &&
    !!household.address; // adjust to your schema

  if (!household || !householdComplete) {
    return finalize("configure_household", { householdId: householdId ?? "" });
  }

  // 2) Application presence + state
  const userApps: WithId<any>[] = apps
    ? await apps
        .find({ householdId, archived: { $ne: true } })
        .sort({ updatedAt: -1 })
        .limit(5)
        .toArray()
    : [];

  const draft = userApps.find((a) => a.state === "draft");
  if (!userApps.length) {
    return finalize("start_application", {});
  }
  if (draft) {
    return finalize("continue_application", { appId: String(draft._id) });
  }

  const submitted = userApps.find((a) => a.state === "submitted");
  if (submitted) {
    // 3) Holding fee requirement
    const holdingRequired = !!submitted.holdingFeeRequired;
    const holdingPaid = payments
      ? await payments.findOne({
          kind: "holding_fee",
          "meta.appId": String(submitted._id),
          status: "succeeded",
        })
      : null;

    if (holdingRequired && !holdingPaid) {
      return finalize("pay_holding_fee", { appId: String(submitted._id) });
    }
  }

  // 4) Lease stage
  const lease: WithId<any> | null = leases
    ? await leases.findOne({ householdId, status: { $in: ["pending_signature", "signed"] } })
    : null;

  if (lease?.status === "pending_signature") {
    return finalize("sign_lease", { leaseId: String(lease._id) });
  }

  // 5) Move-in checklist
  const checklistDone = !!lease?.moveIn?.checklistCompletedAt;
  if (lease?.status === "signed" && !checklistDone) {
    return finalize("complete_movein_checklist", { leaseId: String(lease._id) });
  }

  // 6) Nothing urgent
  return finalize("done", {});
}

/** Helper to produce HomeState with sensible secondary links per step */
function finalize(kind: Step, ctx: Record<string, string>): HomeState {
  const next = toAction(kind, ctx);
  const secondary = pickSecondary(kind, ctx);
  return { nextAction: next, secondary };
}

function pickSecondary(kind: Step, ctx: Record<string, string>) {
  switch (kind) {
    case "configure_household":
      return [
        { href: "/tenant/applications", label: "Browse applications" },
        { href: "/tenant/documents", label: "View documents" },
        { href: "/tenant/payments", label: "Make a payment" },
      ];
    case "start_application":
    case "continue_application":
    case "submit_application":
      return [
        { href: "/tenant/applications", label: "All applications" },
        { href: "/tenant/documents", label: "Upload docs" },
        { href: "/tenant/household", label: "Edit household" },
      ];
    case "pay_holding_fee":
      return [
        { href: `/tenant/applications/${ctx.appId ?? ""}`, label: "Review application" },
        { href: "/tenant/payments", label: "Payment history" },
        { href: "/tenant/documents", label: "Documents" },
      ];
    case "sign_lease":
      return [
        { href: "/tenant/documents", label: "Lease documents" },
        { href: "/tenant/payments", label: "Security deposit" },
        { href: "/tenant/support", label: "Get help" },
      ];
    case "complete_movein_checklist":
      return [
        { href: "/tenant/movein/faq", label: "Move-in FAQ" },
        { href: "/tenant/payments", label: "Set up autopay" },
        { href: "/tenant/documents", label: "Insurance upload" },
      ];
    case "done":
    default:
      return [
        { href: "/tenant/applications", label: "Go to Applications" },
        { href: "/tenant/payments", label: "Make a Payment" },
        { href: "/tenant/documents", label: "View Documents" },
      ];
  }
}
