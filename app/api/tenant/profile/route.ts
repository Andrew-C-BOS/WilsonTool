// app/api/tenant/profile/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toStringId(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (v instanceof ObjectId) return v.toHexString();
  return String(v);
}
function lc(s: unknown) {
  return typeof s === "string" ? s.toLowerCase() : "";
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const preferredNameRaw = typeof body?.preferredName === "string" ? body.preferredName : "";
    const preferredName = preferredNameRaw.trim();

    if (!preferredName) {
      return NextResponse.json({ ok: false, error: "preferred_name_required" }, { status: 400 });
    }
    if (preferredName.length > 80) {
      return NextResponse.json({ ok: false, error: "preferred_name_too_long", max: 80 }, { status: 400 });
    }

    const userEmail = lc((user as any).email);
    const userId = toStringId((user as any)._id ?? (user as any).id ?? (user as any).userId ?? userEmail);
    if (!userId) {
      return NextResponse.json({ ok: false, error: "no_user_id" }, { status: 400 });
    }

    const db = await getDb();
    const usersCol = db.collection("users");
    const membershipsCol = db.collection("household_memberships");
    const membershipsTypoCol = db.collection("household_memberhsips"); // legacy

    const now = new Date();

    // 1) Store on the user record (creates field if missing)
    await usersCol.updateOne(
      { _id: new ObjectId(userId).toString() === userId ? new ObjectId(userId) : { $exists: false } as any, email: { $exists: true } }, // handle non-ObjectId _id by falling back to email match
      { $set: { preferredName, updatedAt: now } }
    ).catch(async () => {
      // Fallback: match by email only if _id shape is unknown
      await usersCol.updateOne({ email: (user as any).email }, { $set: { preferredName, updatedAt: now } }, { upsert: false });
    });

    // 2) Propagate to membership rows so it shows in household contexts
    const membershipFilter = {
      $or: [{ userId }, { email: userEmail }, { email: (user as any).email }],
    };
    const membershipUpdate = { $set: { name: preferredName, updatedAt: now } };

    await Promise.all([
      membershipsCol.updateMany(membershipFilter, membershipUpdate),
      membershipsTypoCol.updateMany(membershipFilter, membershipUpdate),
    ]);

    return NextResponse.json({ ok: true, preferredName });
  } catch (err: any) {
    console.error("[profile preferredName] error:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
