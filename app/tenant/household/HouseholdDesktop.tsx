// app/tenant/household/HouseholdDesktop.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { HouseholdCluster, MemberRole } from "./HouseholdRouter";
import Link from "next/link";
import {
  Users,
  UserPlus,
  LinkIcon,
  ShieldCheck,
  Copy as CopyIcon,
  Trash2,
  X,
  UserCircle2,
  LogOut,
  Info,
  CheckCircle2,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────
   Small utilities
───────────────────────────────────────────────────────────── */
function clsx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}
function niceShortDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ─────────────────────────────────────────────────────────────
   Shared UI atoms
───────────────────────────────────────────────────────────── */
function Badge({
  children,
  tone = "gray",
}: {
  children: React.ReactNode;
  tone?: "gray" | "blue" | "amber" | "emerald" | "rose" | "indigo";
}) {
  const map = {
    gray: "bg-gray-100 text-gray-700",
    blue: "bg-blue-100 text-blue-700",
    amber: "bg-amber-100 text-amber-800",
    emerald: "bg-emerald-100 text-emerald-800",
    rose: "bg-rose-100 text-rose-700",
    indigo: "bg-indigo-100 text-indigo-700",
  } as const;
  return (
    <span className={clsx("inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold", map[tone])}>
      {children}
    </span>
  );
}

function Pill({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={clsx(
        "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold",
        active
          ? "bg-indigo-600 text-white shadow-sm"
          : "bg-indigo-50 text-indigo-700 border border-indigo-100"
      )}
    >
      <span
        className={clsx(
          "inline-block h-1.5 w-1.5 rounded-full",
          active ? "bg-white/80" : "bg-indigo-400"
        )}
      />
      {children}
    </div>
  );
}

