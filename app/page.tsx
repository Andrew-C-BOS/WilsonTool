// app/page.tsx
import Link from "next/link";
import NavBar from "./components/NavBar";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50">
      <NavBar />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white to-gray-50" />
        <div className="relative mx-auto max-w-7xl px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
              Move‑ins, streamlined, secure, simple
            </h1>
            <p className="mt-4 text-lg leading-7 text-gray-600">
              Applications, payments, leases, in one clean flow, built for teams,
              designed for tenants, ready for scale.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-5 py-3 text-sm font-medium text-white shadow-sm hover:bg-blue-700 sm:w-auto"
              >
                Log in
              </Link>
              <Link
                href="/register"
                className="inline-flex w-full items-center justify-center rounded-md border border-gray-300 bg-white px-5 py-3 text-sm font-medium text-gray-900 hover:bg-gray-50 sm:w-auto"
              >
                Create account
              </Link>
            </div>

            <p className="mt-3 text-xs text-gray-500">
              Landlords, tenants, both welcome, one shared standard.
            </p>
          </div>
        </div>
      </section>

      {/* Value props */}
      <section className="mx-auto max-w-7xl px-6 pb-12 sm:pb-16">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Feature
            title="Fewer clicks"
            body="Fast reviews, clear tasks, consistent outcomes, less back‑and‑forth."
            icon={
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            }
          />
          <Feature
            title="Cleaner records"
            body="Payments, documents, signatures, tracked, auditable, exportable."
            icon={
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                <path d="M8 7h8M8 12h8M8 17h5M4 5h16v14H4z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            }
          />
          <Feature
            title="Role‑aware"
            body="Landlords see workflows, tenants see steps, everyone moves forward."
            icon={
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                <path d="M12 12a5 5 0 100-10 5 5 0 000 10zm-7 9a7 7 0 0114 0H5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            }
          />
        </div>
      </section>

      {/* Dual cards */}
      <section className="mx-auto max-w-7xl px-6 pb-16">
        <div className="grid gap-6 md:grid-cols-2">
          <Card
            eyebrow="For landlords"
            title="A single, confident pipeline"
            body="Review applications, request payments, release leases, track every decision, keep your ledger clean."
            ctaLabel="Go to landlord portal"
            ctaHref="/landlord"
          />
          <Card
            eyebrow="For tenants"
            title="Clear steps, no guesswork"
            body="Submit once, pay securely, sign fast, receive receipts, move in with clarity."
            ctaLabel="Go to tenant portal"
            ctaHref="/tenant"
          />
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div className="rounded-xl border border-gray-200 bg-white p-6 md:p-8">
          <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Ready to modernize move‑ins, today
              </h2>
              <p className="mt-1 text-gray-600">
                Create an account, invite your team, start with one unit, scale when ready.
              </p>
            </div>
            <div className="flex gap-3">
              <Link
                href="/register"
                className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Create account
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
              >
                Log in
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 py-6 text-sm text-gray-500 md:flex-row">
          <div>© {new Date().getFullYear()} MILO, all rights reserved</div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="hover:text-gray-700">Log in</Link>
            <Link href="/register" className="hover:text-gray-700">Create account</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

/* ---------- small, local components ---------- */

function Feature({
  title,
  body,
  icon,
}: {
  title: string;
  body: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="mt-0.5 text-blue-600">{icon}</div>
      <div>
        <div className="font-medium text-gray-900">{title}</div>
        <div className="text-sm text-gray-600">{body}</div>
      </div>
    </div>
  );
}

function Card({
  eyebrow,
  title,
  body,
  ctaLabel,
  ctaHref,
}: {
  eyebrow: string;
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="text-xs font-medium uppercase tracking-wide text-blue-600">
        {eyebrow}
      </div>
      <h3 className="mt-2 text-lg font-semibold text-gray-900">{title}</h3>
      <p className="mt-2 text-gray-600">{body}</p>
      <div className="mt-4">
        <Link
          href={ctaHref}
          className="inline-flex items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
        >
          {ctaLabel}
        </Link>
      </div>
    </div>
  );
}
