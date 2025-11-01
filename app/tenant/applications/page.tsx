// app/tenant/applications/page.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth";
import ApplicationsClient from "./ApplicationsClient";

export default async function TenantApplicationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/tenant/applications");

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-5">
        <h1 className="text-xl font-semibold text-gray-900">Your applications</h1>
        <p className="text-sm text-gray-600 mt-1">
          Start a household, join with a code, track progress, chat when needed,
        </p>
      </div>

      <Suspense fallback={<div className="px-4 text-sm text-gray-600">Loading…</div>}>
        <ApplicationsClient />
      </Suspense>
    </div>
  );
}
