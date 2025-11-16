// app/join/[code]/JoinDesktop.tsx
"use client";

import JoinClient from "./JoinClient";
import { UserPlus } from "lucide-react";

export default function JoinDesktop({ code }: { code: string }) {
  return (
    <main className="min-h-[calc(100vh)] bg-[#e6edf1]">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8">
        {/* Hero / header */}
        <header className="rounded-3xl bg-gradient-to-r from-indigo-50 via-sky-50 to-rose-50 p-6 shadow-sm ring-1 ring-indigo-100/60">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-indigo-700">
                <span className="inline-flex items-center rounded-full bg-indigo-600 px-3 py-1 text-[11px] font-semibold text-white shadow-sm">
                  Invite · Join household
                </span>
                <span className="hidden text-indigo-500 sm:inline">
                  From your property manager
                </span>
              </div>
              <h1 className="mt-3 flex items-center text-2xl font-semibold text-gray-900">
                <span className="mr-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/80 shadow-sm">
                  <UserPlus className="h-4 w-4 text-indigo-500" />
                </span>
                Join a household
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-gray-700">
                This link connects you to a household for a specific application or lease,
                we’ll check the invite, align it with your account, and then link you to
                the right household,
              </p>
            </div>
          </div>
        </header>

        {/* Main content card */}
        <section className="mt-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-3 border-b border-gray-100 pb-3">
            <h2 className="text-sm font-semibold text-gray-900">
              Invitation details & next steps
            </h2>
            <p className="mt-1 text-xs text-gray-600">
              We’ll confirm the invite, make sure the email and account match, and then
              join you to the household if everything looks good,
            </p>
          </div>

          <JoinClient code={code} />
        </section>
      </div>
    </main>
  );
}
