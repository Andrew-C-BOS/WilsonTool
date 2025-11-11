// app/tenant/applications/search/SearchDesktop.tsx
"use client";

import { useState } from "react";
import { Search, FileText } from "lucide-react";
import SearchClient from "./SearchClient";

/* tiny util */
function clsx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

/** Reusable lightweight modal, same behavior as ApplicationsDesktop */
function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          "fixed inset-x-0 bottom-0 top-auto w-full rounded-t-2xl bg-white shadow-xl ring-1 ring-gray-200",
          "sm:left-1/2 sm:top-16 sm:bottom-auto sm:w-[92%] sm:max-w-md sm:-translate-x-1/2 sm:rounded-xl"
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 hover:bg-gray-50 active:opacity-80"
          >
            Close
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export default function SearchDesktop() {
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  function onJoin() {
    const code = joinCode.trim();
    if (!code) return setToast("Enter an invite code,");
    window.location.href = `/tenant/apply?form=${encodeURIComponent(code)}`;
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 rounded-xl bg-white p-6 shadow">
        <h1 className="flex items-center text-2xl font-semibold text-gray-900">
          <Search className="mr-2 h-6 w-6 text-indigo-500" />
          Search firms
        </h1>
        <p className="mt-2 text-gray-600">
          Find your property manager or firm, then start the right application,
        </p>
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setJoinOpen(true)}
            className="inline-flex items-center rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50"
          >
            <FileText className="mr-2 h-4 w-4 text-gray-500" />
            Have a code? Enter invite code
          </button>
        </div>
      </header>

      <section className="rounded-xl bg-white p-6 shadow">
        <SearchClient />
      </section>

      {/* Join modal (same UX as ApplicationsDesktop) */}
      <Modal open={joinOpen} title="Join an existing application" onClose={() => setJoinOpen(false)}>
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Enter the application code, we’ll attach the application to your household,
          </p>
          <label htmlFor="invite-code" className="sr-only">
            Invite code
          </label>
          <input
            id="invite-code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onJoin()}
            placeholder="Invite code"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            inputMode="text"
            autoCapitalize="characters"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setJoinOpen(false)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm active:opacity-90"
            >
              Cancel
            </button>
            <button
              onClick={onJoin}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 active:opacity-90"
            >
              Continue
            </button>
          </div>
          <p className="text-xs text-gray-500">If you have a link, open it directly, we’ll handle the rest,</p>
        </div>
      </Modal>

      {/* Minimal toast, optional */}
      {toast && (
        <div
          className="fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-1.5rem)] sm:w-auto sm:bottom-4"
          role="status"
          aria-live="polite"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="mx-auto rounded-md bg-gray-900 text-white text-sm px-4 py-2 shadow-lg">
            {toast}
            <button className="ml-3 underline underline-offset-2" onClick={() => setToast(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
