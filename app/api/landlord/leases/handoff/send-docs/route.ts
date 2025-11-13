// app/api/landlord/leases/handoff/send-docs/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getMailer } from "@/lib/mailer";
import {
  computeNextState,
  deriveMinRulesFromPlan,
  type AppState,
  type Terms,
} from "@/domain/rules";

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------- Helpers ---------- */

const rand = (n = 16) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 36).toString(36)).join("");

function toStr(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  try {
    return v?.toString ? v.toString() : String(v);
  } catch {
    return String(v);
  }
}

function isHex24(s: string) {
  return /^[0-9a-fA-F]{24}$/.test(s);
}

async function asFilter(idLike: string) {
  const { ObjectId } = await import("mongodb");
  return (isHex24(idLike)
    ? { _id: new ObjectId(idLike) }
    : { _id: idLike }) as any;
}

// S3 client (reused)
const s3Region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-2";
const s3Bucket = process.env.AWS_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME;
const s3 = new S3Client({ region: s3Region });

async function getS3ObjectBase64(key: string): Promise<{ base64: string; contentType: string }> {
  const cmd = new GetObjectCommand({
    Bucket: s3Bucket!,
    Key: key,
  });
  const res = await s3.send(cmd);
  const contentType = (res.ContentType as string) || "application/octet-stream";

  const chunks: Uint8Array[] = [];
  for await (const chunk of res.Body as any) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const buf = Buffer.concat(chunks);
  return { base64: buf.toString("base64"), contentType };
}

// Reuse the firm membership logic from other landlord routes
async function resolveFirmForUser(req: NextRequest, user: { _id: any }) {
  const db = await getDb();
  const { ObjectId } = await import("mongodb");
  const firmIdParam = req.nextUrl.searchParams.get("firmId") ?? undefined;

  const userIdCandidates = (() => {
    const out: any[] = [];
    if (user?._id != null) out.push(user._id);
    const asOid = ObjectId.isValid(user?._id) ? new ObjectId(user._id) : null;
    if (asOid) out.push(asOid);
    if (user?._id instanceof ObjectId) out.push(String(user._id));
    return Array.from(new Set(out.map(String))).map((s) =>
      ObjectId.isValid(s) ? new ObjectId(s) : s
    );
  })();

  const firms = db.collection<any>("FirmDoc");

  if (firmIdParam) {
    const m = await db
      .collection("firm_memberships")
      .findOne(
        { firmId: firmIdParam, active: true, userId: { $in: userIdCandidates } },
        { projection: { firmId: 1 } }
      );
    if (!m) {
      throw new Error("not_in_firm");
    }

    const firmFilter: { _id: any } = isHex24(firmIdParam)
      ? { _id: new ObjectId(firmIdParam) }
      : { _id: firmIdParam };

    const firm = await firms.findOne(firmFilter, {
      projection: { _id: 1, name: 1, slug: 1 },
    });
    if (!firm) throw new Error("invalid_firm");
    return {
      firmId: toStr(firm._id),
      firmName: firm.name as string,
      firmSlug: (firm as any).slug as string | undefined,
    };
  }

  const membership = await db
    .collection("firm_memberships")
    .findOne(
      { userId: { $in: userIdCandidates }, active: true },
      { projection: { firmId: 1 } }
    );

  if (!membership) throw new Error("no_firm_membership");

  const firmFilter2: { _id: any } = isHex24(String(membership.firmId))
    ? { _id: new ObjectId(String(membership.firmId)) }
    : { _id: String(membership.firmId) };

  const firm = await firms.findOne(firmFilter2, {
    projection: { _id: 1, name: 1, slug: 1 },
  });
  if (!firm) throw new Error("invalid_firm");
  return {
    firmId: toStr(firm._id),
    firmName: firm.name as string,
    firmSlug: (firm as any).slug as string | undefined,
  };
}

