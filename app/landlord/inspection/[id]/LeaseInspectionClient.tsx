// app/landlord/inspection/[id]/LeaseInspectionClient.tsx
"use client";

import { useEffect, useState } from "react";
import InspectionMobile from "../InspectionMobile";

type Issue = {
  id: string;
  room: string;
  category: string;
  description: string;
  severity: "low" | "medium" | "high";
  photos: string[];
  createdAt: string;
};

export type InspectionDoc = {
  _id: string;
  householdId: string | null;
  leaseId: string;
  status: "draft" | "submitted";
  items: Issue[];
  createdAt: string;
  updatedAt: string;
};

type Envelope =
  | { ok: true; inspection: InspectionDoc }
  | { ok: false; error: string };

export default function LeaseInspectionClient({ leaseId }: { leaseId: string }) {
  const [doc, setDoc] = useState<InspectionDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const res = await fetch(`/api/landlord/inspection?leaseId=${encodeURIComponent(leaseId)}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${txt}`);
        }
        const data: Envelope = await res.json();
        if (!("ok" in data) || !data.ok) {
          throw new Error((data as any)?.error || "load_failed");
        }
        setDoc(data.inspection);
      } catch (e: any) {
        console.error(e);
        setErr(e?.message || "Couldn’t load inspection,");
      } finally {
        setLoading(false);
      }
    })();
  }, [leaseId]);

  if (loading && !doc) {
    return <div className="px-4 pt-6 text-sm text-gray-600">Loading inspection…</div>;
  }

  if (err) {
    return (
      <div className="px-4 pt-6">
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {err}
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="px-4 pt-6 text-sm text-gray-600">
        No inspection document found for this lease,
      </div>
    );
  }

  return <InspectionMobile doc={doc} onChange={setDoc} />;
}
