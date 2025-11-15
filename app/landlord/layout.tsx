// app/landlord/layout.tsx
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import LandlordNavBar from "../components/LandlordNavBar";

export default async function LandlordLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getSessionUser();

  // Require landlord OR admin access
  if (!user || user.role !== "landlord") redirect("/");

  return (
    <div className="min-h-screen bg-gray-50">
      <LandlordNavBar />
      <main className="p-0">{children}</main>
    </div>
  );
}
