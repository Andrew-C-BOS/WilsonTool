"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import LocalTime from "@/app/components/Time"; // ← correct relative path (Time.tsx is one level up)

/* ---------- Types ---------- */
type MemberRole = "primary" | "co_applicant" | "cosigner" | "co-applicant";
type AppStatus = "new" | "in_review" | "needs_approval" | "approved_pending_lease" | "rejected";

type Member = {
  userId?: string;
  email: string;
  role: MemberRole;
  state?: "invited" | "complete" | "missing_docs";
  joinedAt?: string;
  name?: string;
};

type Qualification = {
  id: string;
  title: string;
  requirement: "required" | "optional" | "conditional";
  audience: MemberRole[];
  mode: "self_upload" | "integration" | "either";
  docKind?: string;
};

type FormLite = {
  id: string;
  name: string;
  sections: { id: string; title: string }[];
  questions: any[];
  qualifications: Qualification[];
};

type TimelineEvent = { at: string; by?: string; event: string; meta?: Record<string, any> };

type ReviewBundle = {
  id: string;
  status: AppStatus;
  createdAt?: string;
  updatedAt?: string;
  submittedAt?: string | null;
  form: FormLite;
  members: Member[];
  answersByRole: Record<string, Record<string, any>>;
  timeline: TimelineEvent[];
};

/* ---------- Small UI primitives ---------- */
function clsx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}
function Badge({
  children,
  tone = "gray",
}: {
  children: React.ReactNode;
  tone?: "gray" | "blue" | "amber" | "violet" | "emerald" | "rose";
}) {
  const map = {
    gray: "bg-gray-100 text-gray-800 ring-gray-200",
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    violet: "bg-violet-50 text-violet-800 ring-violet-200",
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    rose: "bg-rose-50 text-rose-700 ring-rose-200",
  } as const;
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", map[tone])}>
      {children}
    </span>
  );
}
function StatusChip({ status }: { status: AppStatus }) {
  const tone =
    status === "new" ? "blue" :
    status === "in_review" ? "amber" :
    status === "needs_approval" ? "violet" :
    status === "approved_pending_lease" ? "emerald" : "rose";
  const label =
    status === "new" ? "New" :
    status === "in_review" ? "In review" :
    status === "needs_approval" ? "Needs approval" :
    status === "approved_pending_lease" ? "Approved" : "Rejected";
  return <Badge tone={tone as any}>{label}</Badge>;
}
function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  if (!text) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      <div className="rounded-md bg-gray-900 text-white text-sm px-4 py-2 shadow-lg">
        {text}{" "}
        <button className="ml-3 underline underline-offset-2" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/* ---------- Helpers ---------- */
const isTruthyId = (s?: string | null) =>
  !!s && s !== "undefined" && s !== "null" && s.trim().length >= 12;

const API = (id: string, firmId?: string) =>
  `/api/landlord/applications/${encodeURIComponent(id)}${firmId ? `?firmId=${encodeURIComponent(firmId)}` : ""}`;

