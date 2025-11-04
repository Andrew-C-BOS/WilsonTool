// app/hold/[token]/result/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

export default function HoldResultPage() {
  const params = useParams();
  const token = Array.isArray(params?.token) ? params.token[0] : (params?.token as string);
  const sp = useSearchParams();

  const [msg, setMsg] = useState("Checking payment…");

  useEffect(() => {
    (async () => {
      const clientSecret = sp.get("payment_intent_client_secret");
      if (!clientSecret) { setMsg("Missing payment intent client secret."); return; }
      const stripe = await stripePromise;
      if (!stripe) { setMsg("Stripe not initialized."); return; }

      const { paymentIntent } = await stripe.retrievePaymentIntent(clientSecret);
      switch (paymentIntent?.status) {
        case "succeeded":
          setMsg("Payment received. Thanks!");
          break;
        case "processing":
          setMsg("Payment processing. We’ll update you shortly.");
          break;
        case "requires_payment_method":
          setMsg("Payment failed or was canceled. Please try again.");
          break;
        default:
          setMsg(`Payment status: ${paymentIntent?.status ?? "unknown"}`);
      }
    })();
  }, [sp]);

  return (
    <div className="mx-auto max-w-md p-6 bg-white rounded-xl border border-gray-200">
      <h1 className="text-lg font-semibold mb-2">Holding payment</h1>
      <p className="text-sm text-gray-700">{msg}</p>
      <div className="mt-4">
        <a className="text-sm underline" href={`/tenant/hold/${encodeURIComponent(token)}`}>
          Back to payment
        </a>
      </div>
    </div>
  );
}
