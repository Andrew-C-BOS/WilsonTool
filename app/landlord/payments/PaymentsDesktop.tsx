// app/landlord/payments/PaymentsDesktop.tsx
"use client";
import { useStripeConnect } from "./useStripeConnect";

function Badge({ children, tone="gray" }:{children:React.ReactNode; tone?: "gray"|"green"|"amber"|"red"}) {
  const map:any = { gray:"bg-gray-100 text-gray-800", green:"bg-emerald-50 text-emerald-800", amber:"bg-amber-50 text-amber-800", red:"bg-rose-50 text-rose-700" };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${map[tone]}`}>{children}</span>;
}

export default function PaymentsDesktop() {
  const { loading, status, err, ensureAccount, startOnboarding, refresh } = useStripeConnect();

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-900">Stripe payouts</div>
          <div className="text-xs text-gray-600">Connect Stripe to receive deposits directly.</div>
        </div>
        <button onClick={refresh} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs hover:bg-gray-50">
          Refresh
        </button>
      </div>

      <div className="mt-4 space-y-3 text-sm">
        {loading ? (
          <div className="text-gray-600">Loading Stripe status…</div>
        ) : err ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-rose-800">{err}</div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="w-40 text-gray-700">Account</div>
              <div className="text-gray-900">{status?.accountId || "—"}</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-40 text-gray-700">Details submitted</div>
              <Badge tone={status?.detailsSubmitted ? "green" : "amber"}>
                {status?.detailsSubmitted ? "Yes" : "Pending"}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-40 text-gray-700">Charges enabled</div>
              <Badge tone={status?.chargesEnabled ? "green" : "amber"}>
                {status?.chargesEnabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-40 text-gray-700">Payouts enabled</div>
              <Badge tone={status?.payoutsEnabled ? "green" : "amber"}>
                {status?.payoutsEnabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {!status?.accountId && (
                <button
                  onClick={ensureAccount}
                  className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
                >
                  Create Stripe account
                </button>
              )}
              <button
                onClick={startOnboarding}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900 hover:bg-gray-50"
              >
                {status?.detailsSubmitted ? "Update details" : "Start onboarding"}
              </button>
              {status?.dashboardUrl && (
                <a
                  href={status.dashboardUrl}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900 hover:bg-gray-50"
                >
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
