// app/tenant/apply/page.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { Suspense } from "react";
import ApplyClient from "./ApplyClient";

export default function TenantApplyPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Suspense fallback={<div className="p-4 text-sm text-gray-600">Loading…</div>}>
        <ApplyClient />
      </Suspense>
    </div>
  );
}
