// src/components/modals/SecurityDepositDisclosureModal.tsx
"use client";

import * as React from "react";

export default function SecurityDepositDisclosureModal({
  open,
  onClose,
  receiptPath,           // e.g., "/api/receipts/security-deposit/69100fd273f4b44e9261ad6a"
  disclosureReady,        // boolean
  bankReceiptDueISO,      // string | null
}: {
  open: boolean;
  onClose: () => void;
  receiptPath: string | null;
  disclosureReady: boolean;
  bankReceiptDueISO: string | null;
}) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  if (!open) return null;

  const due = bankReceiptDueISO
    ? new Date(bankReceiptDueISO).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  const handlePrint = React.useCallback(() => {
    if (!receiptPath) return;
    // Try printing from the embedded iframe (preferred)
    const w = iframeRef.current?.contentWindow;
    try {
      if (w) {
        w.focus();
        w.print();
        return;
      }
    } catch {
      // fall through to opening a new tab
    }
    // Fallback: open in a new tab and rely on its onload to present print
    const pop = window.open(receiptPath, "_blank", "noopener,noreferrer");
    // Some browsers block programmatic print; user can print from the new tab.
    try {
      pop?.focus();
      // In many browsers, cross-origin or CSP may block immediate print();
      // leaving it out avoids errors; user still has the print UI in the new tab.
    } catch {
      /* no-op */
    }
  }, [receiptPath]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Security Deposit Disclosure"
    >
      <div className="w-full max-w-5xl overflow-hidden rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Security Deposit Disclosure</h3>
            <p className="text-xs text-gray-600">
              {disclosureReady
                ? "Printable receipt with bank details (M.G.L. c.186 §15B)."
                : due
                ? `Awaiting bank details. Must be provided by ${due}.`
                : "Awaiting bank details."}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {receiptPath ? (
              <>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50"
                >
                  Print
                </button>
                <a
                  href={receiptPath}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50"
                >
                  Open in new tab
                </a>
              </>
            ) : null}

            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
            >
              Close
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="h-[70vh] bg-gray-50">
          {receiptPath ? (
            <iframe
              ref={iframeRef}
              src={receiptPath}
              title="Security Deposit Disclosure"
              className="h-full w-full"
              // allow-modals lets the print dialog open from inside the iframe.
              // keep other capabilities minimal for safety.
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
              loading="eager"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-gray-600">
              No receipt available yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
