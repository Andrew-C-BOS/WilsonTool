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

/* ---------- Applications ---------- */
export type AppStatus =
  | "new"
  | "in_review"
  | "rejected"
  | "approved_pending_lease"
  | "lease_out"
  | "countersigned"
  | "withdrawn";

export interface ApplicationDoc {
  _id: Id;
  orgId: Id;
  propertyId: string;
  unitId: string;
  applicants: {
    personId: string;
    name: string;
    email: string;
    phone?: string;
    income?: number;
    employer?: string;
    documents?: { kind: string; url: string; uploadedAt: Date }[];
  }[];
  status: AppStatus;
  flags?: { needsMoreDocs?: boolean; risk?: number | null };
  timeline: { at: Date; by: string; event: string }[];
  createdAt: Date;
  updatedAt: Date;
}

/* ---------- Reviews & Approvals ---------- */
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
