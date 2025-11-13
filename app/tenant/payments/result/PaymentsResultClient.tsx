"use client";

import { useEffect, useRef, useState } from "react";

type Status =
  | "created"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled"
  | "returned";

type ResultPayload = {
  ok: boolean;
  appId: string;
  status: Status;
  amountCents: number;
  currency: string;
  rails: "ach" | "card" | string;
  kind: string;
  provider: string;
  paymentIntentId: string | null;
  idempotencyKey: string | null;
  receiptUrl: string | null;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
  error?: string;
};

function clsx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}
function money(cents?: number, currency = "USD") {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format((cents || 0) / 100);
}

function badgeFor(status?: Status) {
  switch (status) {
    case "succeeded":
      return { tone: "emerald" as const, label: "Payment received" };
    case "processing":
      return { tone: "violet" as const, label: "Payment submitted" };
    case "created":
      return { tone: "amber" as const, label: "Awaiting confirmation" };
    case "failed":
      return { tone: "rose" as const, label: "Payment failed" };
    case "canceled":
      return { tone: "gray" as const, label: "Payment canceled" };
    case "returned":
      return { tone: "rose" as const, label: "Payment returned" };
    default:
      return { tone: "gray" as const, label: "Payment status" };
  }
}

function nextSteps(status?: Status, kind?: string, rails?: string) {
  const k = (kind || "").toLowerCase();
  const rail = (rails || "ach").toUpperCase();
  switch (status) {
    case "succeeded":
      return [
        "Funds have cleared.",
        k === "deposit"
          ? "Your deposit was received; we’ll issue the escrow disclosure."
          : "Your lease balance was funded.",
        "The landlord can now proceed to countersign (if applicable).",
      ];
    case "processing":
      return [
        `Your ${rail} transfer is processing (2–5 business days).`,
        "We’ll notify you when funds clear.",
      ];
    case "created":
      return [
        "We’re preparing your payment.",
        "If this screen doesn’t advance, return to the payment page and try again.",
      ];
    case "failed":
      return [
        "The payment didn’t complete.",
        "You can start a new payment from your applications list.",
      ];
    case "canceled":
      return [
        "This payment was canceled.",
        "You can start a new payment from your applications list.",
      ];
    case "returned":
      return [
        "The payment was returned by your bank.",
        "Please contact support or start a new payment.",
      ];
    default:
      return ["We’re checking the latest status…"];
  }
}

function Badge({
  children,
  tone = "gray",
}: {
  children: React.ReactNode;
  tone?: "gray" | "blue" | "amber" | "violet" | "emerald" | "rose";
}) {
  const map = {
    gray: "bg-gray-100 text-gray-800 ring-gray-200",
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    violet: "bg-violet-50 text-violet-800 ring-violet-200",
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    rose: "bg-rose-50 text-rose-700 ring-rose-200",
  } as const;
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        map[tone]
      )}
    >
      {children}
    </span>
  );
}

export default function PaymentsResultClient({
  appId,
  paymentKey,
}: {
  appId: string;
  paymentKey: string;
}) {
  const [data, setData] = useState<ResultPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const pollRef = useRef<number | null>(null);

  const isTerminal = (s?: Status) =>
    s === "succeeded" || s === "failed" || s === "canceled" || s === "returned";

  async function loadOnce() {
    if (!appId || !paymentKey) {
      setErr("Missing appId or payment key.");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/tenant/payments/result?appId=${encodeURIComponent(
          appId
        )}&key=${encodeURIComponent(paymentKey)}`,
        {
          cache: "no-store",
        }
      );
      const j = (await res.json()) as ResultPayload;
      if (!res.ok || !j?.ok) {
        setErr(j?.error || "Unable to load payment status.");
        setData(null);
      } else {
        setData(j);
        setErr(null);
      }
    } catch (e: any) {
      setErr(e?.message || "Unable to load payment status.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    setErr(null);
    setData(null);
    loadOnce();

    // Poll every 7s until terminal state
    function startPoll() {
      if (pollRef.current) return;
      pollRef.current = window.setInterval(() => {
        setData((cur) => {
          if (cur && isTerminal(cur.status)) {
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            return cur;
          }
          loadOnce();
          return cur;
        });
      }, 7000);
    }
    startPoll();

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, paymentKey]);

  const badge = badgeFor(data?.status);
  const steps = nextSteps(data?.status, data?.kind, data?.rails);
  const appsHref = "/tenant/applications";

  return (
    <main className="mx-auto max-w-md p-6 bg-white rounded-xl border border-gray-200">
      <h1 className="text-lg font-semibold mb-2">Payment result</h1>

      {loading ? (
        <p className="text-sm text-gray-600">Checking payment…</p>
      ) : err ? (
        <>
          <p className="text-sm text-rose-700">{err}</p>
          <div className="mt-4 flex flex-col gap-2">
            <a
              className="inline-flex justify-center rounded-md bg-gray-900 text-white text-sm font-medium px-3 py-2 hover:bg-black"
              href={appsHref}
            >
              Back to applications
            </a>
          </div>
        </>
      ) : (
        <>
          <div className="mb-3">
            <div className="flex items-center gap-2">
              <Badge tone={badge.tone}>{badge.label}</Badge>
              {data?.rails && (
                <span className="text-[11px] rounded-full bg-gray-100 text-gray-700 px-2 py-0.5 ring-1 ring-gray-200">
                  {String(data.rails).toUpperCase()}
                </span>
              )}
              {data?.kind && (
                <span className="text-[11px] rounded-full bg-gray-100 text-gray-700 px-2 py-0.5 ring-1 ring-gray-200 capitalize">
                  {data.kind === "operating" ? "Lease" : data.kind}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-700 mt-2">
              {steps[0]}
              {steps.slice(1).map((s, i) => (
                <span key={i}>
                  <br />
                  {s}
                </span>
              ))}
            </p>
          </div>

          <div className="mb-3 text-sm text-gray-700 space-y-1">
            <div>
              Amount:{" "}
              <strong>{money(data?.amountCents, data?.currency || "USD")}</strong>
            </div>
            {data?.paymentIntentId && (
              <div>
                Payment code:{" "}
                <span className="font-mono text-gray-800">{data.paymentIntentId}</span>
              </div>
            )}
            {data?.idempotencyKey && (
              <div>
                Request key:{" "}
                <span className="font-mono text-gray-700">{data.idempotencyKey}</span>
              </div>
            )}
            {data?.updatedAt && (
              <div>
                Updated:{" "}
                <span className="text-gray-600">
                  {new Date(data.updatedAt).toLocaleString()}
                </span>
              </div>
            )}
          </div>

          <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
            <div className="font-medium mb-1">What happens next</div>
            <ul className="list-disc pl-5 space-y-1">
              {steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <a
              className="inline-flex justify-center rounded-md bg-gray-900 text-white text-sm font-medium px-3 py-2 hover:bg-black"
              href={appsHref}
            >
              Back to applications
            </a>
            {data?.receiptUrl && (
              <a
                className="inline-flex justify-center rounded-md border border-blue-300 bg-blue-50 text-blue-800 text-sm font-medium px-3 py-2 hover:bg-blue-100"
                href={data.receiptUrl}
                target="_blank"
                rel="noreferrer"
              >
                View receipt
              </a>
            )}
          </div>
        </>
      )}
    </main>
  );
}
