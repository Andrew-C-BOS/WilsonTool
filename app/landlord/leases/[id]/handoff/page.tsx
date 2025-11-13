// app/landlord/leases/[id]/handoff/page.tsx
import { Suspense } from "react";
import { notFound } from "next/navigation";
import LeaseHandoffRouter from "./LeaseHandoffRouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { id?: string | string[] };
type SearchParams = { [key: string]: string | string[] | undefined };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  // Unwrap the promises
  const resolvedParams = await params;
  const resolvedSearch = await searchParams;

  const rawId = Array.isArray(resolvedParams.id)
    ? resolvedParams.id[0]
    : resolvedParams.id;

  if (!rawId || rawId === "undefined") {
    notFound();
  }

  // Handle firmId from search params (may be string or array or undefined)
  const spFirm = resolvedSearch?.["firmId"];
  const firmId =
    typeof spFirm === "string" ? spFirm : Array.isArray(spFirm) ? spFirm[0] : undefined;

  return (
    <main className="mx-auto w-full max-w-4xl">
      <Suspense fallback={<div className="px-6 py-8 text-sm text-gray-600">Loading…</div>}>
        <LeaseHandoffRouter appId={rawId} firmId={firmId} />
      </Suspense>
    </main>
  );
}
