// app/tenant/layout.tsx
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import TenantNavBar from "../components/TenantNavBar";

export default async function TenantLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getSessionUser();

  // If not logged in or not a tenant, dump them to the home page
  if (!user || user.role !== "tenant") {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <TenantNavBar />
      <main className="p-0">{children}</main>
    </div>
  );
}
