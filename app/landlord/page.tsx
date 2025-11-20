// app/landlord/page.tsx
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function LandlordHome() {
  const user = await getSessionUser();
  if (!user || user.role !== "landlord") {
    redirect("/");
  }
  const firmRole =
    (user.landlordFirm as any)?.firmRole ??
    user.landlordFirm?.role ??
    null;

  // If landlord is an inspector, land them on the inspection tool
  if (firmRole === "inspector") {
    redirect("/landlord/inspection");
  }
  return (
    <>
      <h1 className="text-xl font-semibold">Landlord dashboard</h1>
      <p className="text-gray-600 mt-2">Signed in as {user?.email}</p>

      {/* Quick starter tiles (optional) */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <a href="/landlord/applications" className="block rounded-lg border border-gray-200 bg-white p-4 hover:shadow-sm">
          <div className="font-medium text-gray-900">Applications</div>
          <div className="text-sm text-gray-600">Review and approve applicants.</div>
        </a>
        <a href="/landlord/units" className="block rounded-lg border border-gray-200 bg-white p-4 hover:shadow-sm">
          <div className="font-medium text-gray-900">Units</div>
          <div className="text-sm text-gray-600">Manage unit details and status.</div>
        </a>
        <a href="/landlord/payments" className="block rounded-lg border border-gray-200 bg-white p-4 hover:shadow-sm">
          <div className="font-medium text-gray-900">Payments</div>
          <div className="text-sm text-gray-600">Track deposits and rent.</div>
        </a>
        <a href="/landlord/leases" className="block rounded-lg border border-gray-200 bg-white p-4 hover:shadow-sm">
          <div className="font-medium text-gray-900">Leases</div>
          <div className="text-sm text-gray-600">Generate and countersign leases.</div>
        </a>
      </div>
    </>
  );
}
