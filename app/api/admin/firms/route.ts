// app/api/admin/firms/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db"; // ⬅️ adjust if your helper lives at "@/lib/db"
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAppAdmin(user: any) {
  return user?.isAdmin === true || user?.role === "admin";
}

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// Optional, keep IDs stringy and readable
function newFirmId() {
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36);
  return `firm_${ts}${rand}`;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user || !isAppAdmin(user)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const db = await getDb();
  const firms = await db.collection("FirmDoc").find({}).sort({ createdAt: -1 }).toArray();
  return NextResponse.json({ ok: true, firms });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !isAppAdmin(user)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const body = await req.json();
  const name: string = body?.name;
  let slug: string = body?.slug;
  if (!name || !slug) return NextResponse.json({ ok: false, error: "name and slug are required" }, { status: 400 });

  slug = slugify(slug);

  const doc = {
    _id: newFirmId(),
    name,
    slug,
    address: body?.address,
    logo: body?.logo,
    website: body?.website,
    contactEmail: body?.contactEmail,
    contactPhone: body?.contactPhone,
    createdAt: new Date(),
  };

  const db = await getDb();

  // Ensure uniqueness on slug at application level too
  const exists = await db.collection("FirmDoc").findOne({ slug });
  if (exists) return NextResponse.json({ ok: false, error: "slug already exists" }, { status: 409 });

  await db.collection("FirmDoc").insertOne(doc as any);
  return NextResponse.json({ ok: true, firm: doc }, { status: 201 });
}
