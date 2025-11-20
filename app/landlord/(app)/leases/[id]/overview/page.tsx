// app/landlord/leases/[id]/overview/page.tsx
import { Suspense } from "react";
import { notFound } from "next/navigation";
import LeaseOverviewDesktop from "./LeaseOverviewDesktop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id?: string | string[] }>;
  searchParams?: Promise<{ firmId?: string }>;
}) {
  // Unwrap the promises
  const { id: raw } = await params;
  const sp = searchParams ? await searchParams : undefined;

  const leaseId = Array.isArray(raw) ? raw[0] : raw;
  if (!leaseId || leaseId === "undefined") {
    notFound();
  }

  const firmId = sp?.firmId;

  return (
    <Suspense fallback={<div className="px-6 py-8 text-sm text-gray-600">Loading lease…</div>}>
      <LeaseOverviewDesktop leaseId={leaseId} firmId={firmId} />
    </Suspense>
  );
}
