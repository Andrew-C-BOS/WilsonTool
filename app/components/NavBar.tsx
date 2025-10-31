"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

/**
 * NavBar.tsx
 * - Two roles: "tenant" and "landlord"
 * - Role inferred from path (/tenant/* or /landlord/*), else persisted in localStorage
 * - Active link highlighting
 * - Mobile menu with focus trap, escape to close, click-outside to close
 * - Pure Tailwind for responsiveness (no JS width checks)
 */

type Role = "tenant" | "landlord";

const TENANT_LINKS = [
  { href: "/tenant", label: "Home" },
  { href: "/tenant/applications", label: "Applications" },
  { href: "/tenant/payments", label: "Payments" },
  { href: "/tenant/documents", label: "Documents" },
];

const LANDLORD_LINKS = [
  { href: "/landlord", label: "Dashboard" },
  { href: "/landlord/applications", label: "Applications" },
  { href: "/landlord/units", label: "Units" },
  { href: "/landlord/payments", label: "Payments" },
  { href: "/landlord/leases", label: "Leases" },
  { href: "/landlord/documents", label: "Documents" },
];

const ROLE_STORAGE_KEY = "milo.role";

function inferRoleFromPath(path: string): Role | null {
  if (path.startsWith("/tenant")) return "tenant";
  if (path.startsWith("/landlord")) return "landlord";
  return null;
}

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();

  const inferred = useMemo(() => inferRoleFromPath(pathname || "/"), [pathname]);

  const [role, setRole] = useState<Role>(() => {
    if (typeof window === "undefined") return "landlord";
    const fromPath = inferRoleFromPath(typeof window !== "undefined" ? window.location.pathname : "/");
    if (fromPath) return fromPath;
    const stored = window.localStorage.getItem(ROLE_STORAGE_KEY) as Role | null;
    return stored || "landlord";
  });

  const [mobileOpen, setMobileOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Keep role in sync with URL when a role segment is present
  useEffect(() => {
    if (inferred && inferred !== role) setRole(inferred);
  }, [inferred]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist role changes
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ROLE_STORAGE_KEY, role);
    }
  }, [role]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Escape to close, click outside to close
  useEffect(() => {
    if (!mobileOpen) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(target) && !buttonRef.current?.contains(target)) {
        setMobileOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [mobileOpen]);

  const links = role === "tenant" ? TENANT_LINKS : LANDLORD_LINKS;

  function isActive(href: string) {
    if (!pathname) return false;
    // exact for role root, prefix for deeper routes
    if (href === "/tenant" || href === "/landlord") return pathname === href;
    return pathname.startsWith(href);
  }

  function switchRole(nextRole: Role) {
    if (nextRole === role) return;
    setRole(nextRole);

    // Navigate to parallel root, simple, predictable
    router.push(nextRole === "tenant" ? "/tenant" : "/landlord");
  }

  return (
    <nav className="w-full bg-white border-b border-gray-200">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <Link href="/" className="text-lg sm:text-xl font-semibold tracking-tight text-gray-900">
            MILO
          </Link>

          {/* Role switcher (desktop) */}
          <div className="hidden md:flex items-center">
            <div className="inline-flex rounded-lg border border-gray-300 p-0.5 bg-gray-50">
              <button
                type="button"
                onClick={() => switchRole("tenant")}
                className={`px-3 py-1.5 text-sm rounded-md transition
                  ${role === "tenant" ? "bg-white shadow-sm text-gray-900" : "text-gray-600 hover:text-gray-900"}`}
                aria-pressed={role === "tenant"}
              >
                Tenant
              </button>
              <button
                type="button"
                onClick={() => switchRole("landlord")}
                className={`px-3 py-1.5 text-sm rounded-md transition
                  ${role === "landlord" ? "bg-white shadow-sm text-gray-900" : "text-gray-600 hover:text-gray-900"}`}
                aria-pressed={role === "landlord"}
              >
                Landlord
              </button>
            </div>
          </div>
        </div>

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
        </div>

        {/* Mobile menu button */}
        <div className="md:hidden">
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-menu"
            className="inline-flex items-center justify-center rounded-md border border-gray-300 px-3 py-2 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <span className="sr-only">Open menu</span>
            {/* Simple icon, no external deps */}
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile panel */}
      {mobileOpen && (
        <div id="mobile-menu" ref={panelRef} className="md:hidden border-t border-gray-200">
          {/* Role switcher (mobile) */}
          <div className="px-4 py-3">
            <div className="inline-flex rounded-lg border border-gray-300 p-0.5 bg-gray-50">
              <button
                type="button"
                onClick={() => switchRole("tenant")}
                className={`px-3 py-1.5 text-sm rounded-md transition
                  ${role === "tenant" ? "bg-white shadow-sm text-gray-900" : "text-gray-600 hover:text-gray-900"}`}
                aria-pressed={role === "tenant"}
              >
                Tenant
              </button>
              <button
                type="button"
                onClick={() => switchRole("landlord")}
                className={`px-3 py-1.5 text-sm rounded-md transition
                  ${role === "landlord" ? "bg-white shadow-sm text-gray-900" : "text-gray-600 hover:text-gray-900"}`}
                aria-pressed={role === "landlord"}
              >
                Landlord
              </button>
            </div>
          </div>

          {/* Links */}
          <div className="px-2 pb-3 space-y-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`block rounded-md px-3 py-2 text-base transition ${
                  isActive(l.href)
                    ? "bg-gray-100 text-gray-900 font-medium"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
