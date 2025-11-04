// app/tenant/household/page.tsx
import { Suspense } from "react";
import HouseholdRouter from "./HouseholdRouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function HouseholdPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-4 sm:py-5">
        <h1 className="text-lg sm:text-xl font-semibold text-gray-900">My household</h1>
        <p className="text-sm text-gray-600 mt-1">
          Link co-applicants, and cosigners, share one invite, keep everyone in one cluster,
        </p>
      </div>

      <Suspense fallback={<div className="px-4 text-sm text-gray-600">Loading…</div>}>
        <HouseholdRouter />
      </Suspense>
    </div>
  );
}
