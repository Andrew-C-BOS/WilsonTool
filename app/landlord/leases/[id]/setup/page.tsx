// app/landlord/leases/[id]/setup/page.tsx
import { Suspense } from "react";
import LeaseSetupDesktop from "./LeaseSetupDesktop";
import LeaseSetupMobile from "./LeaseSetupMobile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  // Simple UA sniff — if you already have a device detector, swap this.
  const isMobile =
    typeof navigator !== "undefined" &&
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

  return (
    <Suspense fallback={<div className="p-4 text-sm text-gray-600">Loading…</div>}>
      {isMobile ? <LeaseSetupMobile /> : <LeaseSetupDesktop />}
    </Suspense>
  );
}
