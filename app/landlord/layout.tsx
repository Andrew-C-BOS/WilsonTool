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
  
  console.log(user);

  // Require landlord OR admin access
  if (!user || user.role !== "landlord") redirect("/");
  
    // If this landlord is an inspector, always route to /landlord/inspection
  const firmRole =
    (user.landlordFirm as any)?.firmRole ??
    user.landlordFirm?.role ??
    null;
  // (support both property names depending on your SessionUser shape)

  const isInspector = firmRole === "inspector";

  return (
    <div className="min-h-screen bg-gray-50">
      <LandlordNavBar isInspector={isInspector} />
      <main className="p-0">{children}</main>
    </div>
  );
}
