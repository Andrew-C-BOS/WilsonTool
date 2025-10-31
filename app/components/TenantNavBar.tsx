"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import LogoutButton from "./LogoutButton"; // re-use your existing button

export default function TenantNavBar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const links = [
    { href: "/tenant", label: "Home" },
    { href: "/tenant/applications", label: "Applications" },
    { href: "/tenant/payments", label: "Payments" },
    { href: "/tenant/documents", label: "Documents" },
    // { href: "/tenant/maintenance", label: "Maintenance" }, // add later if needed
  ];

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  // close on outside click / escape
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
    <nav className="w-full border-b border-gray-200 bg-white">
      <div className="mx-auto max-w-7xl flex items-center justify-between h-14 px-4 sm:px-6 lg:px-8">
        {/* Brand (clicking logo sends to tenant home) */}
        <Link href="/tenant" className="text-lg font-semibold text-gray-900">
          MILO Tenant
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-6">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`text-sm transition ${
                isActive(l.href)
                  ? "text-gray-900 font-medium"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {l.label}
            </Link>
          ))}
          <LogoutButton />
        </div>

        {/* Mobile toggle */}
        <div className="md:hidden">
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="inline-flex items-center justify-center rounded-md border border-gray-300 px-3 py-2 text-gray-700 hover:bg-gray-50"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile panel */}
      {mobileOpen && (
        <div ref={panelRef} className="md:hidden border-t border-gray-200 bg-white px-2 pb-3 space-y-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`block rounded-md px-3 py-2 text-base transition ${
                isActive(l.href)
                  ? "bg-gray-100 text-gray-900 font-medium"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
              onClick={() => setMobileOpen(false)}
            >
              {l.label}
            </Link>
          ))}
          <div className="border-t border-gray-100 pt-2">
            <LogoutButton />
          </div>
        </div>
      )}
    </nav>
  );
}
