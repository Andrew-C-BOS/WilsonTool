"use client";

import type { LeaseDoc } from "./LeaseRouter";
import { useState } from "react";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-medium text-gray-900">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export default function LeaseMobile({
  lease,
  onLeaseUpdated,
}: {
  lease: LeaseDoc;
  onLeaseUpdated: (next: LeaseDoc) => void;
}) {
  const [toast, setToast] = useState<string | null>(null);
  const currency = (cents: number) =>
    (cents ?? 0) > 0 ? `$${(cents / 100).toFixed(2)}` : "$0.00";

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 1600);
  }

  async function toggleChecklist(key: string, done: boolean) {
    const prev = lease;
    const next: LeaseDoc = {
      ...prev,
      checklist: (prev.checklist ?? []).map((it) =>
        it.key === key ? { ...it, completedAt: done ? new Date().toISOString() : null } : it
      ),
    };
    onLeaseUpdated(next);
    try {
      const res = await fetch("/api/tenant/lease/checklist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, done }),
      });
      if (!res.ok) throw new Error("update_failed");
      flash("Saved,");
    } catch {
      onLeaseUpdated(prev);
      flash("Couldn’t save,");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-10 space-y-3">
      <Section title="Lease summary">
        <div className="text-xs text-gray-600">{lease.status}</div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Unit / Rent</div>
            <div className="mt-0.5">
              {lease.unitLabel ?? "—"}
              <br />
              {currency(lease.rentCents)} / month
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Term</div>
            <div className="mt-0.5">
              {new Date(lease.startDate).toLocaleDateString()} →{" "}
              {lease.endDate ? new Date(lease.endDate).toLocaleDateString() : "open-ended"}
            </div>
          </div>
          <div className="col-span-2">
            <div className="text-xs uppercase tracking-wide text-gray-500">Address</div>
            <div className="mt-0.5">
              {lease.address.addressLine1}
              {lease.address.addressLine2 ? (
                <>
                  <br />
                  {lease.address.addressLine2}
                </>
              ) : null}
              <br />
              {lease.address.city}, {lease.address.state} {lease.address.postalCode}
            </div>
          </div>
          <div className="col-span-2">
            <div className="text-xs uppercase tracking-wide text-gray-500">Parties</div>
            <div className="mt-0.5">
              Tenant, {lease.parties?.tenantName ?? "—"}
              <br />
              Landlord, {lease.parties?.landlordName ?? "—"}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Lease documents">
        {lease.files?.length ? (
          <ul className="list-disc pl-5 space-y-1 text-sm">
            {lease.files.map((f) => (
              <li key={f.url}>
                <a className="text-blue-600 underline" href={f.url} target="_blank" rel="noreferrer">
                  {f.name}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-gray-600">No files yet,</div>
        )}
      </Section>

      <Section title="Move-in checklist">
        <ul className="space-y-2">
{(lease.checklist ?? []).map((it) => {
  const done = !!it.completedAt;
  const isInspection = it.key === "schedule_walkthrough";

  return (
    <li key={it.key} className="flex items-start gap-3">
      <input
        aria-label={it.label}
        type="checkbox"
        className="mt-1 h-5 w-5"
        checked={done}
        onChange={(e) => toggleChecklist(it.key, e.currentTarget.checked)}
      />
      <div className="flex-1">
        <div className={`font-medium ${done ? "line-through text-gray-500" : ""}`}>{it.label}</div>
        <div className="text-xs text-gray-500">
          {it.dueAt ? `Due, ${new Date(it.dueAt).toLocaleDateString()}` : null}
          {done ? `, completed, ${new Date(it.completedAt!).toLocaleDateString()}` : null}
        </div>

        {isInspection && (
          <div className="mt-2">
            <a
              href="/tenant/inspection"
              className="block w-full text-center rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900 hover:bg-gray-50 active:bg-gray-100"
            >
              Open Pre-Move Inspection
            </a>
          </div>
        )}

        {it.notes ? <div className="text-sm mt-1">{it.notes}</div> : null}
      </div>
    </li>
  );
})}

        </ul>
        {!lease.checklist?.length && <div className="text-sm text-gray-600">No checklist items yet,</div>}
      </Section>

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-gray-900 text-white text-sm px-4 py-2 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
