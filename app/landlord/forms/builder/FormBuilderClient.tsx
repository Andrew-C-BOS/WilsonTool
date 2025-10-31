"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/* ──────────────────────────────────────────────────────────────────────────────
   Types, enums, helpers
────────────────────────────────────────────────────────────────────────────── */

type MemberRole = "primary" | "co_applicant" | "cosigner";
type InputType =
  | "short_text"
  | "long_text"
  | "number"
  | "currency"
  | "yes_no"
  | "date"
  | "email"
  | "phone"
  | "select_single"
  | "select_multi"
  | "file";

type Requirement = "required" | "optional" | "conditional";
type QualMode = "self_upload" | "integration" | "either";

type FormSection = { id: string; title: string; description?: string };
type FormQuestion = {
  id: string;
  sectionId: string;
  label: string;
  helpText?: string;
  inputType: InputType;
  required: boolean;
  showForRoles: MemberRole[];  // who must answer
  options?: string[];          // for select types
  validation?: { min?: number; max?: number; pattern?: string };
};

type Qualification = {
  id: string;
  title: string;               // e.g., Government ID, Credit Report
  audience: MemberRole[];      // who must provide this
  requirement: Requirement;    // required, optional, conditional
  mode: QualMode;              // self upload, integration, either
  docKind?: string;            // id, paystub, w2, bank_statement, credit_report, etc
  integration?: { provider: "Plaid" | "Equifax" | "TransUnion" | "Persona" | "StripeIdentity"; type: "income" | "credit" | "identity" };
  notes?: string;
};

type ApplicationForm = {
  name: string;
  description?: string;
  scope: "portfolio";          // firm-wide for MVP
  sections: FormSection[];
  questions: FormQuestion[];
  qualifications: Qualification[];
  version: number;
};

function uid() {
  // use crypto if available
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "id_" + Math.random().toString(36).slice(2, 9);
}

function clsx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

/* ──────────────────────────────────────────────────────────────────────────────
   Question Library (premade)
────────────────────────────────────────────────────────────────────────────── */
type LibraryItem = {
  label: string;
  inputType: InputType;
  helpText?: string;
  options?: string[];
  validation?: FormQuestion["validation"];
  // sensible defaults
  showForRoles?: MemberRole[];
  required?: boolean;
};

const LIBRARY: Record<string, LibraryItem[]> = {
  "Household": [
    { label: "Legal name", inputType: "short_text", required: true, showForRoles: ["primary", "co_applicant"] },
    { label: "Email address", inputType: "email", required: true, showForRoles: ["primary", "co_applicant", "cosigner"] },
    { label: "Phone", inputType: "phone", required: true, showForRoles: ["primary"] },
    { label: "Date of birth", inputType: "date", required: true, showForRoles: ["primary", "co_applicant"] },
  ],
  "Residence": [
    { label: "Current address", inputType: "long_text", required: true, showForRoles: ["primary", "co_applicant"] },
    { label: "Landlord name", inputType: "short_text", showForRoles: ["primary"] },
    { label: "Landlord phone", inputType: "phone", showForRoles: ["primary"] },
  ],
  "Employment & Income": [
    { label: "Employer", inputType: "short_text", required: true, showForRoles: ["primary", "co_applicant"] },
    { label: "Monthly income", inputType: "currency", required: true, showForRoles: ["primary", "co_applicant"], validation: { min: 0 } },
    { label: "Employment type", inputType: "select_single", options: ["Full‑time", "Part‑time", "Contract", "Self‑employed"] },
  ],
  "Other": [
    { label: "Pets", inputType: "select_multi", options: ["Dog", "Cat", "Other"] },
    { label: "Vehicles", inputType: "number", helpText: "How many vehicles will you park on site" },
    { label: "Anything else we should know", inputType: "long_text" },
  ],
};

const DEFAULT_SECTIONS: FormSection[] = [
  { id: uid(), title: "Applicant info" },
  { id: uid(), title: "Residence history" },
  { id: uid(), title: "Employment & income" },
];

