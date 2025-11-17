// app/tenant/TenantStripeBootstrapper.tsx
"use client";

import { useEffect } from "react";

export default function TenantStripeBootstrapper() {
  useEffect(() => {
    // fire and forget, we don't really care about the response here
    (async () => {
      try {
        await fetch("/api/stripe/bootstrap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
      } catch {
        // we can safely ignore bootstrap failures for now,
        // payments API can still create a customer lazily as a fallback
      }
    })();
  }, []);

  return null;
}
