// app/page.tsx
import Link from "next/link";

const PUBLIC_HERO_VIDEO_URL= "https://mini-milo-bucket.s3.amazonaws.com/Public/hero.mp4"

export default function Home() {
  // Compute once on the server; avoids any client-time drift.
  const year = new Date().getUTCFullYear();

  return (
    <main className="relative min-h-dvh overflow-hidden text-gray-900">
      {/* Background video (hydrate-safe) */}
      <div
        // If the <video> DOM mutates during mount (autoplay, source selection),
        // React won’t try to “fix” it and throw.
        suppressHydrationWarning
        className="absolute inset-0 -z-20"
      >
        <video
          key="bg-video"                 // stable identity across renders
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          className="h-full w-full object-cover"
        >
          <source src={PUBLIC_HERO_VIDEO_URL} type="video/mp4" />
        </video>
      </div>

      {/* Subtle dark overlay for contrast */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-black/35" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        {/* Tall hero frame with only an outline */}
        <section className="mt-8 sm:mt-12 min-h-[80vh] rounded-[28px] ring-1 ring-white/40 shadow-2xl">
          {/* Two-column canvas with no fills; everything inside floats */}
          <div className="grid min-h-[80vh] grid-cols-1 items-start gap-0 sm:grid-cols-2">
            {/* LEFT: floating glass copy panel (hugs top-left) */}
            <div className="relative flex justify-start h-full">
              <div className="max-w-xl rounded-2xl border border-white/30 bg-white/70 p-8 backdrop-blur-xl shadow-lg sm:p-10">
                {/* tiny badges (optional) */}


                <h1 className="text-4xl font-semibold leading-tight tracking-tight text-gray-900 sm:text-5xl">
                  Renting, made responsible
                </h1>
                <p className="mt-4 text-lg leading-7 text-gray-700">
                  MILO brings clarity, confidence, and compliance to Boston rentals — for tenants and landlords alike
                </p>

<div className="mt-10 flex flex-col items-stretch gap-4 sm:items-center sm:w-full max-w-xs mx-auto">
<Link
  href={{ pathname: "/register", query: { mode: "signup" } }}
  className="min-w-[250px] inline-flex items-center justify-center rounded-full bg-blue-600 px-6 py-3 text-base font-semibold text-white shadow-md ring-1 ring-inset ring-blue-500/30 transition-all hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-lg active:translate-y-0"
>
  Create account
</Link>

<Link
  href={{ pathname: "/register", query: { mode: "signin" } }}
  className="min-w-[250px] inline-flex items-center justify-center rounded-full border border-white/30 bg-white/10 px-6 py-3 text-base font-medium text-gray-700 backdrop-blur-md transition-all hover:bg-white/20 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
>
  Log in
</Link>
</div>

                <div className="mt-10 grid gap-8 text-sm sm:grid-cols-1">
                  <Fact
                    label="Earn back time"
                    text="One clean application — shared safely across listings. Less duplication, fewer errors, faster approvals"
                  />
                  <Fact
                    label="Auditable by design"
                    text="Every payment receipted, every signature tracked, every rule followed. Built for compliance — not chaos"
                  />
				  <Fact
                    label="Built for Boston"
                    text="Fully aligned with Massachusetts rental law — so deposits stay protected and disputes stay rare"
                  />
                </div>
                <div className="mt-4 flex justify-center sm:justify-center">
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
              </div>

            </div>

            {/* RIGHT: vertical stack of frosted pills aligned to the edge */}
            <div className="relative flex h-full flex-col items-center justify-center gap-10">
              <span className="rounded-full border border-white/40 bg-white/10 px-3 py-2 text-sm text-white backdrop-blur">
                Applications, done once, done right
              </span>
              <span className="rounded-full border border-white/40 bg-white/10 px-3 py-2 text-sm text-white backdrop-blur">
                Payments, receipted, reconciled, complete
              </span>
              <span className="rounded-full border border-white/40 bg-white/10 px-3 py-2 text-sm text-white backdrop-blur">
                Leases, released, signed, stored
              </span>
			  <span className="rounded-full border border-white/40 bg-white/10 px-3 py-2 text-sm text-white backdrop-blur">
                Deposits, compliant, protected, auditable
              </span>
              <span className="rounded-full border border-white/40 bg-white/10 px-3 py-2 text-sm text-white backdrop-blur">
                Tenants & landlords, aligned by design
              </span>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-10 mb-8 flex items-center justify-between text-xs text-white/80">
          <div>© {year} MILO, all rights reserved</div>
          <div className="flex items-center gap-4">
            <a href="/login" className="hover:text-white">Log in</a>
            <a href="/register" className="hover:text-white">Create account</a>
          </div>
        </footer>
      </div>
    </main>
  );
}

/* — tiny presentational bits — */
function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/30 bg-white/85 px-3 py-1 text-xs font-medium text-gray-900 backdrop-blur">
      {children}
      <svg className="ml-2 h-3 w-3" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}
function Fact({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="font-medium text-gray-900">{label}</div>
      <div className="mt-1 text-gray-700">{text}</div>
    </div>
  );
}

