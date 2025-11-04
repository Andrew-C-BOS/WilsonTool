// app/landlord/payments/PaymentsMobile.tsx
"use client";
import { useStripeConnect } from "./useStripeConnect";

export default function PaymentsMobile() {
  const { loading, status, err, ensureAccount, startOnboarding, refresh } = useStripeConnect();

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-900">Stripe payouts</div>
        <button onClick={refresh} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs hover:bg-gray-50">
          Refresh
        </button>
      </div>

      <div className="mt-3 text-sm">
        {loading ? (
          <div className="text-gray-600">Loading…</div>
        ) : err ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-rose-800">{err}</div>
        ) : (
          <>
            <div className="text-gray-700">Account: <span className="text-gray-900">{status?.accountId || "—"}</span></div>
            <div className="text-gray-700">Details: <strong>{status?.detailsSubmitted ? "Submitted" : "Pending"}</strong></div>
            <div className="text-gray-700">Charges: <strong>{status?.chargesEnabled ? "Enabled" : "Disabled"}</strong></div>
            <div className="text-gray-700">Payouts: <strong>{status?.payoutsEnabled ? "Enabled" : "Disabled"}</strong></div>

            <div className="mt-3 flex flex-col gap-2">
              {!status?.accountId && (
                <button onClick={ensureAccount} className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700">
                  Create Stripe account
                </button>
              )}
              <button onClick={startOnboarding} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900 hover:bg-gray-50">
                {status?.detailsSubmitted ? "Update details" : "Start onboarding"}
              </button>
              {status?.dashboardUrl && (
                <a href={status.dashboardUrl} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900 hover:bg-gray-50">
                  Open Stripe dashboard
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
