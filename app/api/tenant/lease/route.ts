import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { ObjectId } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ── helpers ─────────────────────────────────────────────── */
function parseDateOnly(ymd?: string | null): Date | null {
  if (!ymd) return null;
  const parts = ymd.split("-");
  if (parts.length < 3) return null;
  const [y, m, d] = parts.map(Number);
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
    {
      key: "id_upload",
      label: "Upload government ID",
      dueAt: dueISO,
      completedAt: null,
      notes: null,
    },
    {
      key: "renter_insurance",
      label: "Provide renter’s insurance",
      dueAt: dueISO,
      completedAt: null,
      notes: null,
    },
    {
      key: "schedule_walkthrough",
      label: "Pre-Move Inspection",
      dueAt: dueISO,
      completedAt: null,
      notes: null,
    },
    {
      key: "keys",
      label: "Pick up keys / access fobs",
      dueAt: dueISO,
      completedAt: null,
      notes: null,
    },
    {
      key: "rent_autopay",
      label: "Set up rent autopay",
      dueAt: dueISO,
      completedAt: null,
      notes: null,
    },
  ];
}

/* ── S3 document helpers ─────────────────────────────────── */

const S3_PUBLIC_BASE = process.env.S3_PUBLIC_BASE_URL || "";
const S3_LEASE_DOCS_PREFIX = process.env.S3_LEASE_DOCS_PREFIX || "leases";
const S3_LEASE_DOCS_EXT = process.env.S3_LEASE_DOCS_EXT || ".pdf";

type LeaseDocument = {
  id: string;
  title: string;
  externalDescription?: string | null;
  url?: string | null;
  s3Key?: string | null;
};

function buildS3KeyForLeaseDoc(leaseDoc: any, rawDoc: any): string | null {
  const leaseId = norm(leaseDoc?._id);
  const docId = norm(rawDoc?.id ?? rawDoc?._id);
  if (!leaseId || !docId) return null;

  const prefix = S3_LEASE_DOCS_PREFIX.replace(/\/$/, "");
  const ext = S3_LEASE_DOCS_EXT.startsWith(".")
    ? S3_LEASE_DOCS_EXT
    : `.${S3_LEASE_DOCS_EXT}`;

  return `${prefix}/${encodeURIComponent(leaseId)}/${encodeURIComponent(
    docId,
  )}${ext}`;
}

function mapLeaseDocument(raw: any, parentLease: any): LeaseDocument | null {
  if (!raw) return null;

  const id = norm(raw.id ?? raw._id);
  if (!id) return null;

  const title = String(raw.title ?? "Document");
  const externalDescription =
    raw.externalDescription != null ? String(raw.externalDescription) : null;

  let s3Key: string | null = raw.s3Key ?? null;
  let url: string | null = raw.url ?? null;

  if (!s3Key) {
    s3Key = buildS3KeyForLeaseDoc(parentLease, raw);
  }

  if (!url && s3Key && S3_PUBLIC_BASE) {
    const base = S3_PUBLIC_BASE.replace(/\/$/, "");
    url = `${base}/${s3Key}`;
  }

  return {
    id,
    title,
    externalDescription,
    url,
    s3Key,
  };
}


