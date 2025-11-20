import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LeaseRow = {
  _id: string;
  firmId: string;
  unitNumber?: string | null;
  moveInDate?: string | null;
  moveOutDate?: string | null;
  status?: string;
  building?: {
    addressLine1?: string;
    addressLine2?: string | null;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  } | null;
};

type InspectionRow = {
  leaseId?: string | null;
  firmId?: string | null;
  status?: "draft" | "submitted";
  updatedAt?: Date | string | null;
};

function buildAddressLabel(b?: LeaseRow["building"]) {
  if (!b) return "Unknown address";
  const line1 = (b.addressLine1 || "").trim();
  const line2 = (b.addressLine2 || "").trim();
  const citySt = [b.city, b.state].filter(Boolean).join(", ");
  const zip = (b.postalCode || "").trim();
  return [line1, line2, citySt, zip].filter(Boolean).join(" • ");
}

export async function GET(_req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "landlord" || !user.landlordFirm?.firmId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const firmId = user.landlordFirm.firmId;
  const db = await getDb();
  const leasesCol = db.collection("unit_leases");
  const inspectionsCol = db.collection("landlord_inspections");

  // 1) Get signed, scheduled/active leases for this firm
  const rows = (await leasesCol
    .find<LeaseRow>({
      firmId,
      signed: true,
      status: { $in: ["scheduled", "active"] },
    })
    .sort({ moveInDate: 1, _id: 1 })
    .limit(500)
    .toArray()) as any as LeaseRow[];

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, leases: [] });
  }

  const leaseIds = rows.map((l) => String(l._id));
  const leaseIdSet = new Set(leaseIds);

  // 2) Look up inspections for this firm, then filter by leaseId in code.
  //    This avoids any type mismatch between how leaseId is stored vs _id.
  const inspRows = (await inspectionsCol
    .find<InspectionRow>({
      firmId,
    })
    .toArray()) as any as InspectionRow[];

  // Map leaseId -> best inspection status (prefer submitted, else latest)
  const inspByLease = new Map<
    string,
    { status: "draft" | "submitted"; updatedAt?: string | null }
  >();

  for (const r of inspRows) {
    const rawLeaseId = r.leaseId ?? null;
    if (!rawLeaseId) continue;

    const lid = String(rawLeaseId);
    if (!leaseIdSet.has(lid)) continue; // ignore inspections for leases we aren't listing

    const status = (r.status as "draft" | "submitted") ?? "draft";
    let updatedAt: string | null = null;
    if (r.updatedAt instanceof Date) {
      updatedAt = r.updatedAt.toISOString();
    } else if (typeof r.updatedAt === "string") {
      updatedAt = r.updatedAt;
    }

    const existing = inspByLease.get(lid);
    if (!existing) {
      inspByLease.set(lid, { status, updatedAt });
      continue;
    }

    // Prefer submitted over draft
    if (existing.status === "submitted") continue;
    if (status === "submitted") {
      inspByLease.set(lid, { status, updatedAt });
      continue;
    }

    // Otherwise, keep the most recent updatedAt
    const existingTs = existing.updatedAt ? Date.parse(existing.updatedAt) : 0;
    const newTs = updatedAt ? Date.parse(updatedAt) : 0;
    if (newTs > existingTs) {
      inspByLease.set(lid, { status, updatedAt });
    }
  }

  // 3) Merge lease + inspection info
  const leases = rows.map((l) => {
    const leaseId = String(l._id);
    const insp = inspByLease.get(leaseId);

    return {
      id: leaseId,
      firmId: l.firmId,
      unitNumber: l.unitNumber ?? null,
      moveInDate: l.moveInDate ?? null,
      moveOutDate: l.moveOutDate ?? null,
      status: l.status ?? "scheduled",
      buildingLabel: buildAddressLabel(l.building),

      // inspection info
      inspectionStatus: insp?.status ?? "none" as "none" | "draft" | "submitted",
      lastInspectionAt: insp?.updatedAt ?? null,
    };
  });

  return NextResponse.json({ ok: true, leases });
}
