// app/tenant/applications/search/SearchMobile.tsx
"use client";

import { Search, FileText } from "lucide-react";
import Link from "next/link";
import SearchClient from "./SearchClient";

export default function SearchMobile() {
  return (
    <main className="mx-auto max-w-lg px-4 py-6">
      <div className="rounded-xl bg-white p-5 shadow">
        <h1 className="flex items-center text-xl font-semibold text-gray-900">
          <Search className="mr-2 h-5 w-5 text-indigo-500" />
          Search firms
        </h1>
        <p className="mt-1 text-sm text-gray-600">Find your property manager to begin.</p>

        <div className="mt-3">
          <Link
            href="/tenant/applications/join"
            className="inline-flex w-full items-center justify-center rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50"
          >
            <FileText className="mr-2 h-4 w-4 text-gray-500" />
            Enter invite code
          </Link>
        </div>

        <div className="mt-5">
          <SearchClient />
        </div>
      </div>
    </main>
  );
}
