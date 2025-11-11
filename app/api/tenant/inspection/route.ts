import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { s3, S3_BUCKET, S3_PUBLIC_BASE_URL } from "@/lib/aws/s3";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";

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
function pickLease(raw: any[]): any | null {
  const today = startOfTodayLocal();
  let current: any = null;
  const upcoming: any[] = [];
  for (const L of raw) {
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

/** Try to derive the S3 key from a photo URL. Supports:
 *  - https://<bucket>.s3.<region>.amazonaws.com/<key>
 *  - https://s3.<region>.amazonaws.com/<bucket>/<key>
 *  - `${S3_PUBLIC_BASE_URL}/${key}` (e.g., CloudFront or S3 virtual host)
 */
function extractS3KeyFromUrl(url: string): string | null {
  if (!url || url.startsWith("data:")) return null;

  try {
    const u = new URL(url);

    // If it starts with configured public base URL (S3 or CDN), strip it
    if (S3_PUBLIC_BASE_URL && url.startsWith(S3_PUBLIC_BASE_URL + "/")) {
      return decodeURIComponent(url.slice(S3_PUBLIC_BASE_URL.length + 1));
    }

    // Virtual-hosted–style: <bucket>.s3.<region>.amazonaws.com/<key>
    const vhMatch = u.hostname.match(/^([^.]+)\.s3[.-][a-z0-9-]+\.amazonaws\.com$/i);
    if (vhMatch) {
      const bucket = vhMatch[1];
      if (bucket === S3_BUCKET) {
        const key = u.pathname.replace(/^\/+/, "");
        return decodeURIComponent(key);
      }
    }

    // Path-style: s3.<region>.amazonaws.com/<bucket>/<key>
    const pathMatch = u.hostname.match(/^s3[.-][a-z0-9-]+\.amazonaws\.com$/i);
    if (pathMatch) {
      const parts = u.pathname.replace(/^\/+/, "").split("/");
      const bucket = parts.shift();
      if (bucket === S3_BUCKET) return decodeURIComponent(parts.join("/"));
    }
  } catch {
    /* ignore parse errors */
  }
  return null;
}

/* ── GET: load or create draft ───────────────────────────── */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const db = await getDb();
    const memberships = db.collection("household_memberships");
    const unitLeases = db.collection("unit_leases");
    const inspections = db.collection("inspections");

    const userIdStr = String((user as any)._id ?? user?.id ?? "");
    const hm = await memberships.findOne({ userId: userIdStr, active: true });
    if (!hm) return NextResponse.json({ ok: false, error: "no_household" }, { status: 404 });
    const hhId = String(hm.householdId);

    const leases = await unitLeases.find({ householdId: hhId }).sort({ moveInDate: 1 }).toArray();
    if (leases.length === 0) return NextResponse.json({ ok: false, error: "no_leases" }, { status: 404 });

    const target = pickLease(leases);
    if (!target) return NextResponse.json({ ok: false, error: "no_target_lease" }, { status: 404 });

    const leaseId = String(target._id);

    // find or create draft
    let doc = await inspections.findOne({ leaseId, householdId: hhId });
    if (!doc) {
      const now = new Date().toISOString();
      await inspections.insertOne({
        householdId: hhId,
        leaseId,
        status: "draft",
        items: [],
        createdAt: now,
        updatedAt: now,
      } as any);
      doc = await inspections.findOne({ leaseId, householdId: hhId });
    }

    const out = { ...doc, _id: String(doc!._id) };
    return NextResponse.json({ ok: true, inspection: out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "server_error", detail: e?.message }, { status: 500 });
  }
}

/* ── PATCH: add / update / remove / submit ──────────────── */
type PatchBody =
  | { op: "add"; item: { room: string; category: string; description?: string; severity?: "low"|"medium"|"high"; photos?: string[] } }
  | { op: "update_item"; itemId: string; description?: string; severity?: "low"|"medium"|"high" }
  | { op: "remove_item"; itemId: string }
  | { op: "submit" };

