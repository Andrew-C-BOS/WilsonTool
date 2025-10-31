import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const db = await getDb();
    const { ObjectId } = await import("mongodb");
    const isObj = /^[0-9a-fA-F]{24}$/.test(params.id);
    const query = isObj ? { _id: new ObjectId(params.id) } : { _id: params.id, id: params.id };
    const doc = await db.collection("application_forms").findOne(query);
    if (!doc) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    // normalize
    const form = { ...doc, id: String(doc._id || doc.id) };
    return NextResponse.json({ ok: true, form });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
