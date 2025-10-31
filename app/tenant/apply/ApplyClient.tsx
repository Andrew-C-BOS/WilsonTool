"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

/* ─────────────────────────────────────────────────────────────
   Types (aligned with your builder)
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

/* ─────────────────────────────────────────────────────────────
   Demo form (used if /api/forms/[id] not available)
───────────────────────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────────────────────
   Small helpers
───────────────────────────────────────────────────────────── */
function clsx(...xs: (string | false | null | undefined)[]) { return xs.filter(Boolean).join(" "); }
const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));

/* ─────────────────────────────────────────────────────────────
   Component
───────────────────────────────────────────────────────────── */
export default function ApplyClient() {
  const params = useSearchParams();
  const formId = params.get("form") || "demo_form";
  const inviteToken = params.get("invite");      // if present, we default to "join"

  // Stage machine
  type Stage = "choose" | "info" | "sections" | "quals" | "review";
  const [stage, setStage] = useState<Stage>(inviteToken ? "info" : "choose");
  const [role, setRole] = useState<MemberRole>(inviteToken ? "co_applicant" : "primary");
  const [householdCode, setHouseholdCode] = useState("");
  const [name, setName] = useState(""); const [email, setEmail] = useState("");
  const [secIndex, setSecIndex] = useState(0);

  // Form schema
  const [form, setForm] = useState<ApplicationForm | null>(null);
  const [loading, setLoading] = useState(true);

  // Answers & files
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [files, setFiles] = useState<Record<string, File[]>>({});   // quals and file questions
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  // Errors & toasts
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  // Load schema from API if available, else demo
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Try GET /api/forms/[id]
        const res = await fetch(`/api/forms/${encodeURIComponent(formId)}`, { cache: "no-store" });
        if (res.ok) {
          const j = await res.json();
          if (!cancelled && j?.ok && j.form) setForm(j.form as ApplicationForm);
        } else {
          // fallback to demo
          if (!cancelled) setForm(DEMO);
        }
      } catch {
        if (!cancelled) setForm(DEMO);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [formId]);

  // Local draft (load/save)
  const draftKey = useMemo(() => `milo:apply:${formId}:${email || "anon"}`, [formId, email]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw);
        setRole(d.role ?? role);
        setName(d.name ?? ""); setEmail(d.email ?? "");
        setAnswers(d.answers ?? {}); setFiles(d.files ?? {});
        setSecIndex(d.secIndex ?? 0);
        setStage(d.stage ?? (inviteToken ? "info" : "choose"));
        setToast("Restored your draft,");
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  function saveDraft() {
    try {
      const payload = { formId, role, name, email, answers, files, stage, secIndex };
      localStorage.setItem(draftKey, JSON.stringify(payload));
      setToast("Draft saved, you can come back anytime,");
    } catch { setToast("Could not save draft,"); }
  }

  // Visible questions in current section for the current role
  const sections = form?.sections ?? [];
  const section = sections[secIndex];
  const sectionQs = useMemo(() => {
    if (!form || !section) return [];
    return form.questions.filter(q => q.sectionId === section.id && q.showForRoles.includes(role));
  }, [form, section, role]);

  // Basic validation for a step
  function validateSection(): boolean {
    if (!form || !section) return true;
    const nextErrors: Record<string, string> = {};
    for (const q of sectionQs) {
      const v = answers[q.id];
      if (q.required) {
        const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
        if (empty) { nextErrors[q.id] = "Required"; continue; }
      }
      if (q.inputType === "number" || q.inputType === "currency") {
        if (v !== undefined && v !== null && v !== "") {
          const n = Number(v);
          if (Number.isNaN(n)) nextErrors[q.id] = "Must be a number";
          if (q.validation?.min !== undefined && n < q.validation.min!) nextErrors[q.id] = `Min ${q.validation.min}`;
          if (q.validation?.max !== undefined && n > q.validation.max!) nextErrors[q.id] = `Max ${q.validation.max}`;
        }
      }
      if (q.validation?.pattern && typeof v === "string") {
        try {
          const re = new RegExp(q.validation.pattern);
          if (!re.test(v)) nextErrors[q.id] = "Invalid format";
        } catch { /* ignore bad regex in drafts */ }
      }
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function updateAnswer(id: string, value: any) {
    setAnswers((a) => ({ ...a, [id]: value }));
    setErrors((e) => { const n = { ...e }; delete n[id]; return n; });
  }

  function onFilesChange(key: string, fileList: FileList | null) {
    const arr = fileList ? Array.from(fileList) : [];
    setFiles((f) => ({ ...f, [key]: arr }));
  }

  async function onSubmit() {
    saveDraft();
    try {
      const res = await fetch("/api/tenant/applications", {
        method: "POST",
        body: JSON.stringify({ formId, role, name, email, answers, files: Object.keys(files) }),
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) setToast("Application submitted, thank you,");
      else setToast("Could not submit, we’ll retry shortly,");
    } catch {
      setToast("Offline, saved locally, submit when you’re back online,");
    }
  }

  if (loading || !form) {
    return <div className="p-4 text-sm text-gray-600">Preparing your application…</div>;
  }

  /* ─────────────────────────────────────────────────────
     Screens
  ────────────────────────────────────────────────────── */
  function ChooseScreen() {
    return (
      <div className="mx-auto w-full max-w-md p-4">
        <h1 className="text-xl font-semibold text-gray-900">Start or join</h1>
        <p className="mt-1 text-sm text-gray-600">
          Begin a new household as the primary applicant, or join an existing household with a code,
        </p>

        <div className="mt-4 space-y-3">
          <button
            onClick={() => { setRole("primary"); setStage("info"); }}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 text-white font-medium hover:bg-blue-700"
          >
            Start a new application
          </button>
          <button
            onClick={() => { setRole("co_applicant"); setStage("info"); }}
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 font-medium hover:bg-gray-50"
          >
            Join an existing application
          </button>
        </div>
      </div>
    );
  }

  function InfoScreen() {
    const joining = inviteToken || householdCode;
    return (
      <div className="mx-auto w-full max-w-md p-4">
        <h2 className="text-lg font-semibold text-gray-900">Your details</h2>
        <p className="mt-1 text-sm text-gray-600">
          We’ll use this to save your progress, and keep your household in sync,
        </p>

        <div className="mt-4 space-y-3">
          {/* Role picker (mobile-friendly) */}
          <div>
            <label className="block text-xs text-gray-700 mb-1">Your role</label>
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

          {role === "primary" && !joining && (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
              As primary, you can invite co‑applicants and cosigners later,
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-700 mb-1">Full name</label>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Smith"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-700 mb-1">Email</label>
            <input
              type="email"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
            />
          </div>

          {/* Join code if joining without invite token */}
          {!inviteToken && role !== "primary" && (
            <div>
              <label className="block text-xs text-gray-700 mb-1">Household code (if joining)</label>
              <input
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder="Enter invite code"
                value={householdCode}
                onChange={(e) => setHouseholdCode(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-gray-600">
                If you received a link, you can skip this, we’ll match you automatically,
              </p>
            </div>
          )}
        </div>

        <div className="h-16" />
        {/* Sticky nav */}
        <div className="fixed inset-x-0 bottom-0 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-t">
          <div className="mx-auto max-w-md p-3 flex items-center justify-between">
            <button
              onClick={saveDraft}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              Save
            </button>
            <button
              onClick={() => setStage("sections")}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  function SectionScreen() {
    if (!section) return null;
    return (
      <div className="mx-auto w-full max-w-md p-4">
        {/* Progress */}
        <div className="mb-3">
          <div className="text-xs text-gray-600">
            Section {secIndex + 1} of {sections.length}
          </div>
          <div className="mt-2 h-2 w-full rounded-full bg-gray-200">
            <div
              className="h-2 rounded-full bg-blue-600"
              style={{ width: `${((secIndex + 1) / sections.length) * 100}%` }}
            />
          </div>
        </div>

        <h2 className="text-lg font-semibold text-gray-900">{section.title}</h2>
        {section.description && <p className="text-sm text-gray-600 mt-1">{section.description}</p>}

        <div className="mt-4 space-y-4">
          {sectionQs.length === 0 && (
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
              No questions for your role in this section,
            </div>
          )}

          {sectionQs.map((q) => (
            <div key={q.id}>
              <label className="block text-sm font-medium text-gray-900">
                {q.label} {q.required && <span className="text-rose-600">*</span>}
              </label>
              {q.helpText && <p className="text-xs text-gray-600 mb-1">{q.helpText}</p>}

              <Field
                question={q}
                value={answers[q.id]}
                onChange={(v) => updateAnswer(q.id, v)}
              />

              {errors[q.id] && (
                <div className="mt-1 text-xs text-rose-700">{errors[q.id]}</div>
              )}
            </div>
          ))}
        </div>

        <div className="h-16" />
        {/* Sticky nav */}
        <div className="fixed inset-x-0 bottom-0 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-t">
          <div className="mx-auto max-w-md p-3 flex items-center justify-between">
            <button
              onClick={() => {
                if (secIndex === 0) setStage("info");
                else setSecIndex((i) => Math.max(0, i - 1));
              }}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              Back
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={saveDraft}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                Save
              </button>
              <button
                onClick={() => {
                  if (!validateSection()) return;
                  if (secIndex < sections.length - 1) setSecIndex((i) => i + 1);
                  else setStage("quals");
                }}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

function QualificationsScreen({ f }: { f: ApplicationForm }) {
  const visible = (f.qualifications ?? []).filter(q => q.audience.includes(role));

  return (
    <div className="mx-auto w-full max-w-md p-4">
      <h2 className="text-lg font-semibold text-gray-900">Qualifications</h2>
      <p className="mt-1 text-sm text-gray-600">
        Upload required documents now, or save and finish later,
      </p>

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
        {/* Sticky nav */}
        <div className="fixed inset-x-0 bottom-0 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-t">
          <div className="mx-auto max-w-md p-3 flex items-center justify-between">
            <button
              onClick={() => setStage("sections")}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              Back
            </button>
            <div className="flex items-center gap-2">
              <button onClick={saveDraft} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">
                Save
              </button>
              <button
                onClick={() => setStage("review")}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white"
              >
                Review
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

function ReviewScreen({ f }: { f: ApplicationForm }) {
  const bySection = useMemo(() => {
    const map: Record<string, { title: string; items: { label: string; value: any }[] }> = {};
    for (const s of f.sections) map[s.id] = { title: s.title, items: [] };
    for (const q of f.questions) {
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
  }, [f, answers, role]);

  return (
    <div className="mx-auto w-full max-w-md p-4">
      <h2 className="text-lg font-semibold text-gray-900">Review & submit</h2>
      <p className="mt-1 text-sm text-gray-600">
        Double-check details below, upload missing documents if needed,
      </p>

      <div className="mt-4 space-y-4">
          <div className="rounded-lg border border-gray-200 p-3">
            <div className="text-sm font-medium text-gray-900">Your info</div>
            <div className="mt-2 text-sm text-gray-700">
              <div><span className="text-gray-500">Role:</span> {role.replace("_"," ")}</div>
              <div><span className="text-gray-500">Name:</span> {name || "—"}</div>
              <div><span className="text-gray-500">Email:</span> {email || "—"}</div>
            </div>
          </div>

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
                const idx = f.sections.findIndex((s) => s.id === secId);
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
          {f.qualifications.filter((q) => q.audience.includes(role)).map((q) => (
            <div key={q.id} className="mt-2">
              <div className="text-xs text-gray-600">{q.title}</div>
              <div className="text-sm text-gray-900">
                {(files[q.id]?.length ?? 0) > 0
                  ? `${files[q.id].length} file(s) attached`
                  : "No files"}
              </div>
            </div>
          ))}
          <button onClick={() => setStage("quals")} className="mt-2 text-xs text-gray-700 underline">
            Manage documents
          </button>
        </div>
      </div>

        <div className="h-16" />
        {/* Sticky nav */}
        <div className="fixed inset-x-0 bottom-0 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-t">
          <div className="mx-auto max-w-md p-3 flex items-center justify-between">
            <button
              onClick={() => setStage("quals")}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              Back
            </button>
            <div className="flex items-center gap-2">
              <button onClick={saveDraft} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">Save</button>
              <button onClick={onSubmit} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white">
                Submit application
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ─────────────────────────────────────────────────────
     Field renderer
  ────────────────────────────────────────────────────── */
  function Field({
    question, value, onChange,
  }: { question: FormQuestion; value: any; onChange: (v:any)=>void }) {
    const common = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm";
    switch (question.inputType) {
      case "short_text":
      case "email":
      case "phone":
        return (
          <input
            type={question.inputType === "email" ? "email" : question.inputType === "phone" ? "tel" : "text"}
            className={common}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        );
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
            {(question.options ?? []).map((opt, i) => <option key={i} value={opt}>{opt}</option>)}
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
  }

  /* ─────────────────────────────────────────────────────
     Router
  ────────────────────────────────────────────────────── */
  return (
    <>
      {/* App header (mobile friendly) */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b">
        <div className="mx-auto max-w-md px-4 py-3">
          <div className="text-sm font-medium text-gray-900">{form.name}</div>
          <div className="text-xs text-gray-600">Role: {role.replace("_"," ")}</div>
        </div>
      </header>

      {stage === "choose"   && <ChooseScreen />}
		{stage === "info"     && <InfoScreen />}
		{stage === "sections" && <SectionScreen />}
		{stage === "quals"    && form && <QualificationsScreen f={form} />}
		{stage === "review"   && form && <ReviewScreen f={form} />}

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