// Household recipients (based on your webhook)
async function getHouseholdUserEmails(db: any, householdId: string): Promise<string[]> {
  const membershipsCollCanonical = db.collection("household_memberships") as any;
  const membershipsCollLegacy = db.collection("household_memberhsips") as any;
  const { ObjectId } = await import("mongodb");

  const isHex = ObjectId.isValid(householdId);
  const hhIdObj = isHex ? new ObjectId(householdId) : null;
  const hhMatch = hhIdObj ? { $in: [householdId, hhIdObj] } : householdId;

  let mships = await membershipsCollCanonical
    .find({ householdId: hhMatch, active: true })
    .project({ userId: 1, email: 1, role: 1 })
    .toArray();

  if (!mships?.length) {
    try {
      mships = await membershipsCollLegacy
        .find({ householdId: hhMatch, active: true })
        .project({ userId: 1, email: 1, role: 1 })
        .toArray();
    } catch {
      // ignore legacy errors
    }
  }

  if (!mships?.length) return [];

  const rawIds = mships.map((m: any) => m.userId).filter(Boolean);
  const userIds = rawIds.map((id: any) =>
    ObjectId.isValid(String(id)) ? new ObjectId(String(id)) : String(id)
  );

  const users = userIds.length
    ? await (db.collection("users") as any)
        .find({ _id: { $in: userIds } })
        .project({ email: 1, preferredName: 1 })
        .toArray()
    : [];

  const emailByUserIdStr = new Map<string, string>(
    users.map((u: any) => [String(u._id), String(u.email || "").trim()])
  );

  const emails = new Set<string>();
  for (const m of mships) {
    const uidStr = String(m.userId || "");
    const userEmail = emailByUserIdStr.get(uidStr);
    if (userEmail) emails.add(userEmail);
    if (!userEmail && m.email) emails.add(String(m.email).trim());
  }

  return Array.from(emails).filter(Boolean);
}

