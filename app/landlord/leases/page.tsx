// app/landlord/leases/page.tsx
import LeasesDesktop from "./LeasesDesktop";
import LeasesMobile from "./LeasesMobile";

export const dynamic = "force-dynamic";

export default function LeasesPage() {
  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 sm:px-6 pb-8">
      {/* Header */}
      <div className="mt-4 mb-2">
        <h1 className="text-base font-semibold text-gray-900">Leases</h1>
        <p className="text-xs text-gray-600">Assignments of households to units, with dates and signed status.</p>
      </div>

      {/* Desktop vs Mobile */}
      <div className="hidden md:block">
        <LeasesDesktop />
      </div>
      <div className="md:hidden">
        <LeasesMobile />
      </div>
    </main>
  );
}
