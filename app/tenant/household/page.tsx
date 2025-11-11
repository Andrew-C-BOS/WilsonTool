// app/tenant/household/page.tsx
import { Suspense } from "react";
import HouseholdRouter from "./HouseholdRouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function HouseholdPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Suspense fallback={<div className="px-4 text-sm text-gray-600">Loading…</div>}>
        <HouseholdRouter />
      </Suspense>
    </div>
  );
}
