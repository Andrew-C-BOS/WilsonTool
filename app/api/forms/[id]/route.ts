// app/api/forms/[id]/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> } // ← typed-routes passes a Promise
) {
  try {
    const { id } = await context.params; // ← await it
    const db = await getDb();

    // Handle both ObjectId and string ids
    const { ObjectId } = await import("mongodb");
    const isObjId = /^[0-9a-fA-F]{24}$/.test(id);

    const query = isObjId ? { _id: new ObjectId(id) } : { _id: id };
    let doc = await db.collection("application_forms").findOne(query);

    // (Optional) If you store a separate "id" field, try that next
    if (!doc && !isObjId) {
      doc = await db.collection("application_forms").findOne({ id });
    }

    if (!doc) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    // Normalize id for the client
    const form = { ...doc, id: String(doc._id ?? doc.id) };
    return NextResponse.json({ ok: true, form });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
