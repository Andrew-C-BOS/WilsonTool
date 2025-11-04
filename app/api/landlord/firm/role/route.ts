// app/api/landlord/firm/role/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toStringId(v: any) {
  if (!v) return "";
  if (typeof v === "string") return v;
  try { return v?.toHexString ? v.toHexString() : String(v); } catch { return String(v); }
}
const isHex24 = (s: string) => /^[0-9a-fA-F]{24}$/.test(s);

/** Safely extract a user identifier across auth shapes */
function pickUserId(user: unknown): string {
  const u = user as any;
  return toStringId(
    u?._id ??
    u?.id ??        // some auth libs
    u?.userId ??    // custom
    u?.sub ??       // JWT
    u?.uid ??       // Firebase
    u?.email ??     // last resort
    ""
  );
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const db = await getDb();
  const { ObjectId } = await import("mongodb");
  const fm = db.collection("firm_memberships");
  const apps = db.collection("applications");
  const forms = db.collection("application_forms");

  const url = new URL(req.url);
  let firmId = url.searchParams.get("firmId") || "";
  const appId = url.searchParams.get("appId") || "";

  // If firmId missing but appId provided, resolve firm via app -> form
  if (!firmId && appId) {
    const appFilter = isHex24(appId) ? { _id: new ObjectId(appId) } : ({ _id: appId } as any);
    const app = await apps.findOne(appFilter, { projection: { formId: 1 } });
    if (app?.formId) {
      const formKey = String(app.formId);
      const form = await forms.findOne(
        isHex24(formKey) ? { _id: new ObjectId(formKey) } : ({ _id: formKey } as any),
        { projection: { firmId: 1 } }
      );
      if (form?.firmId) firmId = String(form.firmId);
    }
  }

  // Last-resort fallback: if still no firmId, return role only when the user has EXACTLY one active membership
  if (!firmId) {
    const uidStr = pickUserId(user);
    const uidOid = ObjectId.isValid(uidStr) ? new ObjectId(uidStr) : null;
    const userIdOr = uidOid ? [{ userId: uidStr }, { userId: uidOid }] : [{ userId: uidStr }];
    const rows = await fm
      .find({ active: true, $or: userIdOr }, { projection: { firmId: 1, role: 1 } })
      .limit(3)
      .toArray();

    if (rows.length === 1) {
      return NextResponse.json({
        ok: true,
        role: rows[0].role ?? "none",
        firmId: String(rows[0].firmId),
      });
    }
    return NextResponse.json({ ok: false, error: "missing_firmId" }, { status: 400 });
  }

  // Normal path: resolve membership for firmId
  const uidStr = pickUserId(user);
  const uidOid = ObjectId.isValid(uidStr) ? new ObjectId(uidStr) : null;
  const userIdOr = uidOid ? [{ userId: uidStr }, { userId: uidOid }] : [{ userId: uidStr }];

  const m = await fm.findOne(
    { firmId, active: true, $or: userIdOr },
    { projection: { role: 1 } }
  );

  return NextResponse.json({ ok: true, role: m?.role ?? "none", firmId });
}
