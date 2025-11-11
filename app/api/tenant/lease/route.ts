import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { ObjectId } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ── helpers ─────────────────────────────────────────────── */
function parseDateOnly(ymd?: string | null): Date | null {
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}
function startOfTodayLocal(): Date {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate(), 0, 0, 0, 0);
}
const norm = (v: any) => (v == null ? null : String(v));

type ChecklistItem = {
  key: string;
  label: string;
  dueAt?: string | null;
  completedAt?: string | null;
  notes?: string | null;
};
function defaultChecklist(dueISO: string): ChecklistItem[] {
  return [
    { key: "id_upload",            label: "Upload government ID",        dueAt: dueISO, completedAt: null, notes: null },
    { key: "renter_insurance",     label: "Provide renter’s insurance",  dueAt: dueISO, completedAt: null, notes: null },
    { key: "schedule_walkthrough", label: "Pre-Move Inspection",        dueAt: dueISO, completedAt: null, notes: null },
    { key: "keys",                 label: "Pick up keys / access fobs",  dueAt: dueISO, completedAt: null, notes: null },
    { key: "rent_autopay",         label: "Set up rent autopay",         dueAt: dueISO, completedAt: null, notes: null },
  ];
}

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) {
      console.error("[lease][auth] no session user");
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const db = await getDb();
    console.log("[lease][db]", db.databaseName);

    const memberships = db.collection("household_memberships");
    const leasesColPrimary = db.collection("leases");        // may be empty
    const leasesColAlt     = db.collection("unit_leases");   // your actual data

    // membership lookup (userId stored as string)
    const userIdStr = String((user as any)._id ?? user?.id ?? "");
    const hm = await memberships.findOne({ userId: userIdStr, active: true });
    if (!hm) {
      console.warn("[lease][hm] no active household for user", { userIdStr });
      return NextResponse.json({ ok: true, leases: { current: null, upcoming: [], past: [], all: [] } }, { status: 200 });
    }

    // tolerant matcher (string/ObjectId)
    const hhIdStr = String(hm.householdId);
    const hhIdObj = ObjectId.isValid(hhIdStr) ? new ObjectId(hhIdStr) : null;
    const hhMatch = hhIdObj ? ({ $in: [hhIdStr, hhIdObj] } as any) : hhIdStr;
    console.log("[lease][query]", { hhIdStr, hhIdObj: hhIdObj?.toHexString() ?? null });

    // diagnostics (optional)
    try {
      const [totA, totB] = await Promise.all([
        leasesColPrimary.countDocuments().catch(() => 0),
        leasesColAlt.countDocuments().catch(() => 0),
      ]);
      console.log("[lease][collection_totals]", { leases: totA, unit_leases: totB });
    } catch {}

    // === fetch from BOTH collections ===
    const [rawA, rawB] = await Promise.all([
      leasesColPrimary.find({ householdId: hhMatch }).sort({ moveInDate: 1, createdAt: 1 }).toArray(),
      leasesColAlt.find({ householdId: hhMatch }).sort({ moveInDate: 1, createdAt: 1 }).toArray(),
    ]);

    // merge + de-dupe by _id
    const seen = new Set<string>();
    const allRaw: any[] = [];
    for (const doc of [...rawA, ...rawB]) {
      const idStr = norm(doc?._id) ?? "";
      if (!seen.has(idStr)) {
        seen.add(idStr);
        allRaw.push(doc);
      }
    }

    console.log("[lease][found_all]", {
      from_leases: rawA.length,
      from_unit_leases: rawB.length,
      merged: allRaw.length,
      householdId: hhIdStr,
    });

    // ensure checklist on each
    const today = startOfTodayLocal();
    const touchChecklist = async (doc: any, colName: "leases" | "unit_leases") => {
      if (!doc) return;
      if (!doc.checklist || !Array.isArray(doc.checklist)) {
        const due = parseDateOnly(doc.moveInDate) ?? today;
        const checklist = defaultChecklist(due.toISOString());
        try {
          await db.collection(colName).updateOne({ _id: doc._id }, { $set: { checklist } });
          doc.checklist = checklist;
        } catch (e) {
          console.error("[lease][checklist][updateOne] failed", { id: doc._id, colName, e });
        }
      }
    };
    // decide which collection each doc came from (by presence in rawA/rawB)
    const idInA = new Set(rawA.map((d: any) => norm(d._id)!));
    for (const doc of allRaw) {
      const col = idInA.has(norm(doc._id)!) ? "leases" : "unit_leases";
      await touchChecklist(doc, col as any);
    }

    // classify for convenience
    let current: any = null;
    const upcoming: any[] = [];
    const past: any[] = [];

    for (const L of allRaw) {
      const start = parseDateOnly(L.moveInDate);
      const end   = parseDateOnly(L.moveOutDate ?? null);
      if (start && start <= today && (!end || today <= end)) {
        if (!current) current = L;
        else {
          const curStart = parseDateOnly(current.moveInDate) ?? new Date(0);
          if (start > curStart) current = L;
        }
      } else if (start && start > today) {
        upcoming.push(L);
      } else {
        past.push(L);
      }
    }

    upcoming.sort((a, b) => (parseDateOnly(a.moveInDate)!.getTime() - parseDateOnly(b.moveInDate)!.getTime()));
    past.sort((a, b) => (parseDateOnly(b.moveOutDate ?? b.moveInDate)?.getTime() ?? 0) - (parseDateOnly(a.moveOutDate ?? a.moveInDate)?.getTime() ?? 0));

    const normalize = (doc: any) =>
      doc ? {
        ...doc,
        _id:        norm(doc._id),
        firmId:     norm(doc.firmId),
        appId:      norm(doc.appId),
        householdId:norm(doc.householdId),
        propertyId: norm(doc.propertyId),
        unitId:     norm(doc.unitId),
      } : null;

    const payload = {
      current: normalize(current),
      upcoming: upcoming.map(normalize),
      past: past.map(normalize),
      all: allRaw.map(normalize),
    };

    console.log("[lease][respond]", {
      allCount: payload.all.length,
      hasCurrent: !!payload.current,
      upcomingCount: payload.upcoming.length,
      pastCount: payload.past.length,
    });

    return NextResponse.json({ ok: true, leases: payload }, { status: 200 });
  } catch (e: any) {
    console.error("[lease][error]", e);
    return NextResponse.json({ ok: false, error: "server_error", detail: e?.message }, { status: 500 });
  }
}
