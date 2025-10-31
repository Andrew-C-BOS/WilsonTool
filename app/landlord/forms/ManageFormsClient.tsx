"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

/** --------------------------------------------------------------------------------
 * Types and demo data (will fetch real forms if /api/forms exists)
 * -------------------------------------------------------------------------------*/
type FormSummary = {
  id: string;
  name: string;
  scope: "portfolio" | "property";
  property?: string;
  updatedAt?: string;
};

const DEMO_FORMS: FormSummary[] = [
  { id: "form_portfolio_default", name: "Standard Rental Application", scope: "portfolio", updatedAt: "2025-10-28" },
  { id: "form_cambridge_flats", name: "Cambridge Flats Application", scope: "property", property: "Cambridge Flats", updatedAt: "2025-10-20" },
];

/** --------------------------------------------------------------------------------
 * Small helpers
 * -------------------------------------------------------------------------------*/
function clsx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

function Badge({
  children,
  tone = "gray",
}: {
  children: React.ReactNode;
  tone?: "gray" | "blue" | "amber" | "violet" | "emerald";
}) {
  const map = {
    gray: "bg-gray-100 text-gray-800 ring-gray-200",
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    violet: "bg-violet-50 text-violet-800 ring-violet-200",
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  } as const;
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", map[tone])}>
      {children}
    </span>
  );
}

