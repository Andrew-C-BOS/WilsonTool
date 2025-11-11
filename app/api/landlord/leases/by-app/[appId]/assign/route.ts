import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LeaseStatus = "scheduled" | "active" | "ended" | "canceled";
const isHex24 = (s: string) => /^[0-9a-fA-F]{24}$/.test(s);
const rand = (n=22) => Array.from({length:n},()=>Math.floor(Math.random()*36).toString(36)).join("");
function toStringId(v:any){ try { return typeof v==="string" ? v : v?.toHexString?.() ?? String(v);} catch { return String(v);} }

async function getAppParam(req: NextRequest, ctx: { params?: any }) {
  try { const p=await (ctx as any)?.params; const raw=Array.isArray(p?.appId)?p.appId[0]:p?.appId; if(raw) return String(raw);} catch{}
  return (req.nextUrl?.pathname||"").split("/").filter(Boolean).pop() || "";
}

export async function POST(
  req: NextRequest,
  ctx: { params: { appId: string } } | { params: Promise<{ appId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok:false, error:"not_authenticated" }, { status:401 });

  const db = await getDb();
  const { ObjectId } = await import("mongodb");
  const apps   = db.collection("applications");
  const forms  = db.collection("application_forms");
  const fms    = db.collection("firm_memberships");
  const leases = db.collection("unit_leases");

  const appId = await getAppParam(req, ctx as any);
  if (!appId) return NextResponse.json({ ok:false, error:"bad_application_id" }, { status:400 });

  const body = await req.json().catch(()=> ({}));
  const moveInDate: string = String(body?.moveInDate || "").slice(0,10);
  const moveOutDate: string | null = body?.moveOutDate ? String(body.moveOutDate).slice(0,10) : null;
  const signed: boolean = !!body?.signed;
  const status: LeaseStatus = (body?.status as LeaseStatus) || "scheduled";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(moveInDate)) return NextResponse.json({ ok:false, error:"bad_move_in" }, { status:400 });
  if (moveOutDate && !/^\d{4}-\d{2}-\d{2}$/.test(moveOutDate)) return NextResponse.json({ ok:false, error:"bad_move_out" }, { status:400 });
  if (moveOutDate && moveOutDate <= moveInDate) return NextResponse.json({ ok:false, error:"move_out_before_in" }, { status:400 });

  const appFilter = isHex24(appId) ? { _id: new ObjectId(appId) } : ({ _id: appId } as any);
  const app = await apps.findOne(appFilter, { projection: { _id:1, householdId:1, formId:1, building:1, unit:1, protoLease:1 } });
  if (!app) return NextResponse.json({ ok:false, error:"application_not_found" }, { status:404 });

  const formKey = toStringId(app.formId);
  const form = await forms.findOne(isHex24(formKey) ? { _id: new ObjectId(formKey) } : ({ _id: formKey } as any), { projection: { firmId:1 } });
  if (!form?.firmId) return NextResponse.json({ ok:false, error:"firm_not_found" }, { status:400 });
  const firmId = String(form.firmId);

  // Auth: firm membership
  const uid = toStringId((user as any)._id ?? (user as any).id ?? (user as any).userId ?? (user as any).email);
  const uidOid = ObjectId.isValid(uid) ? new ObjectId(uid) : null;
  const userIdOr = uidOid ? [{ userId: uid }, { userId: uidOid }] : [{ userId: uid }];
  const membership = await fms.findOne({ firmId, active:true, $or: userIdOr }, { projection: { _id:1 } });
  if (!membership) return NextResponse.json({ ok:false, error:"forbidden" }, { status:403 });

  const unitNumber = app?.unit?.unitNumber ?? null;
  const building = app?.building ? {
    addressLine1: app.building.addressLine1,
    addressLine2: app.building.addressLine2 ?? null,
    city: app.building.city,
    state: app.building.state,
    postalCode: app.building.postalCode,
    country: app.building.country ?? "US",
  } : null;

  const monthlyRent = Number(app?.protoLease?.monthlyRent ?? 0) || null;

  // Overlap guard for scheduled/active leases in same unitNumber (or unitId when you add one)
  if (["scheduled","active"].includes(status)) {
    const overlap = await leases.findOne({
      firmId,
      $or: [ unitNumber ? { unitNumber } : { unitNumber: "__none__" } ],
      status: { $in: ["scheduled","active"] },
      $expr: {
        $and: [
          { $lt: ["$moveInDate", moveOutDate ?? "9999-12-31"] },
          { $lt: [moveInDate, { $ifNull: ["$moveOutDate", "9999-12-31"] }] }
        ]
      }
    }, { projection: { _id:1, moveInDate:1, moveOutDate:1, status:1 } });

    if (overlap) return NextResponse.json({ ok:false, error:"overlap", details: overlap }, { status:409 });
  }

  const now = new Date();
  const leaseId = `lease_${rand(18)}`;

  await leases.updateOne(
    { firmId, appId: String(app._id) }, // one lease per application record (adjust if needed)
    {
      $setOnInsert: {
        _id: leaseId, firmId, appId: String(app._id), householdId: toStringId(app.householdId), createdAt: now,
      },
      $set: {
        propertyId: null,
        unitId: null,
        unitNumber,
        building,
        moveInDate,
        moveOutDate: moveOutDate ?? null,
        monthlyRent,
        signed,
        signedAt: signed ? now : null,
        status,
        updatedAt: now,
      }
    },
    { upsert: true }
  );

  const out = await leases.findOne({ firmId, appId: String(app._id) }, { projection: { _id:1 } });
  return NextResponse.json({ ok:true, leaseId: out?._id ?? leaseId });
}
