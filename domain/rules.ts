// domain/rules.ts
// Minimal, pure, and testable state rules for Applications

/* ─────────────────────────────────────────────────────────────
   Public types
───────────────────────────────────────────────────────────── */
export type AppState =
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

export type Action =
  | "submit"
  | "admin_screen"
  | "approve_high"
  | "set_terms"
  | "system_min_ready"
  | "payment_updated"
  | "signatures_completed"
  | "tick_clock"
  | "reject"
  | "withdraw";

export type Role = "tenant" | "admin" | "manager" | "system";

export type MoneyBucket = "upfront" | "deposit";

export type MinRule = { bucket: MoneyBucket; minCents: number };

export type Terms = {
  addressFreeform: string;        // required once terms are set
  unitId?: string | null;         // optional, future-ready
  rentCents: number;              // > 0
  startISO: string;               // ISO date
  endISO?: string | null;
  depositCents?: number | null;
  fees?: { label: string; amountCents: number }[];
};

export type GuardContext = {
  // only include what you actually know at call time
  membersAck?: boolean;           // all members acknowledged, ready to submit
  terms?: Terms | null;           // snapshot when setting terms
  minRules?: MinRule[] | null;    // countersign thresholds, across buckets
  signaturesCount?: number;       // completed signatures (tenant + landlord)
  paymentTotals?: Partial<Record<MoneyBucket, number>>; // succeeded totals
  now?: Date;                     // overrideable clock for tests
};

/* ─────────────────────────────────────────────────────────────
   Helpers (small, pure)
───────────────────────────────────────────────────────────── */

// Treat missing numbers as zero, keep it resilient
const n = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);

// All countersign rules must be met, across buckets
export function countersignMinimumSatisfied(
  rules: MinRule[] | null | undefined,
  totals: Partial<Record<MoneyBucket, number>> | undefined
): boolean {
  const rs = rules ?? [];
  if (rs.length === 0) return false; // explicit policy, no rules -> not ready
  const t = { upfront: n(totals?.upfront), deposit: n(totals?.deposit) };
  return rs.every(r => t[r.bucket] >= n(r.minCents));
}

// Simple sanity check for terms
export function termsAreValid(t: Terms | null | undefined): t is Terms {
  return !!t && !!t.addressFreeform && n(t.rentCents) > 0 && !!t.startISO;
}

/* ─────────────────────────────────────────────────────────────
   Core: computeNextState
───────────────────────────────────────────────────────────── */
export function computeNextState(
  current: AppState,
  action: Action,
  role: Role,
  ctx: GuardContext = {}
): AppState {
  switch (action) {
	case "submit": {
	  // let the server (system) *or* a tenant flip draft→submitted,
	  // but only when the server computed membersAck = true
	  const okActor = role === "tenant" || role === "system";
	  if (current === "draft" && okActor && (ctx.membersAck === true)) {
		return "submitted";
	  }
	  break;
	}

    case "admin_screen": {
      if (current === "submitted" && role === "admin") {
        return "admin_screened";
      }
      break;
    }

    case "approve_high": {
      if ((current === "submitted" || current === "admin_screened") && role === "manager") {
        return "approved_high";
      }
      break;
    }

    case "set_terms": {
      if (current === "approved_high" && (role === "admin" || role === "manager") && termsAreValid(ctx.terms)) {
        return "terms_set";
      }
      break;
    }

	case "system_min_ready": {
	  if (current === "terms_set" && role === "system") {
		const count = ctx.minRules?.length ?? 0;

		if (count > 0) {
		  // At least one countersign rule => go to min_due
		  return "min_due";
		}

		// No countersign minimum configured => treat as immediately countersigned
		// (we assume terms were already validated when we entered terms_set)
		if (count === 0) {
		  return "countersigned";
		}
	  }
	  break;
	}

    case "payment_updated": {
      if (current === "min_due" && role === "system" && countersignMinimumSatisfied(ctx.minRules, ctx.paymentTotals)) {
        return "min_paid";
      }
      break;
    }

    case "signatures_completed": {
      if (current === "min_paid" && role === "system" && (ctx.signaturesCount ?? 0) >= 2) {
        return "countersigned";
      }
      break;
    }

    case "tick_clock": {
      if (current === "countersigned" && role === "system" && ctx.terms?.startISO) {
        const now = (ctx.now ?? new Date()).getTime();
        const start = new Date(ctx.terms.startISO).getTime();
        if (isFinite(start) && start <= now) return "occupied";
      }
      break;
    }

    case "reject": {
      if (current === "submitted" && role === "manager") return "rejected";
      break;
    }

    case "withdraw": {
      if (current === "submitted" && role === "tenant") return "withdrawn";
      break;
    }
  }

  // Illegal, or not yet satisfied -> stay put
  return current;
}

/* ─────────────────────────────────────────────────────────────
   Optional: declare allowed actions per state (for UI hints)
───────────────────────────────────────────────────────────── */
export const AllowedActions: Record<AppState, Action[]> = {
  draft: ["submit"],
  submitted: ["admin_screen", "approve_high", "reject", "withdraw"],
  admin_screened: ["approve_high"],
  approved_high: ["set_terms"],
  terms_set: ["system_min_ready"],
  min_due: ["payment_updated"],
  min_paid: ["signatures_completed"],
  countersigned: ["tick_clock"],
  occupied: [],
  rejected: [],
  withdrawn: [],
};

/* ─────────────────────────────────────────────────────────────
   Optional: derive countersign rules from your plan
   (call this when you "set terms")
───────────────────────────────────────────────────────────── */
export type MinRule = { bucket: MoneyBucket; minCents: number };

export function deriveMinRulesFromPlan(plan: {
  countersignUpfrontThresholdCents?: number | null;
  countersignDepositThresholdCents?: number | null;
} | null | undefined): MinRule[] {
  const up = n(plan?.countersignUpfrontThresholdCents);
  const dep = n(plan?.countersignDepositThresholdCents);
  const rules: MinRule[] = [];
  if (up > 0) rules.push({ bucket: "upfront", minCents: up });
  if (dep > 0) rules.push({ bucket: "deposit", minCents: dep });
  return rules;
}