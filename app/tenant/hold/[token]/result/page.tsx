// app/tenant/hold/[token]/result/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

type HoldStatus = "pending" | "submitted" | "paid" | "failed" | "canceled" | "";
type HoldInfo = {
  ok: boolean;
  total: number;
  minimumDue?: number;
  status?: HoldStatus;
  appId?: string;
  updatedAt?: string | Date | null;
  paidAt?: string | Date | null;
};

function clsx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

function statusCopy(s: HoldStatus) {
  switch (s) {
    case "submitted":
      return { title: "Payment submitted", desc: "Your bank transfer is processing. This usually takes 2–5 business days. We’ll notify you when funds clear.", tone: "violet" as const };
    case "paid":
      return { title: "Payment received", desc: "Thanks! Your payment cleared. The landlord can now countersign the lease.", tone: "emerald" as const };
    case "failed":
      return { title: "Payment failed", desc: "The payment didn’t go through. You can try again from your application.", tone: "rose" as const };
    case "canceled":
      return { title: "Payment canceled", desc: "This payment was canceled. You can start a new payment from your application.", tone: "gray" as const };
    case "pending":
      return { title: "Payment not started", desc: "You haven’t submitted your payment for this hold yet. You can start from your application.", tone: "amber" as const };
    default:
      return { title: "Payment status", desc: "We’re checking the latest status.", tone: "gray" as const };
  }
}

function Badge({ children, tone = "gray" }: { children: React.ReactNode; tone?: "gray" | "blue" | "amber" | "violet" | "emerald" | "rose" }) {
  const map = {
    gray: "bg-gray-100 text-gray-800 ring-gray-200",
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    violet: "bg-violet-50 text-violet-800 ring-violet-200",
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    rose: "bg-rose-50 text-rose-700 ring-rose-200",
  } as const;
  return <span className={clsx("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", map[tone])}>{children}</span>;
}

