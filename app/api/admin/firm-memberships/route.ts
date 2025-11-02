// app/api/admin/firm-memberships/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAppAdmin(user: any) {
  return user?.isAdmin === true || user?.role === "admin";
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !isAppAdmin(user)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const firmId = searchParams.get("firmId");
  if (!firmId) return NextResponse.json({ ok: false, error: "firmId required" }, { status: 400 });

  const db = await getDb();

  // Join user emails for convenience
  const members = await db.collection("firm_memberships").aggregate([
    { $match: { firmId } },
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "u",
      },
    },
    {
      $project: {
        firmId: 1,
        userId: 1,
        role: 1,
        title: 1,
        department: 1,
        active: 1,
        createdAt: 1,
        updatedAt: 1,
        userEmail: { $arrayElemAt: ["$u.email", 0] },
      },
    },
    { $sort: { createdAt: -1 } },
  ]).toArray();

  return NextResponse.json({ ok: true, members });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !isAppAdmin(user)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const firmId: string = body?.firmId;
  const userEmail: string = body?.userEmail;
  const role: "owner" | "admin" | "member" = body?.role || "member";
  const title: string | undefined = body?.title;
  const department: string | undefined = body?.department;

  if (!firmId || !userEmail) return NextResponse.json({ ok: false, error: "firmId and userEmail are required" }, { status: 400 });

  const db = await getDb();

  const userDoc = await db.collection("users").findOne({ email: userEmail });
  if (!userDoc) return NextResponse.json({ ok: false, error: "user not found" }, { status: 404 });

  const now = new Date();
  const memberDoc = {
    _id: `fm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    firmId,
    userId: userDoc._id,
    role,
    title,
    department,
    active: true,
    createdAt: now,
    updatedAt: now,
  };

  // Upsert on (firmId,userId)
  await db.collection("firm_memberships").updateOne(
    { firmId, userId: userDoc._id },
    { $set: { role, title, department, active: true, updatedAt: now }, $setOnInsert: { _id: memberDoc._id, createdAt: now } },
    { upsert: true }
  );

  return NextResponse.json({ ok: true, member: { ...memberDoc, userEmail } }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !isAppAdmin(user)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const firmId = searchParams.get("firmId");
  const userId = searchParams.get("userId");
  if (!firmId || !userId) return NextResponse.json({ ok: false, error: "firmId and userId are required" }, { status: 400 });

  const db = await getDb();
  const res = await db.collection("firm_memberships").deleteOne({ firmId, userId });
  if (res.deletedCount === 0) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
