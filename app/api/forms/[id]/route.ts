// app/api/forms/[id]/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const db = await getDb();
    const { ObjectId } = await import("mongodb");

    const col = db.collection("application_forms");

    // Query in two branches to satisfy types
    let doc: any = null;

    if (/^[0-9a-fA-F]{24}$/.test(id)) {
      // Only try ObjectId when it looks like one
      doc = await col.findOne({ _id: new ObjectId(id) });
    } else {
      // Try a string _id first if you ever stored it that way
      doc = await col.findOne({ _id: id as any });
      // Or your logical "id" field (common in apps)
      if (!doc) doc = await col.findOne({ id });
    }

    if (!doc) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    const form = { ...doc, id: String(doc._id ?? doc.id) };
    return NextResponse.json({ ok: true, form });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
