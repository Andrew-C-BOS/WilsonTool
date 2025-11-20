// app/api/disclosures/statement-of-condition/[inspectionId]/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
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
  // Styling is intentionally very close to the security‑deposit receipt route
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>
 body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;background:#f7f7f7;margin:0}
 .page{max-width:900px;margin:24px auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px}
 h1{font-size:20px;font-weight:700;margin:0}
 h2{font-size:16px;font-weight:600;margin:18px 0 8px}
 hr{border:0;border-top:1px solid #e5e7eb;margin:16px 0}
 .muted{color:#475569;font-size:12px}
 .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
 @media(max-width:760px){.grid{grid-template-columns:1fr}}
 .row{font-size:14px}
 .label{color:#64748b;display:block;font-size:12px}
 .box{border:1px solid #e5e7eb;border-radius:8px;padding:12px;background:#fff}
 .sigline{border-top:1px solid #cbd5e1;height:28px;margin-top:24px}
 .note{background:#f1f5f9;border:1px dashed #cbd5e1;border-radius:8px;padding:10px;color:#334155;font-size:12px}
 ul.damage-list{margin:8px 0 16px 18px;padding:0;font-size:14px}
 ul.damage-list li{margin-bottom:4px}
 .room-header{margin-top:18px;font-weight:600;font-size:14px}
 .tag{display:inline-block;border-radius:999px;border:1px solid #cbd5e1;padding:0 6px;font-size:11px;color:#475569;margin-left:4px}
</style>
</head><body><div class="page">${inner}</div></body></html>`;
}

function toISO(v: any): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
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

// This is a *paraphrased* default notice that tracks the substance of
// M.G.L. c.186 § 15B(2)(c). For strict legal compliance, override with the
// exact statutory language (for example via MA_STATEMENT_OF_CONDITION_NOTICE).
const DEFAULT_MA_STATEMENT_NOTICE =
  "This is a written statement of the present condition of the premises you are renting. " +
  "You should read it carefully. If you agree that it is complete and accurate, sign and return it. " +
  "If you disagree, you may attach your own signed list of additional damage or defects that you believe exist and return that as well. " +
  "Under Massachusetts law, you must return the statement within fifteen (15) days after you receive it or after you move in, whichever is later. " +
  "If you do not return anything within that time, a court may later treat that as your agreement that this list is complete and correct in any case about your security deposit.";

function buildConditionHtml(grouped: Record<string, any[]>): string {
  const rooms = Object.keys(grouped);
  if (!rooms.length) {
    return "<p class=\"muted\">No pre-existing damage was recorded in this landlord inspection.</p>";
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
      let photosHtml = "";
      if (Array.isArray(item.photos) && item.photos.length) {
        const links = item.photos
          .filter(Boolean)
          .map(
            (url: string, idx: number) =>
              `<a href="${esc(
                url,
              )}" target="_blank" rel="noreferrer">photo ${idx + 1}</a>`,
          )
          .join(", ");
        photosHtml = links
          ? `<div class="muted">Photos: ${links}</div>`
          : "";
      }
      const mainText = parts.join(" – ");
      html += `<li>${mainText}${severityTag}${photosHtml}</li>`;
    }
    html += "</ul>";
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
  const seg = params?.inspectionId ?? "";
  const q = url.searchParams.get("inspectionId") || "";
  const pathSegs = url.pathname.split("/").filter(Boolean);
  const last = pathSegs[pathSegs.length - 1];
  const inspectionIdRaw = seg || q || last || "";

  const trace: { [k: string]: any } = {
    params: { inspectionIdRaw, seg, q, last },
    lookup: {},
  };

  const inspectionsCol = db.collection("landlord_inspections") as any;

  let inspection: any = null;
  if (inspectionIdRaw) {
    // Try _id as ObjectId
    if (ObjectId.isValid(inspectionIdRaw)) {
      inspection = await inspectionsCol.findOne({
        _id: new ObjectId(inspectionIdRaw),
      });
      trace.lookup.byObjectId = !!inspection;
    }
    // Try _id as string
    if (!inspection) {
      inspection = await inspectionsCol.findOne({ _id: inspectionIdRaw });
      trace.lookup.byStringId = !!inspection;
    }
    // Optional: also allow lookup by leaseId
    if (!inspection) {
      inspection = await inspectionsCol.findOne({ leaseId: inspectionIdRaw });
      trace.lookup.byLeaseId = !!inspection;
    }
  }

  if (!inspection) {
    const notFound = htmlShell(
      "<h1>Statement of Condition</h1><p class='muted'>Inspection not found.</p>",
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

  const grouped = groupInspectionItemsByRoom(inspection.items);
  const conditionHtml = buildConditionHtml(grouped);

  const statementDateISO =
    toISO(inspection.createdAt) || toISO(inspection.updatedAt);
  const statementDateDisplay = statementDateISO
    ? new Date(statementDateISO).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : new Date().toLocaleDateString();

  const statutoryNotice =
    (process.env.MA_STATEMENT_OF_CONDITION_NOTICE || "").trim() ||
    DEFAULT_MA_STATEMENT_NOTICE;

  const leaseRef =
    (inspection.leaseId && String(inspection.leaseId)) || "—";
  const landlordRef =
    (inspection.firmId && String(inspection.firmId)) || "—";
  const inspectorRef =
    (inspection.inspectorId && String(inspection.inspectorId)) || "—";
  const statusRef = (inspection.status && String(inspection.status)) || "—";

  const inner = `
<h1>Statement of Condition – Massachusetts Security Deposit</h1>
<p class="muted">
  Prepared on ${esc(statementDateDisplay)} for lease ${esc(
    leaseRef,
  )}. This document is intended to satisfy the
  Massachusetts “statement of present condition” requirement when a security deposit is taken.
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
  </div>
  <div class="box">
    <div class="row"><span class="label">Firm / Landlord Id</span>${esc(
      landlordRef,
    )}</div>
    <div class="row"><span class="label">Inspector Id</span>${esc(
      inspectorRef,
    )}</div>
  </div>
</div>

<h2>Important notice to tenant</h2>
<p class="muted" style="white-space:pre-line">${esc(statutoryNotice)}</p>

<h2>Present condition of the premises</h2>
${conditionHtml}

<div style="margin-top:32px" class="grid">
  <div class="box">
    <div class="row"><span class="label">Landlord / Agent Signature</span><div class="sigline"></div></div>
    <div class="row"><span class="label">Date</span><div class="sigline"></div></div>
  </div>
  <div class="box">
    <div class="row"><span class="label">Tenant Signature(s)</span><div class="sigline"></div></div>
    <div class="row"><span class="label">Date</span><div class="sigline"></div></div>
  </div>
</div>

<p class="note" style="margin-top:18px">
  Tenant: if you believe this statement is incomplete or inaccurate, you may attach your own signed list of additional damage or defects that you believe exist, and return both this form and your list to the landlord within fifteen (15) days after you receive this statement or move in, whichever is later.
</p>
`;

  const html = htmlShell(inner, "Statement of Condition", { emailMode });

  if (debugLevel >= 1) {
    return NextResponse.json({
      inspectionIdRaw,
      inspection,
      grouped,
      html,
      trace,
    });
  }

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy":
        "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none';",
      "Referrer-Policy": "no-referrer",
    },
  });
}
