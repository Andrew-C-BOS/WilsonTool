// app/tenant/household/HouseholdMobile.tsx
"use client";

import { useState } from "react";
import type { HouseholdCluster, MemberRole } from "./HouseholdRouter";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-medium text-gray-900">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}
function Chip({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-800 ring-1 ring-gray-200 px-2 py-0.5 text-[11px] font-medium">{children}</span>;
}
function roleTone(r: MemberRole) {
  return r === "primary" ? "primary" : r === "co_applicant" ? "co" : "sig";
}

export default function HouseholdMobile({ cluster }: { cluster: HouseholdCluster }) {
  const [toast, setToast] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [newName, setNewName] = useState(cluster.displayName || "");

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setToast("Copied,"); } catch { setToast(text); }
    setTimeout(() => setToast(null), 1800);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-10 space-y-3">
      <Section title="Household cluster">
        <div className="text-xs text-gray-600">{cluster.displayName || "Untitled household"}</div>
        <div className="mt-3 grid grid-cols-1 gap-2">
          <button onClick={() => setInviteOpen(true)} className="rounded-lg bg-gray-900 text-white text-sm font-medium px-4 py-3">Share invite</button>
          <button onClick={() => setJoinOpen(true)} className="rounded-lg border border-gray-300 bg-white text-sm font-medium px-4 py-3">Join with a code</button>
        </div>
      </Section>

      <Section title="Members">
        <ul className="space-y-2">
          {cluster.members.map((m) => (
            <li key={m.id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="text-sm font-medium text-gray-900">{m.name || m.email}</div>
              <div className="text-xs text-gray-600">{m.email}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                <Chip>{m.role.replace("_"," ")}</Chip>
                <Chip>{m.state}</Chip>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1">
                <button className="text-xs rounded-md border border-gray-300 bg-white px-2 py-1" onClick={() => setToast("Role updated (stub),")}>Role</button>
                <button className="text-xs rounded-md border border-gray-300 bg-white px-2 py-1" onClick={() => setToast("Set as primary (stub),")}>Primary</button>
                <button className="text-xs rounded-md border border-gray-300 bg-white px-2 py-1" onClick={() => setToast("Removed (stub),")}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Pending requests">
        {cluster.pendingRequests.length === 0 ? (
          <div className="text-sm text-gray-600">No pending requests,</div>
        ) : (
          <ul className="space-y-2">
            {cluster.pendingRequests.map((r) => (
              <li key={r.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                <div className="text-sm">{r.email} <span className="text-gray-500">· {r.requestedRole.replace("_"," ")}</span></div>
                <div className="text-xs text-gray-500">{r.at}</div>
                <div className="mt-2 grid grid-cols-2 gap-1">
                  <button className="text-xs rounded-md bg-gray-900 text-white px-2 py-1" onClick={() => setToast("Approved (stub),")}>Approve</button>
                  <button className="text-xs rounded-md border border-gray-300 bg-white px-2 py-1" onClick={() => setToast("Declined (stub),")}>Decline</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Household settings">
        <label className="text-xs text-gray-600">Name</label>
        <div className="mt-1 flex gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="A2 · Cambridge Flats" />
          <button className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" onClick={() => setToast("Renamed (stub),")}>Save</button>
        </div>
        <button className="mt-3 w-full rounded-md bg-rose-600 text-white text-sm px-3 py-2" onClick={() => setToast("Left household (stub),")}>Leave household</button>
      </Section>

      {/* Invite sheet (simple) */}
      {inviteOpen && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-sm font-medium text-gray-900">Share household invite</div>
          <div className="mt-2">
            <div className="text-xs text-gray-600 mb-1">Invite link</div>
            <div className="flex gap-2">
              <input readOnly value={cluster.inviteUrl} className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm" />
              <button className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" onClick={() => copy(cluster.inviteUrl)}>Copy</button>
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xs text-gray-600 mb-1">Invite code</div>
            <div className="flex gap-2">
              <input readOnly value={cluster.inviteCode} className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm" />
              <button className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" onClick={() => copy(cluster.inviteCode)}>Copy</button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="rounded-md bg-gray-900 text-white px-3 py-2 text-sm" onClick={() => setToast("Link shared (stub),")}>Share</button>
            <button className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" onClick={() => setInviteOpen(false)}>Close</button>
          </div>
        </div>
      )}

      {/* Join sheet (simple) */}
      {joinOpen && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-sm font-medium text-gray-900">Join a household</div>
          <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="Enter invite code" className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button className="rounded-md bg-blue-600 text-white px-3 py-2 text-sm" onClick={() => { setJoinOpen(false); setToast(`Joined with ${joinCode} (stub),`); }}>Join</button>
            <button className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" onClick={() => setJoinOpen(false)}>Cancel</button>
          </div>
          <p className="mt-1 text-xs text-gray-500">We’ll link you once wired up,</p>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-gray-900 text-white text-sm px-4 py-2 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
