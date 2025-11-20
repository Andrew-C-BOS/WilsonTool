// app/admin/AdminPanel.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/* ---------------- Types ---------------- */
type Firm = {
  _id: string;
  name: string;
  slug: string;
  website?: string;
  contactEmail?: string;
  address?: { line1?: string; line2?: string; city?: string; state?: string; zip?: string; country?: string };
  logo?: { url: string };
  createdAt: string;
};

type Member = {
  _id: string;
  firmId: string;
  userId: string;
  role: "owner" | "admin" | "member";
  title?: string;
  department?: string;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
  userEmail?: string; // hydrated for convenience
};

/* ---------------- Small UI helpers ---------------- */
function SectionCard(
  props: React.PropsWithChildren<{ title: string; subtitle?: string; right?: React.ReactNode }>
) {
  return (
    <section className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-5 md:p-6">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base md:text-lg font-semibold text-zinc-100">{props.title}</h2>
          {props.subtitle ? <p className="mt-1 text-sm text-zinc-400">{props.subtitle}</p> : null}
        </div>
        {props.right}
      </div>
      {props.children}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-xs font-semibold tracking-wide text-zinc-200">{children}</div>;
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={
        "w-full rounded-lg border border-zinc-700/80 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 " +
        "focus:outline-none focus:ring-2 focus:ring-pink-400/70 focus:border-pink-500/60 " +
        (props.className ?? "")
      }
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={
        "w-full rounded-lg border border-zinc-700/80 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100 " +
        "focus:outline-none focus:ring-2 focus:ring-pink-400/70 focus:border-pink-500/60 " +
        (props.className ?? "")
      }
    />
  );
}

