"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import LocalTime from "@/app/components/Time";

/* ---------- Types ---------- */
type MemberRole = "primary" | "co_applicant" | "cosigner" | "co-applicant";
type AppStatus =
  | "draft"
  | "submitted"
  | "admin_screened"
  | "approved_high"
  | "terms_set"
  | "min_due"
  | "min_paid"
  | "countersigned"
  | "occupied"
  | "rejected"
  | "withdrawn";

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

type MemberSectionBucket = {
  role: MemberRole;
  email: string;
  sections: Record<string, Record<string, any>>; // sectionTitle -> { questionLabel -> answer }
};

type ReviewBundle = {
  id: string;
  status: AppStatus;
  createdAt?: string;
  updatedAt?: string;
  submittedAt?: string | null;
  form: FormLite;
  members: Member[];
  answersByMember?: Record<string, { role: MemberRole; email: string; answers: Record<string, any> }>;
  answersByMemberSections?: Record<string, MemberSectionBucket>;
  timeline: TimelineEvent[];
  building?: {
    addressLine1: string;
    addressLine2?: string | null;
    city: string;
    state: string;
    postalCode: string;
    country?: string;
  } | null;
  unit?: { unitNumber?: string | null } | null;
  protoLease?: { monthlyRent?: number | null; moveInDate?: string | null; termMonths?: number | null } | null;
};

type FirmViewerRole = "member" | "admin" | "owner" | "none";

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
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        map[tone]
      )}
    >
      {children}
    </span>
  );
}

/** New canonical state chip */
function StatusChip({ status }: { status: AppStatus }) {
  const tone: "gray" | "blue" | "amber" | "violet" | "emerald" | "rose" =
    status === "draft"
      ? "gray"
      : status === "submitted"
      ? "blue"
      : status === "admin_screened"
      ? "amber"
      : status === "approved_high"
      ? "violet"
      : status === "terms_set"
      ? "violet"
      : status === "min_due"
      ? "violet"
      : status === "min_paid"
      ? "emerald"
      : status === "countersigned"
      ? "emerald"
      : status === "occupied"
      ? "emerald"
      : status === "rejected" || status === "withdrawn"
      ? "rose"
      : "gray";

  const label =
    status === "draft"
      ? "Draft"
      : status === "submitted"
      ? "Submitted"
      : status === "admin_screened"
      ? "In review"
      : status === "approved_high"
      ? "Approved"
      : status === "terms_set"
      ? "Terms set"
      : status === "min_due"
      ? "Payment due"
      : status === "min_paid"
      ? "Ready to sign"
      : status === "countersigned"
      ? "Countersigned"
      : status === "occupied"
      ? "Occupied"
      : status === "rejected"
      ? "Rejected"
      : status === "withdrawn"
      ? "Withdrawn"
      : "—";

  return <Badge tone={tone}>{label}</Badge>;
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
  `/api/landlord/applications/${encodeURIComponent(id)}${
    firmId ? `?firmId=${encodeURIComponent(firmId)}` : ""
  }`;

function normalizeRole(v: any): MemberRole {
  const s = String(v ?? "").toLowerCase().replace("_", "-");
  if (s === "co-applicant") return "co-applicant";
  if (s === "primary" || s === "cosigner") return s as MemberRole;
  return "co-applicant";
}

const centsToDollars = (c?: number | null) =>
  typeof c === "number" && c > 0 ? (c / 100).toFixed(2) : "";

/** add N months to yyyy-mm-dd */
function addMonthsISO(startISO: string, months: number): string {
  const [y, m, d] = startISO.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  const y2 = dt.getUTCFullYear();
  const m2 = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d2 = String(dt.getUTCDate()).padStart(2, "0");
  return `${y2}-${m2}-${d2}`;
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

    const answersByMember =
      app.answersByMember && typeof app.answersByMember === "object"
        ? (app.answersByMember as Record<
            string,
            { role: MemberRole; email: string; answers: Record<string, any> }
          >)
        : undefined;

    const answersByMemberSections =
      app.answersByMemberSections && typeof app.answersByMemberSections === "object"
        ? (Object.fromEntries(
            Object.entries(app.answersByMemberSections as Record<string, any>).map(
              ([uid, bucket]) => [
                uid,
                {
                  role: normalizeRole(bucket.role),
                  email: String(bucket.email || "—"),
                  sections: bucket.sections || {},
                } as MemberSectionBucket,
              ]
            )
          ) as Record<string, MemberSectionBucket>)
        : undefined;

    return {
      id: String(app.id ?? app._id ?? ""),
      status: String(app.status ?? "submitted") as AppStatus,
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
      answersByMember,
      answersByMemberSections,
      timeline: Array.isArray(app.timeline) ? app.timeline : [],
      building: app.building ?? null,
      unit: app.unit ?? null,
      protoLease: app.protoLease ?? null,
    };
  } catch {
    return null;
  }
}

