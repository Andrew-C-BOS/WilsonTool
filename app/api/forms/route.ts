// app/api/forms/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const db = await getDb();
  const col = db.collection("application_forms");

  // In a future org-aware world, filter by orgId here
  const docs = await col
    .find({}, { projection: { name: 1, scope: 1, propertyId: 1 } })
    .sort({ updatedAt: -1 })
    .limit(100)
    .toArray();

  return NextResponse.json({
    ok: true,
    forms: docs.map((d: any) => ({
      _id: d._id,
      id: String(d._id),            // normalize for the client
      name: d.name ?? "Untitled",
      scope: d.scope ?? "portfolio",
      propertyId: d.propertyId ?? null,
    })),
  });
}

// Optional: allow your Builder to save new forms
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || !body.name || !Array.isArray(body.sections) || !Array.isArray(body.questions)) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const now = new Date();
  const doc = {
    name: String(body.name),
    description: body.description ?? "",
    scope: body.scope ?? "portfolio",
    sections: body.sections,
    questions: body.questions,
    qualifications: body.qualifications ?? [],
    version: body.version ?? 1,
    createdAt: now,
    updatedAt: now,
    createdBy: (user as any).email, // simple ownership for now
  };

  const db = await getDb();
  const res = await db.collection("application_forms").insertOne(doc);

  return NextResponse.json({ ok: true, id: String(res.insertedId) });
}
