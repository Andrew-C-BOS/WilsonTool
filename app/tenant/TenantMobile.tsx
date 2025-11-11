"use client";

import Link from "next/link";

type SessionUser = { email: string | null };

export default function TenantMobile({ user }: { user: SessionUser }) {
  return (
    <main className="px-4 py-5">
      <h1 className="text-xl font-semibold">Tenant home</h1>
      <p className="text-gray-600 mt-1">Signed in as {user.email ?? "—"}</p>

      {/* Mobile: single column, larger tap targets */}
      <div className="mt-5 space-y-3">
        <MobileCard href="/tenant/applications" title="Applications" desc="Start or review applications." />
        <MobileCard href="/tenant/payments" title="Payments" desc="Pay deposits, rent, receipts." />
        <MobileCard href="/tenant/documents" title="Documents" desc="Lease, files, downloads." />
        {/* <MobileCard href="/tenant/maintenance" title="Maintenance" desc="Submit, track requests." /> */}
      </div>
    </main>
  );
}

function MobileCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-gray-200 bg-white p-4 active:scale-[0.99] transition-transform"
    >
      <div className="text-base font-medium text-gray-900">{title}</div>
      <div className="text-sm text-gray-600 mt-0.5">{desc}</div>
    </Link>
  );
}
