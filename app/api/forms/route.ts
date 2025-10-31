import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // naive validation for MVP
    if (!body?.name || !Array.isArray(body.sections) || !Array.isArray(body.questions)) {
      return NextResponse.json({ ok: false, error: "Invalid form body" }, { status: 400 });
    }
    const db = await getDb();
    const now = new Date();
    const doc = {
      name: String(body.name),
      description: String(body.description || ""),
      scope: "portfolio",
      sections: body.sections,
      questions: body.questions,
      qualifications: body.qualifications || [],
      version: Number(body.version || 1),
      createdAt: now,
      updatedAt: now,
      // TODO: set orgId from membership, for now we store owner for traceability
      ownerUserId: null,
    };
    const res = await db.collection("application_forms").insertOne(doc);
    return NextResponse.json({ ok: true, id: String(res.insertedId) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function GET() {
  const db = await getDb();
  const forms = await db.collection("application_forms").find({}).project({ name: 1, version: 1, updatedAt: 1 }).sort({ updatedAt: -1 }).limit(50).toArray();
  return NextResponse.json({ ok: true, forms });
}
