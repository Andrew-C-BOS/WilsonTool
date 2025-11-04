export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { Suspense } from "react";
import ReviewDesktop from "./ReviewDesktop";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string | string[] }>;
}) {
  // In Next.js (app router), `params` can be a Promise — unwrap it.
  const { id: raw } = await params;
  const id = Array.isArray(raw) ? raw[0] : raw;

  if (!id) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-[1400px] px-6 py-6">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
            Missing application id, please navigate from the Applications table again,
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold text-gray-900">Application review</h1>
          <p className="text-sm text-gray-600 mt-1">
            Review answers, check members, verify required documents, record decisions,
          </p>
        </div>

        <Suspense fallback={<div className="text-sm text-gray-500">Loading…</div>}>
          {/* key forces remount if the route param changes */}
          <ReviewDesktop appId={id} key={id} />
        </Suspense>
      </div>
    </div>
  );
}
