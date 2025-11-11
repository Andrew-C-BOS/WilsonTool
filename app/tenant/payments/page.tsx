// app/tenant/payments/page.tsx
import { Suspense } from "react";
import PaymentsRouter from "./PaymentsRouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page(props: {
  searchParams?: { [k: string]: string | string[] | undefined };
}) {
  return (
    <Suspense fallback={<div className="px-4 text-sm text-gray-600">Loading…</div>}>
      <PaymentsRouter searchParams={props.searchParams ?? {}} />
    </Suspense>
  );
}
