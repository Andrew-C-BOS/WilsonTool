// app/tenant/household/page.tsx
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { buildTenantHomeState } from "@/lib/tenant/homeViewState";
import HouseholdRouter from "./HouseholdRouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HouseholdPage() {
  const user = await getSessionUser();

  // Same rule as tenant homepage + applications page
  if (!user || user.role !== "tenant") {
    redirect("/login?next=/tenant/household");
  }

  const state = await buildTenantHomeState({
    _id: user._id,
    email: user.email,
  });

  return (
    <div className="min-h-screen bg-gray-50 mx-0">
      <Suspense fallback={<div className="px-4 text-sm text-gray-600">Loading…</div>}>
        <HouseholdRouter
          user={{ email: user.email }}
          state={state}
        />
      </Suspense>
    </div>
  );
}
