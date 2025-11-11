// app/api/tenant/applications/search/firms/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return NextResponse.json({ ok: true, results: [] });

    const db = await getDb();
    const firmsCol = db.collection("FirmDoc");               // rename if your collection differs
    const formsCol = db.collection("application_forms");   // rename if your collection differs

    // Basic text-ish search across name, slug, city/state/line1
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const firms = await firmsCol
      .find({
        $or: [
          { name: rx },
          { slug: rx },
          { "address.city": rx },
          { "address.state": rx },
          { "address.line1": rx },
        ],
      })
      .limit(20)
      .toArray();

    if (!firms.length) return NextResponse.json({ ok: true, results: [] });

    const firmIds = firms.map((f: any) => String(f._id));

    // Pull active forms for those firms (tweak filter to your schema if you track active/archived)
    const forms = await formsCol
      .find({ firmId: { $in: firmIds } })
      .project({ _id: 1, firmId: 1, name: 1, description: 1, scope: 1 })
      .toArray();

    const formsByFirm = new Map<string, any[]>();
    for (const fm of forms) {
      const key = String(fm.firmId);
      if (!formsByFirm.has(key)) formsByFirm.set(key, []);
      formsByFirm.get(key)!.push({
        id: String(fm._id),
        name: fm.name,
        description: fm.description ?? null,
        scope: fm.scope ?? "portfolio",
      });
    }

    const results = firms.map((f: any) => ({
      id: String(f._id),
      name: f.name as string,
      slug: f.slug as string | undefined,
      address: f.address ?? {},
      logoUrl: f.logo?.url ?? null,
      website: f.website ?? null,
      contactEmail: f.contactEmail ?? null,
      forms: formsByFirm.get(String(f._id)) ?? [],
    }));

    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    console.error("[firms.search] error", e);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
