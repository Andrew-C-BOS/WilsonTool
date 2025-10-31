// app/landlord/forms/builder/page.tsx
import { Suspense } from "react";
import FormBuilderClient from "./FormBuilderClient";

export default function FormBuilderPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold text-gray-900">Application Form Builder</h1>
          <p className="text-sm text-gray-600 mt-1">
            Build firm‑wide application forms with sections, audience‑aware questions, and qualifications,
          </p>
        </div>
        <Suspense fallback={<div className="text-sm text-gray-500">Loading…</div>}>
          <FormBuilderClient />
        </Suspense>
      </div>
    </div>
  );
}
