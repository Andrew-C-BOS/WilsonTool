export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { Suspense } from "react";
import ReviewDesktop from "./ReviewDesktop";

export default function ReviewPage({ params }: { params: { id: string | string[] } }) {
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id;

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
