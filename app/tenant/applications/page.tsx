// app/tenant/applications/page.tsx
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth";
import ApplicationsRouter from "./ApplicationsRouter";
import { buildTenantHomeState } from "@/lib/tenant/homeViewState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TenantApplicationsPage() {
  const user = await getSessionUser();
  if (!user || user.role !== "tenant") {
    redirect("/login?next=/tenant/applications");
  }

  const state = await buildTenantHomeState({
    _id: user._id,
    email: user.email,
  });

  return (
    <Suspense fallback={<div className="text-sm text-gray-600">Loading…</div>}>
      <ApplicationsRouter
        user={{ email: user.email }}
        state={state}
      />
    </Suspense>
  );
}