// app/landlord/documents/DocumentsDesktop.tsx
"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/* ---------- Tiny utils ---------- */

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

const formatDate = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString();
};

/* ---------- Types ---------- */

type LandlordDocument = {
  id: string;
  firmId: string;
  title: string;
  internalDescription?: string | null;
  externalDescription?: string | null;
  objectKey: string; // S3 key
  url?: string | null; // signed or public URL (optional)
  createdAt?: string | null;
};

/* ---------- Data helpers ---------- */

async function fetchDocuments(firmId?: string): Promise<LandlordDocument[]> {
  try {
    const qs = firmId ? `?firmId=${encodeURIComponent(firmId)}` : "";
    const res = await fetch(`/api/landlord/documents${qs}`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const j = await res.json();
    const list: any[] = Array.isArray(j.documents) ? j.documents : [];
    return list.map((d) => ({
      id: String(d.id ?? d._id),
      firmId: String(d.firmId ?? ""),
      title: String(d.title ?? "Untitled"),
      internalDescription: d.internalDescription ?? null,
      externalDescription: d.externalDescription ?? null,
      objectKey: String(d.objectKey ?? ""),
      url: d.url ?? null,
      createdAt: d.createdAt ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * Create a new document metadata + upload target.
 * This is intentionally stubby: it assumes your API returns either:
 *  - a direct upload URL (presigned S3 URL), or
 *  - just metadata (if you're using multipart/form-data directly).
 *
 * For now we just demo the "presigned URL" flow.
 */
async function createDocumentUpload(opts: {
  firmId?: string;
  title: string;
  internalDescription: string;
  externalDescription: string;
  fileName: string;
  contentType: string;
}) {
  const { firmId, title, internalDescription, externalDescription, fileName, contentType } = opts;
  const qs = firmId ? `?firmId=${encodeURIComponent(firmId)}` : "";
  const res = await fetch(`/api/landlord/documents/upload${qs}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title,
      internalDescription,
      externalDescription,
      fileName,
      contentType,
    }),
  }).catch(() => null);

  if (!res || !res.ok) {
    let msg = "upload_init_failed";
    try {
      const j = await res?.json();
      if (j?.error) msg = j.error;
    } catch {}
    throw new Error(msg);
  }

  const j = await res.json();
  // You can adjust based on how you implement the API:
  // e.g. { uploadUrl, objectKey, docId }
  return j;
}

/* ---------- Component ---------- */

export default function DocumentsDesktop({ firmId }: { firmId?: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const effectiveFirmId = firmId || search.get("firmId") || undefined;

  const [docs, setDocs] = useState<LandlordDocument[]>([]);
  const [loading, setLoading] = useState(true);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [internalDescription, setInternalDescription] = useState("");
  const [externalDescription, setExternalDescription] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const rows = await fetchDocuments(effectiveFirmId || undefined);
      if (!cancelled) {
        setDocs(rows);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveFirmId]);

  function resetForm() {
    setFile(null);
    setTitle("");
    setInternalDescription("");
    setExternalDescription("");
  }

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setToast("Please choose a file to upload,");
      return;
    }
    if (!title.trim()) {
      setToast("Enter a title for this document,");
      return;
    }

    try {
      setBusy(true);
      setToast(null);

      // 1) Ask your API where/how to upload
      const init = await createDocumentUpload({
        firmId: effectiveFirmId,
        title: title.trim(),
        internalDescription: internalDescription.trim(),
        externalDescription: externalDescription.trim(),
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
      });

      // Example expected API response shape:
      // { uploadUrl: string, objectKey: string, doc: { ... } }
      const uploadUrl: string | undefined = init.uploadUrl;
      const objectKey: string | undefined = init.objectKey;

      if (uploadUrl) {
        // 2) Upload the file directly to S3 (presigned URL)
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "content-type": file.type || "application/octet-stream",
          },
          body: file,
        }).catch(() => null);

        if (!putRes || !putRes.ok) {
          throw new Error("upload_failed");
        }
      }

      // 3) Optionally, your API might already return the saved document metadata
      // For now, we’ll just re-fetch the list to keep it simple.
      const rows = await fetchDocuments(effectiveFirmId || undefined);
      setDocs(rows);
      resetForm();
      setToast("Document uploaded,");
      setTimeout(() => setToast(null), 1200);
    } catch (err: any) {
      setToast(`Upload failed, ${err?.message || "unknown_error"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 pb-8 space-y-6">
      {/* Header */}
      <header className="mt-5 mb-2 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-gray-900">
            Landlord documents
          </h1>
          <p className="mt-1 text-xs text-gray-600">
            Upload documents (lease templates, disclosures, move-in instructions) that you can
            later attach to the tenant handoff flow.
          </p>
        </div>
        <button
          className="hidden sm:inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900 hover:bg-gray-50"
          onClick={() => router.back()}
        >
          Back
        </button>
      </header>

      {/* Content */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left: Upload form */}
        <section className="col-span-12 lg:col-span-6 space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm">
            <div className="text-sm font-semibold text-gray-900">
              Upload new document
            </div>
            <p className="mt-1 text-xs text-gray-600">
              Title and descriptions help you organize documents internally and control what tenants
              see when you attach a document in the handoff flow.
            </p>

            <form className="mt-3 space-y-3" onSubmit={onUpload}>
<label className="block text-xs text-gray-900">
  File
  <div className="mt-1 flex items-center justify-between rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-2">
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white ring-1 ring-gray-300 text-[11px] text-gray-500">
        📎
      </span>
      <span className="flex-1 truncate text-[11px] text-gray-600">
        {file
          ? file.name
          : "Choose a file to upload (PDF, DOCX, or image)"}
      </span>
    </div>
    <button
      type="button"
      onClick={() => fileInputRef.current?.click()}
      className="ml-3 inline-flex items-center rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-900 hover:bg-gray-100"
    >
      Browse
    </button>
  </div>

  {/* Visually hidden real input */}
  <input
    ref={fileInputRef}
    type="file"
    className="sr-only"
    onChange={(e) => setFile(e.target.files?.[0] || null)}
  />
</label>

              <label className="block text-xs text-gray-900">
                Title
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs"
                  placeholder="e.g., Mold disclosure, House rules, Move-in instructions"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>

              <label className="block text-xs text-gray-900">
                Internal notes (private)
                <textarea
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs"
                  rows={3}
                  placeholder="Optional notes for your team, e.g., 'Use this mold disclosure for MA properties only.'"
                  value={internalDescription}
                  onChange={(e) => setInternalDescription(e.target.value)}
                />
              </label>

              <label className="block text-xs text-gray-900">
                External description (shown to tenant)
                <textarea
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs"
                  rows={3}
                  placeholder="Short explanation tenants will see, e.g., 'State-required mold disclosure for your records.'"
                  value={externalDescription}
                  onChange={(e) => setExternalDescription(e.target.value)}
                />
              </label>

              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900 hover:bg-gray-50"
                >
                  Clear
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className={clsx(
                    "rounded-md px-3 py-2 text-xs font-medium text-white",
                    busy
                      ? "bg-gray-400 cursor-not-allowed"
                      : "bg-emerald-600 hover:bg-emerald-700"
                  )}
                >
                  {busy ? "Uploading…" : "Upload document"}
                </button>
              </div>
            </form>
          </div>
        </section>

        {/* Right: Document list */}
        <section className="col-span-12 lg:col-span-6 space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900">Your documents</div>
              <span className="text-[11px] text-gray-500">
                {loading ? "Loading…" : `${docs.length} document${docs.length === 1 ? "" : "s"}`}
              </span>
            </div>

            {loading ? (
              <div className="mt-4 text-xs text-gray-600">Loading…</div>
            ) : docs.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-xs text-gray-600">
                No documents uploaded yet. Upload a lease template, disclosure, or move-in info to
                get started.
              </div>
            ) : (
              <ul className="mt-4 space-y-3">
{docs.map((doc) => (
  <li
    key={doc.id}
    className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-xs shadow-sm hover:shadow transition"
  >
    <div className="flex items-start justify-between gap-3">
      {/* Left side — titles + descriptions */}
      <div className="min-w-0 space-y-1.5">
        <div className="text-[13px] font-semibold text-gray-900 truncate">
          {doc.title}
        </div>

        {doc.externalDescription && (
          <div className="text-[11px] text-gray-700 leading-snug">
            <span className="font-medium text-gray-800">Tenant sees:</span>{" "}
            {doc.externalDescription}
          </div>
        )}

        {doc.internalDescription && (
          <div className="text-[11px] text-gray-500 leading-snug">
            <span className="font-medium text-gray-600">Internal note:</span>{" "}
            {doc.internalDescription}
          </div>
        )}
      </div>

      {/* Right side — metadata & actions */}
      <div className="shrink-0 text-right space-y-1">
        {doc.createdAt && (
          <div className="text-[10px] text-gray-500">
            Added {formatDate(doc.createdAt)}
          </div>
        )}

        {doc.url && (
          <a
            href={doc.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center text-[10px] font-medium text-blue-600 hover:underline"
          >
            View file →
          </a>
        )}
      </div>
    </div>
  </li>
))}

              </ul>
            )}
          </div>
        </section>
      </div>

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
          <div className="rounded-md bg-gray-900 text-white text-sm px-4 py-2 shadow-lg">
            {toast}{" "}
            <button className="ml-3 underline" onClick={() => setToast(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
