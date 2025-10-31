import { getSessionUser } from "@/lib/auth";

export default async function TenantHome() {
  const user = await getSessionUser();
  return (
    <>
      <h1 className="text-xl font-semibold">Tenant home</h1>
      <p className="text-gray-600 mt-2">Signed in as {user?.email}</p>

      {/* Quick starter content */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <a href="/tenant/applications" className="block rounded-lg border border-gray-200 bg-white p-4 hover:shadow-sm">
          <div className="font-medium text-gray-900">Applications</div>
          <div className="text-sm text-gray-600">Start or review your rental applications.</div>
        </a>
        <a href="/tenant/payments" className="block rounded-lg border border-gray-200 bg-white p-4 hover:shadow-sm">
          <div className="font-medium text-gray-900">Payments</div>
          <div className="text-sm text-gray-600">Pay deposits, rent, and view receipts.</div>
        </a>
        <a href="/tenant/documents" className="block rounded-lg border border-gray-200 bg-white p-4 hover:shadow-sm">
          <div className="font-medium text-gray-900">Documents</div>
          <div className="text-sm text-gray-600">View or download your lease and files.</div>
        </a>
        {/* <a href="/tenant/maintenance" className="block rounded-lg border border-gray-200 bg-white p-4 hover:shadow-sm">
          <div className="font-medium text-gray-900">Maintenance</div>
          <div className="text-sm text-gray-600">Submit and track requests.</div>
        </a> */}
      </div>
    </>
  );
}
