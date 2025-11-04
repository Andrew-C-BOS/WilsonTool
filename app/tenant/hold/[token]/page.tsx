"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, Stripe } from "@stripe/stripe-js";

const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!;

type HoldInfo = { ok: boolean; total: number; minimumDue?: number; status?: string };

function CheckoutForm({ returnUrl }: { returnUrl: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

	async function onSubmit(e: React.FormEvent) {
	  e.preventDefault();
	  if (!stripe || !elements) return;

	  setSubmitting(true);
	  setMessage(null);

	  // Use "if_required" so the result may include paymentIntent OR error
	  const { error, paymentIntent } = await stripe.confirmPayment({
		elements,
		redirect: "if_required",
		confirmParams: { return_url: returnUrl },
	  });

	  if (error) {
		setMessage(error.message || "Payment failed, please try again.");
	  } else if (paymentIntent) {
		// If Stripe didn't need to redirect, finish locally.
		window.location.assign(returnUrl);
	  }

	  setSubmitting(false);
	}
	
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <PaymentElement />
      <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
        <strong>Pay from your bank account (ACH).</strong> You’ll securely connect your bank.
        ACH can take 2–5 business days. If instant verification isn’t available,
        Stripe may use micro-deposits to verify your account.
      </div>
      <p className="text-[11px] text-gray-500 leading-snug">
        By clicking <em>Pay now</em>, you authorize a one-time ACH debit for the amount shown.
      </p>
      <button
        type="submit"
        disabled={!stripe || !elements || submitting}
        className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {submitting ? "Processing…" : "Pay now"}
      </button>
      {message && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
          {message}
        </div>
      )}
    </form>
  );
}

export default function HoldPayPage() {
  const params = useParams();
  const token = Array.isArray(params?.token) ? params.token[0] : (params?.token as string);

  const [info, setInfo] = useState<HoldInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [returnUrl, setReturnUrl] = useState<string | null>(null);

  // Destination charges => do NOT scope to a connected account
  const stripePromise = useMemo(() => loadStripe(pk), []);

  // Prevent stale responses from overwriting newer state
  const reqSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const seq = ++reqSeq.current;

    // reset UI when token changes
    setInfo(null);
    setError(null);
    setClientSecret(null);
    setReturnUrl(null);

    (async () => {
      try {
        // 1) Load holding basics
        const r = await fetch(`/api/holding/${encodeURIComponent(token)}`, { cache: "no-store" });
        if (!r.ok) { if (!cancelled && seq === reqSeq.current) setError("Invalid or expired link"); return; }
        const j = (await r.json()) as HoldInfo;
        if (cancelled || seq !== reqSeq.current) return;
        setInfo(j);

        // 2) Create/retrieve the PaymentIntent (server returns clientSecret + returnUrl)
        const res = await fetch(`/api/holding/${encodeURIComponent(token)}/intent`, { method: "POST" });
        const pj = await res.json();
        if (!res.ok) { if (!cancelled && seq === reqSeq.current) setError(pj.error || "Failed to init payment"); return; }

        if (cancelled || seq !== reqSeq.current) return;

        // Use ONLY the latest response to mount Elements
        setClientSecret(pj.clientSecret as string);
        setReturnUrl(pj.returnUrl as string);
      } catch {
        if (!cancelled && seq === reqSeq.current) setError("Failed to load");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) {
    return <div className="p-6 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded">{error}</div>;
  }
  if (!info) return <div className="p-6 text-sm text-gray-600">Loading…</div>;

  const totalDisplay = (info.total / 100).toFixed(2);
  const minimumDisplay = info.minimumDue ? (info.minimumDue / 100).toFixed(2) : null;

  return (
    <div className="mx-auto max-w-md p-6 bg-white rounded-xl border border-gray-200">
      <h1 className="text-lg font-semibold mb-2">Holding payment</h1>

      <div className="mb-3 text-sm text-gray-700 space-y-1">
        <div>Total due before lease signing: <strong>${totalDisplay}</strong></div>
        {minimumDisplay && <div>Minimum to proceed today: <strong>${minimumDisplay}</strong></div>}
      </div>

      {!pk && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Missing <code>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code>. Add it to <code>.env.local</code> and restart.
        </div>
      )}

      {clientSecret && returnUrl ? (
        <Elements
          key={clientSecret}                    // ← force a clean mount for the latest PI
          stripe={stripePromise}
          options={{ clientSecret, appearance: { theme: "stripe" } }}
        >
          <CheckoutForm returnUrl={returnUrl} />
        </Elements>
      ) : (
        <div>Preparing payment…</div>
      )}
    </div>
  );
}
