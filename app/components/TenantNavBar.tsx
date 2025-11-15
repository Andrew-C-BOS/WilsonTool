"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import LogoutButton from "./LogoutButton";

export default function TenantNavBar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const links = [
    { href: "/tenant", label: "Home" },
    { href: "/tenant/household", label: "My Household" },
    { href: "/tenant/applications", label: "Applications" },
    { href: "/tenant/lease", label: "My Lease" },
    //{ href: "/tenant/documents", label: "Documents" },
  ];

    const isActive = (href: string) => {
		// Home should only be active on the exact /tenant route
		if (href === "/tenant") {
		  return pathname === "/tenant";
		}
		// Other links: exact match or nested path
		return pathname === href || pathname.startsWith(href + "/");
	  };


  // close on outside click / escape for mobile sheet
  useEffect(() => {
    if (!mobileOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setMobileOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  return (
    <nav className="relative z-30 w-full bg-[#e6edf1]/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center px-4 sm:px-6 lg:px-8">
        {/* Inner pill container */}
        <div className="flex w-full items-center justify-between rounded-full bg-white/95 px-4 py-2 shadow-md ring-1 ring-slate-100">
          {/* Brand */}
          <Link
            href="/tenant"
            className="flex items-center gap-2 rounded-full px-2 py-1 text-sm font-semibold text-slate-900"
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
              M
            </span>
            <span className="hidden text-sm sm:inline-block">MILO Tenant</span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden items-center gap-6 md:flex">
            <div className="flex items-center gap-1 rounded-full bg-slate-50 px-1 py-1">
              {links.map((l) => {
                const active = isActive(l.href);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={[
                      "rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200",
                      active
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-600 hover:bg-white hover:text-slate-900",
                    ].join(" ")}
                  >
                    {l.label}
                  </Link>
                );
              })}
            </div>
            <div className="ml-2">
              <LogoutButton />
            </div>
          </div>

          {/* Mobile toggle */}
          <div className="md:hidden">
            <button
              aria-label="Open navigation"
              onClick={() => setMobileOpen((v) => !v)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  d="M4 6h16M4 12h16M4 18h16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile sheet */}
      {mobileOpen && (
        <div className="md:hidden">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div
              ref={panelRef}
              className="mt-2 overflow-hidden rounded-2xl bg-white/95 shadow-lg ring-1 ring-slate-200 animate-[fadeDown_0.15s_ease-out]"
            >
              <div className="space-y-1 px-2 py-2">
                {links.map((l) => {
                  const active = isActive(l.href);
                  return (
                    <Link
                      key={l.href}
                      href={l.href}
                      onClick={() => setMobileOpen(false)}
                      className={[
                        "block rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-slate-900 text-white"
                          : "text-slate-700 hover:bg-slate-50",
                      ].join(" ")}
                    >
                      {l.label}
                    </Link>
                  );
                })}
              </div>
              <div className="border-t border-slate-100 px-3 py-2">
                <LogoutButton />
              </div>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
