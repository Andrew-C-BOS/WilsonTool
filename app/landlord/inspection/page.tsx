// app/landlord/inspection/page.tsx
import { Suspense } from "react";
import InspectionPicker from "./InspectionPicker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-md px-4 pt-4 pb-2">
        <h1 className="text-lg font-semibold text-gray-900">
          Pre-Move Inspections
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          See upcoming move-ins for your firm and pick a unit to inspect,
        </p>
      </div>
      <Suspense fallback={<div className="px-4 text-sm text-gray-600">Loading…</div>}>
        <InspectionPicker />
      </Suspense>
    </div>
  );
}