/* ---------- Route ---------- */

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  const db = await getDb();
  const { ObjectId } = await import("mongodb");

  const body = await req.json().catch(() => ({} as any));
  const appId = String(body.appId || "");
  const docs: string[] = Array.isArray(body.docs) ? body.docs : [];
  const checklist: Array<{ id: string; label: string; helpText?: string | null }> =
    Array.isArray(body.checklist) ? body.checklist : [];
  const completedInAppFolio = !!body.completedInAppFolio;

  if (!appId) {
    return NextResponse.json({ ok: false, error: "missing_appId" }, { status: 400 });
  }
  if (!docs.length) {
    return NextResponse.json({ ok: false, error: "no_documents_selected" }, { status: 400 });
  }

  // Resolve firm + auth
  let firm;
  try {
    firm = await resolveFirmForUser(req as any, user as any);
  } catch (e: any) {
    const msg = e?.message || "forbidden";
    return NextResponse.json({ ok: false, error: msg }, { status: 403 });
  }
  const firmId = firm.firmId;

  // Load application (and related data)
  const apps = db.collection<any>("applications");
  const appFilter = (await asFilter(appId)) as any;
  const app = await apps.findOne(appFilter, {
    projection: {
      _id: 1,
      status: 1,
      formId: 1,
      firmId: 1,
      householdId: 1,
      building: 1,
      unit: 1,
      protoLease: 1,
      paymentPlan: 1,
      countersign: 1,
    },
  });

  if (!app) {
    return NextResponse.json({ ok: false, error: "application_not_found" }, { status: 404 });
  }

  // Verify app belongs to this firm via form.firmId (or app.firmId)
  const forms = db.collection<any>("application_forms");
  const formIdRaw = (app as any).formId;
  let owningFirmId: string | undefined;

  if (formIdRaw) {
    const formFilter: { _id: any } = isHex24(String(formIdRaw))
      ? { _id: new ObjectId(String(formIdRaw)) }
      : { _id: String(formIdRaw) };
    const form = await forms.findOne(formFilter, { projection: { firmId: 1 } });
    if (form?.firmId) owningFirmId = String(form.firmId);
  }
  if (!owningFirmId && (app as any).firmId) {
    owningFirmId = String((app as any).firmId);
  }
  if (owningFirmId && owningFirmId !== String(firmId)) {
    return NextResponse.json({ ok: false, error: "not_in_firm" }, { status: 403 });
  }

  const currentStatus = String(app.status ?? "approved_high") as AppState;
  if (currentStatus !== "min_paid" && currentStatus !== "countersigned") {
    return NextResponse.json(
      { ok: false, error: "invalid_state", status: currentStatus },
      { status: 400 }
    );
  }

  const plan = app.paymentPlan ?? null;
  if (!plan || !plan.startDate || !plan.monthlyRentCents) {
    return NextResponse.json(
      { ok: false, error: "missing_payment_plan" },
      { status: 400 }
    );
  }

  // Derive terms for FSM
  const building = app.building;
  const addressFreeform = building
    ? `${building.addressLine1 || ""}, ${building.city || ""}, ${building.state || ""} ${
        building.postalCode || ""
      }`
    : "Lease address";

  const terms: Terms = {
    addressFreeform,
    unitId: app.unit?.id ?? null,
    rentCents: plan.monthlyRentCents,
    startISO: plan.startDate,
    endISO: null,
    depositCents: plan.securityCents ?? null,
    fees: plan.keyFeeCents ? [{ label: "Key fee", amountCents: plan.keyFeeCents }] : [],
  };

  const minRules = deriveMinRulesFromPlan({
    countersignUpfrontThresholdCents:
      app.countersign?.upfrontMinCents ?? plan.countersignUpfrontThresholdCents,
    countersignDepositThresholdCents:
      app.countersign?.depositMinCents ?? plan.countersignDepositThresholdCents,
  });

  // Advance state: min_paid -> countersigned via signatures_completed
  let nextStatus: AppState = currentStatus;
  if (nextStatus === "min_paid") {
    nextStatus = computeNextState(
      nextStatus as any,
      "signatures_completed",
      "system",
      {
        terms,
        minRules,
        signaturesCount: 2,
      }
    ) as AppState;
  }

  const now = new Date();

  // Load selected landlord docs INCLUDING S3 metadata
  const docsColl = db.collection<any>("landlord_documents");
  const docIds = docs.map((id) => (isHex24(id) ? new ObjectId(id) : id));
  const docRows = await docsColl
    .find({ _id: { $in: docIds }, firmId })
    .project({
      _id: 1,
      title: 1,
      externalDescription: 1,
      objectKey: 1,
      contentType: 1,
      fileName: 1,
    })
    .toArray();

  const selectedDocRecords = docRows.map((d: any) => ({
    id: toStr(d._id),
    title: String(d.title || "Document"),
    externalDescription: d.externalDescription ?? null,
    objectKey: String(d.objectKey || ""),
    contentType: d.contentType || "application/octet-stream",
    fileName: d.fileName || undefined,
  }));

  // Build unit_lease document
  const leases = db.collection<any>("unit_leases");

  const moveInISO = String(plan.startDate);
  const moveOutISO =
    typeof plan.termMonths === "number" && plan.termMonths > 0
      ? (() => {
          const [y, m, d] = moveInISO.split("-").map(Number);
          if (!y || !m || !d) return null;
          const dt = new Date(Date.UTC(y, m - 1, d));
          dt.setUTCMonth(dt.getUTCMonth() + plan.termMonths);
          return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(
            2,
            "0"
          )}-${String(dt.getUTCDate()).padStart(2, "0")}`;
        })()
      : null;

  const moveInDateObj = moveInISO ? new Date(`${moveInISO}T10:00:00.000Z`) : now;
  const defaultDue = new Date(moveInDateObj.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const leaseChecklist = (checklist || []).map((item) => ({
    key: item.id,
    label: item.label,
    dueAt: defaultDue,
    completedAt: null as string | null,
    notes: null as string | null,
  }));

  const leaseId = `lease_${rand(22)}`;
  const leaseDoc: any = {
    _id: leaseId,
    firmId,
    appId: toStr(app._id),
    householdId: toStr(app.householdId ?? ""),
    building: app.building ?? null,
    unitId: app.unit?.id ?? null,
    unitNumber: app.unit?.unitNumber ?? null,
    monthlyRent: plan.monthlyRentCents,
    moveInDate: moveInISO,
    moveOutDate: moveOutISO,
    status: "scheduled",
    signed: nextStatus === "countersigned",
    signedAt: nextStatus === "countersigned" ? now : null,
    createdAt: now,
    updatedAt: now,
    checklist: leaseChecklist,
    documents: selectedDocRecords.map((d) => ({
      id: d.id,
      title: d.title,
      externalDescription: d.externalDescription,
    })),
  };

  await leases.insertOne(leaseDoc as any);

  // Update application status & link leaseId
  const updateDoc: any = {
    $set: {
      status: nextStatus,
      leaseId,
      updatedAt: now,
    },
    $push: {
      timeline: {
        at: now,
        by: toStr((user as any)?._id ?? (user as any)?.email ?? "system"),
        event: "lease.finalized",
        meta: {
          from: currentStatus,
          to: nextStatus,
          leaseId,
          docsSent: selectedDocRecords.map((d) => ({ id: d.id, title: d.title })),
          completedInAppFolio,
        },
      },
    },
  };

  await apps.updateOne(appFilter, updateDoc);

  // Build SES attachments from S3
  const attachments = await Promise.all(
    selectedDocRecords.map(async (d) => {
      if (!d.objectKey) return null;
      try {
        const { base64, contentType } = await getS3ObjectBase64(d.objectKey);
        return {
          filename: d.fileName || `${d.title}.pdf`,
          contentType,
          contentBase64: base64,
        };
      } catch (e) {
        console.error("[handoff] failed to fetch S3 object", d.objectKey, e);
        return null;
      }
    })
  );
  const mailAttachments = attachments.filter(Boolean) as {
    filename: string;
    contentType: string;
    contentBase64: string;
  }[];

  // Email household members with docs + checklist summary
  if (app.householdId) {
    const recipients = await getHouseholdUserEmails(db, String(app.householdId));
    if (recipients.length) {
      const mailer = getMailer();

      const b = app.building;
      const u = app.unit;
      const premises = b
        ? `${b.addressLine1 ?? ""}${b.addressLine2 ? `, ${b.addressLine2}` : ""}, ${
            b.city ?? ""
          }, ${b.state ?? ""} ${b.postalCode ?? ""}${
            u?.unitNumber ? ` — ${u.unitNumber}` : ""
          }`
        : "Your new home";

      const subject = `Your lease is ready – ${premises}`;
      const docsList = selectedDocRecords.map((d) => `• ${d.title}`).join("\n");

      const checklistList = leaseChecklist
        .map((c) => `• ${c.label} (due by ${c.dueAt ?? "TBD"})`)
        .join("\n");

      const text = [
        `Hi,`,
        ``,
        `Your lease for ${premises} has been finalized.`,
        ``,
        `Included documents (attached):`,
        docsList || "• (no documents were attached)",
        ``,
        `Next steps / checklist:`,
        checklistList || "• (no additional items configured)",
        ``,
        `If you have any questions, please contact your landlord or property manager.`,
      ].join("\n");

      const html =
        `<p>Hi,</p>` +
        `<p>Your lease for <strong>${premises}</strong> has been finalized.</p>` +
        `<p><strong>Included documents (attached):</strong><br>` +
        (selectedDocRecords.length
          ? `<ul>${selectedDocRecords.map((d) => `<li>${d.title}</li>`).join("")}</ul>`
          : `<em>No documents were attached.</em>`) +
        `</p>` +
        `<p><strong>Next steps / checklist:</strong><br>` +
        (leaseChecklist.length
          ? `<ul>${leaseChecklist
              .map(
                (c) =>
                  `<li>${c.label}${
                    c.dueAt ? ` (due by ${new Date(c.dueAt).toLocaleDateString()})` : ""
                  }</li>`
              )
              .join("")}</ul>`
          : `<em>No additional items were configured.</em>`) +
        `<p>If you have any questions, please contact your landlord or property manager.</p>`;

      await Promise.all(
        recipients.map((to) =>
          mailer.send({
            to,
            subject,
            html,
            text,
            idempotencyKey: `lease-handoff:${leaseId}:${to}`,
            traceId: `lease:${leaseId}`,
            attachments: mailAttachments.length ? mailAttachments : undefined,
          })
        )
      );
    }
  }

  return NextResponse.json({
    ok: true,
    leaseId,
    nextStatus,
    docsSent: selectedDocRecords.length,
  });
}
