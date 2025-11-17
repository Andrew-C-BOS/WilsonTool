// app/tenant/payments/result/page.tsx
import { Suspense } from "react";
import PaymentsResultClient from "./PaymentsResultClient";

export const dynamic = "force-dynamic";

// In Next 15, searchParams is a Promise passed to server components
type SearchParams = Promise<{
  [key: string]: string | string[] | undefined;
}>;

function pickOne(v?: string | string[]) {
  return Array.isArray(v) ? v[0] : v ?? "";
}

export default async function PaymentsResultPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // ⬅️ unwrap the Promise
  const resolved = await searchParams;
  const appId = pickOne(resolved.appId);
  const key = pickOne(resolved.key);

  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-md p-6 bg-white rounded-xl border border-gray-200">
          <h1 className="text-lg font-semibold mb-2">Payment result</h1>
          <p className="text-sm text-gray-600">Loading payment status…</p>
        </main>
      }
    >
	<main className="py-6">
      <PaymentsResultClient appId={appId} paymentKey={key} />
	  </main>
    </Suspense>
  );
}