export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) {
      console.error("[lease][auth] no session user");
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }

    const db = await getDb();
    console.log("[lease][db]", db.databaseName);

    const membershipsCol = db.collection("household_memberships");
    const leasesColPrimary = db.collection("leases");
    const leasesColAlt = db.collection("unit_leases");
    const applicationsCol = db.collection("applications");
    const householdsCol = db.collection("households");
    const firmsCol = db.collection("FirmDoc");
    const appFormsCol = db.collection("application_forms");
    const usersCol = db.collection("users");

    // membership lookup (userId stored as string)
    const u: any = user;
    const userIdStr = String(u._id ?? u.id ?? "");
    console.log("[lease][user]", {
      userIdStr,
      email: u.email,
      role: u.role,
    });

    const hm = await membershipsCol.findOne({
      userId: userIdStr,
      active: true,
    });
    console.log("[lease][hm] active membership", hm);

    if (!hm) {
      console.warn("[lease][hm] no active household for user", { userIdStr });
      return NextResponse.json(
        { ok: true, leases: { current: null, upcoming: [], past: [], all: [] } },
        { status: 200 },
      );
    }

    // tolerant matcher (string/ObjectId)
    const hhIdStr = String(hm.householdId);
    const hhIdObj = ObjectId.isValid(hhIdStr) ? new ObjectId(hhIdStr) : null;
    const hhMatch = hhIdObj ? ({ $in: [hhIdStr, hhIdObj] } as any) : hhIdStr;
    console.log("[lease][query]", {
      hhIdStr,
      hhIdObj: hhIdObj?.toHexString() ?? null,
    });

    // collection diagnostics (optional)
    try {
      const [totA, totB] = await Promise.all([
        leasesColPrimary.countDocuments().catch(() => 0),
        leasesColAlt.countDocuments().catch(() => 0),
      ]);
      console.log("[lease][collection_totals]", {
        leases: totA,
        unit_leases: totB,
      });
    } catch (err) {
      console.warn("[lease][collection_totals] failed", err);
    }

    // fetch from BOTH collections
    const [rawA, rawB] = await Promise.all([
      leasesColPrimary
        .find({ householdId: hhMatch })
        .sort({ moveInDate: 1, createdAt: 1 })
        .toArray(),
      leasesColAlt
        .find({ householdId: hhMatch })
        .sort({ moveInDate: 1, createdAt: 1 })
        .toArray(),
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
      leaseIds: allRaw.map((d) => norm(d._id)),
    });

    // ensure checklist on each
    const today = startOfTodayLocal();
    const touchChecklist = async (
      doc: any,
      colName: "leases" | "unit_leases",
    ) => {
      if (!doc) return;
      if (!doc.checklist || !Array.isArray(doc.checklist)) {
        const due = parseDateOnly(doc.moveInDate) ?? today;
        const checklist = defaultChecklist(due.toISOString());
        try {
          await db
            .collection(colName)
            .updateOne({ _id: doc._id }, { $set: { checklist } });
          doc.checklist = checklist;
          console.log("[lease][checklist][created]", {
            leaseId: norm(doc._id),
            colName,
            checklistCount: checklist.length,
          });
        } catch (e) {
          console.error("[lease][checklist][updateOne] failed", {
            id: doc._id,
            colName,
            e,
          });
        }
      }
    };

    // decide which collection each doc came from (by presence in rawA/rawB)
    const idInA = new Set(rawA.map((d: any) => norm(d._id)!));
    for (const doc of allRaw) {
      const col = idInA.has(norm(doc._id)!) ? "leases" : "unit_leases";
      await touchChecklist(doc, col as any);
    }

    // Collect all appIds from leases
    const appIdStrings = Array.from(
      new Set(
        allRaw
          .map((d) => norm(d.appId))
          .filter((x): x is string => !!x),
      ),
    );
    const appQueryIds = appIdStrings.map((id) =>
      ObjectId.isValid(id) ? new ObjectId(id) : id,
    );
    console.log("[lease][apps][ids]", {
      appIdStrings,
      appQueryIds: appQueryIds.map(String),
    });

    // Load applications
    const appsById = new Map<string, any>();
    if (appQueryIds.length > 0) {
      const apps = await applicationsCol
        .find({ _id: { $in: appQueryIds as any[] } })
        .toArray();
      console.log("[lease][apps][loaded]", {
        count: apps.length,
        ids: apps.map((a) => norm(a._id)),
      });
      for (const a of apps) {
        const key = norm(a._id)!;
        appsById.set(key, a);
      }
    } else {
      console.log("[lease][apps] no appIds collected from leases");
    }

    // Collect householdIds (from leases or apps) for enrichment
    const hhIdSet = new Set<string>();
    for (const doc of allRaw) {
      const h = norm(doc.householdId);
      if (h) hhIdSet.add(h);
    }
    for (const app of appsById.values()) {
      const h = norm(app.householdId);
      if (h) hhIdSet.add(h);
    }
    const hhIdList = Array.from(hhIdSet);
    const hhObjIds = hhIdList
      .filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));
    console.log("[lease][hhIds]", {
      hhIdList,
      hhObjIds: hhObjIds.map((x) => x.toHexString()),
    });

    // Load households
	const householdsById = new Map<string, any>();

	if (hhIdList.length > 0) {
	  // Build a tolerant list: raw strings + ObjectIds for any valid ones
	  const hhAnyIds: any[] = [...hhIdList];
	  for (const id of hhIdList) {
		if (ObjectId.isValid(id)) {
		  hhAnyIds.push(new ObjectId(id));
		}
	  }

	  console.log("[lease][households][query]", {
		hhIdList,
		hhAnyIds: hhAnyIds.map((x) =>
		  typeof x === "string" ? x : (x as ObjectId).toHexString(),
		),
	  });

	  const households = await householdsCol
		.find({ _id: { $in: hhAnyIds } })
		.toArray();

	  console.log("[lease][households][loaded]", {
		count: households.length,
		ids: households.map((h) => norm(h._id)),
		sample: households[0],
	  });

	  for (const h of households) {
		const key = norm(h._id)!; // this will be "6917cd80c2bca69da2725fdd"
		householdsById.set(key, h);
	  }
	} else {
	  console.log("[lease][households] no hhIdList to load");
	}

    // Load memberships for those households
    const membershipsMany = await membershipsCol
      .find({ householdId: { $in: hhIdList } })
      .toArray();
    console.log("[lease][memberships][loaded]", {
      count: membershipsMany.length,
      byHousehold: hhIdList.reduce(
        (acc, id) => ({
          ...acc,
          [id]: membershipsMany
            .filter((m) => norm(m.householdId) === id)
            .map((m) => ({
              _id: norm(m._id),
              userId: norm(m.userId),
              role: m.role,
            })),
        }),
        {},
      ),
    });

    const membershipsByHousehold = new Map<string, any[]>();
    for (const m of membershipsMany) {
      const hid = norm(m.householdId)!;
      const arr = membershipsByHousehold.get(hid) || [];
      arr.push(m);
      membershipsByHousehold.set(hid, arr);
    }

    // Load users for those household members (for legal_name)
    const userIdSet = new Set<string>();
    for (const m of membershipsMany) {
      const uid = norm(m.userId);
      if (uid) userIdSet.add(uid);
    }
    const userIdList = Array.from(userIdSet);
    const userObjIds = userIdList
      .filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));
    const usersById = new Map<string, any>();
    if (userObjIds.length > 0) {
      const users = await usersCol
        .find({ _id: { $in: userObjIds } })
        .toArray();
      console.log("[lease][users][loaded]", {
        count: users.length,
        ids: users.map((usr) => norm(usr._id)),
        sample: users[0],
      });
      for (const usr of users) {
        const key = norm(usr._id)!;
        usersById.set(key, usr);
      }
    } else {
      console.log("[lease][users] no userObjIds to load");
    }

    // Collect formIds from apps to find the firmId
    const formIdSet = new Set<string>();
    for (const app of appsById.values()) {
      const fid = norm(app.formId);
      if (fid) formIdSet.add(fid);
    }
    const formIdList = Array.from(formIdSet);
    const formObjIds = formIdList
      .filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));
    const formsById = new Map<string, any>();
    if (formObjIds.length > 0) {
      const forms = await appFormsCol
        .find({ _id: { $in: formObjIds } })
        .toArray();
      console.log("[lease][forms][loaded]", {
        count: forms.length,
        ids: forms.map((f) => norm(f._id)),
        sample: forms[0],
      });
      for (const f of forms) {
        const key = norm(f._id)!;
        formsById.set(key, f);
      }
    } else {
      console.log("[lease][forms] no formObjIds to load");
    }

    // Collect firmIds from leases and forms
    const firmIdSet = new Set<string>();
    for (const doc of allRaw) {
      const fid = norm(doc.firmId);
      if (fid) firmIdSet.add(fid);
    }
    for (const app of appsById.values()) {
      const fidFromApp = norm(app.firmId);
      if (fidFromApp) firmIdSet.add(fidFromApp);
      const fidFromFormId = norm(app.formId);
      if (fidFromFormId && formsById.has(fidFromFormId)) {
        const form = formsById.get(fidFromFormId);
        const fid2 = norm(form.firmId);
        if (fid2) firmIdSet.add(fid2);
      }
    }
    const firmIdList = Array.from(firmIdSet);
    const firmsById = new Map<string, any>();
    if (firmIdList.length > 0) {
      const firms = await firmsCol
        .find({ _id: { $in: firmIdList as any[] } })
        .toArray();
      console.log("[lease][firms][loaded]", {
        count: firms.length,
        ids: firms.map((f) => norm(f._id)),
        sample: firms[0],
      });
      for (const f of firms) {
        const key = norm(f._id)!;
        firmsById.set(key, f);
      }
    } else {
      console.log("[lease][firms] no firmIds to load");
    }

    // classify current/upcoming/past
    let current: any = null;
    const upcoming: any[] = [];
    const past: any[] = [];

    for (const L of allRaw) {
      const start = parseDateOnly(L.moveInDate);
      const end = parseDateOnly(L.moveOutDate ?? null);
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

    upcoming.sort(
      (a, b) =>
        parseDateOnly(a.moveInDate)!.getTime() -
        parseDateOnly(b.moveInDate)!.getTime(),
    );
    past.sort(
      (a, b) =>
        (parseDateOnly(b.moveOutDate ?? b.moveInDate)?.getTime() ?? 0) -
        (parseDateOnly(a.moveOutDate ?? a.moveInDate)?.getTime() ?? 0),
    );

    const normalize = (doc: any) =>
      doc
        ? (() => {
            const docsRaw = Array.isArray(doc.documents) ? doc.documents : [];
            const documents = docsRaw
              .map((raw: any) => mapLeaseDocument(raw, doc))
              .filter(
                (d: LeaseDocument | null): d is LeaseDocument => d !== null,
              );

            const leaseId = norm(doc._id);
            const appIdStr = norm(doc.appId);
            const app =
              appIdStr && appsById.has(appIdStr)
                ? appsById.get(appIdStr)
                : null;

            // Household + members
            const hhIdForLease = norm(doc.householdId);
            const householdDoc =
              hhIdForLease && householdsById.has(hhIdForLease)
                ? householdsById.get(hhIdForLease)
                : null;
            const householdDisplayName =
              householdDoc?.displayName ?? null;

            const members =
              (hhIdForLease && membershipsByHousehold.get(hhIdForLease)) || [];
            const tenantMembers = members.map((m: any) => {
              const uid = norm(m.userId);
              const userDoc = uid ? usersById.get(uid) : null;
              return {
                userId: uid,
                role: m.role,
                email: m.email ?? null,
                legalName: userDoc?.legal_name ?? null,
                displayName: m.name ?? userDoc?.legal_name ?? m.email ?? null,
              };
            });

            console.log("[lease][normalize][tenant]", {
              leaseId,
              householdId: hhIdForLease,
              householdDisplayName,
              memberCount: tenantMembers.length,
              members: tenantMembers,
            });

            // Payment/Deposit: prefer lease.depositCents; fallback to paymentPlan.securityCents
            let depositCents =
              doc.depositCents != null ? doc.depositCents : null;
            if (
              depositCents == null &&
              app?.paymentPlan?.securityCents != null
            ) {
              depositCents = app.paymentPlan.securityCents;
            }

            // Parties: tenant from household; landlord from firm
            const existingParties =
              (doc.parties as {
                tenantName?: string | null;
                landlordName?: string | null;
              }) || {};

            // Tenant
            let tenantName: string | null =
              householdDisplayName ??
              existingParties.tenantName ??
              null;

            // Landlord via lease.firmId or form.firmId
            let landlordName: string | null =
              existingParties.landlordName ?? null;
            let firmDoc: any = null;

            const firmIdFromLease = norm(doc.firmId);
            const firmIdFromApp = app ? norm(app.firmId) : null;
            const formIdStr = app ? norm(app.formId) : null;
            const form = formIdStr ? formsById.get(formIdStr) : null;
            const firmIdFromForm = form ? norm(form.firmId) : null;

            if (firmIdFromLease && firmsById.has(firmIdFromLease)) {
              firmDoc = firmsById.get(firmIdFromLease);
            } else if (firmIdFromApp && firmsById.has(firmIdFromApp)) {
              firmDoc = firmsById.get(firmIdFromApp);
            } else if (firmIdFromForm && firmsById.has(firmIdFromForm)) {
              firmDoc = firmsById.get(firmIdFromForm);
            }

            if (firmDoc) {
              landlordName = firmDoc.name ?? landlordName ?? null;
            }

            console.log("[lease][normalize][landlord]", {
              leaseId,
              firmIdFromLease,
              firmIdFromApp,
              formIdStr,
              firmIdFromForm,
              resolvedFirmId: firmDoc ? norm(firmDoc._id) : null,
              landlordName,
            });

            return {
              ...doc,

              _id: leaseId,
              firmId: firmIdFromLease ?? (firmDoc ? norm(firmDoc._id) : null),
              appId: appIdStr,
              householdId: hhIdForLease,
              propertyId: norm(doc.propertyId),
              unitId: norm(doc.unitId),

              documents,
              depositCents,

              parties: {
                tenantName,
                landlordName,
              },

              tenantMembers, // extra structure if you want to show member names later
              paymentPlan: app?.paymentPlan ?? null,
              countersign: app?.countersign ?? null,
            };
          })()
        : null;

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
      sampleCurrent: payload.current,
    });

    return NextResponse.json({ ok: true, leases: payload }, { status: 200 });
  } catch (e: any) {
    console.error("[lease][error]", e);
    return NextResponse.json(
      { ok: false, error: "server_error", detail: e?.message },
      { status: 500 },
    );
  }
}
