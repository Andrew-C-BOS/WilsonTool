// app/tenant/apply/ApplyClient.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

/* ─────────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────────── */
type MemberRole = "primary" | "co_applicant" | "cosigner";
type InputType =
  | "short_text" | "long_text" | "number" | "currency" | "yes_no"
  | "date" | "email" | "phone" | "select_single" | "select_multi" | "file";

type FormSection = { id: string; title: string; description?: string };
type FormQuestion = {
  id: string;
  sectionId: string;
  label: string;
  helpText?: string;
  inputType: InputType;
  required: boolean;
  showForRoles: MemberRole[];
  options?: string[];
  validation?: { min?: number; max?: number; pattern?: string };
};
type Qualification = {
  id: string;
  title: string;
  audience: MemberRole[];
  requirement: "required" | "optional" | "conditional";
  mode: "self_upload" | "integration" | "either";
  docKind?: string;
  notes?: string;
};
type ApplicationForm = {
  _id?: string;
  id?: string;
  name: string;
  description?: string;
  scope: "portfolio";
  sections: FormSection[];
  questions: FormQuestion[];
  qualifications: Qualification[];
  version: number;
};

/* ---------- small helpers ---------- */
function digitsOnly(s: string): string { return (s || "").replace(/\D/g, ""); }
function maskUSPhone(d: string): string {
  const x = digitsOnly(d).slice(0, 10);
  const a = x.slice(0, 3), b = x.slice(3, 6), c = x.slice(6, 10);
  if (x.length <= 3) return a;
  if (x.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}
function clsx(...xs: (string | false | null | undefined)[]) { return xs.filter(Boolean).join(" "); }
/** Best-effort: read user email from 'milo_auth' cookie payload */
function getMyEmailFromCookie(): string | null {
  try {
    const cookie = document.cookie.split(";").map((s) => s.trim()).find((c) => c.startsWith("milo_auth="));
    if (!cookie) return null;
    const token = cookie.split("=")[1];
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    const email = String(payload?.email ?? "").toLowerCase();
    return email || null;
  } catch { return null; }
}

/* ─────────────────────────────────────────────────────────────
   Optional demo form: only used when form=demo_form explicitly
───────────────────────────────────────────────────────────── */
const DEMO: ApplicationForm = {
  id: "demo_form",
  name: "Standard Rental Application",
  description: "Complete the steps below, invite co-applicants and cosigners, upload documents,",
  scope: "portfolio",
  version: 1,
  sections: [
    { id: "sec_applicant", title: "Applicant info" },
    { id: "sec_residence", title: "Residence history" },
    { id: "sec_income", title: "Employment & income" },
  ],
  questions: [
    { id: "q_name", sectionId: "sec_applicant", label: "Legal name", inputType: "short_text", required: true, showForRoles: ["primary", "co_applicant"] },
    { id: "q_email", sectionId: "sec_applicant", label: "Email address", inputType: "email", required: true, showForRoles: ["primary", "co_applicant", "cosigner"] },
    { id: "q_phone", sectionId: "sec_applicant", label: "Phone", inputType: "phone", required: true, showForRoles: ["primary"] },
    { id: "q_dob", sectionId: "sec_applicant", label: "Date of birth", inputType: "date", required: true, showForRoles: ["primary", "co_applicant"] },
    { id: "q_curr_addr", sectionId: "sec_residence", label: "Current address", inputType: "long_text", required: true, showForRoles: ["primary", "co_applicant"] },
    { id: "q_landlord_name", sectionId: "sec_residence", label: "Prior landlord name", inputType: "short_text", required: false, showForRoles: ["primary"] },
    { id: "q_employer", sectionId: "sec_income", label: "Employer", inputType: "short_text", required: true, showForRoles: ["primary", "co_applicant"] },
    { id: "q_income", sectionId: "sec_income", label: "Monthly income", inputType: "currency", required: true, showForRoles: ["primary", "co_applicant"], validation: { min: 0 } },
    { id: "q_emp_type", sectionId: "sec_income", label: "Employment type", inputType: "select_single", required: false, showForRoles: ["primary", "co_applicant"], options: ["Full-time", "Part-time", "Contract", "Self-employed"] },
  ],
  qualifications: [
    { id: "qual_id", title: "Government ID", audience: ["primary", "co_applicant"], requirement: "required", mode: "either", docKind: "government_id" },
    { id: "qual_credit", title: "Credit report", audience: ["primary", "co_applicant", "cosigner"], requirement: "required", mode: "either", docKind: "credit_report" },
  ],
};

/* ─────────────────────────────────────────────────────────────
   Field (respects disabled)
───────────────────────────────────────────────────────────── */
type FieldProps = {
  question: FormQuestion;
  value: any;
  onChange: (v: any) => void;
  onFilesChange: (key: string, fileList: FileList | null) => void;
  disabled?: boolean;
};
const Field: React.FC<FieldProps> = React.memo(function Field({ question, value, onChange, onFilesChange, disabled = false }) {
  const common = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm";
  const dis = disabled ? "opacity-60 cursor-not-allowed bg-gray-50" : "";
  switch (question.inputType) {
    case "short_text":
      return <input type="text" className={`${common} ${dis}`} value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={disabled} readOnly={disabled} />;
    case "email":
      return <input type="email" autoComplete="email" className={`${common} ${dis}`} value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={disabled} readOnly={disabled} />;
    case "phone": {
      const display = maskUSPhone(String(value ?? ""));
      return (
        <input
          type="tel" inputMode="numeric" autoComplete="tel" placeholder="(555) 123-4567"
          className={`${common} ${dis}`} maxLength={14} value={display}
          onChange={(e) => onChange(digitsOnly(e.target.value).slice(0, 10))}
          onBlur={(e) => onChange(digitsOnly(e.target.value).slice(0, 10))}
          disabled={disabled} readOnly={disabled}
        />
      );
    }
    case "long_text":
      return <textarea className={`${common} ${dis}`} rows={4} value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={disabled} readOnly={disabled} />;
    case "number":
    case "currency":
      return (
        <input
          type="number" className={`${common} ${dis}`} value={value ?? ""} onChange={(e) => onChange(e.target.value)}
          step={question.inputType === "currency" ? "0.01" : "1"} min={question.validation?.min} max={question.validation?.max}
          disabled={disabled} readOnly={disabled}
        />
      );
    case "date":
      return <input type="date" className={`${common} ${dis}`} value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={disabled} readOnly={disabled} />;
    case "yes_no":
      return (
        <div className={`flex gap-3 ${dis}`}>
          <label className="inline-flex items-center gap-2 text-sm text-gray-800">
            <input type="radio" checked={value === true} onChange={() => onChange(true)} disabled={disabled} />
            Yes
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-gray-800">
            <input type="radio" checked={value === false} onChange={() => onChange(false)} disabled={disabled} />
            No
          </label>
        </div>
      );
    case "select_single":
      return (
        <select className={`${common} ${dis}`} value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          <option value="">Select…</option>
          {(question.options ?? []).map((opt, i) => (<option key={i} value={opt}>{opt}</option>))}
        </select>
      );
    case "select_multi":
      return (
        <div className={`flex flex-wrap gap-2 ${dis}`}>
          {(question.options ?? []).map((opt, i) => {
            const arr: string[] = Array.isArray(value) ? value : [];
            const checked = arr.includes(opt);
            return (
              <label key={i} className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs">
                <input
                  type="checkbox" checked={checked} disabled={disabled}
                  onChange={(e) => {
                    const next = new Set(arr);
                    if (e.target.checked) next.add(opt); else next.delete(opt);
                    onChange(Array.from(next));
                  }}
                />
                {opt}
              </label>
            );
          })}
        </div>
      );
    case "file":
      return (
        <input
          type="file" multiple disabled={disabled}
          className={`block w-full text-sm text-gray-900 file:mr-3 file:rounded-md file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-sm hover:file:bg-gray-50 ${dis}`}
          onChange={(e) => onFilesChange(question.id, e.target.files)}
        />
      );
    default:
      return null;
  }
});

/* ─────────────────────────────────────────────────────────────
   Main ApplyClient — always "me" (logged-in member)
───────────────────────────────────────────────────────────── */
export default function ApplyClient() {
  /** URL */
  const [query, setQuery] = useState<{ formId: string | null; invite?: string; app?: string | null; ready: boolean }>({
    formId: null, invite: undefined, app: null, ready: false,
  });
  useEffect(() => {
    const u = new URL(window.location.href);
    setQuery({
      formId: u.searchParams.get("form"),
      invite: u.searchParams.get("invite") || undefined,
      app: u.searchParams.get("app"),
      ready: true,
    });
  }, []);

  /** Guards */
  const ensuredRef = useRef(false);
  const probedRef = useRef(false);
  const normalizedRef = useRef(false);

  /** App + stage */
  const [appId, setAppId] = useState<string | null>(null);
  type Stage = "gate" | "sections" | "quals" | "review" | "form_missing";
  const [stage, setStage] = useState<Stage>("gate");

  /** Me (from API) */
  const [myMemberId, setMyMemberId] = useState<string | null>(null);
  const [myEmail, setMyEmail] = useState<string>("");
  const [myRole, setMyRole] = useState<MemberRole>("primary");

  /** Schema */
  const [form, setForm] = useState<ApplicationForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  /** Answers & files */
  const [answersByMember, setAnswersByMember] = useState<Record<string, { role: MemberRole; email: string; answers: Record<string, any> }>>({});
  const myAnswers = useMemo(() => (myMemberId ? (answersByMember[myMemberId]?.answers ?? {}) : {}), [answersByMember, myMemberId]);
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  /** UI */
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editable, setEditable] = useState<boolean>(true);
  const [lockedReason, setLockedReason] = useState<string | null>(null);

  /** Debounced write-behind queue */
  const queueRef = useRef<Array<{ memberId: string; role: MemberRole; qid: string; value: any }>>([]);
  const timerRef = useRef<number | ReturnType<typeof setTimeout> | null>(null);
  function scheduleSave(memberId: string, role: MemberRole, qid: string, value: any) {
    if (!editable) return; // latch: ignore edits when locked
    queueRef.current.push({ memberId, role, qid, value });
    if (timerRef.current) clearTimeout(timerRef.current as any);
    timerRef.current = setTimeout(flushQueue, 400);
  }
  async function flushQueue() {
    if (!appId) return;
    const batch = queueRef.current;
    queueRef.current = [];
    if (batch.length === 0) return;
    const key = (m: string, r: MemberRole, q: string) => `${m}::${r}::${q}`;
    const latest = new Map<string, { memberId: string; role: MemberRole; qid: string; value: any }>();
    for (const u of batch) latest.set(key(u.memberId, u.role, u.qid), u);
    try {
      await fetch(`/api/tenant/applications/${encodeURIComponent(appId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: Array.from(latest.values()) }),
      });
    } catch {}
  }

  /** Load "me" (but not if already known from app.me) */
  useEffect(() => {
    if (myMemberId) return;
    let cancelled = false;
    (async () => {
      try {
        const myCookieEmail = getMyEmailFromCookie();
        const res = await fetch("/api/tenant/household/cluster?me=1", { cache: "no-store" });
        const j = await res.json();
        if (cancelled || !res.ok || !j?.ok) return;
        const members: Array<{ id: string; email: string; role: MemberRole; state?: string }> =
          Array.isArray(j.cluster?.members) ? j.cluster.members : [];
        const meLc = String(myCookieEmail || "").toLowerCase();

        const byEmail = meLc && members.find((m) => String(m.email || "").toLowerCase() === meLc);
        const active = !byEmail && members.find((m) => m.state === "active");
        const primary = !byEmail && !active && members.find((m) => m.role === "primary");
        const me = (byEmail || active || primary || members[0]) ?? null;

        if (me && !cancelled) {
          setMyMemberId(String(me.id));
          setMyEmail(String(me.email || "").toLowerCase());
          setMyRole(me.role as MemberRole);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [appId, myMemberId]);

  /** Invite/open adoption */
  useEffect(() => {
    if (!query.ready) return;
    if (query.invite) {
      (async () => {
        if (appId || ensuredRef.current) return;
        ensuredRef.current = true;
        try {
          const res = await fetch("/api/tenant/applications/open", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ formId: query.formId, invite: query.invite }),
          });
          if (res.status === 401) {
            window.location.href = `/login?next=${encodeURIComponent(window.location.href)}`; return;
          }
          const j = await res.json();
          if (res.ok && j?.ok && j.appId) {
            setAppId(j.appId);
            if (!normalizedRef.current) {
              normalizedRef.current = true;
              const u = new URL(window.location.href);
              u.searchParams.set("app", j.appId);
              window.history.replaceState(null, "", u.toString());
            }
            setStage("sections");
          }
        } catch { setToast("Offline, we’ll retry,"); }
      })();
    } else if (query.app) {
      setAppId(query.app);
      setStage("sections");
    }
  }, [query.ready, query.invite, query.formId, query.app, appId]);

  /** Probe for existing app (by form) */
useEffect(() => {
  if (!query.ready) return;
  let cancelled = false;
  (async () => {
    setLoading(true); setFormError(null);
    if (!query.formId) { if (!cancelled){ setForm(null); setStage("form_missing"); setLoading(false);} return; }
    try {
      const res = await fetch(`/api/tenant/applications/resolve?form=${encodeURIComponent(query.formId)}&create=0`, { cache: "no-store" });
      const j = await res.json().catch(() => null);
      if (cancelled) return;

      if (!res.ok || !j?.ok) {
        if (j?.error === "form_not_found" || res.status === 404) { setForm(null); setFormError("Form not found"); setStage("form_missing"); }
        else if (res.status === 401) { window.location.href = `/login?next=${encodeURIComponent(window.location.href)}`; }
        else { setForm(null); setFormError("Unable to load form"); setStage("form_missing"); }
        setLoading(false); return;
      }

      setForm(j.form);
      if (j.app?.id) {
        if (!normalizedRef.current) {
          normalizedRef.current = true;
          const u = new URL(window.location.href);
          u.searchParams.set("app", String(j.app.id));
          window.history.replaceState(null, "", u.toString());
        }
        setAppId(String(j.app.id));
        setStage("sections");
      } else {
        setStage("gate");
      }
    } catch {
      if (!cancelled) { setForm(null); setFormError("Network error loading form"); setStage("form_missing"); }
    } finally { if (!cancelled) setLoading(false); }
  })();
  return () => { cancelled = true; };
}, [query.ready, query.formId]);


  /** Create or reuse app */
  async function createOrReuse(formIdParam?: string | null) {
    const formId = formIdParam ?? query.formId;
    if (!formId) { setToast("Missing form, please choose a form,"); return false; }
    try {
      const res = await fetch("/api/tenant/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formId }),
      });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.href)}`; return false;
      }
      const j = await res.json();
      if (res.ok && j?.ok && j.appId) {
        setAppId(j.appId);
        if (!normalizedRef.current) {
          normalizedRef.current = true;
          const u = new URL(window.location.href);
          u.searchParams.set("app", j.appId);
          window.history.replaceState(null, "", u.toString());
        }
        return true;
      }
      setToast(j?.error || "Could not start application,"); return false;
    } catch { setToast("Network error, please try again,"); return false; }
  }

  /** Load form schema */


  /** Hydrate existing answers & latch (editable flag) */
  useEffect(() => {
    if (!appId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tenant/applications/${encodeURIComponent(appId)}`, { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        if (cancelled || !j?.ok) return;

        // who am I
        const me = j.app?.me as { memberId?: string; email?: string; role?: MemberRole } | undefined;
        if (me?.memberId) {
          setMyMemberId(me.memberId);
          if (me.email) setMyEmail(String(me.email).toLowerCase());
          if (me.role) setMyRole(me.role);
        }

        // latch
        if (j.app?.editable !== undefined) {
          setEditable(!!j.app.editable);
          if (!j.app.editable) setLockedReason(String(j.app.status ?? "submitted"));
        }

        // answers
        const byMember = j.app?.answersByMember as Record<string, { role: MemberRole; email: string; answers: Record<string, any> }> | undefined;
        if (byMember && typeof byMember === "object") {
          setAnswersByMember(byMember); return;
        }

        const legacy = (j.app?.answers ?? {}) as Partial<Record<MemberRole, Record<string, any>>>;
        const primaryAns = legacy.primary ?? {};
        if (me?.memberId || myMemberId) {
          const id = (me?.memberId || myMemberId)!;
          const role = me?.role || myRole;
          const email = me?.email || myEmail;
          setAnswersByMember({ [id]: { role, email, answers: primaryAns } });
        } else {
          setAnswersByMember({});
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [appId, myMemberId, myRole, myEmail]);

  /** Draft load/save */
  const draftKey = useMemo(() => `milo:apply:${query.formId ?? "noform"}:${appId ?? "new"}`, [query.formId, appId]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.answersByMember) setAnswersByMember(d.answersByMember);
        if (d.files) setFiles(d.files);
        setToast("Restored your draft,");
      }
    } catch {}
  }, [draftKey]);
  function saveDraft() {
    if (!editable) return; // no-op when locked
    try {
      localStorage.setItem(draftKey, JSON.stringify({ formId: query.formId, appId, answersByMember, files }));
      setToast("Draft saved,");
    } catch { setToast("Could not save draft,"); }
  }

  /** Sections for myRole */
  const sections = form?.sections ?? [];
  const [secIndex, setSecIndex] = useState(0);
  const section = sections[secIndex];
  const sectionQs = useMemo(() => {
    if (!form || !section) return [];
    return form.questions.filter((q) => q.sectionId === section.id && q.showForRoles.includes(myRole));
  }, [form, section, myRole]);

  /** One-time jump to first unanswered for me */
  const jumpedRef = useRef(false);
  useEffect(() => {
    if (!form || !appId || !myMemberId) return;
    if (jumpedRef.current) return;
    const ordered: FormQuestion[] = [];
    for (const s of form.sections) {
      for (const q of form.questions) {
        if (q.sectionId === s.id && q.showForRoles.includes(myRole)) ordered.push(q);
      }
    }
    const first = ordered.find((q) => (myAnswers as any)[q.id] === undefined || (myAnswers as any)[q.id] === "");
    if (first) {
      const idx = form.sections.findIndex((s) => s.id === first.sectionId);
      if (idx >= 0) setSecIndex(idx);
    }
    jumpedRef.current = true;
  }, [form, appId, myMemberId, myRole, myAnswers]);

  /** Validation & updates */
  function validateSection(): boolean {
    if (!form || !section) return true;
    const e: Record<string, string> = {};
    for (const q of sectionQs) {
      const v = (myAnswers as any)[q.id];
      if (q.required) {
        const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
        if (empty) e[q.id] = "Required";
      }
      if ((q.inputType === "number" || q.inputType === "currency") && v !== undefined && v !== null && v !== "") {
        const n = Number(v);
        if (Number.isNaN(n)) e[q.id] = "Must be a number";
        if (q.validation?.min !== undefined && n < q.validation.min!) e[q.id] = `Min ${q.validation.min}`;
        if (q.validation?.max !== undefined && n > q.validation.max!) e[q.id] = `Max ${q.validation.max}`;
      }
      if (q.validation?.pattern && typeof v === "string") {
        try { const re = new RegExp(q.validation.pattern); if (!re.test(v)) e[q.id] = "Invalid format"; } catch {}
      }
    }
    setLocalErrors(e);
    return Object.keys(e).length === 0;
  }

  function updateAnswer(qid: string, value: any) {
    if (!myMemberId || !editable) return; // block edits when locked
    setAnswersByMember((prev) => {
      const bucket = prev[myMemberId] ?? { role: myRole, email: myEmail, answers: {} };
      const next = { ...bucket, role: myRole, email: myEmail, answers: { ...bucket.answers, [qid]: value } };
      return { ...prev, [myMemberId]: next };
    });
    setLocalErrors((e) => { const n = { ...e }; delete n[qid]; return n; });
    scheduleSave(myMemberId, myRole, qid, value);
  }

  function onFilesChange(key: string, fileList: FileList | null) {
    if (!editable) return; // no-op when locked
    const arr = fileList ? Array.from(fileList) : [];
    setFiles((f) => ({ ...f, [key]: arr }));
  }

  /** Submit */
  async function onSubmit() {
    if (!editable) { setToast("This application is locked,"); return; }
    if (submitting) return;
    setSubmitting(true);
    saveDraft();

    try {
      if (!appId) {
        const ok = await createOrReuse(query.formId);
        if (!ok) { setSubmitting(false); return; }
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current as any);
        await flushQueue();
      }

      const res = await fetch(`/api/tenant/applications/${encodeURIComponent(appId!)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "member_submit" }),
      });

      try { localStorage.removeItem(draftKey); } catch {}

      if (res.ok) {
        window.location.href = "/tenant/applications";
        return;
      } else {
        const j = await res.json().catch(() => ({}));
        setToast(j?.error || "Could not submit,");
      }
    } catch {
      setToast("Offline, try again later,");
    } finally {
      setSubmitting(false);
    }
  }

  /** Loading & form missing guards */
  if (loading) {
    return <div className="p-4 text-sm text-gray-600">Preparing your application…</div>;
  }
  if (stage === "form_missing") {
    return (
      <div className="mx-auto max-w-md p-5">
        <h1 className="text-lg font-semibold text-gray-900">We couldn’t find that application form,</h1>
        {formError && <p className="mt-1 text-sm text-gray-600">{formError}</p>}
        <div className="mt-4 space-y-3">
          <a href="/tenant/applications/search" className="block w-full rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-center text-blue-800 font-medium hover:bg-blue-100">
            Browse available applications
          </a>
          <button onClick={() => (window.location.href = "/tenant/applications")} className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 font-medium hover:bg-gray-50">
            Enter a join/invite code
          </button>
          <a href="/tenant/applications" className="block w-full text-center rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 font-medium hover:bg-gray-50">
            Back to my applications
          </a>
          <details className="mt-2 text-xs text-gray-500">
            <summary>Use the demo form</summary>
            <div className="mt-1">
              <a href="/tenant/apply?form=demo_form" className="underline">Open demo</a>
            </div>
          </details>
        </div>
      </div>
    );
  }
  if (!form) {
    return <div className="p-4 text-sm text-gray-600">Preparing your application…</div>;
  }

  return (
    <>
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b">
        <div className="mx-auto max-w-md px-4 py-3">
          <div className="text-sm font-medium text-gray-900">{form.name}</div>
          <div className="text-xs text-gray-600">Filling as you ({myEmail || "user"}) · {myRole.replace("_", " ")}</div>
        </div>
      </header>

      {!editable && (
        <div className="mx-auto max-w-md px-4 mt-3">
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            This application is locked{lockedReason ? ` (state: ${lockedReason})` : ""}. You can still view your answers,
          </div>
        </div>
      )}

      {stage === "gate" && (
        <div className="mx-auto w-full max-w-md p-4">
          <h1 className="text-xl font-semibold text-gray-900">Start this application?</h1>
          <p className="mt-1 text-sm text-gray-600">
            We’ll create an application tied to your household, you can save progress,
          </p>
          <div className="mt-4 space-y-3">
            <button
              onClick={async () => {
                const ok = await createOrReuse(query.formId);
                if (ok) setStage("sections");
              }}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 text-white font-medium hover:bg-blue-700"
            >
              Start application
            </button>
            <a href="/tenant/applications" className="block w-full text-center rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 font-medium hover:bg-gray-50">
              Not now
            </a>
          </div>
        </div>
      )}

      {stage === "sections" && (
        <SectionScreen
          form={form}
          role={myRole}
          sections={form.sections}
          secIndex={secIndex}
          setSecIndex={setSecIndex}
          sectionQs={sectionQs}
          answers={myAnswers}
          updateAnswer={updateAnswer}
          localErrors={localErrors}
          onBack={() => setStage("gate")}
          onNext={() => {
            if (!validateSection()) return;
            if (secIndex < form.sections.length - 1) setSecIndex((i) => i + 1);
            else setStage("quals");
          }}
          saveDraft={saveDraft}
          onFilesChange={onFilesChange}
          editable={editable}
        />
      )}

      {stage === "quals" && (
        <QualificationsScreen
          form={form}
          role={myRole}
          files={files}
          fileInputs={fileInputs as any}
          onFilesChange={onFilesChange}
          saveDraft={saveDraft}
          onBack={() => setStage("sections")}
          onReview={() => setStage("review")}
          editable={editable}
        />
      )}

      {stage === "review" && (
        <ReviewScreen
          form={form}
          role={myRole}
          answers={myAnswers}
          files={files}
          onBack={() => setStage("quals")}
          onSubmit={onSubmit}
          setStage={setStage as any}
          setSecIndex={setSecIndex}
          editable={editable}
          submitting={submitting}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
          <div className="rounded-md bg-gray-900 text-white text-sm px-4 py-2 shadow-lg">
            {toast} <button className="ml-3 underline" onClick={() => setToast(null)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
   Screens
───────────────────────────────────────────────────────────── */

type SectionScreenProps = {
  form: ApplicationForm;
  role: MemberRole;
  sections: FormSection[];
  secIndex: number;
  setSecIndex: (i: number) => void;
  sectionQs: FormQuestion[];
  answers: Record<string, any>;
  updateAnswer: (id: string, v: any) => void;
  localErrors: Record<string, string>;
  onBack: () => void;
  onNext: () => void;
  saveDraft: () => void;
  onFilesChange: (key: string, fl: FileList | null) => void;
  editable: boolean;
};
const SectionScreen: React.FC<SectionScreenProps> = ({
  form, sections, secIndex, setSecIndex, sectionQs, answers, updateAnswer, localErrors, onBack, onNext, saveDraft, onFilesChange, editable,
}) => {
  const section = sections[secIndex];
  if (!section) return null;
  return (
    <div className="mx-auto w-full max-w-md p-4">
      <div className="mb-3">
        <div className="text-xs text-gray-600">Section {secIndex + 1} of {sections.length}</div>
        <div className="mt-2 h-2 w-full rounded-full bg-gray-200">
          <div className="h-2 rounded-full bg-blue-600" style={{ width: `${((secIndex + 1) / sections.length) * 100}%` }} />
        </div>
      </div>

      <h2 className="text-lg font-semibold text-gray-900">{section.title}</h2>
      {section.description && <p className="text-sm text-gray-600 mt-1">{section.description}</p>}

      <div className="mt-4 space-y-4">
        {form && sectionQs.map((q) => (
          <div key={q.id}>
            <label className="block text-sm font-medium text-gray-900">
              {q.label} {q.required && <span className="text-rose-600">*</span>}
            </label>
            {q.helpText && <p className="text-xs text-gray-600 mb-1">{q.helpText}</p>}
            <Field
              question={q}
              value={answers[q.id]}
              onChange={(v) => updateAnswer(q.id, v)}
              onFilesChange={onFilesChange}
              disabled={!editable}
            />
            {localErrors[q.id] && <div className="mt-1 text-xs text-rose-700">{localErrors[q.id]}</div>}
          </div>
        ))}
      </div>

<div className="h-16" />
<div
  className="fixed inset-x-0 bottom-0 bg-white/80 backdrop-blur border-t shadow-[0_-4px_12px_rgba(0,0,0,0.06)]"
  style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
>
  <div className="mx-auto max-w-md px-3 py-2 sm:py-3 flex items-center justify-between gap-2">
    {/* Back — hidden on first section */}
    {secIndex > 0 ? (
      <button
        onClick={onBack}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white",
          "px-3.5 py-2 text-sm font-medium text-gray-800",
          "hover:bg-gray-50 active:scale-[0.99] transition"
        )}
        aria-label="Go back"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          className="text-gray-500"
          aria-hidden="true"
        >
          <path
            d="M15 18l-6-6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Back
      </button>
    ) : (
      <div className="w-[68px]" /> // keeps spacing when hidden
    )}

    {/* Right-side actions */}
    <div className="flex items-center gap-2">
      {editable && (
        <button
          onClick={saveDraft}
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white",
            "px-3.5 py-2 text-sm font-medium text-gray-800",
            "hover:bg-gray-50 active:scale-[0.99] transition"
          )}
          aria-label="Save draft"
          title="Save draft"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            className="text-gray-500"
            aria-hidden="true"
          >
            <path
              d="M19 21H5a2 2 0 0 1-2-2V7l4-4h8l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Save
        </button>
      )}

      {/* Next — always available for navigation */}
      <button
        onClick={onNext}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-md",
          "bg-blue-600 text-white px-4 py-2 text-sm font-medium",
          "hover:bg-blue-700 active:scale-[0.99] transition shadow-sm"
        )}
        aria-label="Go next"
      >
        Next
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          className="text-white/90"
          aria-hidden="true"
        >
          <path
            d="M9 18l6-6-6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  </div>
