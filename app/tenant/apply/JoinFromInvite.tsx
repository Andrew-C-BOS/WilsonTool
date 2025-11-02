"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function JoinFromInvite() {
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    const code = sp.get("join");
    if (!code) return;

    (async () => {
      const res = await fetch("/api/tenant/invites/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
        cache: "no-store",
      }).catch(() => null);

      if (!res) return router.replace("/tenant/applications?error=invite-network");
      if (res.status === 401) {
        // send them to login and bounce back here, we’ll auto-redeem again
        const next = window.location.pathname + window.location.search;
        window.location.href = `/login?next=${encodeURIComponent(next)}`;
        return;
      }

      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok && j.appId && j.formId) {
        router.replace(`/tenant/apply?form=${encodeURIComponent(j.formId)}&hh=${encodeURIComponent(j.appId)}`);
      } else {
        router.replace("/tenant/applications?error=invite-invalid");
      }
    })();
  }, [router, sp]);

  return null;
}
