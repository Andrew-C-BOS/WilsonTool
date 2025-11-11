// ./lib/indexes.ts
import { getDb } from "./db";

/** Create all MVP indexes. Safe to run multiple times. */
export async function createAllIndexes() {
  const db = await getDb();

  // ---------- helpers ----------
  async function collectionExists(name: string) {
    const cur = db.listCollections({ name });
    const one = await cur.next();
    return !!one;
  }
  async function createIfExists(name: string, fn: (col: any) => Promise<void>) {
    if (await collectionExists(name)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await fn(db.collection(name) as any);
    }
  }

  // ---------- users ----------
  await db.collection("users").createIndex({ email: 1 }, { unique: true, name: "uniq_email" });

  // ---------- orgs ----------
  await db.collection("orgs").createIndex({ slug: 1 }, { unique: true, name: "uniq_slug" });

  // ---------- org_memberships ----------
  await db.collection("org_memberships").createIndex(
    { orgId: 1, userId: 1 },
    { unique: true, name: "uniq_org_user" }
  );
  await db.collection("org_memberships").createIndex({ userId: 1 }, { name: "by_user" });
  await db.collection("org_memberships").createIndex(
    { orgId: 1, orgRole: 1 },
    { name: "by_org_role" }
  );

  // ---------- properties ----------
  await db.collection("properties").createIndex({ orgId: 1 }, { name: "by_org" });

  // ---------- applications ----------
  await db.collection("applications").createIndex(
    { orgId: 1, status: 1, createdAt: -1 },
    { name: "pipeline" }
  );
  await db.collection("applications").createIndex(
    { orgId: 1, propertyId: 1, unitId: 1 },
    { name: "routing" }
  );

  // ---------- reviews ----------
  await db.collection("application_reviews").createIndex(
    { applicationId: 1, createdAt: -1 },
    { name: "by_app_time" }
  );
  await db.collection("application_reviews").createIndex(
    { orgId: 1, reviewerUserId: 1, createdAt: -1 },
    { name: "by_reviewer" }
  );

  // ---------- approvals ----------
  await db.collection("application_approvals").createIndex(
    { applicationId: 1, effective: 1 },
    { name: "by_app_effective" }
  );
  await db.collection("application_approvals").createIndex(
    { orgId: 1, approverUserId: 1, createdAt: -1 },
    { name: "by_approver" }
  );

  // ---------- audit ----------
  await db.collection("audit_log").createIndex(
    { orgId: 1, "entity.type": 1, "entity.id": 1, at: -1 },
    { name: "audit_entity" }
  );

  // ---------- forms ----------
  await db.collection("application_forms").createIndex({ name: 1 }, { name: "by_name" });
  await db.collection("application_forms").createIndex({ updatedAt: -1 }, { name: "by_updated" });

  // ---------- households ----------
  await db.collection("households").createIndex({ createdAt: 1 }, { name: "by_created" });

  // ---------- household_memberships (canonical) ----------
  // Strong rule: at most one ACTIVE membership per user
  await db.collection("household_memberships").createIndex(
    { userId: 1, active: 1 },
    {
      unique: true,
      partialFilterExpression: { active: true },
      name: "uniq_active_user_membership",
    }
  );
  // Also guard email-based flows (before a userId exists)
  await db.collection("household_memberships").createIndex(
    { email: 1, active: 1 },
    {
      unique: true,
      partialFilterExpression: { active: true, email: { $type: "string" } },
      name: "uniq_active_email_membership",
    }
  );
  // Fast lookups within a household
  await db.collection("household_memberships").createIndex(
    { householdId: 1, active: 1, role: 1 },
    { name: "by_household_active_role" }
  );
  // Optional: by user for dashboards
  await db.collection("household_memberships").createIndex(
    { userId: 1, active: 1 },
    { name: "by_user_active" }
  );

  // ---------- household_memberhsips (legacy typo) ----------
  // Mirror protections only if the legacy collection exists
  await createIfExists("household_memberhsips", async (col) => {
    await col.createIndex(
      { userId: 1, active: 1 },
      {
        unique: true,
        partialFilterExpression: { active: true },
        name: "uniq_active_user_membership",
      }
    );
    await col.createIndex(
      { email: 1, active: 1 },
      {
        unique: true,
        partialFilterExpression: { active: true, email: { $type: "string" } },
        name: "uniq_active_email_membership",
      }
    );
    await col.createIndex(
      { householdId: 1, active: 1, role: 1 },
      { name: "by_household_active_role" }
    );
    await col.createIndex({ userId: 1, active: 1 }, { name: "by_user_active" });
  });

  // ---------- household_invites ----------
  // BUGFIX: you store codeHash, not code — make the unique on codeHash
  await db.collection("household_invites").createIndex(
    { codeHash: 1 },
    { unique: true, name: "uniq_codeHash" }
  );
  await db.collection("household_invites").createIndex(
    { householdId: 1, state: 1, expiresAt: 1 },
    { name: "by_household_state_exp" }
  );
  await db.collection("household_invites").createIndex(
    { email: 1, state: 1, expiresAt: 1 },
    { name: "by_email_state_exp" }
  );
  // TTL on expiresAt (Mongo requires TTL key only; partial is allowed)
  await db.collection("household_invites").createIndex(
    { expiresAt: 1 },
    {
      expireAfterSeconds: 0,
      partialFilterExpression: { expiresAt: { $exists: true } },
      name: "ttl_expiresAt",
    }
  );
}