/** ---------- Per-token polling lock (so only one tab polls) ---------- */
function useTokenPollLock(token: string) {
  const pageIdRef = useRef<string>(() =>
    (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : String(Math.random())
  );
  // @ts-ignore
  const pageId = (pageIdRef.current as unknown as () => string)();

  const KEY = `hold_poll_lock:${token}`;
  const HEARTBEAT_KEY = `hold_poll_lock_hb:${token}`;

  function now() { return Date.now(); }

  function acquireLock(): boolean {
    try {
      const existing = localStorage.getItem(KEY);
      const hb = Number(localStorage.getItem(HEARTBEAT_KEY) || "0");
      const stale = !existing || (now() - hb) > 15000; // 15s without heartbeat → stale
      if (!existing || stale) {
        localStorage.setItem(KEY, pageId);
        localStorage.setItem(HEARTBEAT_KEY, String(now()));
        return true;
      }
      return existing === pageId;
    } catch { return true; } // if storage blocked, just proceed
  }

  function beat() {
    try { localStorage.setItem(HEARTBEAT_KEY, String(now())); } catch {}
  }

  function releaseLock() {
    try {
      const existing = localStorage.getItem(KEY);
      if (existing === pageId) {
        localStorage.removeItem(KEY);
        localStorage.removeItem(HEARTBEAT_KEY);
      }
    } catch {}
  }

  return { acquireLock, beat, releaseLock, pageId };
}

export default function HoldResultPage() {
  const params = useParams();
  const token = Array.isArray(params?.token) ? params.token[0] : (params?.token as string);

  const [info, setInfo] = useState<HoldInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const pollIdRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { acquireLock, beat, releaseLock } = useTokenPollLock(token);

  const isVisible = () => typeof document !== "undefined" && !document.hidden;

  async function loadOnce(stopOn404 = false) {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch(`/api/holding/${encodeURIComponent(token)}`, { cache: "no-store", signal: ac.signal });
      const j = (await res.json()) as HoldInfo;
      if (!res.ok || !j?.ok) {
        if (stopOn404 && res.status === 404) {
          // stop polling permanently for this token
          if (pollIdRef.current) { clearInterval(pollIdRef.current); pollIdRef.current = null; }
          releaseLock();
        }
        setErr("We couldn’t find this holding payment or it’s already finalized.");
        setInfo(null);
      } else {
        setInfo(j);
        setErr(null);
      }
    } catch (e) {
      if ((e as any)?.name !== "AbortError") {
        setErr("Unable to check payment status right now.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    setErr(null);
    setInfo(null);

    // Try to acquire the per-token lock before starting any polling
    const hasLock = acquireLock();
    loadOnce(true);

    function startPolling() {
      if (pollIdRef.current) return;
      pollIdRef.current = window.setInterval(() => {
        // Heartbeat so other tabs know this lock is alive
        beat();

        // Only the visible tab with the lock should poll
        if (!isVisible()) return;

        setInfo((cur) => {
          const s = (cur?.status ?? "") as HoldStatus;
          if (s === "paid" || s === "failed" || s === "canceled") {
            if (pollIdRef.current) { clearInterval(pollIdRef.current); pollIdRef.current = null; }
            releaseLock();
            return cur;
          }
          loadOnce(true);
          return cur;
        });
      }, 10000);
    }

    function handleVis() {
      // On visibility regain, refresh once and (re)start polling if we still hold the lock
      if (isVisible() && acquireLock()) {
        beat();
        loadOnce();
        startPolling();
      }
    }

    if (hasLock && isVisible()) {
      beat();
      startPolling();
    }

    document.addEventListener("visibilitychange", handleVis);
    window.addEventListener("focus", handleVis);
    window.addEventListener("beforeunload", releaseLock);

    return () => {
      document.removeEventListener("visibilitychange", handleVis);
      window.removeEventListener("focus", handleVis);
      window.removeEventListener("beforeunload", releaseLock);
      if (pollIdRef.current) { clearInterval(pollIdRef.current); pollIdRef.current = null; }
      abortRef.current?.abort();
      releaseLock();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const status = (info?.status || "") as HoldStatus;
  const copy = statusCopy(status);

  const appsHref = "/tenant/applications";
  const canRetry = status === "pending" || status === "failed" || status === "canceled";
  const payHref = `/tenant/hold/${encodeURIComponent(token)}`;

  const totalDisplay = useMemo(() => (info?.total ? (info.total / 100).toFixed(2) : "0.00"), [info?.total]);
  const minDisplay = useMemo(() => (info?.minimumDue && info.minimumDue > 0 ? (info.minimumDue / 100).toFixed(2) : null), [info?.minimumDue]);

  return (
    <div className="mx-auto max-w-md p-6 bg-white rounded-xl border border-gray-200">
      <h1 className="text-lg font-semibold mb-2">Holding payment</h1>

      {loading ? (
        <p className="text-sm text-gray-600">Checking payment…</p>
      ) : err ? (
        <>
          <p className="text-sm text-rose-700">{err}</p>
          <div className="mt-4 flex flex-col gap-2">
            <a className="inline-flex justify-center rounded-md bg-gray-900 text-white text-sm font-medium px-3 py-2 hover:bg-black" href={appsHref}>
              Back to applications
            </a>
          </div>
        </>
      ) : (
        <>
          <div className="mb-3">
            <div className="flex items-center gap-2">
              <Badge tone={copy.tone}>{copy.title}</Badge>
            </div>
            <p className="text-sm text-gray-700 mt-2">{copy.desc}</p>
          </div>

          <div className="mb-3 text-sm text-gray-700 space-y-1">
            <div> Total due before lease signing: <strong>${totalDisplay}</strong> </div>
            {minDisplay && <div> Minimum to proceed: <strong>${minDisplay}</strong> </div>}
          </div>

          <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
            <div className="font-medium mb-1">What happens next</div>
            {status === "submitted" && (
              <ul className="list-disc pl-5 space-y-1">
                <li>Your bank is processing the transfer. This may take a few business days.</li>
                <li>We’ll update your application as soon as funds clear.</li>
              </ul>
            )}
            {status === "paid" && (
              <ul className="list-disc pl-5 space-y-1">
                <li>Your payment has cleared.</li>
                <li>The landlord can now countersign the lease. Watch your application for next steps.</li>
              </ul>
            )}
            {status === "pending" && (
              <ul className="list-disc pl-5 space-y-1">
                <li>You haven’t started this payment yet.</li>
                <li>Open your application to begin, or use “Try payment again.”</li>
              </ul>
            )}
            {(status === "failed" || status === "canceled") && (
              <ul className="list-disc pl-5 space-y-1">
                <li>The previous attempt didn’t complete.</li>
                <li>You can retry the payment from your application.</li>
              </ul>
            )}
            {!status && <p>Stay on this page; we’ll refresh automatically.</p>}
          </div>

          {/* Actions */}
          <div className="mt-4 flex flex-col gap-2">
            <a className="inline-flex justify-center rounded-md bg-gray-900 text-white text-sm font-medium px-3 py-2 hover:bg-black" href={appsHref}>
              Back to applications
            </a>

            {canRetry && (
              <a className="inline-flex justify-center rounded-md border border-blue-300 bg-blue-50 text-blue-800 text-sm font-medium px-3 py-2 hover:bg-blue-100" href={payHref}>
                Try payment again
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
}