</div>
    </div>
  );
};

type QualificationsScreenProps = {
  form: ApplicationForm;
  role: MemberRole;
  files: Record<string, File[]>;
  fileInputs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
  onFilesChange: (key: string, fl: FileList | null) => void;
  onBack: () => void;
  onReview: () => void;
  saveDraft: () => void;
  editable: boolean;
};
const QualificationsScreen: React.FC<QualificationsScreenProps> = ({
  form, role, files, fileInputs, onFilesChange, onBack, onReview, saveDraft, editable,
}) => {
  const visible = (form.qualifications ?? []).filter((q) => q.audience.includes(role));
  return (
    <div className="mx-auto w-full max-w-md p-4">
      <h2 className="text-lg font-semibold text-gray-900">Qualifications</h2>
      <p className="mt-1 text-sm text-gray-600">Upload required documents now, or save and finish later,</p>

      <div className="mt-4 space-y-3">
        {visible.map((q) => (
          <div key={q.id} className="rounded-lg border border-gray-200 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-gray-900">{q.title}</div>
              <span className={"text-[11px] rounded-full px-2 py-0.5 ring-1 ring-inset " + (q.requirement === "required" ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-gray-100 text-gray-700 ring-gray-200")}>
                {q.requirement}
              </span>
            </div>
            {q.notes && <div className="mt-1 text-xs text-gray-600">{q.notes}</div>}
            <div className="mt-2">
              <input
                ref={(el) => { (fileInputs.current as any)[q.id] = el; }}
                type="file"
                multiple
                disabled={!editable}
                onChange={(e) => onFilesChange(q.id, e.target.files)}
                className="block w-full text-sm text-gray-900 file:mr-3 file:rounded-md file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-sm hover:file:bg-gray-50"
              />
              {files[q.id]?.length ? (
                <ul className="mt-2 list-disc pl-5 text-xs text-gray-700">
                  {files[q.id].map((f, i) => (<li key={i}>{f.name}</li>))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-gray-500">No files attached yet,</p>
              )}
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            No documents required for your role,
          </div>
        )}
      </div>

      <div className="h-16" />
      <div className="fixed inset-x-0 bottom-0 bg-white/80 backdrop-blur border-t">
        <div className="mx-auto max-w-md p-3 flex items-center justify-between">
                <button
        onClick={onBack}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white",
          "px-3.5 py-2 text-sm font-medium text-gray-800",
          "hover:bg-gray-50 active:scale-[0.99] transition"
        )}
        aria-label="Go back"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          className="text-gray-500"
          aria-hidden="true"
        >
          <path
            d="M15 18l-6-6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Back
      </button>
          {editable ? (
            <div className="flex items-center gap-2">
              <button onClick={saveDraft} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">Save</button>
              <button onClick={onReview} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white">Review</button>
            </div>
          ) : (
            <a href="/tenant/applications" className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white">
              Back to applications
            </a>
          )}
        </div>
      </div>
    </div>
  );
};

type ReviewScreenProps = {
  form: ApplicationForm;
  role: MemberRole;
  answers: Record<string, any>;
  files: Record<string, File[]>;
  onBack: () => void;
  onSubmit: () => void;
  setStage: (s: "sections") => void;
  setSecIndex: (i: number) => void;
  editable: boolean;
  submitting: boolean;
};
const ReviewScreen: React.FC<ReviewScreenProps> = ({
  form, role, answers, files, onBack, onSubmit, setStage, setSecIndex, editable, submitting,
}) => {
  const bySection = useMemo(() => {
    const map: Record<string, { title: string; items: { label: string; value: any }[] }> = {};
    for (const s of form.sections) map[s.id] = { title: s.title, items: [] };
    for (const q of form.questions) {
      if (!q.showForRoles.includes(role)) continue;
      const v = answers[q.id];
      (map[q.sectionId]?.items || (map[q.sectionId] = { title: q.sectionId, items: [] }).items).push({
        label: q.label,
        value: v === undefined || v === null || v === "" ? "—" : Array.isArray(v) ? v.join(", ") : String(v),
      });
    }
    return map;
  }, [form, answers, role]);

  return (
    <div className="mx-auto w-full max-w-md p-4">
      <h2 className="text-lg font-semibold text-gray-900">Review & submit</h2>
      <p className="mt-1 text-sm text-gray-600">Double-check your details, attach missing documents if needed,</p>

      <div className="mt-4 space-y-4">
        {Object.entries(bySection).map(([secId, group]) => (
          <div key={secId} className="rounded-lg border border-gray-200 p-3">
            <div className="text-sm font-medium text-gray-900">{group.title}</div>
            <dl className="mt-2">
              {group.items.map((it, i) => (
                <div key={i} className="grid grid-cols-3 gap-2 py-1">
                  <dt className="col-span-1 text-xs text-gray-500">{it.label}</dt>
                  <dd className="col-span-2 text-sm text-gray-900">{it.value}</dd>
                </div>
              ))}
            </dl>
            <button
              onClick={() => {
                const idx = form.sections.findIndex((s) => s.id === secId);
                if (idx >= 0) { setSecIndex(idx); setStage("sections"); }
              }}
              className="mt-2 text-xs text-gray-700 underline"
            >
              Edit section
            </button>
          </div>
        ))}

        <div className="rounded-lg border border-gray-200 p-3">
          <div className="text-sm font-medium text-gray-900">Documents</div>
          {form.qualifications.filter((q) => q.audience.includes(role)).map((q) => (
            <div key={q.id} className="mt-2">
              <div className="text-xs text-gray-600">{q.title}</div>
              <div className="text-sm text-gray-900">
                {(files[q.id]?.length ?? 0) > 0 ? `${files[q.id].length} file(s) attached` : "No files"}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="h-16" />
      <div className="fixed inset-x-0 bottom-0 bg-white/80 backdrop-blur border-t">
        <div className="mx-auto max-w-md p-3 flex items-center justify-between">
          <button onClick={onBack} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">Back</button>
          {editable ? (
            <button
              onClick={onSubmit}
              disabled={submitting}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {submitting ? "Submitting…" : "Submit application"}
            </button>
          ) : (
            <a href="/tenant/applications" className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white">
              Close
            </a>
          )}
        </div>
      </div>
    </div>
  );
};