function Button({
  children,
  tone = "primary",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "danger" | "ghost" }) {
  const base =
    "inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-semibold tracking-wide " +
    "focus:outline-none transition ring-1";
  const styles =
    tone === "primary"
      ? "bg-pink-500 !text-white ring-pink-300/70 hover:bg-pink-400 active:bg-pink-300"
      : tone === "danger"
      ? "bg-red-500 !text-white ring-red-300/70 hover:bg-red-400 active:bg-red-300"
      : "bg-zinc-800/80 !text-white ring-zinc-600/70 hover:bg-zinc-700 active:bg-zinc-600";
  const disabled = "disabled:opacity-70 disabled:saturate-75 disabled:cursor-not-allowed";
  return (
    <button {...rest} className={`${base} ${styles} ${disabled} ${rest.className ?? ""}`}>
      <span className="leading-none text-current">{children}</span>
    </button>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-block rounded-md bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">{children}</span>;
}

/* ---------------- Component ---------------- */
export default function AdminPanel() {
  const router = useRouter();

  const [firms, setFirms] = React.useState<Firm[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [msgTone, setMsgTone] = React.useState<"ok" | "err">("ok");

  const [createForm, setCreateForm] = React.useState({
    name: "",
    slug: "",
    website: "",
    contactEmail: "",
    addressLine1: "",
    city: "",
    state: "",
    zip: "",
    country: "",
    logoUrl: "",
  });

  const [assignForm, setAssignForm] = React.useState({
    firmId: "",
    userEmail: "",
    role: "member" as "owner" | "admin" | "member",
    title: "",
    department: "",
  });

  const [members, setMembers] = React.useState<Member[]>([]);

  React.useEffect(() => {
    refreshFirms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------- Auth -------------- */
  async function handleLogout() {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error("Failed to log out");
      router.replace("/login"); // or "/"
      router.refresh();
    } catch (e) {
      console.error(e);
      toast("Logout failed", "err");
    }
  }

  /* -------------- Server calls -------------- */
  async function refreshFirms() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/firms", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load firms");
      setFirms(data.firms);
      if (data.firms.length && !assignForm.firmId) {
        const first = data.firms[0]._id;
        setAssignForm((s) => ({ ...s, firmId: first }));
        await refreshMembers(first);
      }
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setLoading(false);
    }
  }

  async function refreshMembers(firmId: string) {
    const res = await fetch(`/api/admin/firm-memberships?firmId=${encodeURIComponent(firmId)}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Failed to load members");
    setMembers(data.members);
  }

  /* -------------- Handlers -------------- */
  function slugify(s: string) {
    return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  }

  function toast(msg: string, tone: "ok" | "err" = "ok") {
    setMsgTone(tone);
    setMessage(msg);
    setTimeout(() => setMessage(null), 3500);
  }

  async function handleCreateFirm(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        name: createForm.name,
        slug: createForm.slug || slugify(createForm.name),
        website: createForm.website || undefined,
        contactEmail: createForm.contactEmail || undefined,
        address: {
          line1: createForm.addressLine1 || undefined,
          city: createForm.city || undefined,
          state: createForm.state || undefined,
          zip: createForm.zip || undefined,
          country: createForm.country || undefined,
        },
        logo: createForm.logoUrl ? { url: createForm.logoUrl } : undefined,
      };
      const res = await fetch("/api/admin/firms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to create firm");
      toast(`Created firm: ${data.firm?.name}`, "ok");
      setCreateForm({
        name: "",
        slug: "",
        website: "",
        contactEmail: "",
        addressLine1: "",
        city: "",
        state: "",
        zip: "",
        country: "",
        logoUrl: "",
      });
      await refreshFirms();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteFirm(id: string) {
    if (!confirm("Delete this firm? This cannot be undone.")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/firms/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to delete firm");
      toast("Firm deleted", "ok");
      if (assignForm.firmId === id) {
        setMembers([]);
        setAssignForm((s) => ({ ...s, firmId: "" }));
      }
      await refreshFirms();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setLoading(false);
    }
  }

  async function handleAssignUser(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        firmId: assignForm.firmId,
        userEmail: assignForm.userEmail,
        role: assignForm.role,
        title: assignForm.title || undefined,
        department: assignForm.department || undefined,
      };
      const res = await fetch("/api/admin/firm-memberships", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to assign user");
      toast(`Assigned ${data.member?.userEmail || assignForm.userEmail}`, "ok");
      setAssignForm((s) => ({ ...s, userEmail: "" }));
      await refreshMembers(assignForm.firmId);
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveMember(firmId: string, userId: string) {
    if (!confirm("Remove this user from the firm?")) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/firm-memberships?firmId=${encodeURIComponent(firmId)}&userId=${encodeURIComponent(userId)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to remove member");
      toast("Member removed", "ok");
      await refreshMembers(firmId);
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setLoading(false);
    }
  }

  /* -------------- UI -------------- */
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:py-10">
      {/* Header + Logout */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-zinc-100">Admin</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Create and destroy firms, assign users to firms, all in one place.
          </p>
        </div>
        <Button tone="ghost" onClick={handleLogout}>
          Log out
        </Button>
      </div>

      {message && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            msgTone === "ok"
              ? "border-pink-700/40 bg-pink-900/30 text-pink-200"
              : "border-red-700/40 bg-red-900/30 text-red-200"
          }`}
          role="status"
        >
          {message}
        </div>
      )}

      {/* Create firm */}
      <SectionCard title="Create a firm">
        <form onSubmit={handleCreateFirm} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label>Name</Label>
              <Input
                required
                value={createForm.name}
                onChange={(e) =>
                  setCreateForm((s) => ({
                    ...s,
                    name: e.target.value,
                    slug: s.slug ? s.slug : slugify(e.target.value),
                  }))
                }
              />
            </div>
            <div>
              <Label>Slug</Label>
              <Input
                required
                value={createForm.slug}
                placeholder="xyz-co"
                onChange={(e) => setCreateForm((s) => ({ ...s, slug: e.target.value }))}
              />
            </div>
            <div>
              <Label>Website</Label>
              <Input value={createForm.website} onChange={(e) => setCreateForm((s) => ({ ...s, website: e.target.value }))} />
            </div>
            <div>
              <Label>Contact email</Label>
              <Input
                type="email"
                value={createForm.contactEmail}
                onChange={(e) => setCreateForm((s) => ({ ...s, contactEmail: e.target.value }))}
              />
            </div>
            <div className="md:col-span-2">
              <Label>Address line 1</Label>
              <Input
                value={createForm.addressLine1}
                onChange={(e) => setCreateForm((s) => ({ ...s, addressLine1: e.target.value }))}
              />
            </div>
            <div>
              <Label>City</Label>
              <Input value={createForm.city} onChange={(e) => setCreateForm((s) => ({ ...s, city: e.target.value }))} />
            </div>
            <div>
              <Label>State</Label>
              <Input value={createForm.state} onChange={(e) => setCreateForm((s) => ({ ...s, state: e.target.value }))} />
            </div>
            <div>
              <Label>ZIP</Label>
              <Input value={createForm.zip} onChange={(e) => setCreateForm((s) => ({ ...s, zip: e.target.value }))} />
            </div>
            <div>
              <Label>Country</Label>
              <Input value={createForm.country} onChange={(e) => setCreateForm((s) => ({ ...s, country: e.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <Label>Logo URL</Label>
              <Input value={createForm.logoUrl} onChange={(e) => setCreateForm((s) => ({ ...s, logoUrl: e.target.value }))} />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button disabled={loading} type="submit">
              {loading ? "Saving…" : "Create firm"}
            </Button>
          </div>
        </form>
      </SectionCard>

      {/* Firms list */}
      <div className="h-4" />
      <SectionCard title="Firms">
        {firms.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 p-4 text-sm text-zinc-400">No firms yet</div>
        ) : (
          <ul className="divide-y divide-zinc-800/80 rounded-lg border border-zinc-800">
            {firms.map((f) => (
              <li key={f._id} className="flex flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="truncate text-zinc-100">
                    <span className="font-medium">{f.name}</span>{" "}
                    <span className="text-zinc-400">({f.slug})</span>
                    {f.website ? (
                      <span className="text-zinc-400">
                        ,{" "}
                        <a className="underline hover:text-zinc-200" href={f.website} target="_blank" rel="noreferrer">
                          {f.website}
                        </a>
                      </span>
                    ) : null}
                  </div>
                  {f.contactEmail ? <div className="truncate text-xs text-zinc-500">{f.contactEmail}</div> : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    tone="ghost"
                    onClick={() => {
                      setAssignForm((s) => ({ ...s, firmId: f._id }));
                      refreshMembers(f._id);
                    }}
                  >
                    View members
                  </Button>
                  <Button tone="danger" onClick={() => handleDeleteFirm(f._id)}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Assign user */}
      <div className="h-4" />
      <SectionCard title="Assign user to firm">
        <form onSubmit={handleAssignUser} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <Label>Firm</Label>
              <Select value={assignForm.firmId} onChange={(e) => setAssignForm((s) => ({ ...s, firmId: e.target.value }))}>
                {firms.map((f) => (
                  <option key={f._id} value={f._id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>User email</Label>
              <Input
                type="email"
                required
                placeholder="user@company.com"
                value={assignForm.userEmail}
                onChange={(e) => setAssignForm((s) => ({ ...s, userEmail: e.target.value }))}
              />
            </div>
            <div>
              <Label>Role</Label>
              <Select value={assignForm.role} onChange={(e) => setAssignForm((s) => ({ ...s, role: e.target.value as any }))}>
                <option value="member">member</option>
                <option value="admin">admin</option>
                <option value="owner">owner</option>
				<option value="inspector">inspector</option>
              </Select>
            </div>
            <div>
              <Label>Title</Label>
              <Input value={assignForm.title} onChange={(e) => setAssignForm((s) => ({ ...s, title: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label>Department</Label>
              <Input value={assignForm.department} onChange={(e) => setAssignForm((s) => ({ ...s, department: e.target.value }))} />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button disabled={loading || !assignForm.firmId} type="submit">
              {loading ? "Assigning…" : "Assign"}
            </Button>
          </div>
        </form>

        {/* Members of selected firm */}
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold text-zinc-200">Members</h3>
          {!assignForm.firmId ? (
            <div className="rounded-lg border border-zinc-800 p-4 text-sm text-zinc-400">Select a firm to view members</div>
          ) : members.length ? (
            <ul className="divide-y divide-zinc-800/80 rounded-lg border border-zinc-800">
              {members.map((m) => (
                <li key={m._id} className="flex flex-col gap-2 p-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-zinc-100">
                      <span className="font-medium">{m.userEmail ?? m.userId}</span> <Badge>{m.role}</Badge>
                      {m.title ? <span className="text-zinc-400">, {m.title}</span> : null}
                    </div>
                    {m.department ? <div className="truncate text-xs text-zinc-500">{m.department}</div> : null}
                  </div>
                  <Button tone="danger" onClick={() => handleRemoveMember(m.firmId, m.userId)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg border border-zinc-800 p-4 text-sm text-zinc-400">No members yet</div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
