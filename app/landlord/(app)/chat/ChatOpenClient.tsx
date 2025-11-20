// app/landlord/chat/ChatOpenClient.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function ChatOpenClient({
  appId,
  householdId,
}: {
  appId?: string;
  householdId?: string;
}) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const open = async () => {
      try {
        // Fallback: if props are empty, read from URL (defensive)
        let a = appId || "";
        let h = householdId || "";
        if (!a && !h && typeof window !== "undefined") {
          const u = new URL(window.location.href);
          a = u.searchParams.get("appId") || "";
          h = u.searchParams.get("hh") || "";
        }

        if (!a && !h) {
          setErr("Missing app or household id,");
          return;
        }

        const res = await fetch("/api/landlord/chat/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(a ? { appId: a } : { householdId: h }),
        });

        const j = await res.json();
        if (!res.ok || !j?.ok || !j?.threadId) {
          setErr(j?.error || "Unable to open chat,");
          return;
        }
        if (cancelled) return;

        router.replace(`/landlord/chat/${encodeURIComponent(j.threadId)}`);
      } catch {
        setErr("Network error,");
      }
    };

    open();
    return () => { cancelled = true; };
  }, [appId, householdId, router]);

  return (
    <div className="p-4 text-sm text-gray-700">
      {err ? err : "Opening chat…"}
    </div>
  );
}
