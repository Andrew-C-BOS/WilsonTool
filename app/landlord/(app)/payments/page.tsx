// app/landlord/payments/page.tsx
import PaymentsRouter from "./PaymentsRouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PaymentsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto w-full max-w-[1100px] px-6 py-6">
        <h1 className="text-2xl font-semibold text-gray-900">Payments</h1>
        <p className="mt-1 text-sm text-gray-600">
          Set up payouts with Stripe. Reporting & statements will appear here soon.
        </p>
        <div className="mt-6">
          <PaymentsRouter />
        </div>
      </div>
    </div>
  );
}
