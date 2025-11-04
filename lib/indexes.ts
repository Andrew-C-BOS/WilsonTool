// ./lib/indexes.ts
import { getDb } from "./db";

/** Create all MVP indexes. Safe to run multiple times. */
export async function createAllIndexes() {
  const db = await getDb();

  // users
  await db.collection("users").createIndex({ email: 1 }, { unique: true, name: "uniq_email" });

  // orgs
  await db.collection("orgs").createIndex({ slug: 1 }, { unique: true, name: "uniq_slug" });

  // org_memberships
  await db.collection("org_memberships").createIndex(
    { orgId: 1, userId: 1 },
    { unique: true, name: "uniq_org_user" }
  );
  await db.collection("org_memberships").createIndex({ userId: 1 }, { name: "by_user" });
  await db.collection("org_memberships").createIndex(
    { orgId: 1, orgRole: 1 },
    { name: "by_org_role" }
  );

  // properties
  await db.collection("properties").createIndex({ orgId: 1 }, { name: "by_org" });

  // applications
  await db.collection("applications").createIndex(
    { orgId: 1, status: 1, createdAt: -1 },
    { name: "pipeline" }
  );
  await db.collection("applications").createIndex(
    { orgId: 1, propertyId: 1, unitId: 1 },
    { name: "routing" }
  );

  // reviews
  await db.collection("application_reviews").createIndex(
    { applicationId: 1, createdAt: -1 },
    { name: "by_app_time" }
  );
  await db.collection("application_reviews").createIndex(
    { orgId: 1, reviewerUserId: 1, createdAt: -1 },
    { name: "by_reviewer" }
  );

  // approvals
  await db.collection("application_approvals").createIndex(
    { applicationId: 1, effective: 1 },
    { name: "by_app_effective" }
  );
  await db.collection("application_approvals").createIndex(
    { orgId: 1, approverUserId: 1, createdAt: -1 },
    { name: "by_approver" }
  );

  // audit
  await db.collection("audit_log").createIndex(
    { orgId: 1, "entity.type": 1, "entity.id": 1, at: -1 },
    { name: "audit_entity" }
  );

  // forms
  await db.collection("application_forms").createIndex({ name: 1 }, { name: "by_name" });
  await db.collection("application_forms").createIndex({ updatedAt: -1 }, { name: "by_updated" });

  // households
  await db.collection("households").createIndex({ createdAt: 1 }, { name: "by_created" });

  // exactly one active membership per user
  await db.collection("household_memberships").createIndex(
    { userId: 1 },
    { unique: true, partialFilterExpression: { active: true }, name: "uniq_active_user_membership" }
  );

  // fast lookups per household, and active flag
  await db.collection("household_memberships").createIndex(
    { householdId: 1, active: 1 },
    { name: "by_household_active" }
  );

  // invites
  await db.collection("household_invites").createIndex({ code: 1 }, { unique: true, name: "uniq_code" });
  await db.collection("household_invites").createIndex({ householdId: 1 }, { name: "by_household" });
  await db.collection("household_invites").createIndex(
    { expiresAt: 1 },
    {
      expireAfterSeconds: 0,
      partialFilterExpression: { expiresAt: { $exists: true } },
      name: "ttl_expiresAt",
    }
  );
}
