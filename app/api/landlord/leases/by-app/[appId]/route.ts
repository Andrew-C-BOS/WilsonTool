import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getParam(req: NextRequest, ctx: { params?: any }) {
  try {
    const p = await (ctx as any)?.params;
    const raw = Array.isArray(p?.appId) ? p.appId[0] : p?.appId;
    if (raw) return String(raw);
  } catch {}
  return (
    (req.nextUrl?.pathname || "")
      .split("/")
      .filter(Boolean)
      .pop() || ""
  );
}

export async function GET(
  req: NextRequest,
  ctx: { params: { appId: string } } | { params: Promise<{ appId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 }
    );
  }

  const db = await getDb();
  const leases = db.collection<any>("unit_leases");
  const apps = db.collection<any>("applications");
  const forms = db.collection<any>("application_forms");
  const fms = db.collection<any>("firm_memberships");
  const { ObjectId } = await import("mongodb");

  const appId = await getParam(req, ctx as any);
  if (!appId) {
    return NextResponse.json(
      { ok: false, error: "bad_application_id" },
      { status: 400 }
    );
  }

  const appFilter: { _id: any } = ObjectId.isValid(appId)
    ? { _id: new ObjectId(appId) }
    : { _id: appId };

  const app = await apps.findOne(appFilter, {
    projection: { _id: 1, formId: 1 },
  });
  if (!app) {
    return NextResponse.json(
      { ok: false, error: "application_not_found" },
      { status: 404 }
    );
  }

  const formFilter: { _id: any } = ObjectId.isValid(String(app.formId))
    ? { _id: new ObjectId(String(app.formId)) }
    : { _id: String(app.formId) };

  const form = await forms.findOne(formFilter, {
    projection: { firmId: 1 },
  });
  if (!form?.firmId) {
    return NextResponse.json(
      { ok: false, error: "firm_not_found" },
      { status: 400 }
    );
  }

  // auth
  const firmId = String(form.firmId);
  const uid = String(
    (user as any)._id ??
      (user as any).id ??
      (user as any).userId ??
      (user as any).email
  );
  const uidOid = ObjectId.isValid(uid) ? new ObjectId(uid) : null;
  const membership = await fms.findOne(
    {
      firmId,
      active: true,
      $or: uidOid
        ? [{ userId: uid }, { userId: uidOid }]
        : [{ userId: uid }],
    },
    { projection: { _id: 1 } }
  );
  if (!membership) {
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 }
    );
  }

  const lease = await leases.findOne(
    { firmId, appId: String(app._id) },
    { projection: { meta: 0 } }
  );

  return NextResponse.json({ ok: true, lease });
}
