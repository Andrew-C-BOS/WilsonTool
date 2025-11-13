import { Suspense } from "react";
import PaymentsResultClient from "./PaymentsResultClient";

export const dynamic = "force-dynamic";

type SearchParams =
  | { [key: string]: string | string[] | undefined }
  | undefined;

function pickOne(v?: string | string[]) {
  return Array.isArray(v) ? v[0] : v ?? "";
}

export default function PaymentsResultPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const appId = pickOne(searchParams?.appId);
  const key = pickOne(searchParams?.key);

  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-md p-6 bg-white rounded-xl border border-gray-200">
          <h1 className="text-lg font-semibold mb-2">Payment result</h1>
          <p className="text-sm text-gray-600">Loading payment status…</p>
        </main>
      }
    >
      <PaymentsResultClient appId={appId} paymentKey={key} />
    </Suspense>
  );
}
