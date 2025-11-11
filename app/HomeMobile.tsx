// app/HomeMobile.tsx
import Link from "next/link";
import { useState, useEffect } from "react";

export default function HomeMobile() {
  // Pre-render stable year (avoid hydration mismatch)
  const [year] = useState(() => 2025);

  // Render video only after mount (prevents autoplay attr drift)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <main className="relative min-h-dvh overflow-hidden text-gray-900">
      {/* Background video rendered only on client to avoid hydration diff */}
      {mounted && (
        <div className="absolute inset-0 -z-20" suppressHydrationWarning>
          <video
            key="bg-video"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          >
            <source src="/hero.mp4" type="video/mp4" />
          </video>
        </div>
      )}

      {/* Slightly darker overlay for contrast */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-black/45" />

      <div className="relative mx-auto max-w-xl px-4">
        {/* Hero panel */}
<section className="mt-6 relative overflow-hidden rounded-2xl ring-1 ring-white/20 shadow-[0_16px_40px_-20px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
  <div
    className={[
      "relative isolate rounded-2xl border border-white/15",
      "bg-white/55 supports-[backdrop-filter:blur(0)]:bg-white/65",
      "backdrop-blur-2xl backdrop-saturate-150",
      "p-5 sm:p-6 transition-all duration-300",
      "hover:bg-white/20 hover:shadow-[0_18px_44px_-20px_rgba(0,0,0,0.6)]",
    ].join(" ")}
  >
    {/* subtle light gradients for the frosted effect */}
    <div className="pointer-events-none absolute inset-0 -z-10 rounded-2xl
                    bg-[radial-gradient(120%_80%_at_0%_0%,rgba(255,255,255,0.4),rgba(255,255,255,0)),
                        radial-gradient(120%_80%_at_100%_100%,rgba(255,255,255,0.18),rgba(255,255,255,0))]" />
    <div className="pointer-events-none absolute inset-0 -z-10 rounded-2xl ring-1 ring-inset ring-white/10" />
    <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px bg-white/60" />

    {/* --- your original content here --- */}
    <h1 className="text-3xl font-semibold leading-tight tracking-tight text-gray-900">
      Renting, made responsible
    </h1>
    <p className="mt-3 text-base leading-7 text-gray-700">
      MILO brings clarity, confidence, and compliance to Boston rentals, for tenants and landlords alike.
    </p>

    {/* CTAs */}
    <div className="mt-6 flex flex-col items-stretch gap-3 w-full max-w-xs mx-auto">
      <Link
        href="/register"
        className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-3 text-base font-semibold text-white shadow-md ring-1 ring-inset ring-blue-500/30 transition-all hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-lg active:translate-y-0"
      >
        Create account
      </Link>
      <Link
        href="/login"
        className="inline-flex items-center justify-center rounded-full border border-white/30 bg-white/10 px-5 py-3 text-base font-medium text-gray-800 backdrop-blur-md transition-all hover:bg-white/20 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
      >
        Log in
      </Link>
    </div>

    {/* Value props */}
    <div className="mt-8 grid gap-6 text-sm">
      <Fact
        label="Earn back time"
        text="One clean application, shared safely across listings. Less duplication, fewer errors, faster approvals."
      />
      <Fact
        label="Auditable by design"
        text="Every payment receipted, every signature tracked, every rule followed. Built for compliance, not chaos."
      />
      <Fact
        label="Built for Boston"
        text="Aligned with Massachusetts rental law, so deposits stay protected and disputes stay rare."
      />
    </div>
  </div>
</section>


        {/* Process flow */}
        <section className="mt-6 space-y-3 pb-2 text-center">
          {[
            "Applications, done once, done right",
            "Payments, receipted, reconciled, complete",
            "Leases, released, signed, stored",
            "Deposits, compliant, protected, auditable",
            "Tenants & landlords, aligned by design",
          ].map((s, i) => (
            <span
              key={i}
              className="block rounded-full border border-white/40 bg-white/10 px-3 py-2 text-sm text-white backdrop-blur"
            >
              {s}
            </span>
          ))}

          {/* Email badge placed directly after the last pill */}
          <div className="mt-3 flex justify-center">
            <a
              href="mailto:Andrew@MiloHomesBOS.com"
              aria-label="Email Andrew at Milo Homes"
              className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-sm font-medium text-gray-900 shadow-sm ring-1 ring-black/5 transition hover:shadow-md hover:ring-black/10"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
                <path d="m22 8-10 6L2 8" />
              </svg>
              Andrew@MiloHomesBOS.com
            </a>
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-8 mb-6 text-center text-xs text-white/80">
          <div>© {year} MILO, all rights reserved</div>
          <div className="mt-2 flex items-center justify-center gap-4">
            <a href="/login" className="hover:text-white">Log in</a>
            <a href="/register" className="hover:text-white">Create account</a>
          </div>
        </footer>
      </div>
    </main>
  );
}

/* — tiny presentational bits — */
function Fact({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="font-medium text-gray-900">{label}</div>
      <div className="mt-1 text-gray-700">{text}</div>
    </div>
  );
}
