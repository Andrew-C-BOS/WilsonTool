import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LeaseStatus = "scheduled" | "active" | "ended" | "canceled";
const isIso = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
function toStringId(v: any) {
  try {
    return typeof v === "string" ? v : v?.toHexString?.() ?? String(v);
  } catch {
    return String(v);
  }
}

async function getParamId(
  req: NextRequest,
  ctx: { params?: any }
) {
  try {
    const p = await (ctx as any)?.params;
    const raw = Array.isArray(p?.id) ? p.id[0] : p?.id;
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
  ctx:
    | { params: { id: string } }
    | { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 }
    );
  }

  const db = await getDb();
  // Loosen collection types to avoid ObjectId-only _id constraints
  const leases = db.collection<any>("unit_leases");
  const fms = db.collection<any>("firm_memberships");
  const { ObjectId } = await import("mongodb");

  const id = await getParamId(req, ctx as any);
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "bad_id" },
      { status: 400 }
    );
  }

  const leaseFilter: { _id: any } = ObjectId.isValid(id)
    ? { _id: new ObjectId(id) }
    : { _id: id };

  const lease = await leases.findOne(leaseFilter);
  if (!lease) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 }
    );
  }

  // auth
  const firmId = String(lease.firmId);
  const uid = toStringId(
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

  return NextResponse.json({ ok: true, lease });
}

export async function PATCH(
  req: NextRequest,
  ctx:
    | { params: { id: string } }
    | { params: Promise<{ id: string }> }
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
  const fms = db.collection<any>("firm_memberships");
  const { ObjectId } = await import("mongodb");

  const id = await getParamId(req, ctx as any);
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "bad_id" },
      { status: 400 }
    );
  }

  const leaseFilter: { _id: any } = ObjectId.isValid(id)
    ? { _id: new ObjectId(id) }
    : { _id: id };

  const lease = await leases.findOne(leaseFilter);
  if (!lease) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 }
    );
  }

  // auth
  const firmId = String(lease.firmId);
  const uid = toStringId(
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

  // body
  const body = await req.json().catch(() => ({}));
  const moveInDate = body?.moveInDate
    ? String(body.moveInDate).slice(0, 10)
    : undefined;
  const moveOutDate =
    body?.moveOutDate === null
      ? null
      : body?.moveOutDate
      ? String(body.moveOutDate).slice(0, 10)
      : undefined;
  const signed = body?.signed as boolean | undefined;
  const status = body?.status as LeaseStatus | undefined;

  if (moveInDate && !isIso(moveInDate)) {
    return NextResponse.json(
      { ok: false, error: "bad_move_in" },
      { status: 400 }
    );
  }
  if (
    moveOutDate !== undefined &&
    moveOutDate !== null &&
    !isIso(moveOutDate)
  ) {
    return NextResponse.json(
      { ok: false, error: "bad_move_out" },
      { status: 400 }
    );
  }
  if (
    moveInDate &&
    moveOutDate &&
    moveOutDate <= moveInDate
  ) {
    return NextResponse.json(
      { ok: false, error: "move_out_before_in" },
      { status: 400 }
    );
  }

  // Overlap guard if scheduled/active window would collide with another lease on same unit
  const nextStatus: LeaseStatus = status ?? lease.status;
  const nextStart = moveInDate ?? lease.moveInDate;
  const nextEnd =
    (moveOutDate !== undefined
      ? moveOutDate
      : lease.moveOutDate) ?? "9999-12-31";

  if (["scheduled", "active"].includes(nextStatus)) {
    const conflict = await leases.findOne(
      {
        firmId,
        $or: [
          lease.unitId
            ? { unitId: lease.unitId }
            : { unitNumber: lease.unitNumber ?? "__none__" },
        ],
        status: { $in: ["scheduled", "active"] },
        _id: { $ne: lease._id },
        $expr: {
          $and: [
            { $lt: ["$moveInDate", nextEnd] },
            {
              $lt: [
                nextStart,
                { $ifNull: ["$moveOutDate", "9999-12-31"] },
              ],
            },
          ],
        },
      },
      { projection: { _id: 1 } }
    );
    if (conflict) {
      return NextResponse.json(
        { ok: false, error: "overlap" },
        { status: 409 }
      );
    }
  }

  const now = new Date();
  const set: any = { updatedAt: now };
  if (moveInDate) set.moveInDate = moveInDate;
  if (moveOutDate !== undefined) set.moveOutDate = moveOutDate;
  if (status) set.status = status;
  if (signed !== undefined) {
    set.signed = !!signed;
    set.signedAt = signed ? now : null;
  }

  await leases.updateOne(
    { _id: lease._id },
    { $set: set }
  );

  return NextResponse.json({
    ok: true,
    updatedAt: now.toISOString(),
  });
}
