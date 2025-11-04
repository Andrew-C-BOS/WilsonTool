// app/tenant/household/HouseholdDesktop.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { HouseholdCluster, MemberRole } from "./HouseholdRouter";

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
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        map[tone]
      )}
    >
      {children}
    </span>
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
      <div className="fixed left-1/2 top-16 -translate-x-1/2 w-[92%] max-w-md rounded-xl bg-white shadow-xl ring-1 ring-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- types (local) ---------------- */
type ActiveInvite = {
  id: string;
  email: string;
  role: MemberRole;
  createdAt: string;
  expiresAt: string;
  // We don’t get code on GET, only on create
  inviteUrlTemplate?: string;
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

export default function HouseholdDesktop({ cluster }: { cluster: HouseholdCluster }) {
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // modals
  const [inviteOpen, setInviteOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  // rename
  const [newName, setNewName] = useState(cluster.displayName || "");

  // join
  const [joinCode, setJoinCode] = useState("");

  // invites
  const [invites, setInvites] = useState<ActiveInvite[]>([]);
  const [creating, setCreating] = useState(false);
  const [newInviteEmail, setNewInviteEmail] = useState("");
  const [newInviteRole, setNewInviteRole] = useState<MemberRole>("co_applicant");
  const [lastCreated, setLastCreated] = useState<CreatedInvite | null>(null); // show code after POST

  const primaryId = useMemo(
    () => cluster.members.find((m) => m.role === "primary")?.id,
    [cluster.members]
  );

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      flash("Copied,");
    } catch {
      flash(text);
    }
  }

  function roleTone(r: MemberRole) {
    return r === "primary" ? "emerald" : r === "co_applicant" ? "blue" : "violet";
  }

  /* ---------------- API helpers ---------------- */
  async function fetchInvites() {
    try {
      const res = await fetch("/api/tenant/household/invites?me=1", { cache: "no-store" });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "error");
      setInvites(json.invites as ActiveInvite[]);
    } catch (e) {
      // silent, but show minimal hint
      console.error("invite list error", e);
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
      // refresh list, shows the active row too
      fetchInvites();
      flash("Invite created,");
    } catch (e: any) {
      flash(`Invite failed, ${e.message || "error"},`);
    } finally {
      setCreating(false);
    }
  }

  async function revokeInvite(id: string) {
    // optimistic remove
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

  async function redeemInvite(code: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/tenant/household/invites/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "redeem_failed");

      // naive UX: show success, you can re-fetch cluster on parent to reflect the new member
      flash("Joined,");
      // optional: reload to reflect updated membership, if your parent loader won’t re-run automatically
      // location.reload();
    } catch (e: any) {
      const reason =
        e?.message === "wrong_email"
          ? "wrong email for this code,"
          : e?.message === "invalid_or_expired"
          ? "invalid or expired code,"
          : e?.message || "error,";
      flash(`Couldn’t join, ${reason}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // load active invites when opening the modal, or on mount
    fetchInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 pb-10">
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        {/* Header + quick actions */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-base font-semibold text-gray-900">Household cluster</div>
            <div className="text-xs text-gray-600 mt-0.5 truncate">
              {cluster.displayName || "Untitled household"}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setInviteOpen(true);
                // refresh in case another tab added one
                fetchInvites();
              }}
              className="rounded-md bg-gray-900 text-white text-sm font-medium px-3 py-2 hover:bg-black"
            >
              Share invite
            </button>
            <button
              onClick={() => setJoinOpen(true)}
              className="rounded-md border border-gray-300 bg-white text-sm font-medium px-3 py-2 hover:bg-gray-50"
            >
              Join with a code
            </button>
          </div>
        </div>

        {/* Members */}
        <div className="mt-5">
          <div className="text-xs uppercase tracking-wide text-gray-500">Members</div>
          <div className="mt-2 space-y-2">
            {cluster.members.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {m.name || m.email}
                  </div>
                  <div className="text-xs text-gray-600 truncate">{m.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={roleTone(m.role)}>{m.role.replace("_", " ")}</Badge>
                  <Badge
                    tone={m.state === "active" ? "emerald" : m.state === "invited" ? "amber" : "rose"}
                  >
                    {m.state}
                  </Badge>
                  {/* Role select (stub) */}
                  <select
                    defaultValue={m.role}
                    className="text-xs rounded-md border border-gray-300 bg-white px-2 py-1"
                    onChange={() => flash("Role updated,")}
                  >
                    <option value="primary">primary</option>
                    <option value="co_applicant">co_applicant</option>
                    <option value="cosigner">cosigner</option>
                  </select>
                  {/* Primary toggle (stub) */}
                  {m.id !== primaryId && (
                    <button
                      className="text-xs rounded-md border border-gray-300 bg-white px-2 py-1 hover:bg-gray-100"
                      onClick={() => flash("Set as primary,")}
                    >
                      Make primary
                    </button>
                  )}
                  {/* Remove (stub) */}
                  <button
                    className="text-xs rounded-md border border-gray-300 bg-white px-2 py-1 hover:bg-gray-100"
                    onClick={() => flash("Removed from household,")}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pending requests */}
        <div className="mt-5">
          <div className="text-xs uppercase tracking-wide text-gray-500">Pending requests</div>
          {cluster.pendingRequests.length === 0 ? (
            <div className="mt-2 text-sm text-gray-600">No pending requests,</div>
          ) : (
            <div className="mt-2 space-y-2">
              {cluster.pendingRequests.map((req) => (
                <div
                  key={req.id}
                  className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2"
                >
                  <div className="text-sm">
                    {req.email}{" "}
                    <span className="text-gray-500">· asked for {req.requestedRole.replace("_", " ")}</span>
                    <div className="text-xs text-gray-500">{req.at}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="text-xs rounded-md bg-gray-900 text-white px-2 py-1 hover:bg-black"
                      onClick={() => flash("Approved,")}
                    >
                      Approve
                    </button>
                    <button
                      className="text-xs rounded-md border border-gray-300 bg-white px-2 py-1 hover:bg-gray-100"
                      onClick={() => flash("Declined,")}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cluster settings (rename, leave) */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-sm font-medium text-gray-900">Rename household</div>
            <div className="mt-2 flex gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder="A2 · Cambridge Flats"
              />
              <button
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
                onClick={() => flash("Renamed,")}
              >
                Save
              </button>
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-sm font-medium text-gray-900">Leave household</div>
            <p className="text-xs text-gray-600 mt-1">You’ll be unlinked from this cluster,</p>
            <button
              className="mt-2 rounded-md bg-rose-600 text-white text-sm px-3 py-2 hover:bg-rose-700"
              onClick={() => flash("Left household,")}
            >
              Leave
            </button>
          </div>
        </div>
      </div>

      {/* Invite modal */}
      <Modal open={inviteOpen} title="Share household invite" onClose={() => setInviteOpen(false)}>
        <div className="space-y-4">
          {/* Create new invite */}
          <div className="rounded-md border border-gray-200 p-3">
            <div className="text-xs text-gray-600 mb-2">Create a new invite</div>
            <div className="flex gap-2">
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
              <button
                disabled={creating || !newInviteEmail}
                onClick={() => createInvite(newInviteEmail, newInviteRole)}
                className={clsx(
                  "rounded-md px-3 py-2 text-sm font-medium",
                  creating || !newInviteEmail
                    ? "bg-gray-200 text-gray-500"
                    : "bg-gray-900 text-white hover:bg-black"
                )}
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </div>

            {/* Show the freshly created invite’s code+URL once, so user can copy */}
            {lastCreated && (
              <div className="mt-3 space-y-2">
                <div className="text-xs text-gray-600">New invite, valid for 15 days,</div>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={lastCreated.inviteUrl}
                    className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                  <button
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={() => copy(lastCreated.inviteUrl)}
                  >
                    Copy
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={lastCreated.code}
                    className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                  <button
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={() => copy(lastCreated.code)}
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Active invites list */}
          <div>
            <div className="text-xs text-gray-600 mb-2">Active invites</div>
            {invites.length === 0 ? (
              <div className="text-sm text-gray-600">No active invites,</div>
            ) : (
              <div className="space-y-2">
                {invites.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {inv.email}
                      </div>
                      <div className="text-xs text-gray-600">
                        Role: {inv.role.replace("_", " ")},{" "}
                        Expires: {new Date(inv.expiresAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* You don’t have the code here; show a template link for clarity */}
                      <button
                        className="text-xs rounded-md border border-gray-300 bg-white px-2 py-1 hover:bg-gray-100"
                        onClick={() => copy(inv.inviteUrlTemplate?.replace("<code>", "…") || "")}
                      >
                        Copy link, template
                      </button>
                      <button
                        className="text-xs rounded-md border border-gray-300 bg-white px-2 py-1 hover:bg-gray-100"
                        onClick={() => revokeInvite(inv.id)}
                      >
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

      {/* Join modal */}
      <Modal open={joinOpen} title="Join a household with a code" onClose={() => setJoinOpen(false)}>
        <div className="space-y-3">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="Enter invite code"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setJoinOpen(false)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              disabled={busy || !joinCode}
              onClick={async () => {
                setJoinOpen(false);
                await redeemInvite(joinCode);
                setJoinCode("");
              }}
              className={clsx(
                "rounded-md px-3 py-2 text-sm font-medium text-white",
                busy || !joinCode ? "bg-gray-300" : "bg-blue-600 hover:bg-blue-700"
              )}
            >
              {busy ? "Joining…" : "Join"}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            We’ll link you into that cluster when the code is valid, and the email matches,
          </p>
        </div>
      </Modal>

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-gray-900 text-white text-sm px-4 py-2 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
