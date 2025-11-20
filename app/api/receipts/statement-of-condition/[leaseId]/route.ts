// app/api/receipts/statement-of-condition/[leaseId]/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { s3, S3_BUCKET, S3_PUBLIC_BASE_URL } from "@/lib/aws/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ObjectId } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------- helpers ---------- */

function esc(x: any): string {
  const s = String(x ?? "");
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlShell(
  inner: string,
  title: string,
  opts?: { emailMode?: boolean },
) {
  const { emailMode = false } = opts || {};
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>
 body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;background:#f7f7f7;margin:0}
 .page{max-width:900px;margin:24px auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px}
 h1{font-size:20px;font-weight:700;margin:12px 0 0}
 h2{font-size:16px;font-weight:600;margin:18px 0 8px}
 hr{border:0;border-top:1px solid #e5e7eb;margin:16px 0}
 .muted{color:#475569;font-size:12px}
 .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
 @media(max-width:760px){.grid{grid-template-columns:1fr}}
 .row{font-size:14px}
 .label{color:#64748b;display:block;font-size:12px}
 .box{border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#fff}
 .sigline{border-top:1px solid #cbd5e1;height:28px;margin-top:8px}
 .note{background:#f1f5f9;border:1px dashed #cbd5e1;border-radius:8px;padding:10px;color:#334155;font-size:12px}
 ul.damage-list{margin:8px 0 16px 18px;padding:0;font-size:14px}
 ul.damage-list li{margin-bottom:8px}
 .room-header{margin-top:18px;font-weight:600;font-size:14px}
 .tag{display:inline-block;border-radius:999px;border:1px solid #cbd5e1;padding:0 6px;font-size:11px;color:#475569;margin-left:4px}
 #ma-statement-notice{
   font-weight:700;
   font-size:12pt;
   margin:0 0 12px 0;
 }
 .photo-grid{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
 .photo-thumb{max-width:140px;max-height:140px;border-radius:6px;border:1px solid #e5e7eb;object-fit:cover}
 .photo-caption{font-size:11px;color:#6b7280;margin-top:2px}
 .page-break{page-break-before:always;margin-top:24px}
 .appendix-title{font-size:16px;font-weight:600;margin:0 0 4px}
 .appendix-item{margin-top:12px}
 .appendix-meta{font-size:12px;color:#4b5563;margin-bottom:4px}
</style>
</head><body><div class="page">${inner}</div></body></html>`;
}

function toISO(v: any): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Simple cents → $X,XXX.XX formatter */
function moneyFromCents(c: any): string {
  const n = Number(c);
  if (!isFinite(n)) return "";
  return `$${(n / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Safe ObjectId conversion for string or ObjectId-ish values */
function toMaybeObjectId(v: any): ObjectId | null {
  if (!v) return null;
  if (v instanceof ObjectId) return v;
  const s = String(v);
  return ObjectId.isValid(s) ? new ObjectId(s) : null;
}

/** In Next 15+, ctx.params may be a Promise. */
async function resolveParams(ctx: any): Promise<Record<string, string> | null> {
  if (!ctx || !("params" in ctx)) return null;
  const p = (ctx as any).params;
  if (!p) return null;
  if (typeof (p as any)?.then === "function") {
    try {
      return await p;
    } catch {
      return null;
    }
  }
  return p as Record<string, string>;
}

function groupInspectionItemsByRoom(
  items: any[] | undefined | null,
): Record<string, any[]> {
  const byRoom: Record<string, any[]> = {};
  for (const raw of items || []) {
    if (!raw) continue;
    const room = String(raw.room || "Unspecified area");
    if (!byRoom[room]) byRoom[room] = [];
    byRoom[room].push(raw);
  }
  return byRoom;
}

function formatSeverity(severity: any): string {
  const s = String(severity || "").toLowerCase();
  if (!s) return "";
  if (s === "high") return "High";
  if (s === "medium") return "Medium";
  if (s === "low") return "Low";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * This is a *paraphrased* fallback notice with the same substance as
 * M.G.L. c.186 § 15B(2)(c), but it is NOT the exact statutory text.
 *
 * For strict compliance, always override this by setting the environment
 * variable MA_STATEMENT_OF_CONDITION_NOTICE to the full, exact notice
 * from the statute (copied from the official Massachusetts site).
 */
const DEFAULT_MA_STATEMENT_NOTICE =
  "This is a written statement of the present condition of the premises you are renting, " +
  "You should read it carefully, If you agree that it is complete and accurate, sign and return it, " +
  "If you disagree, you may attach your own signed list of additional damage or defects that you believe exist and return that as well, " +
  "Under Massachusetts law, you must return the statement within fifteen (15) days after you receive it or after you move in, whichever is later, " +
  "If you do not return anything within that time, a court may later treat that as your agreement that this list is complete and correct in any case about your security deposit,";

/* ---------- S3 signing helpers ---------- */

async function signS3Url(raw: string): Promise<string> {
  if (!raw) return raw;

  // If it already looks like a presigned URL, leave it alone.
  try {
    const u = new URL(raw);
    if (u.searchParams.has("X-Amz-Signature") || u.searchParams.has("X-Amz-Credential")) {
      return raw;
    }

    // If it's our bucket's public base URL, strip prefix and sign that key.
    if (raw.startsWith(S3_PUBLIC_BASE_URL)) {
      const rawPath = raw.slice(S3_PUBLIC_BASE_URL.length).replace(/^\/+/, "");
      const key = decodeURIComponent(rawPath);
      const cmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
      return await getSignedUrl(s3, cmd, { expiresIn: 60 * 60 }); // 1 hour
    }

    // Not our bucket host – safest is to just return raw (don't try to sign third-party URLs)
    return raw;
  } catch {
    // If it's not a valid URL, maybe it's just an object key.
    const keyCandidate = raw.replace(/^s3:\/\//, "").replace(/^\/+/, "");
    if (!keyCandidate) return raw;
    const cmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: keyCandidate });
    return await getSignedUrl(s3, cmd, { expiresIn: 60 * 60 });
  }
}

async function signInspectionPhotos(inspection: any): Promise<any> {
  const items = Array.isArray(inspection.items) ? inspection.items : [];
  const signedItems = await Promise.all(
    items.map(async (item: any) => {
      const photos: string[] = Array.isArray(item.photos) ? item.photos : [];
      const signedPhotos = await Promise.all(
        photos.map((p) => signS3Url(String(p))),
      );
      return { ...item, photos: signedPhotos };
    }),
  );
  return { ...inspection, items: signedItems };
}

/* ---------- HTML builders ---------- */

/** Main section listing condition + inline thumbnails */
function buildConditionHtml(grouped: Record<string, any[]>): string {
  const rooms = Object.keys(grouped);
  if (!rooms.length) {
    return '<p class="muted">No pre-existing damage was recorded in this landlord inspection.</p>';
  }

  let html = "";
  for (const room of rooms) {
    const items = grouped[room] || [];
    html += `<div class="room-header">${esc(room)}</div>`;
    html += '<ul class="damage-list">';
    for (const item of items) {
      const parts: string[] = [];
      if (item.category) {
        parts.push(esc(String(item.category)));
      }
      if (item.description) {
        parts.push(esc(String(item.description)));
      }
      const severityLabel = formatSeverity(item.severity);
      const severityTag = severityLabel
        ? `<span class="tag">${esc(severityLabel)}</span>`
        : "";

      const mainText = parts.join(" – ");

      let photosHtml = "";
      if (Array.isArray(item.photos) && item.photos.length) {
        const imgs = item.photos
          .filter(Boolean)
          .map(
            (url: string, idx: number) =>
              `<div>
                 <img src="${esc(url)}" alt="Photo ${idx + 1} – ${esc(
                   item.description || room,
                 )}" class="photo-thumb" loading="lazy" />
               </div>`,
          )
          .join("");
        photosHtml = `<div class="photo-grid">${imgs}</div>`;
      }

      html += `<li>${mainText}${severityTag}${photosHtml}</li>`;
    }
    html += "</ul>";
  }
  return html;
}

/** Photo appendix for print/PDF: larger gallery grouped by item */
function buildPhotoAppendix(items: any[] | undefined | null): string {
  const photoItems = (items || []).filter(
    (it) => Array.isArray(it.photos) && it.photos.length,
  );
  if (!photoItems.length) return "";

  let html = `
<div class="page-break"></div>
<h2 class="appendix-title">Photo Appendix – Statement of Condition</h2>
<p class="muted">
  The photos below were captured as part of the pre-move-in inspection and correspond to the items listed in the Statement of Condition above.
</p>
`;

  for (const item of photoItems) {
    const room = String(item.room || "Unspecified area");
    const severity = formatSeverity(item.severity);
    html += `<div class="appendix-item">
      <div class="appendix-meta">
        <strong>${esc(room)}</strong>${
          item.category ? ` • ${esc(String(item.category))}` : ""
        }${
      item.description ? ` • ${esc(String(item.description))}` : ""
    }${severity ? ` • Severity: ${esc(severity)}` : ""}
      </div>
      <div class="photo-grid">
    `;

    html += item.photos
      .filter(Boolean)
      .map(
        (url: string, idx: number) =>
          `<div>
             <img src="${esc(url)}" alt="Photo ${idx + 1} – ${esc(
               item.description || room,
             )}" class="photo-thumb" loading="lazy" />
             <div class="photo-caption">Photo ${idx + 1}</div>
           </div>`,
      )
      .join("");

    html += `</div></div>`;
  }

  return html;
}

/* ---------- route ---------- */

export async function GET(req: Request, ctx: any) {
  const db = await getDb();
  const url = new URL(req.url);
  const debugLevel = Number(url.searchParams.get("debug") || 0) || 0;
  const emailMode =
    (url.searchParams.get("mode") || "").toLowerCase() === "email";

  const params = await resolveParams(ctx);
  const seg = params?.leaseId ?? "";
  const q = url.searchParams.get("leaseId") || "";
  const pathSegs = url.pathname.split("/").filter(Boolean);
  const last = pathSegs[pathSegs.length - 1];
  const leaseIdRaw = seg || q || last || "";

  const trace: { [k: string]: any } = {
    params: { leaseIdRaw, seg, q, last },
    lookup: {},
  };

  const inspectionsCol = db.collection("landlord_inspections") as any;

  let inspection: any = null;

  if (leaseIdRaw) {
    // Basic assumption: one inspection per lease; if you end up with multiple,
    // you may want to add an explicit sort by createdAt/updatedAt.
    inspection = await inspectionsCol.findOne({ leaseId: leaseIdRaw });
    trace.lookup.byLeaseId = !!inspection;
  }

  if (!inspection) {
    const notFound = htmlShell(
      "<h1>Statement of Condition</h1><p class='muted'>No inspection found for this lease.</p>",
      "Statement of Condition",
      { emailMode },
    );
    return new NextResponse(notFound, {
      status: 404,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Frame-Options": "SAMEORIGIN",
        "Content-Security-Policy":
          "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none';",
        "Referrer-Policy": "no-referrer",
      },
    });
  }

  // 🔐 Sign all photo URLs before building HTML
  inspection = await signInspectionPhotos(inspection);

  const grouped = groupInspectionItemsByRoom(inspection.items);
  const conditionHtml = buildConditionHtml(grouped);
  const appendixHtml = buildPhotoAppendix(inspection.items);

  // Base statement date: when the inspection record was created / last touched
  const statementDateISO =
    toISO(inspection.createdAt) || toISO(inspection.updatedAt);
  const statementDateDisplay = statementDateISO
    ? new Date(statementDateISO).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : new Date().toLocaleDateString();

  // Landlord "signature" date = when the inspection was submitted (fall back to updatedAt/createdAt)
  const submissionDateISO =
    toISO((inspection as any).submittedAt) ||
    toISO(inspection.updatedAt) ||
    toISO(inspection.createdAt) ||
    statementDateISO;
  const landlordSignatureDateDisplay = submissionDateISO
    ? new Date(submissionDateISO).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : statementDateDisplay;

  const statutoryNotice =
    (process.env.MA_STATEMENT_OF_CONDITION_NOTICE || "").trim() ||
    DEFAULT_MA_STATEMENT_NOTICE;

  const leaseRef =
    (inspection.leaseId && String(inspection.leaseId)) || "—";
  const firmId =
    (inspection.firmId && String(inspection.firmId)) || "";
  const landlordRef = firmId || "—";
  const inspectorRef =
    (inspection.inspectorId && String(inspection.inspectorId)) || "—";
  const statusRef = (inspection.status && String(inspection.status)) || "—";

  // Pull unit / building details from unit_leases
  let leaseAddress = "";
  let moveInDisplay = "";
  let moveOutDisplay = "";
  let monthlyRentDisplay = "";
  let leaseHouseholdId: string | null = null;

  try {
    if (leaseRef && leaseRef !== "—") {
      const unitLeasesCol = db.collection("unit_leases") as any;
      const leaseDoc = await unitLeasesCol.findOne({ _id: leaseRef });
      if (leaseDoc) {
        trace.unitLeaseDocFound = true;

        leaseHouseholdId = leaseDoc.householdId || null;

        // Address
        const b = leaseDoc.building || {};
        const line = [b.addressLine1, b.addressLine2].filter(Boolean).join(", ");
        const cityStateZip = [b.city, b.state, b.postalCode]
          .filter(Boolean)
          .join(", ");
        const country = b.country;
        const addrParts = [line, cityStateZip, country].filter(Boolean);
        leaseAddress = addrParts.join(", ");

        // Move-in / move-out
        const miISO = toISO(leaseDoc.moveInDate);
        const moISO = toISO(leaseDoc.moveOutDate);
        moveInDisplay = miISO
          ? new Date(miISO).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : "";
        moveOutDisplay = moISO
          ? new Date(moISO).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : "";

        // Monthly rent (cents)
        if (leaseDoc.monthlyRent != null) {
          monthlyRentDisplay = moneyFromCents(leaseDoc.monthlyRent);
        }
      }
    }
  } catch {
    // Non-fatal; just omit address/lease meta if lookup fails
  }

  // Pull firm details from FirmDoc using inspection.firmId
  let firmName = "";
  try {
    if (firmId) {
      const firmsCol = db.collection("FirmDoc") as any;
      const firmDoc = await firmsCol.findOne({ _id: firmId });
      if (firmDoc) {
        firmName = firmDoc.name || "";
        trace.firmDocFound = true;
      }
    }
  } catch {
    // Non-fatal; landlordRef will still show the firmId
  }

  const landlordSignatureLine = firmName
    ? `An agent of ${firmName}`
    : "An authorized agent of the landlord";

  // Household / tenant names based on household_memberships + users
  let householdTenantNames = "";
  try {
    // Prefer an explicit inspection.householdId, fall back to the lease document’s householdId
    const rawHouseholdId =
      (inspection.householdId && String(inspection.householdId)) ||
      leaseHouseholdId ||
      null;

    trace.householdIdRaw = rawHouseholdId;

    if (rawHouseholdId) {
      const householdIdString = String(rawHouseholdId);

      const membershipsCol = db.collection("household_memberships") as any;
      const usersCol = db.collection("users") as any;

      // In your samples, household_memberships.householdId is a plain string,
      // so we query directly by string
      const memberships = await membershipsCol
        .find({ householdId: householdIdString, active: true })
        .toArray();

      trace.householdId = householdIdString;
      trace.membershipCount = memberships.length;
      trace.membershipSample = memberships
        .slice(0, 3)
        .map((m: any) => ({ _id: m._id, userId: m.userId, email: m.email, role: m.role }));

      if (!memberships.length) {
        // No members, we just leave householdTenantNames empty and fall back to the blank line
        throw new Error("no_active_memberships_for_household");
      }

      const userIdStrings = memberships
        .map((m: any) => (m.userId ? String(m.userId) : null))
        .filter(Boolean) as string[];

      trace.userIdStrings = userIdStrings;

      // Your users._id is an ObjectId, your membership.userId is a string of that ObjectId’s hex,
      // so we convert them to ObjectIds here
      const userObjectIds = userIdStrings
        .map((id) => toMaybeObjectId(id))
        .filter((id): id is ObjectId => !!id);

      trace.userObjectIds = userObjectIds.map((id) => id.toHexString());

      const users = userObjectIds.length
        ? await usersCol
            .find({ _id: { $in: userObjectIds } })
            .toArray()
        : [];

      trace.userCount = users.length;
      trace.userSample = users
        .slice(0, 3)
        .map((u: any) => ({
          _id: u._id,
          legal_name: u.legal_name,
          preferredName: u.preferredName,
          name: u.name,
          email: u.email,
        }));

      const names = users
        .map((u: any) => {
          return (
            u.legal_name ||
            u.preferredName ||
            u.name ||
            u.email ||
            null
          );
        })
        .filter(Boolean) as string[];

      if (names.length) {
        householdTenantNames = names.join(", ");
      }
    }
  } catch (err) {
    trace.householdError = String(
      err instanceof Error ? err.message : err,
    );
  }

  const tenantSectionHtml = householdTenantNames
    ? `<div class="row">
         <span class="label">Household / Tenants (informational)</span>
         <div style="font-size:13px;color:#111827;margin-top:2px;">
           The household consisting of ${esc(
             householdTenantNames,
           )} is expected to occupy the premises for this tenancy, however, if there is any difference between this list and the signed lease, the lease and its named tenants control.
         </div>
       </div>`
    : `<div class="row"><span class="label">Tenant(s)</span>____________________________</div>`;

  const inner = `
<p id="ma-statement-notice">${esc(statutoryNotice)}</p>

<h1>Statement of Condition – Massachusetts Security Deposit</h1>
<p class="muted">
  Prepared on ${esc(statementDateDisplay)} for lease ${esc(
    leaseRef,
  )}, This separate written statement describes the present condition of the premises at the start of the tenancy,
</p>

<hr/>

<div class="grid">
  <div class="box">
    <div class="row"><span class="label">Lease Reference</span>${esc(
      leaseRef,
    )}</div>
    <div class="row"><span class="label">Inspection Status</span>${esc(
      statusRef,
    )}</div>
    ${
      moveInDisplay
        ? `<div class="row"><span class="label">Move-in Date</span>${esc(
            moveInDisplay,
          )}</div>`
        : ""
    }
    ${
      monthlyRentDisplay
        ? `<div class="row"><span class="label">Monthly Rent</span>${esc(
            monthlyRentDisplay,
          )}</div>`
        : ""
    }
  </div>
  <div class="box">
    <div class="row"><span class="label">Firm / Landlord Id</span>${esc(
      landlordRef,
    )}</div>
    <div class="row"><span class="label">Inspector Id</span>${esc(
      inspectorRef,
    )}</div>
    ${
      moveOutDisplay
        ? `<div class="row"><span class="label">Move-out Date</span>${esc(
            moveOutDisplay,
          )}</div>`
        : ""
    }
  </div>
</div>

<div class="grid" style="margin-top:12px">
  <div class="box">
    <div class="row"><span class="label">Premises Address</span>${
      leaseAddress ? esc(leaseAddress) : "____________________________"
    }</div>
  </div>
  <div class="box">
    ${tenantSectionHtml}
  </div>
</div>

<h2>Present condition of the premises</h2>
${conditionHtml}

<div style="margin-top:32px" class="grid">
  <div class="box">
    <div class="row">
      <span class="label">Landlord / Agent Certification</span>
      <div class="muted" style="font-size:11px;margin-top:4px;">
        I certify under pains and penalties of perjury that this Statement of Condition is, to the best of my knowledge, true, accurate, and complete as of the date signed,
      </div>
    </div>
    <div class="row" style="margin-top:12px;">
      <span class="label">Landlord / Agent Signature</span>
      <div style="margin-top:4px;font-size:13px;color:#111827;">
        ${esc(landlordSignatureLine)}
      </div>
    </div>
    <div class="row">
      <span class="label">Date</span>
      <div style="margin-top:4px;font-size:13px;color:#111827;">
        ${esc(landlordSignatureDateDisplay)}
      </div>
    </div>
  </div>
  <div class="box">
    <div class="row"><span class="label">Tenant Signature(s)</span><div class="sigline"></div></div>
    <div class="row"><span class="label">Date</span><div class="sigline"></div></div>
  </div>
</div>

<p class="note" style="margin-top:18px">
  Tenant, if you believe this statement is incomplete or inaccurate, you may attach your own signed list of additional damage or defects that you believe exist, and return both this form and your list to the landlord within fifteen (15) days after you receive this statement or move in, whichever is later,
</p>

${appendixHtml}
`;

  const html = htmlShell(inner, "Statement of Condition", { emailMode });

  if (debugLevel >= 1) {
    return NextResponse.json({
      leaseIdRaw,
      inspection,
      grouped,
      html,
      trace,
    });
  }

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="statement-of-condition-${encodeURIComponent(
        leaseRef,
      )}.html"`,
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy":
        "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none';",
      "Referrer-Policy": "no-referrer",
    },
  });
}
