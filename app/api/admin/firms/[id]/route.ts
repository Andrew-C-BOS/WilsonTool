// app/api/admin/firms/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ObjectId, type Filter } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAppAdmin(user: any) {
  return user?.isAdmin === true || user?.role === "admin";
}

export async function DELETE(
  _req: NextRequest,
  ctx: RouteContext<"/api/admin/firms/[id]">
) {
  const { id } = await ctx.params;

  const user = await getSessionUser();
  if (!user || !isAppAdmin(user)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const db = await getDb();

  // If you also store firmId as ObjectId in memberships, this will hit both string and ObjectId forms.
  const firmIdCandidates = ObjectId.isValid(id) ? [id, new ObjectId(id)] : [id];

  await db.collection("firm_memberships").deleteMany({
    firmId: { $in: firmIdCandidates as any[] },
  });

  // Build a filter that satisfies TS and matches either _id form
  const filter: Filter<any> = ObjectId.isValid(id)
    ? { _id: new ObjectId(id) }
    : { _id: id as any };

  const res = await db.collection("FirmDoc").deleteOne(filter);

  if (res.deletedCount === 0) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
