import type { ReactNode } from "react";
import TenantNavBar from "../components/TenantNavBar";

export default function TenantLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <TenantNavBar />
      <main className="p-6">{children}</main>
    </div>
  );
}
