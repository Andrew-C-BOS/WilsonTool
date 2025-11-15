// app/admin/AdminSwitcher.tsx
"use client";

import * as React from "react";
import AdminPanel from "./AdminPanel";
import LandlordUserPanel from "./LandlordUserPanel";

export default function AdminSwitcher() {
  const [active, setActive] = React.useState<"firms" | "landlords">("firms");

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:py-10">
      {/* Top header shared across both views */}
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold text-zinc-100">Admin</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Manage firms, assign users, and create landlord accounts.
        </p>

        {/* Simple toggle */}
        <div className="mt-4 inline-flex rounded-lg bg-zinc-900/70 p-1 text-xs">
          <button
            type="button"
            onClick={() => setActive("firms")}
            className={
              "rounded-md px-3 py-1.5 font-medium transition " +
              (active === "firms"
                ? "bg-zinc-800 text-zinc-50"
                : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60")
            }
          >
            Firms & memberships
          </button>
          <button
            type="button"
            onClick={() => setActive("landlords")}
            className={
              "rounded-md px-3 py-1.5 font-medium transition " +
              (active === "landlords"
                ? "bg-zinc-800 text-zinc-50"
                : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60")
            }
          >
            Create landlord user
          </button>
        </div>
      </div>

      {/* Actual contents */}
      {active === "firms" ? <AdminPanel /> : <LandlordUserPanel />}
    </div>
  );
}
