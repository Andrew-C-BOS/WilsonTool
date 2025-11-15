// app/admin/LandlordUserPanel.tsx
"use client";

import * as React from "react";

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

export default function LandlordUserPanel() {
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [msgTone, setMsgTone] = React.useState<"ok" | "err">("ok");

  const [form, setForm] = React.useState({
    email: "",
    password: "",
  });

  function toast(msg: string, tone: "ok" | "err" = "ok") {
    setMsgTone(tone);
    setMessage(msg);
    setTimeout(() => setMessage(null), 3500);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (!form.email || !form.password) {
        throw new Error("Email and password are required");
      }

      const payload = {
        email: form.email,
        password: form.password,
        role: "landlord" as const,
		loginAfterRegister: false
      };

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to create landlord user");
      }

      toast(`Created landlord user: ${form.email}`, "ok");

      setForm({
        email: "",
        password: "",
      });
    } catch (e: any) {
      toast(e.message ?? "Something went wrong", "err");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-5 md:p-6">
      <div className="mb-4">
        <h2 className="text-base md:text-lg font-semibold text-zinc-100">Create landlord user</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Enter an email and password to create a landlord account via the register API.
        </p>
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

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label>User email</Label>
            <Input
              type="email"
              required
              placeholder="landlord@company.com"
              value={form.email}
              onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
            />
          </div>
          <div>
            <Label>Password</Label>
            <Input
              type="password"
              required
              value={form.password}
              onChange={(e) => setForm((s) => ({ ...s, password: e.target.value }))}
            />
          </div>
        </div>

        <p className="text-xs text-zinc-500">
          This will call <code>/api/auth/register</code> with <code>role="landlord"</code>.
        </p>

        <div className="flex items-center gap-3">
          <Button disabled={loading} type="submit">
            {loading ? "Creating…" : "Create landlord"}
          </Button>
        </div>
      </form>
    </div>
  );
}
