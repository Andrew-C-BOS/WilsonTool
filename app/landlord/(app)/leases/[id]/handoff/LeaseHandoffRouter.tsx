"use client";

import LeaseHandoffDesktop from "./LeaseHandoffDesktop";
// If you want a different mobile layout later, you can create LeaseHandoffMobile.tsx
// For now we'll reuse the desktop component.
const LeaseHandoffMobile = LeaseHandoffDesktop;

export default function LeaseHandoffRouter({
  appId,
  firmId,
}: {
  appId: string;
  firmId?: string;
}) {
  return (
    <div className="w-full">
      {/* Mobile */}
      <div className="block lg:hidden">
        <LeaseHandoffMobile appId={appId} firmId={firmId} />
      </div>
      {/* Desktop */}
      <div className="hidden lg:block">
        <LeaseHandoffDesktop appId={appId} firmId={firmId} />
      </div>
    </div>
  );
}
