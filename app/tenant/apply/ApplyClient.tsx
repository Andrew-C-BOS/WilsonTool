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
  id: string; sectionId: string; label: string; helpText?: string;
  inputType: InputType; required: boolean; showForRoles: MemberRole[];
  options?: string[]; validation?: { min?: number; max?: number; pattern?: string };
};
type Qualification = {
  id: string; title: string; audience: MemberRole[]; requirement: "required"|"optional"|"conditional";
  mode: "self_upload"|"integration"|"either"; docKind?: string; notes?: string;
};
type ApplicationForm = {
  _id?: string; id?: string; name: string; description?: string;
  scope: "portfolio"; sections: FormSection[]; questions: FormQuestion[]; qualifications: Qualification[]; version: number;
};

// Strip everything except 0–9
function digitsOnly(s: string): string {
  return (s || "").replace(/\D/g, "");
}

// US mask: (AAA) BBB-CCCC for up to 10 digits; partials format gracefully
function maskUSPhone(d: string): string {
  const x = digitsOnly(d).slice(0, 10);
  const a = x.slice(0, 3);
  const b = x.slice(3, 6);
  const c = x.slice(6, 10);
  if (x.length <= 3) return a;
  if (x.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}


/* Demo fallback (unchanged) */
const DEMO: ApplicationForm = {
  id: "demo_form",
  name: "Standard Rental Application",
  description: "Complete the steps below, invite co‑applicants and cosigners, upload documents,",
  scope: "portfolio",
  version: 1,
  sections: [
    { id: "sec_applicant", title: "Applicant info" },
    { id: "sec_residence", title: "Residence history" },
    { id: "sec_income", title: "Employment & income" },
  ],
  questions: [
    { id: "q_name", sectionId: "sec_applicant", label: "Legal name", inputType: "short_text", required: true, showForRoles: ["primary","co_applicant"] },
    { id: "q_email", sectionId: "sec_applicant", label: "Email address", inputType: "email", required: true, showForRoles: ["primary","co_applicant","cosigner"] },
    { id: "q_phone", sectionId: "sec_applicant", label: "Phone", inputType: "phone", required: true, showForRoles: ["primary"] },
    { id: "q_dob", sectionId: "sec_applicant", label: "Date of birth", inputType: "date", required: true, showForRoles: ["primary","co_applicant"] },
    { id: "q_curr_addr", sectionId: "sec_residence", label: "Current address", inputType: "long_text", required: true, showForRoles: ["primary","co_applicant"] },
    { id: "q_landlord_name", sectionId: "sec_residence", label: "Prior landlord name", inputType: "short_text", required: false, showForRoles: ["primary"] },
    { id: "q_employer", sectionId: "sec_income", label: "Employer", inputType: "short_text", required: true, showForRoles: ["primary","co_applicant"] },
    { id: "q_income", sectionId: "sec_income", label: "Monthly income", inputType: "currency", required: true, showForRoles: ["primary","co_applicant"], validation:{min:0} },
    { id: "q_emp_type", sectionId: "sec_income", label: "Employment type", inputType: "select_single", required: false, showForRoles: ["primary","co_applicant"], options:["Full‑time","Part‑time","Contract","Self‑employed"] },
  ],
  qualifications: [
    { id: "qual_id", title: "Government ID", audience: ["primary","co_applicant"], requirement: "required", mode: "either", docKind: "government_id" },
    { id: "qual_credit", title: "Credit report", audience: ["primary","co_applicant","cosigner"], requirement: "required", mode: "either", docKind: "credit_report" },
  ],
};

/* Helpers */
function clsx(...xs: (string | false | null | undefined)[]) { return xs.filter(Boolean).join(" "); }

/* ─────────────────────────────────────────────────────────────
   HOISTED (module-scope) components — stable types across renders
   This is the key change to preserve input focus.
───────────────────────────────────────────────────────────── */

type FieldProps = {
  question: FormQuestion;
  value: any;
  onChange: (v: any) => void;
  onFilesChange: (key: string, fileList: FileList | null) => void;
};

const Field: React.FC<FieldProps> = React.memo(function Field({ question, value, onChange, onFilesChange }) {
  const common = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm";

  switch (question.inputType) {
    case "short_text":
      return (
        <input
          type="text"
          className={common}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "email":
      return (
        <input
          type="email"
          autoComplete="email"
          className={common}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "phone": {
      const display = maskUSPhone(String(value ?? "")); // show masked
      return (
        <input
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          placeholder="(555) 123-4567"
          className={common}
          maxLength={14} // "(123) 456-7890"
          value={display}
          onChange={(e) => {
            const digits = digitsOnly(e.target.value).slice(0, 10);
            onChange(digits); // store digits only
          }}
          onBlur={(e) => {
            const digits = digitsOnly(e.target.value).slice(0, 10);
            onChange(digits);
          }}
        />
      );
    }

    case "long_text":
      return (
        <textarea
          className={common}
          rows={4}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "number":
    case "currency":
      return (
        <input
          type="number"
          className={common}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          step={question.inputType === "currency" ? "0.01" : "1"}
          min={question.validation?.min}
          max={question.validation?.max}
        />
      );

    case "date":
      return (
        <input
          type="date"
          className={common}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "yes_no":
      return (
        <div className="flex gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-gray-800">
            <input type="radio" checked={value === true} onChange={() => onChange(true)} />
            Yes
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-gray-800">
            <input type="radio" checked={value === false} onChange={() => onChange(false)} />
            No
          </label>
        </div>
      );

    case "select_single":
      return (
        <select className={common} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {(question.options ?? []).map((opt, i) => (
            <option key={i} value={opt}>{opt}</option>
          ))}
        </select>
      );

    case "select_multi":
      return (
        <div className="flex flex-wrap gap-2">
          {(question.options ?? []).map((opt, i) => {
            const arr: string[] = Array.isArray(value) ? value : [];
            const checked = arr.includes(opt);
            return (
              <label key={i} className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs">
                <input
                  type="checkbox"
                  checked={checked}
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
          type="file"
          multiple
          className="block w-full text-sm text-gray-900 file:mr-3 file:rounded-md file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-sm hover:file:bg-gray-50"
          onChange={(e) => onFilesChange(question.id, e.target.files)}
        />
      );

    default:
      return null;
  }
});

type GateScreenProps = { onStart: () => void };
const GateScreen: React.FC<GateScreenProps> = ({ onStart }) => (
  <div className="mx-auto w-full max-w-md p-4">
    <h1 className="text-xl font-semibold text-gray-900">Start this application?</h1>
    <p className="mt-1 text-sm text-gray-600">
      We’ll create an application tied to your account, you can invite others, you can save progress,
    </p>
    <div className="mt-4 space-y-3">
      <button
        onClick={onStart}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 text-white font-medium hover:bg-blue-700"
      >
        Start application
      </button>
      <a
        href="/tenant/applications"
        className="block w-full text-center rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 font-medium hover:bg-gray-50"
      >
        Not now
      </a>
    </div>
  </div>
);

type InfoScreenProps = {
  role: MemberRole;
  setRole: (r: MemberRole) => void;
  onBack: () => void;
  onContinue: () => void;
};
const InfoScreen: React.FC<InfoScreenProps> = ({ role, setRole, onBack, onContinue }) => (
  <div className="mx-auto w-full max-w-md p-4">
    <h2 className="text-lg font-semibold text-gray-900">Your role</h2>
    <p className="mt-1 text-sm text-gray-600">Pick your role, invite others later, continue when ready,</p>

    <div className="mt-4">
      <div className="grid grid-cols-3 gap-2">
        {(["primary","co_applicant","cosigner"] as MemberRole[]).map(r => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            className={clsx(
              "rounded-md px-3 py-2 text-sm border",
              role === r ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-800 border-gray-300"
            )}
          >
            {r.replace("_"," ")}
          </button>
        ))}
      </div>
    </div>

    <div className="h-16" />
    <div className="fixed inset-x-0 bottom-0 bg-white/80 backdrop-blur border-t">
      <div className="mx-auto max-w-md p-3 flex items-center justify-between">
        <button onClick={onBack} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">Back</button>
        <button onClick={onContinue} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white">Continue</button>
      </div>
    </div>
  </div>
);

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
};
const SectionScreen: React.FC<SectionScreenProps> = ({
  form, role, sections, secIndex, setSecIndex, sectionQs, answers, updateAnswer, localErrors, onBack, onNext, saveDraft, onFilesChange
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
            />
            {localErrors[q.id] && <div className="mt-1 text-xs text-rose-700">{localErrors[q.id]}</div>}
          </div>
        ))}
      </div>

      <div className="h-16" />
      <div className="fixed inset-x-0 bottom-0 bg-white/80 backdrop-blur border-t">
        <div className="mx-auto max-w-md p-3 flex items-center justify-between">
          <button onClick={onBack} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">Back</button>
          <div className="flex items-center gap-2">
            <button onClick={saveDraft} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">Save</button>
            <button onClick={onNext} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white">Next</button>
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
};
const QualificationsScreen: React.FC<QualificationsScreenProps> = ({
  form, role, files, fileInputs, onFilesChange, onBack, onReview, saveDraft
}) => {
  const visible = (form.qualifications ?? []).filter(q => q.audience.includes(role));
  return (
    <div className="mx-auto w-full max-w-md p-4">
      <h2 className="text-lg font-semibold text-gray-900">Qualifications</h2>
      <p className="mt-1 text-sm text-gray-600">Upload required documents now, or save and finish later,</p>

      <div className="mt-4 space-y-3">
        {visible.map((q) => (
          <div key={q.id} className="rounded-lg border border-gray-200 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-gray-900">{q.title}</div>
              <span
                className={
                  "text-[11px] rounded-full px-2 py-0.5 ring-1 ring-inset " +
                  (q.requirement === "required"
                    ? "bg-rose-50 text-rose-700 ring-rose-200"
                    : "bg-gray-100 text-gray-700 ring-gray-200")
                }
              >
                {q.requirement}
              </span>
            </div>
            {q.notes && <div className="mt-1 text-xs text-gray-600">{q.notes}</div>}
            <div className="mt-2">
              <input
                ref={(el) => { (fileInputs.current as any)[q.id] = el; }}
                type="file"
                multiple
                onChange={(e) => onFilesChange(q.id, e.target.files)}
                className="block w-full text-sm text-gray-900 file:mr-3 file:rounded-md file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-sm hover:file:bg-gray-50"
              />
              {files[q.id]?.length ? (
                <ul className="mt-2 list-disc pl-5 text-xs text-gray-700">
                  {files[q.id].map((f, i) => <li key={i}>{f.name}</li>)}
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
          <button onClick={onBack} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">Back</button>
          <div className="flex items-center gap-2">
            <button onClick={saveDraft} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">Save</button>
            <button onClick={onReview} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white">Review</button>
          </div>
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
};
const ReviewScreen: React.FC<ReviewScreenProps> = ({
  form, role, answers, files, onBack, onSubmit, setStage, setSecIndex
}) => {
  const bySection = useMemo(() => {
    const map: Record<string, { title: string; items: { label: string; value: any }[] }> = {};
    for (const s of form.sections) map[s.id] = { title: s.title, items: [] };
    for (const q of form.questions) {
      if (!q.showForRoles.includes(role)) continue;
      const v = answers[q.id];
      (map[q.sectionId]?.items || (map[q.sectionId] = { title: q.sectionId, items: [] }).items).push({
        label: q.label,
        value:
          v === undefined || v === null || v === ""
            ? "—"
            : Array.isArray(v)
            ? v.join(", ")
            : String(v),
      });
    }
    return map;
  }, [form, answers, role]);

  return (
    <div className="mx-auto w-full max-w-md p-4">
      <h2 className="text-lg font-semibold text-gray-900">Review & submit</h2>
      <p className="mt-1 text-sm text-gray-600">Double-check details, attach missing documents if needed,</p>

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
          <button onClick={onSubmit} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white">Submit application</button>
        </div>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────
   Main ApplyClient — now only coordinates state/logic
───────────────────────────────────────────────────────────── */
export default function ApplyClient() {
  /** Read URL once (stable) */
  const [query, setQuery] = useState<{ formId: string; invite?: string; app?: string | null; ready: boolean }>({
    formId: "demo_form", invite: undefined, app: null, ready: false,
  });
  useEffect(() => {
    const u = new URL(window.location.href);
    setQuery({
      formId: u.searchParams.get("form") || "demo_form",
      invite: u.searchParams.get("invite") || undefined,
      app: u.searchParams.get("app"),
      ready: true,
    });
  }, []);

  /** One‑time guards */
  const ensuredRef = useRef(false);
  const probedRef = useRef(false);
  const normalizedRef = useRef(false);

  /** App + role + stage */
  const [appId, setAppId] = useState<string | null>(null);
  const [role, setRole] = useState<MemberRole>("primary");
  type Stage = "gate" | "info" | "sections" | "quals" | "review";
  const [stage, setStage] = useState<Stage>("gate");

  /** Schema */
  const [form, setForm] = useState<ApplicationForm | null>(null);
  const [loading, setLoading] = useState(true);

  /** Answers & files */
  // answersByRole: { primary: { [qId]: value }, co_applicant: {...}, cosigner: {...} }
  const [answersByRole, setAnswersByRole] = useState<Partial<Record<MemberRole, Record<string, any>>>>({});
  const answers = useMemo(() => answersByRole[role] || {}, [answersByRole, role]);

  const [files, setFiles] = useState<Record<string, File[]>>({});
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  /** UI */
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  /** Debounced write‑behind queue for answer updates */
  const queueRef = useRef<Array<{ role: MemberRole; qid: string; value: any }>>([]);
  const timerRef = useRef<number | ReturnType<typeof setTimeout> | null>(null);

  function scheduleSave(role: MemberRole, qid: string, value: any) {
    queueRef.current.push({ role, qid, value });
    if (timerRef.current) clearTimeout(timerRef.current as any);
    timerRef.current = setTimeout(flushQueue, 400);
  }

  async function flushQueue() {
    if (!appId) return;
    const batch = queueRef.current;
    queueRef.current = [];
    if (batch.length === 0) return;

    // Coalesce to last write per (role,qid)
    const key = (r: MemberRole, q: string) => `${r}::${q}`;
    const latest = new Map<string, { role: MemberRole; qid: string; value: any }>();
    for (const u of batch) latest.set(key(u.role, u.qid), u);

    try {
      await fetch(`/api/tenant/applications/${encodeURIComponent(appId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: Array.from(latest.values()) }),
      });
    } catch {
      // fire-and-forget for now
    }
  }

  /** Adopt initial role/app from URL once */
  useEffect(() => {
    if (!query.ready) return;
    if (query.invite) setRole("co_applicant");
    if (query.app) { setAppId(query.app); setStage("info"); }
  }, [query.ready, query.invite, query.app]);

  /** Load form schema */
  useEffect(() => {
    if (!query.ready) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/forms/${encodeURIComponent(query.formId)}`, { cache: "no-store" });
        if (res.ok) {
          const j = await res.json();
          if (!cancelled && j?.ok && j.form) setForm(j.form as ApplicationForm);
          if (!cancelled && !(j?.ok && j.form)) setForm(DEMO);
        } else {
          if (!cancelled) setForm(DEMO);
        }
      } catch {
        if (!cancelled) setForm(DEMO);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [query.ready, query.formId]);

  /** Invite flow → ensure/open app once */
  useEffect(() => {
    if (!query.ready) return;
    const formId = query.formId;
    const inviteToken = query.invite;
    if (!inviteToken || appId || ensuredRef.current) return;
    ensuredRef.current = true;

    (async () => {
      try {
        const res = await fetch("/api/tenant/applications/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ formId, invite: inviteToken, role }),
        });
        if (res.status === 401) {
          window.location.href = `/login?next=${encodeURIComponent(window.location.href)}`;
          return;
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
          setStage("info");
        } else {
          // Fall back to creating a new app for this form
          const ok = await createOrReuse(formId);
          if (ok) setStage("info");
        }
      } catch {
        setToast("Offline, we’ll retry,");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.ready, query.formId, query.invite, appId, role]);

  /** Probe for existing app (no invite) once */
  useEffect(() => {
    if (!query.ready) return;
    const formId = query.formId;
    if (query.invite || appId || probedRef.current) return;
    probedRef.current = true;

    (async () => {
      try {
        const res = await fetch(`/api/tenant/applications?me=1&formId=${encodeURIComponent(formId)}`, { cache: "no-store" });
        if (res.status === 401) {
          window.location.href = `/login?next=${encodeURIComponent(window.location.href)}`;
          return;
        }
        const j = await res.json();
        const existing = (j?.apps || [])[0];
        if (existing) {
          setAppId(existing.id);
          if (!normalizedRef.current) {
            normalizedRef.current = true;
            const u = new URL(window.location.href);
            u.searchParams.set("app", existing.id);
            window.history.replaceState(null, "", u.toString());
          }
          setStage("info");
        } else {
          setStage("gate");
        }
      } catch {
        setStage("gate");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.ready, query.formId, query.invite, appId]);

  /** Create or reuse application for this form */
  async function createOrReuse(formIdParam?: string) {
    const formId = formIdParam ?? query.formId;
    try {
      const res = await fetch("/api/tenant/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formId }),
      });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.href)}`;
        return false;
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
      setToast(j?.error || "Could not start application,");
      return false;
    } catch {
      setToast("Network error, please try again,");
      return false;
    }
  }

  /** Hydrate answers when we have an appId */
  useEffect(() => {
    if (!appId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tenant/applications/${encodeURIComponent(appId)}`, { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled && j?.ok) {
          // Expecting shape { answers: { primary: {...}, co_applicant: {...}, cosigner: {...} } }
          const fromDb = (j.app?.answers ?? {}) as Partial<Record<MemberRole, Record<string, any>>>;
          setAnswersByRole(fromDb);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [appId]);

  /** Draft load/save keyed by stable ids */
  const draftKey = useMemo(() => `milo:apply:${query.formId}:${appId ?? "new"}`, [query.formId, appId]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.role) setRole(d.role);
        setAnswersByRole(d.answersByRole ?? {});
        setFiles(d.files ?? {});
        setToast("Restored your draft,");
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  function saveDraft() {
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({ formId: query.formId, appId, role, answersByRole, files })
      );
      setToast("Draft saved,");
    } catch {
      setToast("Could not save draft,");
    }
  }

  /** Sections & visible questions */
  const sections = form?.sections ?? [];
  const [secIndex, setSecIndex] = useState(0);
  const section = sections[secIndex];
  const sectionQs = useMemo(() => {
    if (!form || !section) return [];
    return form.questions.filter(q => q.sectionId === section.id && q.showForRoles.includes(role));
  }, [form, section, role]);

  /** One-time jump: first unanswered question for my role */
  const jumpedRef = useRef(false);
  useEffect(() => {
    if (!form || !appId) return;
    if (jumpedRef.current) return;

    // build ordered questions for this role by section order
    const ordered: FormQuestion[] = [];
    for (const s of form.sections) {
      for (const q of form.questions) {
        if (q.sectionId === s.id && q.showForRoles.includes(role)) ordered.push(q);
      }
    }
    const my = answersByRole[role] || {};
    const first = ordered.find(q => my[q.id] === undefined || my[q.id] === "");
    if (first) {
      const idx = form.sections.findIndex(s => s.id === first.sectionId);
      if (idx >= 0) setSecIndex(idx);
    }
    jumpedRef.current = true;
  }, [form, appId, role, answersByRole]);

  /** Validation & updates */
  function validateSection(): boolean {
    if (!form || !section) return true;
    const e: Record<string, string> = {};
    for (const q of sectionQs) {
      const v = (answersByRole[role] || {})[q.id];
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

  function updateAnswer(id: string, value: any) {
    setAnswersByRole(prev => {
      const current = prev[role] || {};
      const nextForRole = { ...current, [id]: value };
      return { ...prev, [role]: nextForRole };
    });
    setLocalErrors(e => { const n = { ...e }; delete n[id]; return n; });

    // queue remote write
    scheduleSave(role, id, value);
  }

  function onFilesChange(key: string, fileList: FileList | null) {
    const arr = fileList ? Array.from(fileList) : [];
    setFiles((f) => ({ ...f, [key]: arr }));
    // (optional) upload & PATCH metadata later
  }

  /** Submit: flush pending updates, then set status:new */
  async function onSubmit() {
    saveDraft();
    try {
      if (!appId) {
        const ok = await createOrReuse();
        if (!ok) return;
      }
      if (timerRef.current) { clearTimeout(timerRef.current as any); await flushQueue(); }
      const res = await fetch(`/api/tenant/applications/${encodeURIComponent(appId!)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "new" }),
      });
      if (res.ok) setToast("Application submitted, thank you,");
      else {
        const j = await res.json().catch(() => ({}));
        setToast(j?.error || "Could not submit,");
      }
    } catch {
      setToast("Offline, try again later,");
    }
  }

  /** Loading guard AFTER hooks */
  if (loading || !form) {
    return <div className="p-4 text-sm text-gray-600">Preparing your application…</div>;
  }

  return (
    <>
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b">
        <div className="mx-auto max-w-md px-4 py-3">
          <div className="text-sm font-medium text-gray-900">{form.name}</div>
          <div className="text-xs text-gray-600">Role: {role.replace("_"," ")}</div>
        </div>
      </header>

      {stage === "gate" && (
        <GateScreen
          onStart={async () => { const ok = await createOrReuse(); if (ok) setStage("info"); }}
        />
      )}

      {stage === "info" && (
        <InfoScreen
          role={role}
          setRole={setRole}
          onBack={() => setStage("gate")}
          onContinue={() => setStage("sections")}
        />
      )}

      {stage === "sections" && (
        <SectionScreen
          form={form}
          role={role}
          sections={sections}
          secIndex={secIndex}
          setSecIndex={setSecIndex}
          sectionQs={sectionQs}
          answers={answers}
          updateAnswer={updateAnswer}
          localErrors={localErrors}
          saveDraft={saveDraft}
          onFilesChange={onFilesChange}
          onBack={() => setStage("info")}
          onNext={() => {
            if (!validateSection()) return;
            if (secIndex < sections.length - 1) setSecIndex((i) => i + 1);
            else setStage("quals");
          }}
        />
      )}

      {stage === "quals" && (
        <QualificationsScreen
          form={form}
          role={role}
          files={files}
          fileInputs={fileInputs as any}
          onFilesChange={onFilesChange}
          saveDraft={saveDraft}
          onBack={() => setStage("sections")}
          onReview={() => setStage("review")}
        />
      )}

      {stage === "review" && (
        <ReviewScreen
          form={form}
          role={role}
          answers={answers}
          files={files}
          onBack={() => setStage("quals")}
          onSubmit={onSubmit}
          setStage={setStage as any}
          setSecIndex={setSecIndex}
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

