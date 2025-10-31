// app/landlord/forms/page.tsx
import { Suspense } from "react";
import ManageFormsClient from "./ManageFormsClient";

export default function FormsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold text-gray-900">Manage application forms</h1>
          <p className="text-sm text-gray-600 mt-1">
            Share forms by link or QR, send invites by email, edit any form in the builder,
          </p>
        </div>

        <Suspense fallback={<div className="text-sm text-gray-500">Loading…</div>}>
          <ManageFormsClient />
        </Suspense>
      </div>
    </div>
  );
}
