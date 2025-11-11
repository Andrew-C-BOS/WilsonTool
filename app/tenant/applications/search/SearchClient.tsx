// app/tenant/applications/search/SearchClient.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Building2, Globe, Mail, MapPin, Loader2, FileText } from "lucide-react";

type FirmResult = {
  id: string;              // firmId (e.g., "firm_mhgg3yc9e79wis")
  name: string;            // firm name
  slug?: string;
  address?: { line1?: string; city?: string; state?: string; zip?: string; country?: string };
  logoUrl?: string | null;
  website?: string | null;
  contactEmail?: string | null;
  forms: {
    id: string;            // form _id (stringified)
    name: string;
    description?: string | null;
    scope: "portfolio" | "property" | string;
  }[];
};

function clsx(...xs: (string | null | false | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

export default function SearchClient() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<FirmResult[] | null>(null);
  const first = useRef(true);

  // debounce query
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  // fetch firms
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!debounced) {
      setResults(null);
      setErr(null);
      return;
    }
    (async () => {
      setBusy(true);
      setErr(null);
      try {
        const res = await fetch(`/api/tenant/applications/search?q=${encodeURIComponent(debounced)}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!json?.ok) throw new Error(json?.error || "search_failed");
        setResults(json.results as FirmResult[]);
      } catch (e: any) {
        setErr(e?.message || "Something went wrong");
        setResults(null);
      } finally {
        setBusy(false);
      }
    })();
  }, [debounced]);

  const hasResults = !!results?.length;

  return (
    <div>
      <label className="block text-sm font-medium text-gray-900">Search by firm name or city</label>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="e.g., Wilson Group, Boston, wilson-co…"
        className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        autoFocus
      />

      <div className="mt-3 text-xs text-gray-500">
        {busy ? (
          <span className="inline-flex items-center">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Searching…
          </span>
        ) : err ? (
          <span className="text-rose-600">Error: {err}</span>
        ) : debounced && !hasResults ? (
          <span>No firms found, try a different search,</span>
        ) : (
          <span>Type a firm name, slug, or city,</span>
        )}
      </div>

      {hasResults && (
        <ul className="mt-4 space-y-3">
          {results!.map((f) => (
            <li key={f.id} className="rounded-lg border border-gray-200 bg-gray-50 p-4 hover:bg-white hover:shadow-sm transition">
              <div className="flex items-start gap-3">
                {/* Logo */}
                {f.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.logoUrl} alt={`${f.name} logo`} className="h-10 w-10 rounded-md object-cover ring-1 ring-gray-200" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-indigo-50 ring-1 ring-indigo-100">
                    <Building2 className="h-5 w-5 text-indigo-500" />
                  </div>
                )}

                {/* Core info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-sm font-semibold text-gray-900">{f.name}</h3>
                    {f.website && (
                      <a
                        href={/^https?:\/\//i.test(f.website) ? f.website : `https://${f.website}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-indigo-600 hover:text-indigo-800 inline-flex items-center"
                      >
                        <Globe className="mr-1 h-3.5 w-3.5" /> Website
                      </a>
                    )}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
                    {f.address?.line1 && (
                      <span className="inline-flex items-center">
                        <MapPin className="mr-1 h-3.5 w-3.5" />
                        {f.address.line1}
                        {f.address.city ? `, ${f.address.city}` : ""}
                        {f.address.state ? `, ${f.address.state}` : ""}
                      </span>
                    )}
                    {f.contactEmail && (
                      <a className="inline-flex items-center text-indigo-600 hover:underline" href={`mailto:${f.contactEmail}`}>
                        <Mail className="mr-1 h-3.5 w-3.5" />
                        {f.contactEmail}
                      </a>
                    )}
                  </div>

                  {/* Forms */}
                  {f.forms?.length ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {f.forms.map((form) => (
                        <Link
                          key={form.id}
                          href={`/tenant/apply?&form=${encodeURIComponent(form.id)}`}
                          className="inline-flex items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-900 hover:bg-gray-50"
                        >
                          <span className="truncate">{form.name}</span>
                          <FileText className="ml-2 h-4 w-4 text-gray-500" />
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 text-xs text-gray-500">
                      This firm doesn’t have a public application yet,
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!debounced && (
        <div className="mt-5 rounded-lg border border-dashed border-gray-300 p-6 text-center">
          <p className="text-sm text-gray-600">Search for your property manager or firm to start,</p>
        </div>
      )}
    </div>
  );
}
