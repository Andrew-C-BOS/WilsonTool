// app/api/receipts/security-deposit/[paymentId]/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ObjectId } from "mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------- helpers ---------- */
function esc(x: any): string {
  const s = String(x ?? "");
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function htmlShell(inner: string, title: string, opts?: { emailMode?: boolean }) {
  const { emailMode = false } = opts || {};
  const printScript = emailMode ? "" : `<script>function doPrint(){window.print();}</script>`;
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
 pre{background:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;padding:12px;overflow:auto}
 .actions{display:flex;gap:8px;align-items:center;justify-content:flex-end}
 .btn{font-size:12px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;padding:6px 10px;cursor:pointer}
 .btn:hover{background:#f8fafc}
</style>
${printScript}
</head><body><div class="page">${inner}</div></body></html>`;
}
function toISO(v:any){ if(!v) return null; const d=new Date(v); return isNaN(d.getTime())?null:d.toISOString(); }
function formatInterestFromDisclosure(d: any): string {
  if (d && typeof d.interestHundredths === "number" && !isNaN(d.interestHundredths)) return (d.interestHundredths/100).toFixed(2) + "%";
  if (d && typeof d.interestRate === "number" && !isNaN(d.interestRate)) return Number(d.interestRate).toFixed(2) + "%";
  return "≤5% or bank rate";
}
/** In Next 15+, ctx.params may be a Promise. */
async function resolveParams(ctx: any): Promise<Record<string,string> | null> {
  if (!ctx || !("params" in ctx)) return null;
  const p = (ctx as any).params;
  if (!p) return null;
  if (typeof (p as any)?.then === "function") { try { return await p; } catch { return null; } }
  return p as Record<string,string>;
}
function toMaybeObjectId(x: any): any {
  if (!x) return x;
  const s = String(x);
  return ObjectId.isValid(s) ? new ObjectId(s) : x;
}

/* ---------- firm resolvers (firms + FirmDoc) ---------- */
async function resolveFirmRecords(db: any, hints: any[]) {
  let firm: any = null;
  let firmDoc: any = null;

  for (const raw of hints.filter(Boolean)) {
    const ids = [raw, toMaybeObjectId(raw)];
    for (const _id of ids) {
      if (!firm)    firm    = await db.collection("firms").findOne({ _id });
      if (!firmDoc) firmDoc = await db.collection("FirmDoc").findOne({ _id });
      if (firm && firmDoc) break;
    }
    if (firm && firmDoc) break;
  }

  if (!firmDoc) {
    for (const raw of hints.filter(Boolean)) {
      const asSlug = String(raw);
      const doc = await db.collection("FirmDoc").findOne({ slug: asSlug });
      if (doc) { firmDoc = doc; break; }
    }
  }

  return { firm, firmDoc };
}

/* ---------- HOUSEHOLD: payments → applications → households → memberships → users ---------- */
async function resolveHouseholdBundle(db: any, payment: any, trace?: any) {
  // 1) application (CAST appId so string/ObjectId both work)
  const appId = payment?.appId ? toMaybeObjectId(payment.appId) : null;
  const app = appId ? await db.collection("applications").findOne({ _id: appId }) : null;

  // add a tiny trace to help when ?debug=1
  if (trace) {
    trace.appLookup = {
      raw: payment?.appId ?? null,
      castedType: appId ? (appId.constructor?.name || typeof appId) : null,
      found: !!app,
      appId: app?._id ?? null,
      householdIdOnApp: app?.householdId ?? null,
    };
  }

  // 2) household
  const hhIdRaw = app?.householdId ?? payment?.householdId ?? null;
  let household: any = null;
  if (hhIdRaw) {
    const hhId = toMaybeObjectId(hhIdRaw);
    household = await db.collection("households").findOne({ _id: hhId });
  }

  // 3) memberships
  let memberships: any[] = [];
  if (household?._id) {
    const hhKey = household._id; // ObjectId
    memberships = await db
      .collection("household_memberships")
      .find({ householdId: { $in: [hhKey, String(hhKey)] } })
      .toArray();
  }

  // 4) users → labels (legal_name if exists, otherwise email)
  let memberLabels: string[] = [];
  if (memberships.length) {
    const userIds = memberships.map((m:any)=>m.userId).filter(Boolean);
    if (userIds.length) {
      const userObjIds = userIds.map((id:any)=>toMaybeObjectId(id));
      const users = await db.collection("users").find({ _id: { $in: userObjIds } }).toArray();
      const byId = new Map(users.map((u:any)=>[String(u._id), u]));
      memberLabels = memberships.map((m:any)=>{
        const u = byId.get(String(toMaybeObjectId(m.userId)));
        const legal = u?.legal_name; // your rule
        return (legal && String(legal).trim()) || u?.email || m?.email || "";
      }).filter(Boolean);
    } else {
      memberLabels = memberships.map((m:any)=>m?.email).filter(Boolean);
    }
  }

  // dedupe preserving order
  const seen = new Set<string>();
  const uniq = memberLabels.filter(x => (x && !seen.has(x) && seen.add(x), x));

  // 5) tenant line: displayName if present; otherwise first identifier (legal/email)
  const tenantLine =
    (household?.displayName ? String(household.displayName) : (uniq[0] || "Tenant"));

  // subline: “Consisting of …”
  const tenantSubHtml = uniq.length
    ? `<div class="muted">Consisting of ${esc(uniq.join(", "))}</div>`
    : "";

  if (trace) {
    trace.householdLookup = {
      householdFound: !!household,
      householdId: household?._id ?? null,
      displayName: household?.displayName ?? null,
      memberCount: memberships.length,
      memberLabels: uniq,
    };
  }

  return { app, household, tenantLine, tenantSubHtml, memberLabels: uniq };
}

/* ---------- route ---------- */
export async function GET(req:Request,ctx:any) {
  const db=await getDb();
  const url=new URL(req.url);
  const debugLevel=Number(url.searchParams.get("debug")||0)||0;
  const emailMode=(url.searchParams.get("mode")||"").toLowerCase()==="email";

  // id extraction
  const params = await resolveParams(ctx);
  const seg=params?.paymentId??"";
  const q=url.searchParams.get("paymentId")||"";
  const pathSegs=url.pathname.split("/").filter(Boolean);
  const last=pathSegs[pathSegs.length-1];
  const paymentIdRaw=seg||q||last||"";

  const trace:{[k:string]:any}={params:{paymentIdRaw,seg,q,last},probes:[]};
  const addProbe=(p:any)=>trace.probes.push(p);

  async function probeById(id:any,withFilters:boolean){
    const f=withFilters?{_id:id,kind:"deposit",status:"succeeded"}:{_id:id};
    const doc=await db.collection("payments").findOne(f);
    addProbe({probe:withFilters?"_id + kind/status":"_id only",id:String(id),found:!!doc});
    return doc;
  }

  // load payment
  let payment:any=null;
  if(ObjectId.isValid(paymentIdRaw)){
    payment=await probeById(new ObjectId(paymentIdRaw),true)||await probeById(new ObjectId(paymentIdRaw),false);
  }else{
    payment=await probeById(paymentIdRaw,true)||await probeById(paymentIdRaw,false);
  }
  if(!payment){
    const notFound = htmlShell("<h1>Security Deposit Receipt</h1><p class='muted'>Not found.</p>","Security Deposit Receipt",{emailMode});
    return new NextResponse(notFound,{
      status:404,
      headers:{
        "Content-Type":"text/html; charset=utf-8",
        "X-Frame-Options":"SAMEORIGIN",
        "Content-Security-Policy":"default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none';",
        "Referrer-Policy":"no-referrer",
      },
    });
  }

  // firm (firms + FirmDoc) — unchanged from your fixed version
  // We still read app from the household resolver, so don't fetch here redundantly.
  const firmHints = [payment.firmId, payment?.meta?.firmId].filter(Boolean);
  const { firm, firmDoc } = await resolveFirmRecords(db, firmHints);
  const landlord = (
    firmDoc?.legal_name ??
    firmDoc?.legalName ??
    firmDoc?.name ??
    firm?.legal_name ??
    firm?.legalName ??
    firm?.name ??
    "Landlord"
  ).toString();

  // HOUSEHOLD bundle (does applications join inside)
  const { app, household, tenantLine, tenantSubHtml, memberLabels } =
    await resolveHouseholdBundle(db, payment, trace);

  // premises (from applications)
  const b=app?.building, u=app?.unit;
  const premises=b
    ? `${b.addressLine1??""}${b.addressLine2?`, ${b.addressLine2}`:""}, ${b.city??""}, ${b.state??""} ${b.postalCode??""}${u?.unitNumber?` — Unit ${u.unitNumber}`:""}`
    : "Premises";

  // payment details
  const receivedISO=toISO(payment.createdAt)||new Date().toISOString();
  const receivedOn=new Date(receivedISO).toLocaleDateString();
  const amount=`$${(payment.amountCents/100).toFixed(2)}`;
  const rails=(payment.rails??payment.provider??payment?.meta?.rails??"—").toString();
  const pi=payment?.providerIds?.paymentIntentId;
  const ref=pi?`${rails} • ${pi}`:rails;

  // escrow (from firms)
  const escRow=firm?.escrowDisclosure??{};
  const bankName=escRow.bankName??"";
  const bankAddress=escRow.bankAddress??"";
  const acctId=escRow.accountIdentifier??"";
  const last4=escRow.accountLast4??"";
  const acctDisplay=acctId || (last4?`•••• ${last4}`:"");
  const depositISO=toISO(payment.succeededAt??payment.processingAt??payment.createdAt);
  const depositDate=depositISO?new Date(depositISO).toLocaleDateString():"";
  const interestDisplay=formatInterestFromDisclosure(escRow);

  // signature
  const sigMeta=(payment.meta?.receiptSignature??{}) as {name?:string;atISO?:string;imageUrl?:string;};
  const sigName=(sigMeta.name||"Andrew Codding").trim();
  const sigAtISO=toISO(sigMeta.atISO||receivedISO);
  const sigAt=sigAtISO?new Date(sigAtISO).toLocaleDateString():receivedOn;
  const sigImageUrl=(sigMeta.imageUrl||"").trim();

  // compliance
  const initialReceiptMissing=!landlord||!premises||!receivedOn||!amount||!sigName;
  const bankReceiptMissing=!bankName||!bankAddress||!depositDate||!(acctId||last4);
  const needsFullAccountNumber=!acctId;

  const inner=`
  ${emailMode ? "" : `<div class="actions"><button class="btn" onclick="doPrint()">Print / Save as PDF</button></div>`}
  <h1>Security Deposit Receipt</h1>
  <div class="muted">M.G.L. c.186 § 15B</div>

  <div class="box">
    <h2>Initial Receipt – § 15B(2)(b) disclosure</h2>
    <div class="grid">
      <div class="row"><span class="label">Tenant (household)</span>${esc(tenantLine)}${tenantSubHtml}</div>
      <div class="row"><span class="label">Landlord (legal name)</span>${esc(landlord)}</div>
      <div class="row"><span class="label">Premises</span>${esc(premises)}</div>
      <div class="row"><span class="label">Amount Received</span>${esc(amount)}</div>
      <div class="row"><span class="label">Date Received</span>${esc(receivedOn)}</div>
      <div class="row"><span class="label">Payment / Reference</span>${esc(ref)}</div>
      <div class="row"><span class="label">Received By</span>MILO Homes, payment facilitator for ${esc(landlord)}</div>
    </div>
    <div class="sig">
      ${
        sigImageUrl
          ? `<div style="display:flex;align-items:center;gap:12px;margin-top:8px">
               <img src="${esc(sigImageUrl)}" alt="Signature" style="height:48px;max-width:260px;object-fit:contain;border:1px solid #e5e7eb;border-radius:4px;background:#fff" />
               <div class="muted">Signed electronically by ${esc(sigName)} on ${esc(sigAt)}</div>
             </div>`
          : `<div class="sigline"></div>
             <div class="muted">Signed electronically by ${esc(sigName)} on ${esc(sigAt)}</div>`
      }
      <div class="muted" style="margin-top:6px">
        MILO Homes is not the landlord’s broker and does not hold tenant funds; MILO facilitated this payment directly to the landlord’s Massachusetts escrow account.
      </div>
    </div>
    ${initialReceiptMissing?`<div class="note" style="margin-top:10px">Missing one or more fields required by § 15B(2)(b): amount, date received, premises, receiver/landlord identity, or signature.</div>`:""}
  </div>

  <hr/>

  <div class="box">
    <h2>Bank Account Receipt – § 15B(3)(a) disclosure</h2>
    <div class="grid">
      <div class="row"><span class="label">Bank Name</span>${esc(bankName||"—")}</div>
      <div class="row"><span class="label">Bank Address</span>${esc(bankAddress||"—")}</div>
      <div class="row"><span class="label">Account Number / Identifier</span>${esc(acctDisplay||"—")}</div>
      <div class="row"><span class="label">Account Type</span>${esc(escRow.accountType??"Interest-Bearing")}</div>
      <div class="row"><span class="label">Deposit Amount</span>${esc(amount)}</div>
      <div class="row"><span class="label">Deposit Date</span>${esc(depositDate||"—")}</div>
      <div class="row"><span class="label">Annual Interest</span>${esc(interestDisplay)}</div>
    </div>
    ${bankReceiptMissing?`<div class="note" style="margin-top:10px">This disclosure is incomplete. § 15B(3)(a) requires bank name and address, the <b>account number</b>, amount, and deposit date within 30 days of receipt.</div>`:needsFullAccountNumber?`<div class="note" style="margin-top:10px">For full compliance, disclose the <b>complete account number/identifier</b> to the tenant (last four alone is not sufficient for § 15B(3)(a)).</div>`:""}
    <p class="muted" style="margin-top:12px">
      The security deposit remains the property of the tenant and is held in trust in a separate, interest-bearing account at a bank located in Massachusetts. Interest will be paid or credited annually, or upon termination, in accordance with § 15B.
    </p>
  </div>

  ${debugLevel?`<hr/><h2>Debug</h2><pre>${esc(JSON.stringify({
    paymentIdRaw,
    firmFound: !!firm,
    firmDocFound: !!firmDoc,
    landlord,
    householdId: household?._id ?? null,
    householdDisplay: household?.displayName ?? null,
    memberLabels
  },null,2))}</pre>`:""}
  `;

  const html = htmlShell(inner,"Security Deposit Receipt",{emailMode});

  return new NextResponse(html,{
    headers:{
      "Content-Type":"text/html; charset=utf-8",
      "X-Frame-Options":"SAMEORIGIN",
      "Content-Security-Policy":"default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none';",
      "Referrer-Policy":"no-referrer",
    },
  });
}
