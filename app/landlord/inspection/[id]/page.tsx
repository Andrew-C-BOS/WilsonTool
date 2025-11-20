// app/landlord/inspection/[id]/page.tsx
import { Suspense } from "react";
import { notFound } from "next/navigation";
import LeaseInspectionClient from "./LeaseInspectionClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page({
  params,
}: {
  params: Promise<{ id?: string | string[] }>;
}) {
  // ⬇️ unwrap the promise before using .id
  const { id: raw } = await params;
  const leaseId = Array.isArray(raw) ? raw[0] : raw;

  if (!leaseId || leaseId === "undefined") {
    notFound();
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Suspense fallback={<div className="px-4 pt-6 text-sm text-gray-600">Loading inspection…</div>}>
        <LeaseInspectionClient leaseId={leaseId} />
      </Suspense>
    </div>
  );
}