export async function PATCH(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    // tolerate empty/invalid JSON
    let body: PatchBody | null = null;
    try { body = await req.json(); } catch { /* noop */ }
    if (!body || typeof (body as any).op !== "string") {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    const db = await getDb();
    const memberships = db.collection("household_memberships");
    const unitLeases = db.collection("unit_leases");
    const inspections = db.collection("inspections");

    const userIdStr = String((user as any)._id ?? user?.id ?? "");
    const hm = await memberships.findOne({ userId: userIdStr, active: true });
    if (!hm) return NextResponse.json({ ok: false, error: "no_household" }, { status: 404 });
    const hhId = String(hm.householdId);

    const leases = await unitLeases.find({ householdId: hhId }).sort({ moveInDate: 1 }).toArray();
    const target = pickLease(leases);
    if (!target) return NextResponse.json({ ok: false, error: "no_target_lease" }, { status: 404 });

    const leaseId = String(target._id);
    const now = new Date().toISOString();

    /* --------- ops --------- */
    if (body.op === "add") {
      const it = (body as Extract<PatchBody, { op: "add" }>).item;
      if (!it || !it.room || !it.category) {
        return NextResponse.json({ ok: false, error: "invalid_item" }, { status: 400 });
      }
      const item = {
        id: Math.random().toString(36).slice(2),
        room: String(it.room),
        category: String(it.category),
        description: String(it.description ?? ""),
        severity: (it.severity ?? "low") as "low"|"medium"|"high",
        photos: Array.isArray(it.photos) ? it.photos.filter(Boolean) : [],
        createdAt: now,
      };
      await inspections.updateOne(
        { leaseId, householdId: hhId },
        { $push: { items: item }, $set: { updatedAt: now }, $setOnInsert: { status: "draft", createdAt: now } },
        { upsert: true }
      );

    } else if (body.op === "update_item") {
      const { itemId, description, severity } = body as Extract<PatchBody, { op: "update_item" }>;
      if (!itemId) return NextResponse.json({ ok: false, error: "invalid_itemId" }, { status: 400 });

      const $set: Record<string, any> = { updatedAt: now };
      if (typeof description === "string") $set["items.$.description"] = description;
      if (severity === "low" || severity === "medium" || severity === "high") $set["items.$.severity"] = severity;

      const res = await inspections.updateOne(
        { leaseId, householdId: hhId, "items.id": itemId },
        { $set }
      );
      if (res.matchedCount === 0) {
        return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
      }

    } else if (body.op === "remove_item") {
      const { itemId } = body as Extract<PatchBody, { op: "remove_item" }>;
      if (!itemId) return NextResponse.json({ ok: false, error: "invalid_itemId" }, { status: 400 });

      // 1) Look up the specific item first so we know which S3 objects to delete
      const docWithOne = await inspections.findOne(
        { leaseId, householdId: hhId, "items.id": itemId },
        { projection: { items: { $elemMatch: { id: itemId } } } }
      );
      const itemToDelete = docWithOne?.items?.[0];

      // 2) Pull the item from Mongo
      const res = await inspections.updateOne(
        { leaseId, householdId: hhId },
        { $pull: { items: { id: itemId } }, $set: { updatedAt: now } }
      );
      if (res.matchedCount === 0) {
        return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
      }

      // 3) Best-effort S3 cleanup (non-fatal)
      if (itemToDelete?.photos?.length) {
        const deletions = [];
        for (const url of itemToDelete.photos as string[]) {
          const key = extractS3KeyFromUrl(url);
          if (key) {
            deletions.push(
              s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }))
                .catch(() => undefined) // swallow errors: do not block user
            );
          }
        }
        if (deletions.length) {
          await Promise.allSettled(deletions);
        }
      }

    } else if (body.op === "submit") {
      await inspections.updateOne(
        { leaseId, householdId: hhId },
        { $set: { status: "submitted", updatedAt: now } },
        { upsert: true }
      );

    } else {
      return NextResponse.json({ ok: false, error: "invalid_op" }, { status: 400 });
    }

    /* --------- return latest --------- */
    const doc = await inspections.findOne({ leaseId, householdId: hhId });
    if (!doc) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    const out = { ...doc, _id: String(doc._id) };
    return NextResponse.json({ ok: true, inspection: out });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "server_error", detail: e?.message }, { status: 500 });
  }
}
