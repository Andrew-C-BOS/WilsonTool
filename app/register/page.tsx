"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const LOGIN_HERO_URL =
  "https://mini-milo-bucket.s3.us-east-2.amazonaws.com/Public/LoginHero.jpg";

type Mode = "signin" | "signup";

export default function AuthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialMode =
    (searchParams.get("mode") as Mode) === "signin" ? "signin" : "signup";

  const [mode, setMode] = useState<Mode>(initialMode);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Keep in sync if URL changes (client nav)
  useEffect(() => {
    const qp = searchParams.get("mode") as Mode | null;
    if (qp === "signin" || qp === "signup") setMode(qp);
  }, [searchParams]);

  // Tenant-only self-serve; landlords are admin-only.
  const role = "tenant" as const;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);

    try {
      if (mode === "signup") {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName, email, password, role }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setErr(data.error || "Registration failed");
        } else {
          router.push("/tenant");
          router.refresh();
        }
      } else {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setErr(data.error || "Sign in failed");
		  } else {
			const res = await fetch("/api/auth/login", {
			  method: "POST",
			  headers: { "Content-Type": "application/json" },
			  body: JSON.stringify({ email, password }),
			});
			const data = await res.json();

			if (!res.ok || !data.ok) {
			  setErr(data.error || "Sign in failed");
			} else {
			  const user = data.user;
			  const role = (user?.role ?? "tenant") as "tenant" | "landlord" | "admin";

			  let redirect = "/tenant";

			  if (role === "landlord") {
				redirect = "/landlord";
			  } else if (role === "admin") {
				// change this if you want admins to land somewhere else
				redirect = "/admin";
			  }

			  router.push(redirect);
			  router.refresh();
			}
		  }
      }
    } catch (e: any) {
      setErr(
        e.message ||
          (mode === "signup" ? "Registration failed" : "Sign in failed"),
      );
    } finally {
      setBusy(false);
    }
  }

  const isSignup = mode === "signup";

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Background image + overlays */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <img
          src={LOGIN_HERO_URL}
          alt="Boston brownstones along a tree-lined street"
          className="h-full w-full object-cover object-right"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/45 to-slate-950/0" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent,rgba(15,23,42,0.4))]" />
      </div>

      {/* Content frame */}
      <div className="relative z-10 flex min-h-screen items-center px-4 py-8 sm:px-6 lg:px-10">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {/* Auth card */}
          <section className="w-full max-w-md rounded-3xl border border-slate-200/80 bg-white/95 px-6 py-7 text-slate-900 shadow-2xl backdrop-blur-2xl sm:px-8 sm:py-9">
            {/* Tabs */}
            <div className="mb-6 flex items-center gap-6 text-sm">
              <button
                type="button"
                onClick={() => router.push("/register?mode=signin")}
                className={`pb-2 transition ${
                  mode === "signin"
                    ? "border-b-2 border-blue-600 font-semibold text-slate-900"
                    : "border-b-2 border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900"
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => router.push("/register?mode=signup")}
                className={`pb-2 transition ${
                  mode === "signup"
                    ? "border-b-2 border-blue-600 font-semibold text-slate-900"
                    : "border-b-2 border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900"
                }`}
              >
                Sign up
              </button>
            </div>

            <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.6rem]">
              {isSignup ? "Create your MILO account" : "Welcome back to MILO"}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {isSignup
                ? "One secure profile for Boston rentals — applications, payments, and leases, all in one place."
                : "Sign in to manage your applications, payments, and leases in one place."}
            </p>

            {err && (
              <div className="mt-4 rounded-2xl border border-red-300 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                {err}
              </div>
            )}

            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              {isSignup && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-900">
                    Full name
                  </label>
                  <input
                    type="text"
                    required
                    autoComplete="name"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="First and last name"
                  />
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-900">
                  Email
                </label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-900">
                  Password
                </label>
                <input
                  type="password"
                  required
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isSignup ? "At least 8 characters" : "Your password"}
                />
                {isSignup && (
                  <p className="mt-1 text-xs text-slate-500">
                    Use at least 8 characters, with a mix of letters and
                    numbers.
                  </p>
                )}
              </div>

              {isSignup && (
                <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3.5 py-2 text-xs text-blue-900">
                  You’re creating a <span className="font-semibold">tenant</span>{" "}
                  account. Landlords are onboarded directly by the MILO team.
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="mt-4 flex w-full items-center justify-center rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md ring-1 ring-blue-400/60 transition hover:-translate-y-0.5 hover:bg-blue-500 hover:shadow-lg active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy
                  ? isSignup
                    ? "Creating your account…"
                    : "Signing you in…"
                  : isSignup
                  ? "Create account"
                  : "Sign in"}
              </button>
            </form>

            <div className="mt-6 flex flex-col gap-2 text-xs text-slate-600">
              {isSignup ? (
                <p>
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => router.push("/register?mode=signin")}
                    className="font-medium text-blue-700 hover:underline"
                  >
                    Sign in instead
                  </button>
                  .
                </p>
              ) : (
                <p>
                  New to MILO?{" "}
                  <button
                    type="button"
                    onClick={() => router.push("/register?mode=signup")}
                    className="font-medium text-blue-700 hover:underline"
                  >
                    Create an account
                  </button>
                  .
                </p>
              )}
              <p>
                Are you a landlord?{" "}
                <a
                  href="mailto:Andrew@MiloHomesBOS.com?subject=Landlord%20Onboarding"
                  className="font-medium text-blue-700 hover:underline"
                >
                  Email Andrew to get onboarded
                </a>{" "}
                and we’ll set up your firm from the admin console.
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
