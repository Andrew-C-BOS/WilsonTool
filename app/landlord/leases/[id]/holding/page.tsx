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
            Adjust the amounts or details below, then try again. Massachusetts allows at most one
            month’s rent for each of first month, last month, and security deposit.
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

/* ---------- helpers ---------- */
const toCents = (s: string) => Math.round((Number(s || "0") || 0) * 100);
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const isZip = (z: string) => /^\d{5}(-\d{4})?$/.test(z.trim());

export default function HoldingSetupPage() {
  const params = useParams();
  const appId = Array.isArray(params?.id) ? params.id[0] : (params?.id as string);

  /* ── Building address ── */
  const [addr1, setAddr1] = useState("");
  const [addr2, setAddr2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState(""); // 2-letter preferred
  const [zip, setZip] = useState("");

  /* ── Proto-lease: amounts ── */
  const [monthly, setMonthly] = useState<string>("0");
  const [first, setFirst] = useState<string>("0");
  const [last, setLast] = useState<string>("0");
  const [sec, setSec] = useState<string>("0");

  // Optional fee
  const [includeKeyFee, setIncludeKeyFee] = useState<boolean>(false);
  const [key, setKey] = useState<string>("0");

  // Minimum toggle
  const [requireMinimum, setRequireMinimum] = useState<boolean>(true);
  const [minimum, setMinimum] = useState<string>("0");

  /* ── Unit details ── */
  const [unitNumber, setUnitNumber] = useState<string>("");
  const [beds, setBeds] = useState<string>("1");
  const [baths, setBaths] = useState<string>("1");
  const [sqft, setSqft] = useState<string>("");
  const [moveInISO, setMoveInISO] = useState<string>(""); // yyyy-mm-dd
  const [termMonths, setTermMonths] = useState<string>("12");
  const [petsAllowed, setPetsAllowed] = useState<boolean>(true);
  const [parkingSpaces, setParkingSpaces] = useState<string>("0");

  /* ── Result link ── */
  const [link, setLink] = useState<string>("");

  /* ── Errors modal ── */
  const [errOpen, setErrOpen] = useState(false);
  const [errTitle, setErrTitle] = useState("Invalid configuration");
  const [errLines, setErrLines] = useState<string[]>([]);

  /* ── Derived cents ── */
  const monthlyC = useMemo(() => toCents(monthly), [monthly]);
  const totals = useMemo(() => {
    const firstC = toCents(first);
    const lastC = toCents(last);
    const secC = toCents(sec);
    const keyC = includeKeyFee ? toCents(key) : 0;
    const totalC = firstC + lastC + secC + keyC;
    const minC = requireMinimum ? toCents(minimum) : 0;
    return { totalC, minC, firstC, lastC, secC, keyC };
  }, [first, last, sec, key, includeKeyFee, minimum, requireMinimum]);

  const addressErrors = useMemo(() => {
    const errs: string[] = [];
    if (!addr1.trim()) errs.push("Building street address is required.");
    if (!city.trim()) errs.push("City is required.");
    if (!state.trim() || state.trim().length < 2) errs.push("State must be a 2-letter code.");
    if (!zip.trim() || !isZip(zip)) errs.push("ZIP code must be 12345, or 12345-6789.");
    return errs;
  }, [addr1, city, state, zip]);

  /* ── Client-side preflight ── */
  const capErrors = useMemo(() => {
    const errs: string[] = [];
    if (monthlyC <= 0) errs.push("Monthly rent must be greater than $0.00.");
    if (totals.firstC > monthlyC) errs.push(`First month cannot exceed ${dollars(monthlyC)}.`);
    if (totals.lastC > monthlyC) errs.push(`Last month cannot exceed ${dollars(monthlyC)}.`);
    if (totals.secC > monthlyC) errs.push(`Security deposit cannot exceed ${dollars(monthlyC)}.`);
    if (requireMinimum) {
      if (totals.minC <= 0) errs.push("Minimum due must be greater than $0.00.");
      if (totals.minC > totals.totalC) errs.push("Minimum due cannot exceed the total requested.");
    }
    if ((beds && Number(beds) < 0) || (baths && Number(baths) < 0)) {
      errs.push("Bedrooms, and bathrooms, must be zero or positive.");
    }
    if (termMonths && Number(termMonths) <= 0) {
      errs.push("Lease term must be at least 1 month.");
    }
    return errs;
  }, [monthlyC, totals, requireMinimum, beds, baths, termMonths]);

  const minValid = !requireMinimum || (totals.minC > 0 && totals.minC <= totals.totalC);
  const canSubmit = addressErrors.length === 0 && capErrors.length === 0 && minValid;

  async function submit() {
    if (!canSubmit) {
      setErrTitle("Please fix the highlighted issues");
      setErrLines([...addressErrors, ...capErrors, ...(minValid ? [] : ["Minimum due is invalid."])]);
      setErrOpen(true);
      return;
    }

    const building = {
      addressLine1: addr1.trim(),
      addressLine2: addr2.trim() || null,
      city: city.trim(),
      state: state.trim().toUpperCase(),
      postalCode: zip.trim(),
      country: "US",
    };

    // 1) Try to save the unit + building (non-blocking if endpoint isn’t live yet)
	try {
	  await fetch(`/api/landlord/leases/${encodeURIComponent(appId)}/unit`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
		  building,
		  unit: {
			unitNumber: unitNumber || null,
			beds: Number(beds || 0),
			baths: Number(baths || 0),
			sqft: sqft ? Number(sqft) : null,
			petsAllowed,
			parkingSpaces: Number(parkingSpaces || 0),
		  },
		  lease: {
			monthlyRent: monthlyC, // cents
			termMonths: Number(termMonths || 12),
			moveInDate: moveInISO || null,
		  },
		  // NEW: persist the upfronts on the application
		  amounts: {
			first: totals.firstC,
			last: totals.lastC,
			security: totals.secC,
			key: totals.keyC,
		  },
		}),
	  }).catch(() => {});
	} catch {
	  // Non-fatal: proceed to holding
	}


    // 2) Create holding link
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
            building, // pass through; server can ignore for now
            unit: {
              unitNumber: unitNumber || null,
              beds: Number(beds || 0),
              baths: Number(baths || 0),
              sqft: sqft ? Number(sqft) : null,
              petsAllowed,
              parkingSpaces: Number(parkingSpaces || 0),
            },
            lease: {
              termMonths: Number(termMonths || 12),
              moveInDate: moveInISO || null,
            },
          }),
        }
      );
    } catch {
      setErrTitle("Network error");
      setErrLines(["We couldn’t reach the server, please retry."]);
      setErrOpen(true);
      return;
    }

    const j = await res.json().catch(() => ({} as any));

    if (res.ok) {
      setLink(j.payUrl);
      setErrOpen(false);
      return;
    }

    // Server errors
    const serverLines: string[] = [];
    const details: string[] = Array.isArray(j?.details) ? j.details : [];

    switch (j?.error) {
      case "invalid_amounts":
        setErrTitle("Amounts exceed legal limits");
        if (details.length) serverLines.push(...details);
        else serverLines.push("Each major upfront must be ≤ one month’s rent.");
        break;
      case "invalid_minimum":
        setErrTitle("Minimum due is not allowed");
        serverLines.push("Minimum due must be > $0.00, and ≤ total requested.");
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
        serverLines.push("We couldn’t find this application, please reload.");
        break;
      case "already_paid":
        setErrTitle("Already paid");
        serverLines.push("A paid holding already exists for this application.");
        break;
      default:
        setErrTitle("Could not create payment link");
        if (j?.error) serverLines.push(String(j.error));
        else serverLines.push("An unexpected error occurred, please try again.");
        break;
    }
    setErrLines(serverLines);
    setErrOpen(true);
  }

  const totalDisplay = dollars(totals.totalC);
  const minDisplay = dollars(totals.minC);

  return (
    <>
      <div className="mx-auto max-w-3xl p-6 bg-white border rounded-xl">
        <h1 className="text-lg font-semibold mb-2">Holding setup, unit, and building</h1>
        <p className="text-sm text-gray-600 mb-4">
          Configure the proto-lease, set the building and unit basics, choose a minimum payment if any, then generate the tenant link.
        </p>

        {/* ────────── Section 0: Building address ────────── */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-2">Building address</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm col-span-2">
              Street address
              <input
                className="w-full border rounded px-2 py-1"
                value={addr1}
                onChange={(e) => setAddr1(e.target.value)}
                placeholder="123 Main St"
              />
            </label>
            <label className="text-sm">
              City
              <input
                className="w-full border rounded px-2 py-1"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Boston"
              />
            </label>
            <label className="text-sm">
              State
              <input
                className="w-full border rounded px-2 py-1 uppercase"
                value={state}
                onChange={(e) => setState(e.target.value.toUpperCase())}
                placeholder="MA"
                maxLength={2}
              />
            </label>
            <label className="text-sm">
              ZIP
              <input
                className="w-full border rounded px-2 py-1"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                placeholder="02138"
                inputMode="numeric"
              />
            </label>
          </div>
          {addressErrors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-rose-700 space-y-1">
              {addressErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </section>

        {/* ────────── Section 1: Proto-lease ────────── */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-2">Proto-lease</h2>
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
              Move-in date
              <input
                type="date"
                className="w-full border rounded px-2 py-1"
                value={moveInISO}
                onChange={(e) => setMoveInISO(e.target.value)}
              />
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
                <p className="mt-1 text-[11px] text-rose-700">Must be ≤ {dollars(monthlyC)}.</p>
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
                <p className="mt-1 text-[11px] text-rose-700">Must be ≤ {dollars(monthlyC)}.</p>
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
                <p className="mt-1 text-[11px] text-rose-700">Must be ≤ {dollars(monthlyC)}.</p>
              )}
            </label>

            <div className="text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeKeyFee}
                  onChange={(e) => {
                    setIncludeKeyFee(e.target.checked);
                    if (!e.target.checked) setKey("0");
                  }}
                />
                Include key fee
              </label>
              <input
                className="mt-1 w-full border rounded px-2 py-1 disabled:opacity-60"
                inputMode="decimal"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                disabled={!includeKeyFee}
                placeholder="0.00"
              />
            </div>

            <label className="text-sm col-span-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={requireMinimum}
                onChange={(e) => {
                  setRequireMinimum(e.target.checked);
                  if (!e.target.checked) setMinimum("0");
                }}
              />
              Require minimum payment before countersign
            </label>

            <label className="text-sm col-span-2">
              Minimum due now ($)
              <input
                className="w-full border rounded px-2 py-1 disabled:opacity-60"
                inputMode="decimal"
                value={minimum}
                onChange={(e) => setMinimum(e.target.value)}
                disabled={!requireMinimum}
              />
              {!minValid && requireMinimum && (
                <p className="mt-1 text-[11px] text-rose-700">
                  Minimum must be &gt; $0.00, and ≤ total requested.
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                Lease countersign is allowed once at least this amount is paid.
              </p>
            </label>
          </div>
        </section>

        {/* ────────── Section 2: Unit details ────────── */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-2">Unit details</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Unit number
              <input
                className="w-full border rounded px-2 py-1"
                value={unitNumber}
                onChange={(e) => setUnitNumber(e.target.value)}
                placeholder="e.g., 3B"
              />
            </label>

            <label className="text-sm">
              Lease term (months)
              <input
                className="w-full border rounded px-2 py-1"
                inputMode="numeric"
                value={termMonths}
                onChange={(e) => setTermMonths(e.target.value)}
                placeholder="12"
              />
            </label>

            <label className="text-sm">
              Bedrooms
              <input
                className="w-full border rounded px-2 py-1"
                inputMode="numeric"
                value={beds}
                onChange={(e) => setBeds(e.target.value)}
              />
            </label>

            <label className="text-sm">
              Bathrooms
              <input
                className="w-full border rounded px-2 py-1"
                inputMode="numeric"
                value={baths}
                onChange={(e) => setBaths(e.target.value)}
              />
            </label>

            <label className="text-sm">
              Square feet
              <input
                className="w-full border rounded px-2 py-1"
                inputMode="numeric"
                value={sqft}
                onChange={(e) => setSqft(e.target.value)}
                placeholder="Optional"
              />
            </label>

            <label className="text-sm">
              Parking spaces
              <input
                className="w-full border rounded px-2 py-1"
                inputMode="numeric"
                value={parkingSpaces}
                onChange={(e) => setParkingSpaces(e.target.value)}
              />
            </label>

            <label className="text-sm col-span-2 inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={petsAllowed}
                onChange={(e) => setPetsAllowed(e.target.checked)}
              />
              Pets allowed
            </label>
          </div>
        </section>

        {/* ────────── Section 3: Live summary ────────── */}
        <section className="mb-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-2">Summary</h2>
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm space-y-1">
            <div className="text-gray-800">
              <strong>Address,</strong> {addr1}
              {addr2 ? `, ${addr2}` : ""}, {city}, {state.toUpperCase()} {zip}
            </div>
            <div className="flex justify-between">
              <span>Total requested upfront</span>
              <span>{totalDisplay}</span>
            </div>
            <div className="flex justify-between">
              <span>Minimum due now</span>
              <span className={minValid ? "text-gray-900" : "text-rose-700"}>
                {requireMinimum ? minDisplay : "$0.00"}
              </span>
            </div>
            <div className="pt-2 text-xs text-gray-600">
              {moveInISO ? <>Move-in: <strong>{moveInISO}</strong>, </> : null}
              Term: <strong>{termMonths || "—"}</strong> months, Rent: <strong>{dollars(monthlyC)}</strong>, Unit:{" "}
              <strong>{unitNumber || "—"}</strong>, Beds/Baths:{" "}
              <strong>{beds || "—"}/{baths || "—"}</strong>, Pets:{" "}
              <strong>{petsAllowed ? "Yes" : "No"}</strong>, Parking:{" "}
              <strong>{parkingSpaces || 0}</strong>.
            </div>
            {capErrors.length + addressErrors.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-rose-700 space-y-1">
                {[...addressErrors, ...capErrors].map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ────────── Submit ────────── */}
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="mt-2 rounded-md bg-blue-600 text-white px-3 py-2 text-sm disabled:opacity-60"
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
          We’ll block countersignature until the minimum due, if required, is completed.
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
