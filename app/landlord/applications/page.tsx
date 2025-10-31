export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0; // explicitly opt out of SSG/ISR

import { Suspense } from "react";
import ApplicationsClient from "./ApplicationsClient";

export default function ApplicationsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold text-gray-900">Applications</h1>
          <p className="text-sm text-gray-600 mt-1">
            Forms are created by admins, submissions are grouped households, reviews are structured, approvals are gated,
          </p>
        </div>

        <Suspense fallback={<div className="text-sm text-gray-500">Loading…</div>}>
          <ApplicationsClient />
        </Suspense>
      </div>
    </div>
  );
}