function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div className="rounded-md bg-gray-900 text-white text-sm px-4 py-2 shadow-lg">
        {text} <button className="ml-3 underline" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function Modal({
  open, title, onClose, children,
}: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" className="absolute left-1/2 top-16 -translate-x-1/2 w-[92%] max-w-xl rounded-xl bg-white shadow-xl ring-1 ring-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">
            Close
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** --------------------------------------------------------------------------------
 * ManageFormsClient
 * -------------------------------------------------------------------------------*/
export default function ManageFormsClient() {
  const [forms, setForms] = useState<FormSummary[]>(DEMO_FORMS);
  const [origin, setOrigin] = useState<string>("");
  const [toast, setToast] = useState<string | null>(null);

  // Share modal state
  const [shareFor, setShareFor] = useState<FormSummary | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // Email small form state
  const [email, setEmail] = useState("");
  const [emailMsg, setEmailMsg] = useState("");

  /** Load forms if the API exists; otherwise fall back to demo */
  useEffect(() => {
    setOrigin(window.location.origin);
    (async () => {
      try {
        const res = await fetch("/api/forms", { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          if (json?.ok && Array.isArray(json.forms) && json.forms.length) {
            // Normalize minimal fields
            const mapped: FormSummary[] = json.forms.map((f: any) => ({
              id: String(f._id ?? f.id),
              name: String(f.name ?? "Untitled"),
              scope: (f.scope ?? "portfolio") as "portfolio" | "property",
              property: f.propertyId ? String(f.propertyId) : undefined,
              updatedAt: f.updatedAt ? new Date(f.updatedAt).toISOString().slice(0, 10) : undefined,
            }));
            setForms(mapped);
          }
        }
      } catch {
        /* ignore, stay on demo */
      }
    })();
  }, []);

  /** Honor ?share=1 to open the share dialog for the first form */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("share") === "1" && forms.length) {
      setShareFor(forms[0]);
      setQrDataUrl(null);
    }
  }, [forms]);

  /** Compose share link (one static link per form) */
  const shareLink = (f: FormSummary) =>
    `${origin}/tenant/apply?form=${encodeURIComponent(f.id)}`;

  /** Copy share link */
  async function onCopyLink(f: FormSummary) {
    const link = shareLink(f);
    try {
      await navigator.clipboard.writeText(link);
      setToast("Share link copied, send it anywhere,");
    } catch {
      setToast(`Share link: ${link}`);
    }
  }

  /** Generate QR code (client-side) */
  async function onGenerateQr(f: FormSummary) {
    try {
      const QRCode = (await import("qrcode")).default;
      const url = shareLink(f);
      const dataUrl = await QRCode.toDataURL(url, { width: 256, margin: 1 });
      setQrDataUrl(dataUrl);
    } catch {
      setToast("Could not generate QR, please try again,");
    }
  }

  /** “Send email” — open the user’s client via mailto for now */
  function onSendEmail(f: FormSummary) {
    if (!email.trim()) return setToast("Add a recipient email,");
    const link = shareLink(f);
    const subject = `Rental application form: ${f.name}`;
    const body =
      `${emailMsg ? emailMsg + "\n\n" : ""}` +
      `Please complete this application:\n${link}\n\n` +
      `If you have a co‑applicant or cosigner, invite them to join the same household when prompted,`;
    const href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
    setToast("Email draft opened in your client,");
  }

  const byUpdated = useMemo(
    () =>
      [...forms].sort((a, b) =>
        (b.updatedAt || "").localeCompare(a.updatedAt || "")
      ),
    [forms]
  );

  return (
    <>
      {/* Top actions */}
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-gray-600">
          {forms.length} form{forms.length === 1 ? "" : "s"} available,
        </div>
        <Link
          href="/landlord/forms/builder"
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + New form
        </Link>
      </div>

      {/* List of forms as responsive cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {byUpdated.map((f) => (
          <div key={f.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">{f.name}</div>
                <div className="mt-1 flex items-center gap-2">
                  <Badge tone={f.scope === "portfolio" ? "blue" : "violet"}>
                    {f.scope === "portfolio" ? "Portfolio‑wide" : `Property`}
                  </Badge>
                  {f.property && <span className="text-xs text-gray-600">{f.property}</span>}
                </div>
                {f.updatedAt && (
                  <div className="mt-1 text-xs text-gray-500">Updated {f.updatedAt}</div>
                )}
              </div>

              {/* Quick Copy Link */}
              <button
                onClick={() => onCopyLink(f)}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50"
                title="Copy share link"
              >
                Copy link
              </button>
            </div>

            {/* Actions */}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => { setShareFor(f); setQrDataUrl(null); setEmail(""); setEmailMsg(""); }}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
              >
                Share…
              </button>

              <button
                onClick={() => onGenerateQr(f)}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
              >
                QR code
              </button>

              <Link
                href={`/landlord/forms/builder?form=${encodeURIComponent(f.id)}`}
                className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-black"
              >
                Edit
              </Link>
            </div>

            {/* Inline link preview */}
            <div className="mt-3 rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-2">
              <div className="text-[11px] text-gray-600 truncate">
                {origin ? `${origin}/tenant/apply?form=${f.id}` : "/tenant/apply?form=…"}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Share modal */}
      <Modal open={!!shareFor} title={`Share: ${shareFor?.name ?? ""}`} onClose={() => setShareFor(null)}>
        {shareFor && (
          <div className="space-y-5">
            {/* Shareable link */}
            <div>
              <div className="text-sm font-medium text-gray-900">Shareable link</div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={shareLink(shareFor)}
                  readOnly
                />
                <button
                  onClick={() => onCopyLink(shareFor)}
                  className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-black"
                >
                  Copy
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                One static link per form; prospects will start a household, invite co‑applicants, and cosigners, inside the flow,
              </p>
            </div>

            {/* QR code */}
            <div>
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-gray-900">QR code</div>
                {!qrDataUrl && (
                  <button
                    onClick={() => onGenerateQr(shareFor)}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50"
                  >
                    Generate
                  </button>
                )}
              </div>
              {qrDataUrl ? (
                <div className="mt-3 flex items-center gap-3">
                  <img src={qrDataUrl} alt="QR code" className="h-40 w-40 rounded-md border border-gray-200" />
                  <div className="space-y-2">
                    <a
                      href={qrDataUrl}
                      download={`form_${shareFor.id}_qr.png`}
                      className="inline-block rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50"
                    >
                      Download PNG
                    </a>
                    <button
                      onClick={() => setQrDataUrl(null)}
                      className="block rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50"
                    >
                      Regenerate
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-xs text-gray-500">Create a QR to print on flyers, send in texts, or post in listings,</p>
              )}
            </div>

            {/* Email invite */}
            <div>
              <div className="text-sm font-medium text-gray-900">Send email</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="recipient@example.com"
                  className="sm:col-span-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
                <input
                  value={emailMsg}
                  onChange={(e) => setEmailMsg(e.target.value)}
                  placeholder="Optional message"
                  className="sm:col-span-2 rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="mt-2">
                <button
                  onClick={() => onSendEmail(shareFor)}
                  className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Open email draft
                </button>
                <p className="mt-1 text-xs text-gray-500">
                  This opens your email client with the link prefilled; we’ll wire a real sender later,
                </p>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {toast && <Toast text={toast} onClose={() => setToast(null)} />}
    </>
  );
}
