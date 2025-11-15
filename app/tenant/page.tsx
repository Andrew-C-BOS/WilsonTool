// app/tenant/page.tsx
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import TenantRouter from "./TenantRouter";
import { buildTenantHomeState } from "@/lib/tenant/homeViewState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page() {
  const user = await getSessionUser();

  // If not logged in or not a tenant, kick them out
  if (!user || user.role !== "tenant") {
    redirect("/login"); // or "/" or wherever you want
  }

  const state = await buildTenantHomeState({
    _id: user._id,
    email: user.email,
  });

  return (
    <Suspense fallback={<div>Loading…</div>}>
      <TenantRouter
        user={{ email: user.email }}
        state={state}
      />
    </Suspense>
  );
}
