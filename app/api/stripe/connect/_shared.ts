// app/api/stripe/connect/_shared.ts
import { getDb } from "@/lib/db";

export function toStringId(v: any) {
  if (!v) return "";
  if (typeof v === "string") return v;
  try { return v?.toString ? v.toString() : String(v); } catch { return String(v); }
}

/**
 * Finds exactly ONE active membership where the user is owner/admin.
 * Does NOT enforce that a corresponding 'firms' doc exists.
 * Throws:
 *  - 403 no_admin_membership
 *  - 409 ambiguous_firm (if user is admin of multiple firms)
 */
export async function resolveAdminFirmForUser(user: any): Promise<{ firmId: string; role: string }> {
  const db = await getDb();
  const { ObjectId } = await import("mongodb");

  const uidStr = toStringId(user?._id ?? user?.id ?? user?.userId ?? user?.email ?? "");
  const uidOid = uidStr && ObjectId.isValid(uidStr) ? new ObjectId(uidStr) : null;

  const userIdOr: any[] = [];
  if (uidStr) userIdOr.push({ userId: uidStr });
  if (uidOid) userIdOr.push({ userId: uidOid });
  if (!userIdOr.length) {
    const err: any = new Error("no_admin_membership");
    err.status = 403; throw err;
  }

  const rows = await db.collection("firm_memberships")
    .find(
      { active: true, role: { $in: ["owner", "admin"] }, $or: userIdOr },
      { projection: { firmId: 1, role: 1, _id: 0 } }
    )
    .limit(5)
    .toArray();

  if (!rows.length) {
    const err: any = new Error("no_admin_membership");
    err.status = 403; throw err;
  }
  if (rows.length > 1) {
    const err: any = new Error("ambiguous_firm");
    err.status = 409;
    err.data = { firms: rows.map(r => ({ firmId: r.firmId, role: r.role })) };
    throw err;
  }

  return { firmId: String(rows[0].firmId), role: String(rows[0].role) };
}
