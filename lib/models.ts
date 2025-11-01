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

export interface ApplicationDoc {
  _id: Id;

  /* Link back to the form template */
  formId: Id;

  /* Optional denormalized hints (nice for dashboards) */
  property?: string;
  unit?: string;

  /* Household members */
  members: ApplicationMember[];

  /* Current state */
  status: AppStatus;

  /* Optional convenience counters for dashboards (can be computed) */
  tasks?: {
    myIncomplete?: number;
    householdIncomplete?: number;
    missingDocs?: number;
  };

  /* Timestamps */
  createdAt: Date;
  updatedAt: Date;
  submittedAt?: Date;

  /* Future persistence (answers/uploads/chat) can be added later:
     answers?: Record<string, any>;
     files?: Record<string, { name: string; size: number; key?: string; url?: string }[]>;
     messages?: { senderUserId: Id; body: string; at: Date; attachments?: any[] }[];
  */
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
  _id: Id;                                 // Mongo _id
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
    title: string;                         // Government ID, Credit report, …
    audience: MemberRole[];                // primary / co_applicant / cosigner
    requirement: "required" | "optional" | "conditional";
    mode: "self_upload" | "integration" | "either";
    docKind?: string;                      // "government_id", "credit_report", etc.
    notes?: string;
  }[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;                      // email for traceability
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
