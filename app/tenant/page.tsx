import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth";
import { getTenantHomeState } from "@/lib/tenant/nextAction";
import TenantRouter from "./TenantRouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page() {
  const user = await getSessionUser();
  const state = user?._id ? await getTenantHomeState(String(user._id)) : null;

  return (
    <Suspense fallback={<div className="text-gray-600 text-sm px-4">Loading…</div>}>
      <TenantRouter
        user={{ email: user?.email ?? null }}
        // For now we only use this on Desktop, Router just forwards it.
        state={state}
      />
    </Suspense>
  );
}