function normalizeRole(v: any): MemberRole {
  const s = String(v ?? "").toLowerCase().replace("_", "-");
  if (s === "co-applicant") return "co-applicant";
  if (s === "primary" || s === "cosigner") return s as MemberRole;
  return "co-applicant";
}
function labelize(key: string) {
  const map: Record<string, string> = {
    q_name: "Name",
    q_email: "Email",
    q_phone: "Phone",
    q_dob: "Date of birth",
    q_curr_addr: "Current address",
    q_employer: "Employer",
    q_income: "Monthly income",
  };
  if (map[key]) return map[key];
  return key.replace(/^q_/, "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

/* ---------- Data fetch ---------- */
async function fetchBundle(appId: string, firmId?: string): Promise<ReviewBundle | null> {
  try {
    const res = await fetch(API(appId, firmId), { cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json();
    const app = j.application;
    const form = j.form;

    const members: Member[] = (Array.isArray(app.members) ? app.members : []).map((m: any) => ({
      userId: m.userId,
      email: String(m.email || "—"),
      role: normalizeRole(m.role),
      state: m.state,
      joinedAt: m.joinedAt || null,
      name: m.name,
    }));

    return {
      id: String(app.id ?? app._id ?? ""),
      status: app.status as AppStatus,
      createdAt: app.createdAt || null,
      updatedAt: app.updatedAt || null,
      submittedAt: app.submittedAt || null,
      form: {
        id: String(form.id ?? form._id ?? ""),
        name: String(form.name || "Untitled"),
        sections: Array.isArray(form.sections) ? form.sections : [],
        questions: Array.isArray(form.questions) ? form.questions : [],
        qualifications: Array.isArray(form.qualifications) ? form.qualifications : [],
      },
      members,
      answersByRole: app.answers || {},
      timeline: Array.isArray(app.timeline) ? app.timeline : [],
    };
  } catch {
    return null;
  }
}

/* ---------- Actions ---------- */
async function postDecision(appId: string, action: "preliminary_accept" | "approve" | "reject", firmId?: string) {
  const url = `${API(appId, firmId)}/decision`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  }).catch(() => null);
  return !!res && res.ok;
}

/* ---------- Component ---------- */
export default function ReviewDesktop({ appId }: { appId?: string }) {
  const routeParams = useParams();
  const routeId = Array.isArray(routeParams?.id) ? routeParams.id[0] : (routeParams?.id as string | undefined);
  const searchParams = useSearchParams();

  // Optional firm tz from the URL, e.g., ?tz=America/New_York
  const firmTz = searchParams.get("tz") || searchParams.get("firmTz") || undefined;
  const firmId = searchParams.get("firmId") || undefined;

  // Prefer prop, fall back to the route param
  const effectiveId = isTruthyId(appId) ? (appId as string) : routeId;

  const [bundle, setBundle] = useState<ReviewBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const app = bundle;

  useEffect(() => {
    let cancelled = false;

    if (!isTruthyId(effectiveId)) {
      setLoading(false);
      setBundle(null);
      return;
    }

    (async () => {
      setLoading(true);
      const b = await fetchBundle(effectiveId as string, firmId);
      if (!cancelled) {
        setBundle(b);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveId, firmId]);

  const primary = useMemo(
    () => app?.members?.find((m) => normalizeRole(m.role) === "primary"),
    [app]
  );

  async function onDecision(action: "preliminary_accept" | "approve" | "reject") {
    if (!app || !isTruthyId(app.id)) return;
    const ok = await postDecision(app.id, action, firmId);
    setToast(
      ok
        ? action === "preliminary_accept"
          ? "Preliminary acceptance recorded,"
          : action === "approve"
          ? "Approval recorded,"
          : "Rejection recorded,"
        : "Could not record decision right now,"
    );
    if (ok) {
      const b = await fetchBundle(app.id, firmId);
      setBundle(b);
    }
  }

  if (!isTruthyId(effectiveId)) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Missing or invalid application id, please navigate from the Applications table again,
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
        Loading…
      </div>
    );
  }
  if (!app) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
        Application not found,
      </div>
    );
  }

  const roles = Object.keys(app.answersByRole || {});
  const sortedTimeline = [...(app.timeline || [])].sort(
    (a, b) => (a.at || "").localeCompare(b.at || "")
  );

  return (
    <main className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-500">Application</div>
            <div className="mt-0.5 text-xl font-semibold text-gray-900 truncate">
              {primary?.name || primary?.email || "Primary applicant"}{" "}
              <span className="text-gray-400 font-normal">/</span>{" "}
              <span className="text-gray-700">{app.form.name}</span>
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Created <LocalTime iso={app.createdAt} tz={firmTz} />,{" "}
              updated <LocalTime iso={app.updatedAt} tz={firmTz} />,{" "}
              submitted <LocalTime iso={app.submittedAt} tz={firmTz} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <StatusChip status={app.status} />
            <Link
              href="/landlord/applications"
              className="ml-3 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900 hover:bg-gray-50"
            >
              Back to applications
            </Link>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => onDecision("preliminary_accept")}
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            Prelim accept
          </button>
          <button
            onClick={() => onDecision("approve")}
            className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900 hover:bg-emerald-100"
          >
            Fully accept
          </button>
          <button
            onClick={() => onDecision("reject")}
            className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-900 hover:bg-rose-100"
          >
            Reject
          </button>
        </div>
      </div>

      {/* 2‑column layout */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left: Answers */}
        <section className="col-span-12 lg:col-span-8 space-y-6">
          {roles.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
              No answers yet,
            </div>
          ) : (
            roles.map((roleKey) => {
              const roleAnswers = app.answersByRole[roleKey] || {};
              const roleLabel =
                normalizeRole(roleKey) === "primary"
                  ? "Primary applicant"
                  : normalizeRole(roleKey) === "cosigner"
                  ? "Cosigner"
                  : "Co‑applicant";
              return (
                <div key={roleKey} className="rounded-xl border border-gray-200 bg-white">
                  <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
                    <div className="text-sm font-semibold text-gray-900">{roleLabel}</div>
                    <Badge tone="gray">{Object.keys(roleAnswers).length} answers</Badge>
                  </div>
                  <div className="p-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {Object.entries(roleAnswers).map(([k, v]) => (
                        <div key={k} className="rounded-md border border-gray-200 p-3">
                          <div className="text-[11px] uppercase tracking-wide text-gray-500">
                            {labelize(k)}
                          </div>
                          <div className="mt-1 text-sm text-gray-900 break-words">
                            {String(v ?? "—")}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </section>

        {/* Right: Members, Qualifications, Timeline */}
        <aside className="col-span-12 lg:col-span-4 space-y-6">
          {/* Members */}
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <div className="text-sm font-semibold text-gray-900">Household members</div>
              <Badge tone="gray">{app.members.length}</Badge>
            </div>
            <div className="p-5 space-y-3">
              {app.members.map((m, i) => (
                <div key={i} className="flex items-start justify-between rounded-md border border-gray-200 p-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{m.name || m.email}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge tone={normalizeRole(m.role) === "primary" ? "blue" : normalizeRole(m.role) === "cosigner" ? "violet" : "gray"}>
                        {String(m.role).replace("_", "-")}
                      </Badge>
                      {m.state && (
                        <Badge tone={m.state === "complete" ? "emerald" : m.state === "missing_docs" ? "amber" : "gray"}>
                          {m.state.replace("_", " ")}
                        </Badge>
                      )}
                    </div>
                    {m.joinedAt && (
                      <div className="mt-1 text-xs text-gray-500">
                        Joined <LocalTime iso={m.joinedAt} tz={firmTz} />
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 flex gap-2">
                    <button className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs hover:bg-gray-50">
                      Resend invite
                    </button>
                    <button className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs hover:bg-gray-50">
                      Request docs
                    </button>
                  </div>
                </div>
              ))}
              <p className="text-xs text-gray-500">
                Multi‑member households are supported, primary, co‑applicants, cosigners,
              </p>
            </div>
          </div>

          {/* Qualifications */}
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <div className="text-sm font-semibold text-gray-900">Required qualifications</div>
              <Badge tone="gray">{app.form.qualifications.length}</Badge>
            </div>
            <div className="p-5 space-y-2">
              {app.form.qualifications.length === 0 ? (
                <div className="text-sm text-gray-600">None configured yet,</div>
              ) : (
                app.form.qualifications.map((q) => (
                  <div key={q.id} className="rounded-md border border-gray-200 p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-gray-900">{q.title}</div>
                      <Badge tone={q.requirement === "required" ? "amber" : "gray"}>
                        {q.requirement.replace("_", " ")}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-gray-600">
                      Audience: {q.audience.map(a => String(a).replace("_", "-")).join(", ")}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <div className="text-sm font-semibold text-gray-900">Timeline</div>
              <Badge tone="gray">{sortedTimeline.length}</Badge>
            </div>
            <div className="p-5 space-y-3">
              {sortedTimeline.length === 0 ? (
                <div className="text-sm text-gray-600">No events yet,</div>
              ) : (
                sortedTimeline.map((ev, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="h-2 w-2 mt-1.5 rounded-full bg-gray-400" />
                    <div>
                      <div className="text-sm text-gray-900">
                        {ev.event.replace(".", " · ")}
                        {ev.meta?.to && <span className="text-gray-500"> → {String(ev.meta.to).replace("_", " ")}</span>}
                      </div>
                      <div className="text-xs text-gray-500">
                        <LocalTime iso={ev.at} tz={firmTz} />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>

      <Toast text={toast || ""} onClose={() => setToast(null)} />
    </main>
  );
}
