// app/landlord/inspection/InspectionDesktop.tsx
"use client";

export default function InspectionDesktop() {
  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6">
        <h2 className="text-base font-semibold text-amber-900">
          Use your phone for the Pre-Move Inspection,
        </h2>
        <p className="mt-2 text-sm text-amber-900/90">
          Open this page on your smartphone to take photos room-by-room, quickly, and clearly, as you walk the unit,
        </p>
      </div>
      <p className="mt-6 text-sm text-gray-600">
        Tip: you can also email your team a link to{" "}
        <code className="rounded bg-gray-100 px-1">/landlord/inspection</code>, and continue there,
      </p>
    </div>
  );
}
