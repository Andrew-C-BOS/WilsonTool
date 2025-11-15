import { Suspense } from "react";
import LeaseRouter from "./LeaseRouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function LeasePage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Suspense fallback={<div className="px-4 text-sm text-gray-600">Loading…</div>}>
        <LeaseRouter />
      </Suspense>
    </div>
  );
}