function Card({
  children,
  badgeText,
  title,
  titleIcon,
  right,
  tone = "neutral",
  id,
}: {
  children: React.ReactNode;
  badgeText?: string;
  title: string;
  titleIcon?: React.ReactNode;
  right?: React.ReactNode;
  tone?: "neutral" | "emphasis";
  id?: string;
}) {
  const border =
    tone === "emphasis" ? "border-l-4 border-rose-400" : "border-l-4 border-gray-200";
  return (
    <div
      id={id}
      className={clsx(
        "rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100",
        border
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="flex items-center text-lg font-semibold text-gray-900">
          {titleIcon ? <span className="mr-3 h-6 w-6">{titleIcon}</span> : null}
          {title}
        </h2>
        <div className="flex items-center gap-3">
          {badgeText ? (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
              {badgeText}
            </span>
          ) : null}
          {right}
        </div>
      </div>
      <div className="mt-4 text-gray-700">{children}</div>
    </div>
  );
}

function PrimaryButton({
  children,
  href,
  onClick,
  disabled,
  tone = "gray",
  className,
}: {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "gray" | "indigo" | "rose";
  className?: string;
}) {
  const toneCls =
    tone === "indigo"
      ? "bg-indigo-600 hover:bg-indigo-700 text-white"
      : tone === "rose"
      ? "bg-rose-600 hover:bg-rose-700 text-white"
      : "bg-gray-900 hover:bg-black text-white";

  const finalClassName = clsx(
    "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition",
    disabled ? "bg-gray-300 text-gray-600 cursor-not-allowed shadow-none" : toneCls,
    className,
  );

  if (href) {
    return (
      <Link href={href} className={finalClassName}>
        {children}
      </Link>
    );
  }

  return (
    <button className={finalClassName} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}


function GhostButton({
  children,
  onClick,
  disabled,
  title,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 transition";

  const finalClassName = clsx(
    base,
    disabled && "opacity-60 cursor-not-allowed",
    className
  );

  return (
    <button
      className={finalClassName}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="fixed left-1/2 top-16 w-[92%] max-w-lg -translate-x-1/2 rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="inline-flex items-center rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 hover:bg-gray-50"
          >
            <X className="mr-1 h-4 w-4" />
            Close
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Types (local)
───────────────────────────────────────────────────────────── */
type ActiveInvite = {
  id: string;
  email: string;
  role: MemberRole;
  createdAt: string;
  expiresAt: string;
  inviteUrlTemplate?: string; // no code on GET
};
type CreatedInvite = {
  id: string;
  email: string;
  role: MemberRole;
  createdAt: string;
  expiresAt: string;
  code: string;
  inviteUrl: string;
};

/** Incoming invites addressed to the current user */
type IncomingInvite = {
  id: string;
  householdName?: string | null;
  inviterName?: string | null;
  role: MemberRole;
  createdAt: string;
  expiresAt: string;
};

/* ─────────────────────────────────────────────────────────────
   Component
───────────────────────────────────────────────────────────── */
export default function HouseholdDesktop({
  cluster,
  state,
}: {
  cluster: HouseholdCluster;
  // state is an object that may have primaryKind, and it may be null/undefined
  state?: { primaryKind?: string } | null;
}) {
  const router = useRouter();

  const isConfigure = state?.primaryKind === "configure_household";

  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // modals
  const [inviteOpen, setInviteOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinFromInviteOpen, setJoinFromInviteOpen] = useState(false);

  // rename household
  const [newName, setNewName] = useState(cluster.displayName || "");
  const [savingName, setSavingName] = useState(false);

  // preferred name (visible to landlords)
  const [preferredName, setPreferredName] = useState<string>("");
  const [savingPreferred, setSavingPreferred] = useState(false);

  // join by code
  const [joinCode, setJoinCode] = useState("");

  // invites (outgoing)
  const [invites, setInvites] = useState<ActiveInvite[]>([]);
  const [creating, setCreating] = useState(false);
  const [newInviteEmail, setNewInviteEmail] = useState("");
  const [newInviteRole, setNewInviteRole] = useState<MemberRole>("co_applicant");
  const [lastCreated, setLastCreated] = useState<CreatedInvite | null>(null);

  // incoming invites (to me, from other households)
  const [incomingInvites, setIncomingInvites] = useState<IncomingInvite[]>([]);
  const [incomingLoading, setIncomingLoading] = useState<boolean>(false);

  // leave
  const [leaving, setLeaving] = useState(false);

  const memberCount = cluster.members.length;
  const canJoin = memberCount <= 1;
  const canLeave = memberCount > 1;
  const headerName = cluster.displayName ?? "Untitled household";
  const hasIncomingInvites = incomingInvites.length > 0;

  // two simple tones based on primaryKind
  const statusTone: "info" | "success" = isConfigure ? "info" : "success";
  const statusTitle = isConfigure
    ? "Set up your household before you apply,"
    : "Your household is set up,";
  const statusBody = isConfigure
    ? "Decide who belongs in this household. Invite co-applicants or cosigners, or join a household someone has already created. Give your household a recognizable name so you and your property manager can recognize it quickly."
    : "Everyone on this lease is linked through this household, you can still rename it or adjust members here, but most next steps live on your home and application pages,";

  function flash(msg: string) {
    setToast(msg);
    // @ts-ignore attach timer handle
    window.clearTimeout((flash as any)._t);
    // @ts-ignore save timer handle
    (flash as any)._t = window.setTimeout(() => setToast(null), 1800);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      flash("Copied,");
    } catch {
      flash(text);
    }
  }

  /* ---------------- API helpers ---------------- */
  async function fetchInvites() {
    try {
      const res = await fetch("/api/tenant/household/invites?me=1", { cache: "no-store" });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "error");
      setInvites(json.invites as ActiveInvite[]);
    } catch (e) {
      console.error("invite list error", e);
    }
  }

  async function fetchIncomingInvites() {
    setIncomingLoading(true);
    try {
      const res = await fetch("/api/tenant/household/invites/incoming?me=1", {
        cache: "no-store",
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "error");
      setIncomingInvites(json.invites as IncomingInvite[]);
    } catch (e) {
      console.error("incoming invite list error", e);
      setIncomingInvites([]);
    } finally {
      setIncomingLoading(false);
    }
  }

  async function createInvite(email: string, role: MemberRole) {
    setCreating(true);
    setLastCreated(null);
    try {
      const res = await fetch("/api/tenant/household/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "create_failed");
      const ci = json.invite as CreatedInvite;
      setLastCreated(ci);
      fetchInvites();
      flash("Invite created,");
    } catch (e: any) {
      flash(`Invite failed, ${e.message || "error"},`);
    } finally {
      setCreating(false);
    }
  }

  async function revokeInvite(id: string) {
    const prev = invites;
    setInvites((xs) => xs.filter((r) => r.id !== id));
    try {
      const res = await fetch(`/api/tenant/household/invites/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "revoke_failed");
      flash("Invite revoked,");
    } catch (e: any) {
      setInvites(prev);
      flash(`Revoke failed, ${e.message || "error"},`);
    }
  }

  // Join by inviteId (Join-from-invite modal)
  async function redeemInviteById(inviteId: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/tenant/household/invites/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "redeem_failed");
      flash("Joined,");
      router.refresh();
    } catch (e: any) {
      const msg = e?.message || "redeem_failed";
      const reason =
        msg === "wrong_email"
          ? "wrong email for this invite,"
          : msg === "invalid_or_expired"
          ? "invalid or expired invite,"
          : msg || "error,";
      flash(`Couldn’t join, ${reason}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveHouseholdName() {
    const name = newName.trim();
    if (!name || name === (cluster.displayName ?? "")) {
      flash("No changes,");
      return;
    }
    setSavingName(true);
    try {
      const res = await fetch("/api/tenant/household/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "rename_failed");
      flash("Renamed,");
      router.refresh();
    } catch (e: any) {
      flash(`Rename failed, ${e.message || "error"},`);
    } finally {
      setSavingName(false);
    }
  }

  async function savePreferredName() {
    const pn = preferredName.trim();
    if (!pn) {
      flash("Enter a preferred name,");
      return;
    }
    setSavingPreferred(true);
    try {
      const res = await fetch("/api/tenant/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferredName: pn }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "save_failed");
      flash("Preferred name saved,");
      router.refresh();
    } catch (e: any) {
      flash(`Save failed, ${e.message || "error"},`);
    } finally {
      setSavingPreferred(false);
    }
  }

  async function leaveHousehold() {
    if (!canLeave) return;
    const confirmed = window.confirm(
      "Are you sure you want to leave this household? You’ll be unlinked from the other members,"
    );
    if (!confirmed) return;

    setLeaving(true);
    try {
      const res = await fetch("/api/tenant/household/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "leave_failed");
      flash("Left household,");
      router.replace("/tenant");
      router.refresh();
    } catch (e: any) {
      const msg =
        e?.message === "no_active_membership"
          ? "no active membership to leave,"
          : e?.message || "error,";
      flash(`Couldn’t leave, ${msg}`);
    } finally {
      setLeaving(false);
    }
  }

  async function handleJoinFromInvite(inviteId: string) {
    setJoinFromInviteOpen(false);
    await redeemInviteById(inviteId);
    fetchIncomingInvites();
  }

  useEffect(() => {
    fetchInvites();
    fetchIncomingInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ───────────────────────────────────────────────────────────
     Render
  ─────────────────────────────────────────────────────────── */
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#e6edf1]">
      {/* Hero / header */}
	  <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8 rounded-3xl bg-gradient-to-r from-indigo-50 via-sky-50 to-rose-50 p-6 shadow-sm ring-1 ring-indigo-100/60">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-indigo-700">
              {isConfigure ? (
                <>
                  <Pill active>Step 1</Pill>
                  <span className="hidden text-indigo-500 sm:inline">
                    Before you Apply
                  </span>
                </>
              ) : (
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold text-indigo-700">
                  Household overview
                </span>
              )}
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-gray-900">
              {isConfigure ? "Configure your household" : "Your household"}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-600">
              Your application is based on your household. Co-applicants and cosigners must be linked here 
			  so property managers see one clear group instead of separate submissions.
            </p>
          </div>

          <div className="flex flex-col items-end gap-2 text-right">
            <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-gray-700 shadow-sm">
              Household name
              <span className="mx-1 text-gray-400">·</span>
              {headerName}
            </span>
            <span className="text-xs text-gray-500">
              {memberCount} member{memberCount === 1 ? "" : "s"} linked through this household,
            </span>
          </div>
        </div>

        {/* Status strip */}
        <div
          className={clsx(
            "mt-4 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-sm backdrop-blur",
            statusTone === "success" &&
              "border-emerald-200 bg-emerald-50/70 text-emerald-900",
            statusTone === "info" &&
              "border-indigo-200 bg-white/70 text-indigo-900"
          )}
        >
          <div className="mt-0.5">
            {statusTone === "success" ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            ) : (
              <Info className="h-5 w-5 text-indigo-500" />
            )}
          </div>
          <div>
            <div className="text-sm font-semibold">{statusTitle}</div>
            <p className="mt-1 text-xs text-gray-700">{statusBody}</p>
            {isConfigure ? (
              <p className="mt-1 text-[11px] text-gray-500">
                Your household will be complete once you set your household name (Rename Household Section).
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-gray-500">
                For next steps, use your home page to move into applications, payments, and
                documents, this page is here when you need to update the people linked to you,
              </p>
            )}
          </div>
        </div>

        {/* Primary actions row */}
{isConfigure ? (
		<div/>
) : (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <PrimaryButton href="/tenant" tone="indigo">
              Return to home
            </PrimaryButton>
            <GhostButton>
              <Link href="/tenant/applications">Go to applications</Link>
            </GhostButton>
            <span className="text-[11px] text-gray-500">
              You can still invite, join, or rename below if something changes,
            </span>
          </div>
        )}

        {/* Small “how this works” helper – only needed in configure mode */}
        {isConfigure && (
          <div className="mt-5 grid gap-3 text-xs text-gray-600 sm:grid-cols-3">
            <div className="rounded-xl bg-white/70 px-3 py-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                1, Decide who’s in
              </div>
              <p className="mt-1">
                Invite anyone who should sign the lease, co-applicants, cosigners, or roommates,
                or join an existing household from an invite,
              </p>
            </div>
            <div className="rounded-xl bg-white/70 px-3 py-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                2, Name the household
              </div>
              <p className="mt-1">
                Give the household a short name you recognize quickly, we use this across your
                application and lease,
              </p>
            </div>
            <div className="rounded-xl bg-white/70 px-3 py-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                3, Set your preferred name
              </div>
              <p className="mt-1">
                Set how your name appears to property managers, for example “Andrew C,” instead of a
                long email address,
              </p>
            </div>
          </div>
        )}
      </header>

      {/* Main content grid */}
      <section className="grid gap-6 lg:grid-cols-2">
	  
        {/* Members */}
        <Card
          title="Members"
          titleIcon={<Users className="text-indigo-500" />}
          badgeText={`${memberCount} total`}
        >
          {/* Preferred name editor */}
          <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-center gap-2">
              <UserCircle2 className="h-5 w-5 text-indigo-500" />
              <div className="text-sm font-medium text-gray-900">Preferred name</div>
            </div>
            <p className="mt-1 text-xs text-gray-600">
              This is how your name will appear to property managers and landlords across MILO,
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                value={preferredName}
                onChange={(e) => setPreferredName(e.target.value)}
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder="e.g., Andrew C., or, Andrew"
              />
              <GhostButton
                onClick={savePreferredName}
                disabled={savingPreferred || !preferredName.trim()}
                title={!preferredName.trim() ? "Enter a preferred name," : undefined}
              >
                {savingPreferred ? "Saving…" : "Save"}
              </GhostButton>
            </div>
          </div>

          {/* Members list */}
          <div className="space-y-2">
            {cluster.members.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-gray-900">
                    {m.name || m.email}
                  </div>
                  <div className="truncate text-xs text-gray-600">{m.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={m.role === "primary" ? "emerald" : m.role === "co_applicant" ? "blue" : "indigo"}>
                    {m.role.replace("_", " ")}
                  </Badge>
                  <Badge tone={m.state === "active" ? "emerald" : m.state === "invited" ? "amber" : "rose"}>
                    {m.state}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>

		{/* Invites (outgoing) */}
		<Card
		  title="Household invites"
		  titleIcon={<UserPlus className="text-indigo-500" />}
		  tone={isConfigure ? "emphasis" : "neutral"}
		  right={
			isConfigure ? (
			  <span className="text-[11px] font-semibold uppercase tracking-wide text-rose-500">
				Start here
			  </span>
			) : null
		  }
		>
		  {/* Primary actions for invites live here now */}
<div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
  {/* Share Invite */}
  <PrimaryButton
    onClick={() => {
      setInviteOpen(true);
      fetchInvites();
    }}
    tone="gray"
    className="w-full justify-center"
  >
    <UserPlus className="mr-2 h-4 w-4" />
    Share Invite
  </PrimaryButton>

  {/* Join from invite with tooltip */}
  <span
    className={clsx(
      "relative group w-full",
      !hasIncomingInvites && "cursor-not-allowed"
    )}
  >
    <GhostButton
      onClick={() => {
        if (!hasIncomingInvites) return;
        setJoinFromInviteOpen(true);
      }}
      disabled={!hasIncomingInvites}
      className="w-full justify-center"
    >
      <Users className="mr-2 h-4 w-4" />
      Join from invite
    </GhostButton>

    {/* Tooltip */}
    {!hasIncomingInvites && (
      <div
        className={clsx(
          "pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2",
          "whitespace-nowrap rounded-md bg-gray-900 px-3 py-1 text-xs text-white shadow-lg",
          "opacity-0 group-hover:opacity-100 transition-opacity"
        )}
      >
        {incomingLoading
          ? "Checking for invites tied to this email…"
          : "No active invites found for this email,"}
      </div>
    )}
  </span>
  
</div>
<hr className="my-4 border-t border-gray-200" />
		  {/* Existing invites list */}
		  {invites.length === 0 ? (
			<p className="text-sm text-gray-600">
			  No active invites, create a new one to add members,
			</p>
		  ) : (
			<div className="space-y-2">
			  {invites.map((inv) => (
				<div
				  key={inv.id}
				  className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2"
				>
				  <div className="min-w-0">
					<div className="truncate text-sm font-medium text-gray-900">
					  {inv.email}
					</div>
					<div className="text-xs text-gray-600">
					  Role: {inv.role.replace("_", " ")},{" "}
					  Expires: {new Date(inv.expiresAt).toLocaleString()}
					</div>
				  </div>
				  <div className="flex items-center gap-2">
					<button
					  className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-100"
					  onClick={() => copy(inv.inviteUrlTemplate ?? "")}
					  title={
						inv.inviteUrlTemplate
						  ? "Copies a link template, create a fresh invite for a full link,"
						  : "Create a new invite to get a full link,"
					  }
					>
					  <CopyIcon className="mr-1 h-3.5 w-3.5" />
					  Copy link
					</button>
					<button
					  className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-100"
					  onClick={() => revokeInvite(inv.id)}
					>
					  <Trash2 className="mr-1 h-3.5 w-3.5" />
					  Revoke
					</button>
				  </div>
				</div>
			  ))}
			</div>
		  )}

		  <p className="mt-3 text-xs text-gray-500">
			New invites show the code instantly, active invites expire after 15 days,
		  </p>
		</Card>

        {/* Rename household */}
        <Card
          id="rename"
          title="Rename household"
		  tone={isConfigure ? "emphasis" : "neutral"}
          titleIcon={<ShieldCheck className="text-indigo-500" />}
		  right={
			isConfigure ? (
			  <span className="text-[11px] font-semibold uppercase tracking-wide text-rose-500">
				Start here
			  </span>
			) : null
		  }
        >
          <p className="mb-2 text-xs text-gray-600">
            Property managers and their teams will see this name alongside your applications and
            leases,
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="rename-card-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="A2 · Cambridge Flats"
            />
            <GhostButton
              onClick={saveHouseholdName}
              disabled={savingName || !newName.trim() || newName.trim() === (cluster.displayName ?? "")}
              title={!newName.trim() ? "Enter a name," : undefined}
            >
              {savingName ? "Saving…" : "Save"}
            </GhostButton>
          </div>
        </Card>

        {/* Leave household */}
        <Card
          title="Leave household"
          titleIcon={<ShieldCheck className="text-indigo-500" />}
          tone="neutral"
        >
          <p className="text-sm text-gray-600">
            You’ll be unlinked from this household cluster, if you join or create a new household
            later, that one will be used for your next application,
          </p>
          <div className="mt-3">
            <PrimaryButton
              onClick={leaveHousehold}
              disabled={!canLeave || leaving}
              tone="rose"
            >
              {leaving ? (
                "Leaving…"
              ) : (
                <>
                  <LogOut className="mr-2 h-4 w-4" /> Leave household
                </>
              )}
            </PrimaryButton>
            {!canLeave && (
              <p className="mt-2 text-xs text-gray-500">
                You can only leave if your household has more than one member,
              </p>
            )}
          </div>
        </Card>
      </section>

      {/* Invite modal (outgoing) */}
      <Modal open={inviteOpen} title="Share household invite" onClose={() => setInviteOpen(false)}>
        <div className="space-y-4">
          {/* Create new invite */}
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <div className="mb-2 text-xs font-semibold text-gray-700">Create a new invite</div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={newInviteEmail}
                onChange={(e) => setNewInviteEmail(e.target.value)}
                placeholder="name@example.com"
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <select
                value={newInviteRole}
                onChange={(e) => setNewInviteRole(e.target.value as MemberRole)}
                className="rounded-md border border-gray-300 bg-white px-2 py-2 text-sm"
              >
                <option value="co_applicant">co_applicant</option>
                <option value="primary">primary</option>
                <option value="cosigner">cosigner</option>
              </select>
              <PrimaryButton
                onClick={() => createInvite(newInviteEmail, newInviteRole)}
                disabled={creating || !newInviteEmail}
                tone="gray"
              >
                {creating ? "Creating…" : "Create"}
              </PrimaryButton>
            </div>

            {/* Freshly created code + URL */}
            {lastCreated && (
              <div className="mt-3 space-y-2">
                <div className="text-xs text-gray-600">
                  New invite, valid until {niceShortDate(lastCreated.expiresAt)},
                </div>

                <div className="flex gap-2">
                  <input
                    readOnly
                    value={lastCreated.inviteUrl}
                    className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                  <GhostButton onClick={() => copy(lastCreated.inviteUrl)}>
                    <CopyIcon className="mr-1 h-4 w-4" />
                    Copy
                  </GhostButton>
                </div>

                <div className="flex gap-2">
                  <input
                    readOnly
                    value={lastCreated.code}
                    className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                  <GhostButton onClick={() => copy(lastCreated.code)}>
                    <CopyIcon className="mr-1 h-4 w-4" />
                    Copy
                  </GhostButton>
                </div>
              </div>
            )}
          </div>

          {/* Active invites list */}
          <div>
            <div className="mb-2 text-xs font-semibold text-gray-700">Active invites</div>
            {invites.length === 0 ? (
              <div className="text-sm text-gray-600">No active invites,</div>
            ) : (
              <div className="space-y-2">
                {invites.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-gray-900">{inv.email}</div>
                      <div className="text-xs text-gray-600">
                        Role: {inv.role.replace("_", " ")},{" "}
                        Expires: {new Date(inv.expiresAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-100"
                        onClick={() => copy(inv.inviteUrlTemplate ?? "")}
                        title={
                          inv.inviteUrlTemplate
                            ? "Copies a link template, create a fresh invite for a full link,"
                            : "Create a new invite to get a full link,"
                        }
                      >
                        <CopyIcon className="mr-1 h-3.5 w-3.5" />
                        Copy link
                      </button>
                      <button
                        className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-100"
                        onClick={() => revokeInvite(inv.id)}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        Revoke
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-xs text-gray-500">
            New invites show the code instantly, active invites expire after 15 days,
          </p>
        </div>
      </Modal>

      {/* Join-with-code modal */}
      <Modal open={joinOpen} title="Join a household with a code" onClose={() => setJoinOpen(false)}>
        <div className="space-y-3">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="Enter invite code"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            disabled={!canJoin}
          />
          <div className="flex items-center justify-end gap-2">
            <GhostButton onClick={() => setJoinOpen(false)}>Cancel</GhostButton>
            <PrimaryButton
              onClick={async () => {
                setJoinOpen(false);
                await redeemInviteById(joinCode);
                setJoinCode("");
              }}
              disabled={busy || !joinCode || !canJoin}
              tone="indigo"
            >
              {busy ? "Joining…" : "Join"}
            </PrimaryButton>
          </div>
          {!canJoin && (
            <p className="text-xs text-gray-500">
              You can’t join another household with a code while yours has more than one member,
            </p>
          )}
        </div>
      </Modal>

      {/* Join-from-invite modal */}
      <Modal
        open={joinFromInviteOpen}
        title="Join a household from an invite"
        onClose={() => setJoinFromInviteOpen(false)}
      >
        <div className="space-y-3">
          {memberCount > 1 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <strong className="font-semibold">Heads up,</strong>{" "}
              you’re currently in a household with {memberCount} members,
              joining a different household will move you out of this one, and,
              your existing household members will no longer be linked to you in MILO,
            </div>
          )}

          {incomingLoading ? (
            <p className="text-sm text-gray-600">Looking for invites tied to your account…</p>
          ) : incomingInvites.length === 0 ? (
            <p className="text-sm text-gray-600">No active invites found for your email,</p>
          ) : (
            <div className="space-y-2">
              {incomingInvites.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-gray-900">
                      {inv.householdName || "Application household"}
                    </div>
                    <div className="text-xs text-gray-600">
                      Role: {inv.role.replace("_", " ")},{" "}
                      Invited by: {inv.inviterName || "someone"},{" "}
                      Expires: {new Date(inv.expiresAt).toLocaleString()}
                    </div>
                  </div>
                  <PrimaryButton
                    tone="indigo"
                    disabled={busy}
                    onClick={() => handleJoinFromInvite(inv.id)}
                  >
                    Join
                  </PrimaryButton>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-gray-500">
            Joining from an invite will switch your active household to the one you select,
          </p>
        </div>
      </Modal>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
	  </div>
    </main>
  );
}
