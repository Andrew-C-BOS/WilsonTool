import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ── tiny helpers ───────────────────────────────────────── */
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

/**
 * Choose which lease to update.
 * 1) If body.leaseId is provided, use it.
 * 2) Else pick "current" (moveInDate ≤ today ≤ moveOutDate), otherwise first upcoming.
 */
function pickTargetLease(leases: any[]): any | null {
  const today = startOfTodayLocal();
  let current: any = null;
  const upcoming: any[] = [];
  for (const L of leases) {
    const s = parseDateOnly(L.moveInDate);
    const e = parseDateOnly(L.moveOutDate ?? null);
    const isCurrent = !!s && s <= today && (!e || today <= e);
    if (isCurrent) {
      if (!current) current = L;
      else {
        const curS = parseDateOnly(current.moveInDate) ?? new Date(0);
        if (s! > curS) current = L;
      }
    } else if (s && s > today) {
      upcoming.push(L);
    }
  }
  if (current) return current;
  upcoming.sort((a, b) => (parseDateOnly(a.moveInDate)!.getTime() - parseDateOnly(b.moveInDate)!.getTime()));
  return upcoming[0] ?? null;
}

type PatchBody = {
  key?: string;        // checklist item key (required)
  done?: boolean;      // true = set completedAt now, false = null it (required)
  leaseId?: string;    // optional explicit lease _id
  label?: string;      // optional label when creating a missing item
  dueAt?: string | null; // optional dueAt ISO when creating a missing item
};

export async function PATCH(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const body: PatchBody = await req.json().catch(() => ({} as PatchBody));
    const { key, done, leaseId, label, dueAt } = body;
    if (!key || typeof done !== "boolean") {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    const db = await getDb();
    const memberships = db.collection("household_memberships");
    const colA = db.collection("leases");       // may be empty in your env
    const colB = db.collection("unit_leases");  // where your data lives

    // 1) Find the active household for this user (userId stored as string)
    const u: any = user;
	const userIdStr = String(u._id ?? u.id ?? "");
	const hm = await memberships.findOne({ userId: userIdStr, active: true });
    if (!hm) {
      return NextResponse.json({ ok: false, error: "no_household" }, { status: 404 });
    }
    const hhId = String(hm.householdId);

    // 2) Load this household’s leases from both collections
    const [listA, listB] = await Promise.all([
      colA.find({ householdId: hhId }).project({ checklist: 1, moveInDate: 1, moveOutDate: 1 }).toArray(),
      colB.find({ householdId: hhId }).project({ checklist: 1, moveInDate: 1, moveOutDate: 1 }).toArray(),
    ]);

    // Merge & dedupe by _id (string-safe)
    const seen = new Set<string>();
    const all = [...listA, ...listB].filter((d) => {
      const id = String(d._id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    if (all.length === 0) {
      return NextResponse.json({ ok: false, error: "no_leases" }, { status: 404 });
    }

    // 3) Pick target lease, or find explicit leaseId
    let target =
      leaseId ? all.find((d) => String(d._id) === leaseId) ?? null : pickTargetLease(all);

    if (!target) {
      return NextResponse.json({ ok: false, error: "no_target_lease" }, { status: 404 });
    }

    // 4) Figure out which collection to update (A or B)
    const inA = listA.some((d) => String(d._id) === String(target._id));
    const col = inA ? colA : colB;

    const nowISO = new Date().toISOString();

    // 5a) Try to toggle an existing checklist item (arrayFilters + positional)
    const updateExisting = await col.updateOne(
      { _id: target._id, "checklist.key": key },
      {
        $set: {
          "checklist.$[it].completedAt": done ? nowISO : null,
        },
      },
      {
        arrayFilters: [{ "it.key": key }],
      }
    );

    if (updateExisting.matchedCount === 1) {
      // Success updating an existing item
      return NextResponse.json({
        ok: true,
        leaseId: String(target._id),
        key,
        completedAt: done ? nowISO : null,
        created: false,
      });
    }

    // 5b) If not found, push a new item (uses provided label/dueAt or sensible defaults)
    const fallbackLabel =
      label ??
      key
        .replace(/_/g, " ")
        .replace(/\b\w/g, (m) => m.toUpperCase()); // "rent_autopay" → "Rent Autopay"

    const fallbackDueAt =
      dueAt ??
      (parseDateOnly(target.moveInDate)?.toISOString() ?? startOfTodayLocal().toISOString());

	const pushRes = await col.updateOne(
	  { _id: target._id },
	  {
		$push: {
		  checklist: {
			key,
			label: fallbackLabel,
			dueAt: fallbackDueAt,
			completedAt: done ? nowISO : null,
			notes: null,
		  },
		},
	  } as any
	);

    if (pushRes.matchedCount !== 1) {
      return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      leaseId: String(target._id),
      key,
      completedAt: done ? nowISO : null,
      created: true,
    });
  } catch (e: any) {
    console.error("[lease/checklist][error]", e);
    return NextResponse.json({ ok: false, error: "server_error", detail: e?.message }, { status: 500 });
  }
}