const DEFAULT_QUALS: Qualification[] = [
  {
    id: uid(),
    title: "Government ID",
    audience: ["primary", "co_applicant"],
    requirement: "required",
    mode: "either",
    docKind: "government_id",
    notes: "Driver’s license, passport, state ID,",
    integration: { provider: "Persona", type: "identity" } as const,   // ⬅️ here
  },
  {
    id: uid(),
    title: "Credit report",
    audience: ["primary", "co_applicant", "cosigner"],
    requirement: "required",
    mode: "either",
    docKind: "credit_report",
    integration: { provider: "TransUnion", type: "credit" } as const,   // ⬅️ and here
  },
];

/* ──────────────────────────────────────────────────────────────────────────────
   Builder Component
────────────────────────────────────────────────────────────────────────────── */

export default function FormBuilderClient() {
  const [form, setForm] = useState<ApplicationForm>(() => ({
    name: "Standard Rental Application",
    description: "Firm‑wide application, designed for households, clean and complete,",
    scope: "portfolio",
    sections: DEFAULT_SECTIONS,
    questions: [],
    qualifications: DEFAULT_QUALS,
    version: 1,
  }));

  const [selectedSectionId, setSelectedSectionId] = useState<string>(form.sections[0]?.id || "");
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const selectedQuestion = useMemo(
    () => form.questions.find(q => q.id === selectedQuestionId) || null,
    [form.questions, selectedQuestionId]
  );

  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /* ─── Sections ─── */
  function addSection() {
    const s: FormSection = { id: uid(), title: "New section" };
    setForm(f => ({ ...f, sections: [...f.sections, s] }));
    setSelectedSectionId(s.id);
  }
  function renameSection(id: string, title: string) {
    setForm(f => ({ ...f, sections: f.sections.map(s => s.id === id ? { ...s, title } : s) }));
  }
  function removeSection(id: string) {
    const nextSections = form.sections.filter(s => s.id !== id);
    const nextQuestions = form.questions.filter(q => q.sectionId !== id);
    setForm(f => ({ ...f, sections: nextSections, questions: nextQuestions }));
    if (selectedSectionId === id && nextSections.length) setSelectedSectionId(nextSections[0].id);
  }

  /* ─── Questions ─── */
  function addQuestionFromLibrary(sectionId: string, base: LibraryItem) {
    const q: FormQuestion = {
      id: uid(),
      sectionId,
      label: base.label,
      helpText: base.helpText,
      inputType: base.inputType,
      required: base.required ?? false,
      showForRoles: base.showForRoles ?? ["primary", "co_applicant", "cosigner"],
      options: base.options,
      validation: base.validation,
    };
    setForm(f => ({ ...f, questions: [...f.questions, q] }));
    setSelectedQuestionId(q.id);
  }
  function updateQuestion(id: string, patch: Partial<FormQuestion>) {
    setForm(f => ({ ...f, questions: f.questions.map(q => q.id === id ? { ...q, ...patch } : q) }));
  }
  function moveQuestion(id: string, dir: "up" | "down") {
    const idx = form.questions.findIndex(q => q.id === id);
    if (idx < 0) return;
    const sectionId = form.questions[idx].sectionId;
    const sameSectionIdxs = form.questions
      .map((q, i) => ({ q, i }))
      .filter(p => p.q.sectionId === sectionId)
      .map(p => p.i);
    const localIndex = sameSectionIdxs.indexOf(idx);
    const targetLocalIndex = localIndex + (dir === "up" ? -1 : 1);
    if (targetLocalIndex < 0 || targetLocalIndex >= sameSectionIdxs.length) return;
    const targetIdx = sameSectionIdxs[targetLocalIndex];
    const next = [...form.questions];
    [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
    setForm(f => ({ ...f, questions: next }));
  }
  function deleteQuestion(id: string) {
    setForm(f => ({ ...f, questions: f.questions.filter(q => q.id !== id) }));
    if (selectedQuestionId === id) setSelectedQuestionId(null);
  }

  /* ─── Qualifications ─── */
function addQualification(kind: "id" | "credit" | "income") {
  const base =
    kind === "id"
      ? {
          title: "Government ID",
          docKind: "government_id",
          mode: "either" as const,
          integration: { provider: "Persona", type: "identity" } as const, // ⬅️ keep literals
        }
      : kind === "credit"
      ? {
          title: "Credit report",
          docKind: "credit_report",
          mode: "either" as const,
          integration: { provider: "TransUnion", type: "credit" } as const, // ⬅️
        }
      : {
          title: "Income verification",
          docKind: "income_docs",
          mode: "either" as const,
          integration: { provider: "Plaid", type: "income" } as const, // ⬅️
        };

  const q: Qualification = {
    id: uid(),
    title: base.title,
    audience: ["primary", "co_applicant", "cosigner"],
    requirement: "required",
    mode: base.mode,
    docKind: base.docKind,
    integration: base.integration, // now satisfies the union
  };
  setForm((f) => ({ ...f, qualifications: [...f.qualifications, q] }));
}

  function updateQualification(id: string, patch: Partial<Qualification>) {
    setForm(f => ({ ...f, qualifications: f.qualifications.map(x => x.id === id ? { ...x, ...patch } : x) }));
  }
  function deleteQualification(id: string) {
    setForm(f => ({ ...f, qualifications: f.qualifications.filter(x => x.id !== id) }));
  }

  /* ─── Save, export, import ─── */
  async function saveDraft() {
    try {
      // optional server save, safe to comment out if you haven’t added the API yet
      const res = await fetch("/api/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      setToast("Form saved, versioned, firm‑wide,");
    } catch {
      setToast("Could not reach server, exporting JSON instead,");
      exportJson();
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(form, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${form.name.replace(/\s+/g, "_")}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function importJson(evt: React.ChangeEvent<HTMLInputElement>) {
    const file = evt.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = JSON.parse(String(reader.result));
        // naive validation
        if (!incoming.name || !Array.isArray(incoming.sections)) throw new Error("invalid");
        setForm(incoming);
        setSelectedSectionId(incoming.sections[0]?.id || "");
        setSelectedQuestionId(null);
        setToast("Form imported, ready to edit,");
      } catch {
        setToast("Invalid JSON, please try again,");
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  }

  /* ─── Derived ─── */
  const questionsBySection = useMemo(() => {
    const map: Record<string, FormQuestion[]> = {};
    for (const s of form.sections) map[s.id] = [];
    for (const q of form.questions) {
      if (!map[q.sectionId]) map[q.sectionId] = [];
      map[q.sectionId].push(q);
    }
    return map;
  }, [form.sections, form.questions]);

  /* ─── UI bits ─── */

  function AudienceToggles({
    value, onChange,
  }: { value: MemberRole[]; onChange: (next: MemberRole[]) => void }) {
    const ROLES: { key: MemberRole; label: string }[] = [
      { key: "primary", label: "Primary" },
      { key: "co_applicant", label: "Co‑applicant" },
      { key: "cosigner", label: "Cosigner" },
    ];
    function toggle(k: MemberRole) {
      onChange(value.includes(k) ? value.filter(x => x !== k) : [...value, k]);
    }
    return (
      <div className="flex flex-wrap gap-2">
        {ROLES.map(r => (
          <button
            key={r.key}
            type="button"
            onClick={() => toggle(r.key)}
            className={clsx(
              "rounded-md px-2.5 py-1 text-xs border",
              value.includes(r.key)
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            )}
          >
            {r.label}
          </button>
        ))}
      </div>
    );
  }

  function FieldTypeSelect({
    value, onChange,
  }: { value: InputType; onChange: (t: InputType) => void }) {
    const TYPES: { v: InputType; label: string }[] = [
      { v: "short_text", label: "Short answer" },
      { v: "long_text", label: "Long answer" },
      { v: "number", label: "Number" },
      { v: "currency", label: "Currency" },
      { v: "yes_no", label: "Yes / No" },
      { v: "date", label: "Date" },
      { v: "email", label: "Email" },
      { v: "phone", label: "Phone" },
      { v: "select_single", label: "Select, single" },
      { v: "select_multi", label: "Select, multi" },
      { v: "file", label: "File upload" },
    ];
    return (
      <select
        className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value as InputType)}
      >
        {TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
      </select>
    );
  }

  function Toast({ text, onClose }: { text: string; onClose: () => void }) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
        <div className="rounded-md bg-gray-900 text-white text-sm px-4 py-2 shadow-lg">
          {text} <button className="ml-3 underline" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  /* ─── Layout ─── */
  return (
    <>
      {/* Top bar */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 mb-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="block text-sm text-gray-700 mb-1">Form name</label>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={form.name}
              onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
            />
            <label className="block text-sm text-gray-700 mb-1 mt-3">Description</label>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={form.description || ""}
              onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Visible to applicants, short and clear,"
            />
          </div>
          <div className="flex flex-col gap-2 justify-end">
            <div className="flex gap-2">
              <button
                onClick={saveDraft}
                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Save draft
              </button>
              <button
                onClick={exportJson}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
              >
                Export JSON
              </button>
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={importJson}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900 hover:bg-gray-50"
              >
                Import JSON
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Two-column workspace */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left: Library, Qualifications */}
        <aside className="space-y-4">
          {/* Library */}
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="text-sm font-semibold text-gray-900">Question library</div>
              <div className="text-xs text-gray-600">Pick a section, add questions, edit on the right,</div>
            </div>
            <div className="p-3 space-y-3">
              {Object.entries(LIBRARY).map(([group, items]) => (
                <div key={group}>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">{group}</div>
                  <div className="mt-2 space-y-1">
                    {items.map((it, idx) => (
                      <button
                        key={`${group}-${idx}`}
                        onClick={() => selectedSectionId ? addQuestionFromLibrary(selectedSectionId, it) : setToast("Select a section first,")}
                        className="w-full text-left rounded-md border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        <div className="text-gray-900">{it.label}</div>
                        <div className="text-xs text-gray-600">
                          {it.inputType.replace("_", " ")} • Audience: {(it.showForRoles ?? ["primary","co_applicant","cosigner"]).join(", ")}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Qualifications */}
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="text-sm font-semibold text-gray-900">Qualifications</div>
              <div className="text-xs text-gray-600">Self uploads today, integrations soon,</div>
            </div>
            <div className="p-3">
              <div className="flex flex-wrap gap-2">
                <button onClick={() => addQualification("id")} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs">+ Government ID</button>
                <button onClick={() => addQualification("credit")} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs">+ Credit report</button>
                <button onClick={() => addQualification("income")} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs">+ Income verification</button>
              </div>

              <div className="mt-3 space-y-2">
                {form.qualifications.map(q => (
                  <div key={q.id} className="rounded-md border border-gray-200 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-gray-900">{q.title}</div>
                      <button onClick={() => deleteQualification(q.id)} className="text-xs text-gray-600 hover:underline">Remove</button>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs text-gray-700 mb-1">Audience</label>
                        <AudienceToggles
                          value={q.audience}
                          onChange={(aud) => updateQualification(q.id, { audience: aud })}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-700 mb-1">Requirement</label>
                        <select
                          className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                          value={q.requirement}
                          onChange={(e) => updateQualification(q.id, { requirement: e.target.value as Requirement })}
                        >
                          <option value="required">Required</option>
                          <option value="optional">Optional</option>
                          <option value="conditional">Conditional</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-700 mb-1">Mode</label>
                        <select
                          className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                          value={q.mode}
                          onChange={(e) => updateQualification(q.id, { mode: e.target.value as QualMode })}
                        >
                          <option value="either">Either</option>
                          <option value="self_upload">Self upload only</option>
                          <option value="integration">Integration only</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-700 mb-1">Notes</label>
                        <input
                          className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                          value={q.notes || ""}
                          onChange={(e) => updateQualification(q.id, { notes: e.target.value })}
                          placeholder="Any instructions or constraints,"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500">We’ll wire providers soon, we’ll keep self‑uploads available,</p>
            </div>
          </div>
        </aside>

        {/* Right: Sections and questions */}
        <section className="lg:col-span-2 space-y-4">
          {/* Sections */}
          <div className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900">Sections</div>
				<button
				  onClick={addSection}
				  className="rounded-md border border-gray-300 bg-gradient-to-b from-white to-gray-50 text-gray-800 font-medium 
						 shadow-sm hover:shadow-md hover:from-gray-50 hover:to-white active:from-gray-100 active:to-gray-200 
						 px-3 py-1.5 text-sm transition-all duration-150 ease-in-out">
				  + Add section
				</button>              
			</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {form.sections.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSectionId(s.id)}
                  className={clsx(
                    "rounded-md px-3 py-1.5 text-sm border",
                    selectedSectionId === s.id
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  )}
                >
                  {s.title}
                </button>
              ))}
            </div>
            {/* Rename / Remove selected */}
            {selectedSectionId && (
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs text-gray-700 mb-1">Rename section</label>
                  <input
                    className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                    value={form.sections.find(s => s.id === selectedSectionId)?.title || ""}
                    onChange={(e) => renameSection(selectedSectionId, e.target.value)}
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={() => removeSection(selectedSectionId)}
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 hover:bg-gray-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Questions in selected section */}
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900">Questions</div>
              <div className="text-xs text-gray-600">Add from the library, then edit details here,</div>
            </div>
            <div className="p-4">
              {(questionsBySection[selectedSectionId] || []).length === 0 ? (
                <div className="text-sm text-gray-600">
                  No questions in this section yet, add from the library on the left,
                </div>
              ) : (
                <div className="space-y-3">
                  {questionsBySection[selectedSectionId]?.map(q => (
                    <div key={q.id} className={clsx("rounded-md border p-3", selectedQuestionId === q.id ? "border-gray-900" : "border-gray-200")}>
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium text-gray-900">{q.label}</div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => moveQuestion(q.id, "up")} className="text-xs text-gray-600 hover:underline">Up</button>
                          <button onClick={() => moveQuestion(q.id, "down")} className="text-xs text-gray-600 hover:underline">Down</button>
                          <button onClick={() => setSelectedQuestionId(q.id)} className="text-xs text-gray-600 hover:underline">Edit</button>
                          <button onClick={() => deleteQuestion(q.id)} className="text-xs text-gray-600 hover:underline">Remove</button>
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-gray-600">
                        {q.inputType.replace("_", " ")} • {q.required ? "Required" : "Optional"} • Audience: {q.showForRoles.join(", ")}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Question inspector */}
          {selectedQuestion && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-sm font-semibold text-gray-900 mb-3">Edit question</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-xs text-gray-700 mb-1">Label</label>
                  <input
                    className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                    value={selectedQuestion.label}
                    onChange={(e) => updateQuestion(selectedQuestion.id, { label: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-700 mb-1">Type</label>
                  <FieldTypeSelect
                    value={selectedQuestion.inputType}
                    onChange={(t) => updateQuestion(selectedQuestion.id, { inputType: t, options: t.includes("select") ? (selectedQuestion.options ?? ["Option 1"]) : undefined })}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-700 mb-1">Required</label>
                  <select
                    className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                    value={selectedQuestion.required ? "required" : "optional"}
                    onChange={(e) => updateQuestion(selectedQuestion.id, { required: e.target.value === "required" })}
                  >
                    <option value="required">Required</option>
                    <option value="optional">Optional</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-gray-700 mb-1">Audience</label>
                  <AudienceToggles
                    value={selectedQuestion.showForRoles}
                    onChange={(roles) => updateQuestion(selectedQuestion.id, { showForRoles: roles })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-gray-700 mb-1">Help text</label>
                  <input
                    className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                    value={selectedQuestion.helpText || ""}
                    onChange={(e) => updateQuestion(selectedQuestion.id, { helpText: e.target.value })}
                    placeholder="Short guidance, attachments, examples,"
                  />
                </div>

                {/* Options for selects */}
                {(selectedQuestion.inputType === "select_single" || selectedQuestion.inputType === "select_multi") && (
                  <div className="sm:col-span-2">
                    <label className="block text-xs text-gray-700 mb-1">Options</label>
                    <OptionsEditor
                      options={selectedQuestion.options ?? []}
                      onChange={(opts) => updateQuestion(selectedQuestion.id, { options: opts })}
                    />
                  </div>
                )}

                {/* Numeric validation */}
                {(selectedQuestion.inputType === "number" || selectedQuestion.inputType === "currency") && (
                  <>
                    <div>
                      <label className="block text-xs text-gray-700 mb-1">Min</label>
                      <input
                        type="number"
                        className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                        value={selectedQuestion.validation?.min ?? ""}
                        onChange={(e) => updateQuestion(selectedQuestion.id, { validation: { ...(selectedQuestion.validation || {}), min: e.target.value ? Number(e.target.value) : undefined } })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-700 mb-1">Max</label>
                      <input
                        type="number"
                        className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                        value={selectedQuestion.validation?.max ?? ""}
                        onChange={(e) => updateQuestion(selectedQuestion.id, { validation: { ...(selectedQuestion.validation || {}), max: e.target.value ? Number(e.target.value) : undefined } })}
                      />
                    </div>
                  </>
                )}

                {/* Pattern for short/long/email/phone */}
                {["short_text", "long_text", "email", "phone"].includes(selectedQuestion.inputType) && (
                  <div className="sm:col-span-2">
                    <label className="block text-xs text-gray-700 mb-1">Pattern (optional)</label>
                    <input
                      className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
                      placeholder="Regex, if needed, keep it simple,"
                      value={selectedQuestion.validation?.pattern ?? ""}
                      onChange={(e) => updateQuestion(selectedQuestion.id, { validation: { ...(selectedQuestion.validation || {}), pattern: e.target.value || undefined } })}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
      </section>
      </div>

      {toast && <Toast text={toast} onClose={() => setToast(null)} />}
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Small sub‑component: Options editor for selects
────────────────────────────────────────────────────────────────────────────── */
function OptionsEditor({ options, onChange }: { options: string[]; onChange: (opts: string[]) => void }) {
  const [local, setLocal] = useState<string[]>(options.length ? options : ["Option 1"]);
  useEffect(() => { setLocal(options.length ? options : ["Option 1"]); }, [options]);

  function update(i: number, v: string) {
    const next = [...local]; next[i] = v; setLocal(next); onChange(next);
  }
  function add() { const next = [...local, `Option ${local.length + 1}`]; setLocal(next); onChange(next); }
  function remove(i: number) { const next = local.filter((_, idx) => idx !== i); setLocal(next); onChange(next); }

  return (
    <div className="space-y-2">
      {local.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className="flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
            value={opt}
            onChange={(e) => update(i, e.target.value)}
          />
          <button type="button" onClick={() => remove(i)} className="text-xs text-gray-600 hover:underline">Remove</button>
        </div>
      ))}
      <button type="button" onClick={add} 				  className="rounded-md border border-gray-300 bg-gradient-to-b from-white to-gray-50 text-gray-800 font-medium 
						 shadow-sm hover:shadow-md hover:from-gray-50 hover:to-white active:from-gray-100 active:to-gray-200 
						 px-3 py-1.5 text-sm transition-all duration-150 ease-in-out">+ Add option</button>
    </div>
  );
}
