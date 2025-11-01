// app/tenant/apply/page.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import ApplyClient from "./ApplyClient";

export default function TenantApplyPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <ApplyClient />
    </div>
  );
}
