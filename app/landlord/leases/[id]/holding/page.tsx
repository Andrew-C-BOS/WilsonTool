// app/landlord/leases/[id]/holding/page.tsx
"use client";
import { useParams } from "next/navigation";
import { useMemo, useState, useEffect } from "react";

/* ---------- Small modal ---------- */
function ErrorModal({
  open,
  title,
  lines,
  onClose,
}: {
  open: boolean;
  title: string;
  lines: string[];
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute left-1/2 top-16 w-[92%] max-w-lg -translate-x-1/2 rounded-2xl bg-white shadow-xl ring-1 ring-gray-200">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
        <div className="px-5 py-4">
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-800">
            {lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-gray-500">
            Adjust the amounts below and try again. Massachusetts allows at most **one month’s
            rent** for each of first month, last month, and security deposit.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export default function HoldingSetupPage() {
  const params = useParams();
  const appId = Array.isArray(params?.id) ? params.id[0] : (params?.id as string);

  const [monthly, setMonthly] = useState<string>("0");
  const [first, setFirst] = useState<string>("0");
  const [last, setLast] = useState<string>("0");
  const [sec, setSec] = useState<string>("0");
  const [key, setKey] = useState<string>("0");
  const [minimum, setMinimum] = useState<string>("0");

  const [link, setLink] = useState<string>("");

  // Error modal state
  const [errOpen, setErrOpen] = useState(false);
  const [errTitle, setErrTitle] = useState("Invalid configuration");
  const [errLines, setErrLines] = useState<string[]>([]);

  const toCents = (s: string) => Math.round((Number(s || "0") || 0) * 100);

  // Live totals (in cents)
  const totals = useMemo(() => {
    const firstC = toCents(first);
    const lastC = toCents(last);
    const secC = toCents(sec);
    const keyC = toCents(key);
    const totalC = firstC + lastC + secC + keyC;
    const minC = toCents(minimum);
    return { totalC, minC, firstC, lastC, secC, keyC };
  }, [first, last, sec, key, minimum]);

  const monthlyC = useMemo(() => toCents(monthly), [monthly]);

  // Client-side preflight errors to guide the user before hitting API
  const capErrors = useMemo(() => {
    const errs: string[] = [];
    if (monthlyC <= 0) errs.push("Monthly rent must be greater than $0.00.");
    if (totals.firstC > monthlyC)
      errs.push(
        `First month cannot exceed one month’s rent ($${(monthlyC / 100).toFixed(2)}).`
      );
    if (totals.lastC > monthlyC)
      errs.push(
        `Last month cannot exceed one month’s rent ($${(monthlyC / 100).toFixed(2)}).`
      );
    if (totals.secC > monthlyC)
      errs.push(
        `Security deposit cannot exceed one month’s rent ($${(monthlyC / 100).toFixed(2)}).`
      );
    if (totals.minC <= 0)
      errs.push("Minimum due must be greater than $0.00.");
    if (totals.minC > totals.totalC)
      errs.push("Minimum due cannot exceed the total requested.");
    return errs;
  }, [monthlyC, totals]);

  const minValid = totals.minC > 0 && totals.minC <= totals.totalC;
  const canSubmit = capErrors.length === 0 && minValid;

  async function submit() {
    // If we already know it's invalid, show modal immediately.
    if (!canSubmit) {
      setErrTitle("Please fix the highlighted issues");
      setErrLines(capErrors);
      setErrOpen(true);
      return;
    }

    let res: Response | null = null;
    try {
      res = await fetch(
        `/api/landlord/applications/${encodeURIComponent(appId)}/holding`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            monthlyRent: monthlyC,
            amounts: {
              first: totals.firstC,
              last: totals.lastC,
              security: totals.secC,
              key: totals.keyC,
            },
            minimumDue: totals.minC,
          }),
        }
      );
    } catch {
      setErrTitle("Network error");
      setErrLines(["We couldn’t reach the server. Please check your connection and retry."]);
      setErrOpen(true);
      return;
    }

    const j = await res.json().catch(() => ({} as any));

    if (res.ok) {
      setLink(j.payUrl);
      // Clear any previous error modal
      setErrOpen(false);
      return;
    }

    // Map server errors into friendly messages
    const serverLines: string[] = [];
    const details: string[] = Array.isArray(j?.details) ? j.details : [];

    switch (j?.error) {
      case "invalid_amounts":
        setErrTitle("Amounts exceed legal limits");
        if (details.length) serverLines.push(...details);
        else
          serverLines.push(
            "Each of first month, last month, and security deposit must be ≤ one month’s rent."
          );
        break;
      case "invalid_minimum":
        setErrTitle("Minimum due is not allowed");
        serverLines.push("Minimum due must be > $0.00 and ≤ total requested.");
        break;
      case "forbidden":
        setErrTitle("You don’t have permission");
        serverLines.push("Your firm role doesn’t allow creating holding requests for this app.");
        break;
      case "not_authenticated":
        setErrTitle("Please sign in");
        serverLines.push("You need to be signed in to create a holding request.");
        break;
      case "application_not_found":
        setErrTitle("Application not found");
        serverLines.push("We couldn’t find this application. Try reloading this page.");
        break;
      case "already_paid":
        setErrTitle("Already paid");
        serverLines.push("A paid holding already exists for this application.");
        break;
      default:
        setErrTitle("Could not create payment link");
        if (j?.error) serverLines.push(String(j.error));
        else serverLines.push("An unexpected error occurred. Please try again.");
        break;
    }

    setErrLines(serverLines);
    setErrOpen(true);
  }

  return (
    <>
      <div className="mx-auto max-w-lg p-6 bg-white border rounded-xl">
        <h1 className="text-lg font-semibold mb-2">Holding payment setup</h1>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            Monthly rent ($)
            <input
              className="w-full border rounded px-2 py-1"
              inputMode="decimal"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
            />
            {monthlyC <= 0 && (
              <p className="mt-1 text-[11px] text-rose-700">Enter a positive monthly rent.</p>
            )}
          </label>

          <label className="text-sm">
            First month ($)
            <input
              className="w-full border rounded px-2 py-1"
              inputMode="decimal"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
            />
            {totals.firstC > monthlyC && (
              <p className="mt-1 text-[11px] text-rose-700">
                Must be ≤ ${ (monthlyC/100).toFixed(2) }.
              </p>
            )}
          </label>

          <label className="text-sm">
            Last month ($)
            <input
              className="w-full border rounded px-2 py-1"
              inputMode="decimal"
              value={last}
              onChange={(e) => setLast(e.target.value)}
            />
            {totals.lastC > monthlyC && (
              <p className="mt-1 text-[11px] text-rose-700">
                Must be ≤ ${ (monthlyC/100).toFixed(2) }.
              </p>
            )}
          </label>

          <label className="text-sm">
            Security deposit ($)
            <input
              className="w-full border rounded px-2 py-1"
              inputMode="decimal"
              value={sec}
              onChange={(e) => setSec(e.target.value)}
            />
            {totals.secC > monthlyC && (
              <p className="mt-1 text-[11px] text-rose-700">
                Must be ≤ ${ (monthlyC/100).toFixed(2) } (MA security cap).
              </p>
            )}
          </label>

          <label className="text-sm">
            Key fee ($)
            <input
              className="w-full border rounded px-2 py-1"
              inputMode="decimal"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>

          {/* Minimum due now */}
          <label className="text-sm col-span-2">
            Minimum due now ($)
            <input
              className="w-full border rounded px-2 py-1"
              inputMode="decimal"
              value={minimum}
              onChange={(e) => setMinimum(e.target.value)}
            />
            {!minValid && (
              <p className="mt-1 text-[11px] text-rose-700">
                Minimum must be &gt; $0.00 and ≤ total requested.
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              Lease countersign is allowed once at least this amount is paid.
            </p>
          </label>
        </div>

        {/* Live summary */}
        <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
          <div className="flex justify-between">
            <span>Total requested</span>
            <span>${(totals.totalC / 100).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Minimum due now</span>
            <span className={minValid ? "text-gray-900" : "text-rose-700"}>
              ${(totals.minC / 100).toFixed(2)}
            </span>
          </div>
          {capErrors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-rose-700 space-y-1">
              {capErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="mt-4 rounded-md bg-blue-600 text-white px-3 py-2 text-sm disabled:opacity-60"
        >
          Create payment link
        </button>

        {link && (
          <div className="mt-4 p-3 border rounded bg-gray-50 text-sm">
            Tenant link:{" "}
            <a className="underline" href={link}>
              {link}
            </a>
            <button
              className="ml-2 border px-2 py-1 rounded"
              onClick={() =>
                navigator.clipboard.writeText(
                  (typeof window !== "undefined" ? window.location.origin : "") + link
                )
              }
            >
              Copy
            </button>
          </div>
        )}

        <p className="mt-3 text-xs text-gray-500">
          We’ll block countersignature until the <strong>minimum due</strong> payment is completed.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Massachusetts caps: first month, last month, and security deposit should each be ≤ one
          month’s rent; keep key fees reasonable.
        </p>
      </div>

      <ErrorModal open={errOpen} title={errTitle} lines={errLines} onClose={() => setErrOpen(false)} />
    </>
  );
}
