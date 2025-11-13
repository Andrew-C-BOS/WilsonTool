// app/landlord/documents/DocumentsRouter.tsx
"use client";

import DocumentsDesktop from "./DocumentsDesktop";

// If you want a separate mobile layout later, you can split it.
// For now, reuse the desktop layout on both.
const DocumentsMobile = DocumentsDesktop;

export default function DocumentsRouter({ firmId }: { firmId?: string }) {
  return (
    <div className="w-full">
      {/* Mobile */}
      <div className="block lg:hidden">
        <DocumentsMobile firmId={firmId} />
      </div>
      {/* Desktop */}
      <div className="hidden lg:block">
        <DocumentsDesktop firmId={firmId} />
      </div>
    </div>
  );
}
