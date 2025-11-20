// app/api/landlord/inspection/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Issue = {
  id: string;
  room: string;
  category: string;
  description: string;
  severity: "low" | "medium" | "high";
  photos: string[];
  createdAt: string;
};

type InspectionDocWire = {
  _id: string;
  householdId: string | null;
  leaseId: string;
  status: "draft" | "submitted";
  items: Issue[];
  createdAt: string;
  updatedAt: string;
};

function toWire(doc: any): InspectionDocWire {
  return {
    _id: String(doc._id),
    householdId: doc.householdId ?? null,
    leaseId: doc.leaseId ?? "",
    status: (doc.status as "draft" | "submitted") ?? "draft",
    items: Array.isArray(doc.items) ? doc.items : [],
    createdAt:
      doc.createdAt instanceof Date
        ? doc.createdAt.toISOString()
        : String(doc.createdAt ?? new Date().toISOString()),
    updatedAt:
      doc.updatedAt instanceof Date
        ? doc.updatedAt.toISOString()
        : String(doc.updatedAt ?? new Date().toISOString()),
  };
}

/**
 * Helper to find or create the current inspection doc for this landlord inspector.
 * We key by inspector + firm + (optional) leaseId query param.
 */
async function getOrCreateInspection(
  req: NextRequest,
  user: Awaited<ReturnType<typeof getSessionUser>>,
) {
  const db = await getDb();
  const col = db.collection("landlord_inspections");

  const url = new URL(req.url);
  const leaseId = url.searchParams.get("leaseId");
  const firmId = user?.landlordFirm?.firmId ?? null;
  const inspectorId = new ObjectId(String(user!._id));

  const filter: any = { inspectorId };
  if (firmId) filter.firmId = firmId;
  if (leaseId) filter.leaseId = leaseId;

  // Oldest draft or most recent inspection for this inspector/firm/lease
  let doc = await col.findOne(filter, { sort: { createdAt: -1 } });

  if (!doc) {
    const now = new Date();
    const base = {
      firmId,
      inspectorId,
      leaseId: leaseId ?? null,
      householdId: null,
      status: "draft" as const,
      items: [] as Issue[],
      createdAt: now,
      updatedAt: now,
    };
    const res = await col.insertOne(base);
    doc = { _id: res.insertedId, ...base };
  }

  return { col, doc };
}

/* ───────────────────────────────
   GET  → load (or create) inspection
─────────────────────────────── */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "landlord") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const { doc } = await getOrCreateInspection(req, user);
    return NextResponse.json({ ok: true, inspection: toWire(doc) });
  } catch (err: any) {
    console.error("[landlord inspection] GET failed,", err);
    return NextResponse.json(
      { ok: false, error: "server_error" },
      { status: 500 },
    );
  }
}

/* ───────────────────────────────
   PATCH  → mutate items / assign lease / set status
─────────────────────────────── */
export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "landlord") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const op = body?.op as string | undefined;
  if (!op) {
    return NextResponse.json({ ok: false, error: "missing_op" }, { status: 400 });
  }

  try {
    const { col, doc } = await getOrCreateInspection(req, user);

    let items: Issue[] = Array.isArray(doc.items) ? [...doc.items] : [];
    let status: "draft" | "submitted" = (doc.status as any) === "submitted" ? "submitted" : "draft";
    const now = new Date();

    if (op === "add") {
      const item = body.item as Partial<Issue> | undefined;
      if (!item || !item.room || !item.category) {
        return NextResponse.json({ ok: false, error: "missing_item_fields" }, { status: 400 });
      }
      const newItem: Issue = {
        id: item.id ?? Math.random().toString(36).slice(2),
        room: String(item.room),
        category: String(item.category),
        description: String(item.description ?? ""),
        severity: (item.severity as any) ?? "low",
        photos: Array.isArray(item.photos) ? item.photos.map(String) : [],
        createdAt:
          item.createdAt && typeof item.createdAt === "string"
            ? item.createdAt
            : now.toISOString(),
      };
      items.push(newItem);
    } else if (op === "update_item") {
      const itemId = String(body.itemId ?? "");
      if (!itemId) {
        return NextResponse.json({ ok: false, error: "missing_itemId" }, { status: 400 });
      }
      const patch = body as { description?: string; severity?: Issue["severity"] };
      items = items.map((i) =>
        i.id === itemId
          ? {
              ...i,
              description: patch.description ?? i.description,
              severity: (patch.severity as any) ?? i.severity,
            }
          : i,
      );
    } else if (op === "remove_item") {
      const itemId = String(body.itemId ?? "");
      if (!itemId) {
        return NextResponse.json({ ok: false, error: "missing_itemId" }, { status: 400 });
      }
      items = items.filter((i) => i.id !== itemId);
    } else if (op === "assign_lease") {
      const leaseId = String(body.leaseId ?? "");
      if (!leaseId) {
        return NextResponse.json({ ok: false, error: "missing_leaseId" }, { status: 400 });
      }

      await col.updateOne(
        { _id: doc._id },
        {
          $set: {
            leaseId,
            updatedAt: now,
          },
        },
      );

      const updated = { ...doc, leaseId, updatedAt: now };
      return NextResponse.json({ ok: true, inspection: toWire(updated) });
    } else if (op === "set_status") {
      const next = body.status === "submitted" ? "submitted" : "draft";

      await col.updateOne(
        { _id: doc._id },
        {
          $set: {
            status: next,
            updatedAt: now,
          },
        },
      );

      const updated = { ...doc, status: next, updatedAt: now };
      return NextResponse.json({ ok: true, inspection: toWire(updated) });
    } else {
      return NextResponse.json({ ok: false, error: "unsupported_op" }, { status: 400 });
    }

    // For add / update_item / remove_item, persist items + maintain status
    await col.updateOne(
      { _id: doc._id },
      {
        $set: {
          items,
          status,
          updatedAt: now,
        },
      },
    );

    const updated = { ...doc, items, status, updatedAt: now };
    return NextResponse.json({ ok: true, inspection: toWire(updated) });
  } catch (err: any) {
    console.error("[landlord inspection] PATCH failed,", err);
    return NextResponse.json(
      { ok: false, error: "server_error" },
      { status: 500 },
    );
  }
}
