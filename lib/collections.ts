import type {
  UserDoc, OrgDoc, OrgMembershipDoc, PropertyDoc,
  ApplicationDoc, ApplicationInviteDoc, ApplicationFormDoc,
  ApplicationReviewDoc, ApplicationApprovalDoc, AuditLogDoc
} from "./models";
import { getDb } from "./db";
import type { Collection } from "mongodb";

/* ---------- Collection name → Type mapping ---------- */
type NameMap = {
  users: UserDoc;
  orgs: OrgDoc;
  org_memberships: OrgMembershipDoc;
  properties: PropertyDoc;

  /* Tenant + landlord application data */
  applications: ApplicationDoc;
  application_invites: ApplicationInviteDoc;
  application_forms: ApplicationFormDoc;

  /* Review / approval / audit trails */
  application_reviews: ApplicationReviewDoc;
  application_approvals: ApplicationApprovalDoc;
  audit_log: AuditLogDoc;
};

/* ---------- Typed collection helper ---------- */
export async function col<K extends keyof NameMap>(
  name: K
): Promise<Collection<NameMap[K]>> {
  const db = await getDb();
  return db.collection<NameMap[K]>(name);
}