async function fetchUserFirmRole(firmId?: string): Promise<FirmViewerRole> {
  try {
    const url = `/api/landlord/firm/role${firmId ? `?firmId=${encodeURIComponent(firmId)}` : ""}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return "none";
    const j = await res.json();
    const r = String(j.role || "").toLowerCase();
    if (r === "owner" || r === "admin" || r === "member") return r as any;
    return "none";
  } catch {
    return "none";
  }
}

/* ---------- Actions ---------- */
async function postDecision(
  appId: string,
  action: "preliminary_accept" | "approve" | "reject",
  firmId?: string
) {
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
  const routeId = Array.isArray(routeParams?.id)
    ? routeParams.id[0]
    : (routeParams?.id as string | undefined);
  const searchParams = useSearchParams();
  const router = useRouter();

  const firmTz = searchParams.get("tz") || searchParams.get("firmTz") || undefined;
  const firmId = searchParams.get("firmId") || undefined;

  const effectiveId = isTruthyId(appId) ? (appId as string) : routeId;

  const [bundle, setBundle] = useState<ReviewBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [viewerRole, setViewerRole] = useState<FirmViewerRole>("none");
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);

  // Lease modal state
  const [showLeaseModal, setShowLeaseModal] = useState(false);
  const [unitInput, setUnitInput] = useState<string>("");
  const [rentInput, setRentInput] = useState<string>("");
  const [addr1, setAddr1] = useState<string>("");
  const [addr2, setAddr2] = useState<string>("");
  const [city, setCity] = useState<string>("");
  const [stateInput, setStateInput] = useState<string>("");
  const [zip, setZip] = useState<string>("");
  const [termMonths, setTermMonths] = useState<string>("");
  const [moveIn, setMoveIn] = useState<string>("");
  const [signed, setSigned] = useState<boolean>(false);

  const app = bundle;
  const ctaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!isTruthyId(effectiveId)) {
      setLoading(false);
      setBundle(null);
      return;
    }

    (async () => {
      setLoading(true);
      const [b, role] = await Promise.all([
        fetchBundle(effectiveId as string, firmId),
        fetchUserFirmRole(firmId),
      ]);
      if (!cancelled) {
        setBundle(b);
        setViewerRole(role);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveId, firmId]);

  const answersByMemberSections = app?.answersByMemberSections || {};

  // Derive members, even if API.members is empty, using answersByMemberSections
  const derivedMembers: Member[] = useMemo(() => {
    if (!app) return [];

    const seenUserIds = new Set<string>();
    const seenEmails = new Set<string>();
    const out: Member[] = [];

    // Start with whatever the API gave us
    for (const m of app.members || []) {
      const emailLower = m.email.toLowerCase();
      if (m.userId) seenUserIds.add(m.userId);
      seenEmails.add(emailLower);
      out.push(m);
    }

    // Add synthetic members from answersByMemberSections if missing
    for (const [userId, bucket] of Object.entries(answersByMemberSections)) {
      const emailLower = bucket.email.toLowerCase();
      const hasUserId = userId && seenUserIds.has(userId);
      const hasEmail = emailLower && seenEmails.has(emailLower);

      if (!hasUserId && !hasEmail) {
        out.push({
          userId,
          email: bucket.email || "—",
          role: bucket.role,
          state: undefined,
          joinedAt: undefined,
          name: undefined,
        });
        if (userId) seenUserIds.add(userId);
        if (emailLower) seenEmails.add(emailLower);
      }
    }

    return out;
  }, [app, answersByMemberSections]);

  const primary = useMemo(
    () => derivedMembers.find((m) => normalizeRole(m.role) === "primary"),
    [derivedMembers]
  );

  /* --- Authority gates (role + status) --- */
  const canPrelimByRole =
    viewerRole === "member" || viewerRole === "admin" || viewerRole === "owner";
  const canApproveByRole = viewerRole === "admin" || viewerRole === "owner";
  const canRejectByRole = viewerRole !== "none";

  const prelimStatusOK = app?.status === "submitted";

  // Full approval allowed in submitted or admin_screened
  const approveStatusOK =
    app?.status === "submitted" || app?.status === "admin_screened";

  const canPreliminaryAccept = !!app && prelimStatusOK && canPrelimByRole;
  const canApprove = !!app && approveStatusOK && canApproveByRole;
  const canReject =
    !!app &&
    app.status !== "rejected" &&
    app.status !== "withdrawn" &&
    canRejectByRole;

  // New flow: show CTA after approval (approved_high or terms_set)
  const showConfigureLeaseCTA =
    !!app && (app.status === "approved_high" || app.status === "terms_set");

  async function onDecision(action: "preliminary_accept" | "approve" | "reject") {
    if (!app || !isTruthyId(app.id)) return;

    if (
      (action === "preliminary_accept" && !canPreliminaryAccept) ||
      (action === "approve" && !canApprove) ||
      (action === "reject" && !canReject)
    ) {
      setToast("Not authorized for this action,");
      return;
    }

    const ok = await postDecision(app.id, action, firmId);
    setToast(ok ? "Saved," : "Unauthorized or failed,");
    if (!ok) return;

    const b = await fetchBundle(app.id, firmId);
    setBundle(b);

    if (action === "approve") {
      setToast("Approved — configure the lease next,");
      setTimeout(() => {
        ctaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 150);
    }
  }

  function openLeaseModal() {
    if (!app) return;

    setUnitInput(app.unit?.unitNumber ?? "");
    setRentInput(centsToDollars(app.protoLease?.monthlyRent ?? null));
    setTermMonths(app.protoLease?.termMonths ? String(app.protoLease.termMonths) : "");
    const defaultMoveIn =
      (app.protoLease?.moveInDate && String(app.protoLease.moveInDate).slice(0, 10)) ||
      new Date().toISOString().slice(0, 10);
    setMoveIn(defaultMoveIn);

    const b = app.building;
    setAddr1(b?.addressLine1 ?? "");
    setAddr2(b?.addressLine2 ?? "");
    setCity(b?.city ?? "");
    setStateInput((b?.state ?? "").toUpperCase());
    setZip(b?.postalCode ?? "");
    setSigned(false);

    setShowLeaseModal(true);
  }

  async function onCreateLease() {
    if (!app) return;

    if (!addr1.trim() || !city.trim() || !zip.trim() || !stateInput.trim() || stateInput.trim().length < 2) {
      setToast("Please fill address: street, city, state (2 letters), ZIP,");
      return;
    }
    if (!rentInput.trim() || Number(rentInput) <= 0) {
      setToast("Enter a positive monthly rent,");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(moveIn)) {
      setToast("Enter a valid move-in date (YYYY-MM-DD),");
      return;
    }
    const term = termMonths.trim() ? Number(termMonths) : NaN;
    if (termMonths.trim() && (!Number.isFinite(term) || term <= 0)) {
      setToast("Lease term must be a positive integer,");
      return;
    }

    const monthlyRentCents = Math.round((Number(rentInput) || 0) * 100);

    try {
      const building = {
        addressLine1: addr1.trim(),
        addressLine2: addr2.trim() || null,
        city: city.trim(),
        state: stateInput.trim().toUpperCase(),
        postalCode: zip.trim(),
        country: "US",
      };

      const url = `/api/landlord/leases/${encodeURIComponent(
        app.id
      )}/unit${firmId ? `?firmId=${encodeURIComponent(firmId)}` : ""}`;
      const body = {
        building,
        unit: { unitNumber: unitInput || null },
        lease: {
          monthlyRent: monthlyRentCents,
          termMonths: termMonths.trim() ? Number(termMonths) : null,
          moveInDate: moveIn || null,
        },
      };
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => null);
      if (!res || !res.ok) {
        let msg = "Failed to save unit/rent on application.";
        try {
          const j = await res?.json();
          if (j?.error) msg = String(j.error);
        } catch {}
        throw new Error(msg);
      }

      const url2 = `/api/landlord/leases/by-app/${encodeURIComponent(
        app.id
      )}/assign${firmId ? `?firmId=${encodeURIComponent(firmId)}` : ""}`;
      const res2 = await fetch(url2, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          moveInDate: moveIn,
          moveOutDate:
            termMonths.trim() && Number(termMonths) > 0
              ? addMonthsISO(moveIn, Number(termMonths))
              : null,
          signed,
        }),
      }).catch(() => null);
      if (!res2 || !res2.ok) {
        let msg = "Failed to create lease.";
        try {
          const j = await res2?.json();
          if (j?.error === "overlap")
            msg = "This unit already has a scheduled/active assignment in that window.";
          else if (j?.error) msg = String(j.error);
        } catch {}
        throw new Error(msg);
      }

      setShowLeaseModal(false);
      setToast("Lease saved,");
      setBundle(await fetchBundle(app.id, firmId));
    } catch (e: any) {
      setToast(e?.message || "Failed to save lease,");
    }
  }

  if (!isTruthyId(effectiveId)) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Missing or invalid application id, please navigate from the Applications list,
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

  const sortedTimeline = [...(app.timeline || [])].sort((a, b) =>
    (a.at || "").localeCompare(b.at || "")
  );

  const hasSectionedAnswers =
    Object.keys(answersByMemberSections).length > 0;

  // Sort members for display: primary → co-applicants → cosigners
  const sortedMembers: Member[] = [...derivedMembers].sort((a, b) => {
    const rank = (r: MemberRole) =>
      normalizeRole(r) === "primary"
        ? 0
        : normalizeRole(r) === "co-applicant"
        ? 1
        : 2;
    const ra = rank(a.role);
    const rb = rank(b.role);
    if (ra !== rb) return ra - rb;
    return (a.name || a.email).localeCompare(b.name || b.email);
  });

  // Lookup sectioned answers bucket for a member
  function getMemberSections(member: Member): MemberSectionBucket | null {
    if (member.userId && answersByMemberSections[member.userId]) {
      return answersByMemberSections[member.userId];
    }
    const found = Object.values(answersByMemberSections).find(
      (bucket) =>
        bucket.email &&
        bucket.email.toLowerCase() === member.email.toLowerCase()
    );
    return found || null;
  }

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
              Created <LocalTime iso={app.createdAt} tz={firmTz} />, updated{" "}
              <LocalTime iso={app.updatedAt} tz={firmTz} />, submitted{" "}
              <LocalTime iso={app.submittedAt} tz={firmTz} />
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Your role: <span className="font-medium">{viewerRole}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 relative">
            <StatusChip status={app.status as AppStatus} />
            <Link
              href={`/landlord/applications${
                firmId ? `?firmId=${encodeURIComponent(firmId)}` : ""
              }`}
              className="ml-3 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900 hover:bg-gray-50"
            >
              Back to applications
            </Link>
          </div>
        </div>

        {/* Configure lease CTA after approval */}
        {showConfigureLeaseCTA && (
          <div
            ref={ctaRef}
            className="mt-4 rounded-xl border border-blue-300 bg-blue-50/80 p-4"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-blue-900">
                  Configure lease
                </div>
                <p className="mt-0.5 text-sm text-blue-900/80">
                  This application is <span className="font-medium">approved</span> and waiting for
                  lease setup. Set monthly rent, term, start date, security deposit, and key fee, then
                  collect a minimum payment.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    router.push(
                      `/landlord/leases/${encodeURIComponent(
                        app.id
                      )}/setup${firmId ? `?firmId=${encodeURIComponent(firmId)}` : ""}`
                    )
                  }
                  className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
                >
                  Configure lease
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Decisions (role + status gated) */}
        <div className="mt-4">
          {(canPreliminaryAccept || canApprove || canReject) && (
            <div className="flex flex-wrap items-center gap-2">
              {/* Preliminary accept */}
              {canPreliminaryAccept && (
                <button
                  onClick={() => onDecision("preliminary_accept")}
                  className={clsx(
                    "group inline-flex items-center gap-1.5 rounded-md",
                    "border border-amber-300 bg-amber-50 px-3 py-1.5 text-[11px] font-medium text-amber-900",
                    "hover:bg-amber-100 active:scale-[0.99] transition focus:outline-none focus:ring-2 focus:ring-amber-300/60"
                  )}
                  title="Preliminary accept"
                  aria-label="Preliminary accept"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    className="text-amber-700"
                    aria-hidden="true"
                  >
                    <path
                      d="M20 6L9 17l-5-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Prelim accept
                </button>
              )}

              {/* Fully accept */}
              {canApprove && (
                <button
                  onClick={() => onDecision("approve")}
                  className={clsx(
                    "group inline-flex items-center gap-1.5 rounded-md",
                    "border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[11px] font-medium text-emerald-900",
                    "hover:bg-emerald-100 active:scale-[0.99] transition focus:outline-none focus:ring-2 focus:ring-emerald-300/60"
                  )}
                  title="Fully accept"
                  aria-label="Fully accept"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    className="text-emerald-700"
                    aria-hidden="true"
                  >
                    <path
                      d="M12 20V10m0 0l-3 3m3-3l3 3M5 20h14a2 2 0 0 0 2-2V9.5a2 2 0 0 0-.586-1.414l-4-4A2 2 0 0 0 14.172 3H8A3 3 0 0 0 5 6v14Z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Approve
                </button>
              )}

              {/* Reject */}
              {canReject && (
                <button
                  onClick={() => onDecision("reject")}
                  className={clsx(
                    "group inline-flex items-center gap-1.5 rounded-md",
                    "border border-rose-300 bg-rose-50 px-3 py-1.5 text-[11px] font-medium text-rose-900",
                    "hover:bg-rose-100 active:scale-[0.99] transition focus:outline-none focus:ring-2 focus:ring-rose-300/60"
                  )}
                  title="Reject"
                  aria-label="Reject"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    className="text-rose-700"
                    aria-hidden="true"
                  >
                    <path
                      d="M6 6l12 12M18 6L6 18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Reject
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Lease modal */}
      {showLeaseModal && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setShowLeaseModal(false)}
          />
          <div className="absolute left-1/2 top-16 w-[92%] max-w-lg -translate-x-1/2 rounded-2xl bg-white shadow-xl ring-1 ring-gray-200">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <h3 className="text-sm font-semibold text-gray-900">
                Confirm lease details
              </h3>
              <button
                onClick={() => setShowLeaseModal(false)}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 text-sm">
              <p className="text-[11px] text-gray-500">
                We’ll save address, unit and monthly rent to this application, then create a
                simple assignment (unit, dates, signed flag).
              </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
              <button
                onClick={onCreateLease}
                className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700"
              >
                Save lease
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2-column layout */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left: Answers (member + sections) */}
        <section className="col-span-12 lg:col-span-8 space-y-6">
          {!hasSectionedAnswers ? (
            <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
              No answers yet,
            </div>
          ) : (
            sortedMembers.map((m) => {
              const bucket = getMemberSections(m);
              const sections = bucket?.sections || {};

              const sectionTitlesFromForm = app.form.sections
                .map((s) => s.title)
                .filter((t) => sections[t]);

              const extraSectionTitles = Object.keys(sections).filter(
                (t) => !sectionTitlesFromForm.includes(t)
              );

              const allSectionTitles = [...sectionTitlesFromForm, ...extraSectionTitles];

              const totalAnswers = Object.values(sections).reduce(
                (sum, sec) => sum + Object.keys(sec || {}).length,
                0
              );

              return (
                <div
                  key={m.userId || m.email}
                  className="rounded-xl border border-gray-200 bg-white"
                >
                  <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 truncate">
                        {m.name || m.email}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-gray-600">
                        <Badge
                          tone={
                            normalizeRole(m.role) === "primary"
                              ? "blue"
                              : normalizeRole(m.role) === "cosigner"
                              ? "violet"
                              : "gray"
                          }
                        >
                          {String(m.role).replace("_", "-")}
                        </Badge>
                        {m.state && (
                          <Badge
                            tone={
                              m.state === "complete"
                                ? "emerald"
                                : m.state === "missing_docs"
                                ? "amber"
                                : "gray"
                            }
                          >
                            {m.state.replace("_", " ")}
                          </Badge>
                        )}
                        <span className="text-gray-400">·</span>
                        <span>{totalAnswers} answers</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-5 space-y-5">
                    {allSectionTitles.length === 0 ? (
                      <div className="text-sm text-gray-600">
                        No answers for this member yet,
                      </div>
                    ) : (
                      allSectionTitles.map((sectionTitle) => {
                        const qa = sections[sectionTitle] || {};
                        const entries = Object.entries(qa);

                        if (!entries.length) return null;

                        return (
                          <div
                            key={sectionTitle}
                            className="rounded-lg border border-gray-100 bg-gray-50/60"
                          >
                            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
                              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                {sectionTitle}
                              </div>
                              <Badge tone="gray">{entries.length}</Badge>
                            </div>
                            <div className="px-4 py-3">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {entries.map(([label, value]) => (
                                  <div
                                    key={label}
                                    className="rounded-md border border-gray-200 bg-white p-3"
                                  >
                                    <div className="text-[11px] uppercase tracking-wide text-gray-500">
                                      {label}
                                    </div>
                                    <div className="mt-1 text-sm text-gray-900 break-words whitespace-pre-wrap">
                                      {value === null ||
                                      value === undefined ||
                                      value === ""
                                        ? "—"
                                        : String(value)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
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
              <div className="text-sm font-semibold text-gray-900">
                Household members
              </div>
              <Badge tone="gray">{derivedMembers.length}</Badge>
            </div>
            <div className="p-5 space-y-3">
              {derivedMembers.map((m, i) => (
                <div
                  key={i}
                  className="flex items-start justify-between rounded-md border border-gray-200 p-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {m.name || m.email}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge
                        tone={
                          normalizeRole(m.role) === "primary"
                            ? "blue"
                            : normalizeRole(m.role) === "cosigner"
                            ? "violet"
                            : "gray"
                        }
                      >
                        {String(m.role).replace("_", "-")}
                      </Badge>
                      {m.state && (
                        <Badge
                          tone={
                            m.state === "complete"
                              ? "emerald"
                              : m.state === "missing_docs"
                              ? "amber"
                              : "gray"
                          }
                        >
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
                </div>
              ))}
              <p className="text-xs text-gray-500">
                Multi-member households are supported — primary, co-applicants, cosigners,
              </p>
            </div>
          </div>

          {/* Qualifications */}
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <div className="text-sm font-semibold text-gray-900">
                Required qualifications
              </div>
              <Badge tone="gray">{app.form.qualifications.length}</Badge>
            </div>
            <div className="p-5 space-y-2">
              {app.form.qualifications.length === 0 ? (
                <div className="text-sm text-gray-600">None configured yet,</div>
              ) : (
                app.form.qualifications.map((q) => (
                  <div
                    key={q.id}
                    className="rounded-md border border-gray-200 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-gray-900">{q.title}</div>
                      <Badge tone={q.requirement === "required" ? "amber" : "gray"}>
                        {q.requirement.replace("_", " ")}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-gray-600">
                      Audience:{" "}
                      {q.audience
                        .map((a) => String(a).replace("_", "-"))
                        .join(", ")}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Timeline (collapsible) */}
          <div className="rounded-xl border border-gray-200 bg-white">
            <button
              type="button"
              onClick={() => setIsTimelineOpen((v) => !v)}
              aria-expanded={isTimelineOpen}
              className="flex w-full items-center justify-between border-b border-gray-100 px-5 py-3 text-left"
            >
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-gray-900">
                  Timeline
                </div>
                <Badge tone="gray">{sortedTimeline.length}</Badge>
              </div>
              <svg
                className={clsx(
                  "h-4 w-4 shrink-0 text-gray-500 transition-transform",
                  isTimelineOpen && "rotate-180"
                )}
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 10.17l3.71-2.94a.75.75 0 111.04 1.08l-4.24 3.36a.75.75 0 01-.94 0L5.21 8.31a.75.75 0 01.02-1.1z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {isTimelineOpen && (
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
                          {ev.meta?.to && (
                            <span className="text-gray-500">
                              {" "}
                              → {String(ev.meta.to).replace("_", " ")}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">
                          <LocalTime iso={ev.at} tz={firmTz} />
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      <Toast text={toast || ""} onClose={() => setToast(null)} />
    </main>
  );
}
