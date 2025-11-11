import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth"; // your existing helper
import { Suspense } from "react";
import HomeRouter from "./HomeRouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page() {
  const user = await getSessionUser();

  // Preempt home if logged in
  if (user?.role === "tenant") {
    redirect("/tenant");
  } else if (user?.role === "landlord") {
    redirect("/landlord");
  } else if (user?.role === "admin") {
    redirect("/admin");
  }

  // Otherwise render HomeRouter as usual
  return (
    <Suspense fallback={<div className="text-gray-600 text-sm px-4">Loading…</div>}>
      <HomeRouter />
    </Suspense>
  );
}
