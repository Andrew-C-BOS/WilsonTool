import type {
  UserDoc, OrgDoc, OrgMembershipDoc, PropertyDoc,
  ApplicationDoc, ApplicationReviewDoc, ApplicationApprovalDoc, AuditLogDoc
} from "./models";
import { getDb } from "./db";
import type { Collection } from "mongodb";

type NameMap = {
  users: UserDoc;
  orgs: OrgDoc;
  org_memberships: OrgMembershipDoc;
  properties: PropertyDoc;
  applications: ApplicationDoc;
  application_reviews: ApplicationReviewDoc;
  application_approvals: ApplicationApprovalDoc;
  audit_log: AuditLogDoc;
};

export async function col<K extends keyof NameMap>(name: K): Promise<Collection<NameMap[K]>> {
  const db = await getDb();
  return db.collection<NameMap[K]>(name);
}
