"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import LogoutButton from "./LogoutButton"; // ← add this import

export default function LandlordNavBar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const links = [
    { href: "/landlord", label: "Dashboard" },
    { href: "/landlord/applications", label: "Applications" },
    { href: "/landlord/units", label: "Units" },
    { href: "/landlord/payments", label: "Payments" },
    { href: "/landlord/leases", label: "Leases" },
    { href: "/landlord/documents", label: "Documents" },
  ];

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

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
        {/* Brand */}
        <Link href="/landlord" className="text-lg font-semibold text-gray-900">
          MILO Landlord
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

          {/* Logout on desktop */}
          <LogoutButton />
        </div>

        {/* Mobile menu button */}
        <div className="md:hidden">
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="inline-flex items-center justify-center rounded-md border border-gray-300 px-3 py-2 text-gray-700 hover:bg-gray-50"
          >
            <svg width="20" height="20" viewBox="0 0 24 24">
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

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          ref={panelRef}
          className="md:hidden border-t border-gray-200 bg-white px-2 pb-3 space-y-1"
        >
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
          {/* Logout on mobile */}
          <div className="border-t border-gray-100 pt-2">
            <LogoutButton />
          </div>
        </div>
      )}
    </nav>
  );
}
