// app/landlord/(app)/layout.tsx
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";

export default async function LandlordAppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getSessionUser();
  if (!user || user.role !== "landlord") {
    redirect("/");
  }

  const firmRole =
    (user.landlordFirm as any)?.firmRole ??
    user.landlordFirm?.role ??
    null;

  // Inspectors are not allowed into anything in this group
  if (firmRole === "inspector") {
    redirect("/landlord/inspection");
  }

  return <>{children}</>;
}
