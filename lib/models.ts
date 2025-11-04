/* ---------- IDs ---------- */
export type Id = string; // store ObjectId as string in types, convert at the edge if needed

/* ---------- Users ---------- */
export type UserRoleApp = "tenant" | "landlord";

export interface UserDoc {
  _id: Id;
  email: string;
  passwordHash: string;
  role: UserRoleApp;           // app-level capability
  createdAt: Date;
}

/* ---------- Firms (top-level landlord entities) ---------- */
export interface FirmDoc {
  _id: Id;                     // unique firm identifier (e.g. "firm_abc123")
  name: string;                // "XYZ Co"
  slug: string;                // "xyz-co"  (used in URLs)
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  logo?: {
    url: string;               // public image URL (CDN or storage)
    key?: string;              // optional storage key
    width?: number;
    height?: number;
  };
  website?: string;            // e.g. "https://xyzco.com"
  contactEmail?: string;       // e.g. "leasing@xyzco.com"
  contactPhone?: string;
  createdAt: Date;
}


/* ---------- Orgs (firms) ---------- */
export interface OrgDoc {
  _id: Id;
  name: string;
  slug: string;                // unique
  createdAt: Date;
  settings: {
    approvalPolicy: {
      requireReviewerBeforeApprover: boolean;
      fourEyes: boolean;       // approver must differ from last reviewer
      autoRejectThreshold?: number | null;
    };
    lease?: { templateId?: string | null };
  };
}

/* ---------- Org memberships (RBAC) ---------- */
export type OrgRole = "reviewer" | "approver" | "admin";

export interface OrgMembershipDoc {
  _id: Id;
  orgId: Id;
  userId: Id;
  orgRole: OrgRole;
  scopes?: {
    properties?: string[];     // property ids (strings are fine at MVP)
    units?: string[];
  };
  active: boolean;
  createdAt: Date;
}

/* ---------- Properties ---------- */
export interface PropertyDoc {
  _id: string;                 // "prop_abc"
  orgId: Id;
  name: string;
  address?: { line1?: string; city?: string; state?: string; zip?: string };
  units?: { unitId: string; beds?: number; baths?: number; rent?: number }[];
  createdAt: Date;
}

/* ---------- Shared (tenant application roles & statuses) ---------- */
export type MemberRole = "primary" | "co_applicant" | "cosigner";

export type AppStatus =
  | "draft"
  | "new"
  | "in_review"
  | "needs_approval"
  | "approved_pending_lease"
  | "rejected";

/* ---------- Tenant application instances (what renters fill) ---------- */
export interface ApplicationMember {
  userId: Id;                          // tie to logged-in user (or stable identifier)
  email: string;
  name?: string;
  role: MemberRole;
  state?: "invited" | "complete" | "missing_docs";
  joinedAt: Date;
}


/* ---------- Tenant application instances ---------- */
export interface ApplicationDoc {
  _id: Id;

  /* Link back to the form template */
  formId: Id;

  /* Optional: denormalize firm for fast routing (filled from form.firmId) */
  firmId?: Id;

  /* Optional denormalized hints (nice for dashboards) */
  property?: string;
  unit?: string;

  members: ApplicationMember[];
  status: AppStatus;
  tasks?: { myIncomplete?: number; householdIncomplete?: number; missingDocs?: number };
  createdAt: Date;
  updatedAt: Date;
  submittedAt?: Date;
}

/* ---------- Households: just the group anchor ---------- */
export interface HouseholdDoc {
  _id: Id;
  displayName?: string | null;          // “A2 · Cambridge Flats”, or null
  createdBy: Id;                         // who formed the cluster
  createdAt: Date;
  updatedAt: Date;
  archived?: boolean;                    // soft flag when emptied or merged
}

/* ---------- Memberships: the edges between users and a household ---------- */
export type HouseholdRole = "primary" | "co_applicant" | "cosigner";

export interface HouseholdMembershipDoc {
  _id: Id;
  householdId: Id;
  userId: Id;
  role: HouseholdRole;                   // household-level role, independent of app roles
  active: boolean;                       // invariant: at most one active per user
  joinedAt: Date;
  leftAt?: Date;

  // convenient denorms for UI lists,
  email?: string;
  name?: string;
}

/* ---------- Invites: to connect more people into the cluster ---------- */
export interface HouseholdInviteDoc {
  _id: Id;
  code: string;                          // short, unique, human-friendly
  householdId: Id;
  role?: HouseholdRole;                  // default suggestion for the joiner
  createdBy: Id;
  createdAt: Date;
  expiresAt?: Date;
  maxUses?: number | null;               // null = unlimited
  uses: number;                          // increment on redemption
  disabled?: boolean;
}


/* ---------- Invites (for joining an application) ---------- */
export interface ApplicationInviteDoc {
  _id: Id;
  token: string;              // unique short code
  appId: Id;                  // ApplicationDoc._id
  role?: MemberRole;          // default role for the invite (co_applicant / cosigner)
  createdAt: Date;
  expiresAt?: Date;
  usedBy?: Id;                // userId who redeemed it
  usedAt?: Date;
}

/* ---------- Application forms (admin-defined templates) ---------- */
export interface ApplicationFormDoc {
  _id: Id;

  /* NEW: scope forms to a firm */
  firmId: Id;

  name: string;
  description?: string;
  scope: "portfolio";                      // firm-wide for MVP; add "property" later
  sections: { id: string; title: string; description?: string }[];
  questions: {
    id: string;
    sectionId: string;
    label: string;
    helpText?: string;
    inputType:
      | "short_text" | "long_text" | "number" | "currency" | "yes_no"
      | "date" | "email" | "phone" | "select_single" | "select_multi" | "file";
    required: boolean;
    showForRoles: MemberRole[];            // who must answer
    options?: string[];                    // for select types
    validation?: { min?: number; max?: number; pattern?: string };
  }[];
  qualifications: {
    id: string;
    title: string;
    audience: MemberRole[];
    requirement: "required" | "optional" | "conditional";
    mode: "self_upload" | "integration" | "either";
    docKind?: string;
    notes?: string;
  }[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
}

/* ---------- Reviews & Approvals (landlord-side) ---------- */
export type ReviewDecision = "reject" | "recommend_approve" | "needs_info";

export interface ApplicationReviewDoc {
  _id: Id;
  orgId: Id;
  applicationId: Id;
  reviewerUserId: Id;
  decision: ReviewDecision;
  notes?: string;
  attachments?: { kind: string; url: string }[];
  createdAt: Date;
}

export type ApprovalDecision = "approve" | "reject";

export interface ApplicationApprovalDoc {
  _id: Id;
  orgId: Id;
  applicationId: Id;
  approverUserId: Id;
  decision: ApprovalDecision;
  notes?: string;
  effective: boolean;         // only one should be true
  createdAt: Date;
}

/* ---------- Audit log ---------- */
export interface AuditLogDoc {
  _id: Id;
  orgId: Id;
  actorUserId: Id | "system";
  entity: { type: "application"; id: Id };
  action: string;              // e.g., "review.create"
  meta?: Record<string, unknown>;
  at: Date;
}
