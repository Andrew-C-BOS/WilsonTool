// app/landlord/layout.tsx
import type { ReactNode } from "react";
// adjust this import to match your folder structure:
// your components folder is inside /app, so:
import LandlordNavBar from "../components/LandlordNavBar";

export default function LandlordLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <LandlordNavBar />
      <main className="p-6">{children}</main>
    </div>
  );
}
