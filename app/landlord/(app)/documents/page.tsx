// app/landlord/documents/page.tsx
import { Suspense } from "react";
import DocumentsRouter from "./DocumentsRouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page({
  searchParams,
}: {
  searchParams?: { firmId?: string };
}) {
  const firmId = searchParams?.firmId;

  return (
    <Suspense
      fallback={
        <div className="px-6 py-8 text-sm text-gray-600">
          Loading documents…
        </div>
      }
    >
      <DocumentsRouter firmId={firmId} />
    </Suspense>
  );
}
