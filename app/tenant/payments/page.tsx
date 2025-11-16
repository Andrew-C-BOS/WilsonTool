// app/tenant/payments/page.tsx
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { buildTenantHomeState } from "@/lib/tenant/homeViewState";
import PaymentsRouter from "./PaymentsRouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page(props: {
  searchParams?: { [k: string]: string | string[] | undefined };
}) {
  const user = await getSessionUser();

  // Keep behavior consistent with tenant home
  if (!user || user.role !== "tenant") {
    redirect("/login?next=/tenant/payments");
  }

  const state = await buildTenantHomeState({
    _id: user._id,
    email: user.email,
  });

  return (
    <Suspense fallback={<div className="px-4 text-sm text-gray-600">Loading…</div>}>
      <PaymentsRouter
        user={{ email: user.email }}
        state={state}
        searchParams={props.searchParams ?? {}}
      />
    </Suspense>
  );
}
