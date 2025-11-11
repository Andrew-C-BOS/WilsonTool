"use client";

import type { InspectionDoc } from "./InspectionRouter";
import { useEffect, useMemo, useRef, useState } from "react";

/* ---- Recommended shots per room ---- */
const TEMPLATE: { name: string; shots: string[] }[] = [
  { name: "Kitchen",       shots: ["Floor", "Walls", "Ceiling", "Sink/Counter", "Stove/Oven", "Fridge", "Windows", "Doors"] },
  { name: "Living Room",   shots: ["Floor", "Walls", "Ceiling", "Windows", "Doors", "Outlets/Switches"] },
  { name: "Bedroom 1",     shots: ["Floor", "Walls", "Ceiling", "Closet", "Windows", "Doors"] },
  { name: "Bathroom 1",    shots: ["Floor", "Walls", "Ceiling", "Sink/Vanity", "Toilet", "Tub/Shower", "Tiles/Grout", "Vent/Fan"] },
  { name: "Exterior / Entry", shots: ["Door/Lock", "Mailbox/Package Area"] },
];

type Issue = InspectionDoc["items"][number];

const toDataURL = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("read_fail"));
    fr.onload = () => resolve(String(fr.result));
    fr.readAsDataURL(file);
  });

const uniq = <T,>(xs: T[]) => Array.from(new Set(xs));

/* ---------- Scroll lock utility (stable on iOS Safari) ---------- */
function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const y = window.scrollY;
    const b = document.body;
    b.style.position = "fixed";
    b.style.top = `-${y}px`;
    b.style.left = "0";
    b.style.right = "0";
    b.style.width = "100%";
    b.style.overflow = "hidden";
    b.style.touchAction = "none";
    b.style.overscrollBehavior = "none";
    return () => {
      const restoreY = -parseInt(b.style.top || "0", 10) || 0;
      b.style.position = "";
      b.style.top = "";
      b.style.left = "";
      b.style.right = "";
      b.style.width = "";
      b.style.overflow = "";
      b.style.touchAction = "";
      b.style.overscrollBehavior = "";
      window.scrollTo(0, restoreY);
    };
  }, [active]);
}

/* ---------- Bottom Sheet ---------- */
function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useScrollLock(open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" style={{ height: "100dvh" }} aria-modal="true" role="dialog">
      <button aria-label="Close" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="absolute bottom-0 left-0 right-0 w-full max-w-md mx-auto rounded-t-2xl bg-white shadow"
        style={{ maxHeight: "100dvh", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 12px)" }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-3 pb-2 border-b border-gray-100">
          <div className="mx-auto h-1.5 w-12 rounded-full bg-gray-200" />
          {title ? <div className="mt-2 text-sm font-medium text-gray-900">{title}</div> : null}
        </div>
        <div className="px-4 pt-2 pb-3 overflow-y-auto" style={{ maxHeight: "calc(100dvh - 56px)" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ---------- Inline error toast ---------- */
function ErrorToast({ msg, detail, onClose }: { msg: string; detail?: string; onClose: () => void }) {
  if (!msg) return null;
  return (
    <div className="fixed top-3 left-0 right-0 z-[60]">
      <div className="mx-auto max-w-md px-4">
        <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 shadow">
          <div className="flex items-start gap-3">
            <div className="text-rose-700 text-sm font-medium">Error</div>
            <button onClick={onClose} className="ml-auto text-xs underline text-rose-700">Dismiss</button>
          </div>
          <div className="mt-1 text-xs text-rose-900 break-words">{msg}</div>
          {detail ? (
            <div className="mt-1 text-[11px] text-rose-900/80 break-words">
              {detail.length > 220 ? detail.slice(0, 220) + "…" : detail}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function InspectionMobile({ doc, onChange }: { doc: InspectionDoc; onChange: (d: InspectionDoc) => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  // error toast state
  const [errMsg, setErrMsg] = useState("");
  const [errDetail, setErrDetail] = useState("");

  // preview (new capture)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<{ room: string; category: string } | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [sevDraft, setSevDraft] = useState<"low" | "medium" | "high">("low");
  const [damageMode, setDamageMode] = useState<"ok" | "damage">("ok");

  // edit existing
  const [editItem, setEditItem] = useState<Issue | null>(null);
  const [editNote, setEditNote] = useState("");
  const [editSev, setEditSev] = useState<"low" | "medium" | "high">("low");

  // "Other Damage / Concerns"
  const [otherText, setOtherText] = useState("");

  const fileRef = useRef<HTMLInputElement | null>(null);
  const pickedFileRef = useRef<File | null>(null);

  /* Rooms */
  const discoveredRooms = useMemo(() => uniq(doc.items.map(i => i.room || "General")), [doc.items]);
  const roomNames = useMemo(() => {
    const baseline = TEMPLATE.map(r => r.name);
    return uniq([...baseline, ...discoveredRooms]).length ? uniq([...baseline, ...discoveredRooms]) : ["General"];
  }, [discoveredRooms]);
  const currentRoom = roomNames[step] ?? roomNames[0];
  const shotsFor = (room: string) => TEMPLATE.find(r => r.name === room)?.shots ?? ["General"];

  /* Items grouped per category for current room */
  const itemsInRoom = useMemo(() => doc.items.filter(i => (i.room || "General") === currentRoom), [doc.items, currentRoom]);
  const byCategory = useMemo(() => {
    const m = new Map<string, Issue[]>();
    shotsFor(currentRoom).forEach(s => m.set(s, []));
    for (const it of itemsInRoom) {
      const key = it.category || "General";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(it);
    }
    return m;
  }, [itemsInRoom, currentRoom]);

  const totals = useMemo(() => {
    const required = shotsFor(currentRoom).length;
    const have = Array.from(byCategory.values()).filter(arr => arr.some(i => (i.photos?.length ?? 0) > 0)).length;
    return { required, have, pct: required ? Math.round((have / required) * 100) : 0 };
  }, [byCategory, currentRoom]);

  /* Camera */
  function openCamera(cat: string) {
    setPreviewSrc(null);
    setNoteDraft("");
    setSevDraft("low");
    setDamageMode("ok");
    setPreviewMeta({ room: currentRoom, category: cat });
    fileRef.current?.click();
  }
  const onPick = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    ev.target.value = "";
    if (!f) return;
    pickedFileRef.current = f;                 // real file for S3 upload
    setPreviewSrc(await toDataURL(f));         // instant preview (not stored)
  };

  /* Error helper */
  function showError(msg: string, detail?: string) {
    setErrMsg(msg);
    setErrDetail(detail || "");
    window.clearTimeout((showError as any)._t);
    (showError as any)._t = window.setTimeout(() => {
      setErrMsg(""); setErrDetail("");
    }, 7000);
  }
  
  async function saveEdit() {
    if (!editItem) return;

    const nextDesc = (editNote ?? "").trim();
    const allowedSev = ["low", "medium", "high"] as const;
    const nextSev = allowedSev.includes(editSev) ? editSev : "low";

    const curDesc = (editItem.description ?? "").trim();
    const curSev = (editItem.severity as any) ?? "low";
    if (nextDesc === curDesc && nextSev === curSev) {
      setEditItem(null);
      return;
    }

    setBusy(true);
    try {
      await persistUpdate(editItem.id, { description: nextDesc, severity: nextSev });
    } catch (e: any) {
      if (typeof (window as any).showError === "function") {
        (window as any).showError("Save failed", e?.message || String(e));
      } else if (typeof showError === "function") {
        showError("Save failed", e?.message || String(e));
      } else {
        alert(`Save failed: ${e?.message || e}`);
      }
    } finally {
      setBusy(false);
      setEditItem(null);
    }
  }

  async function deleteEdit() {
    if (!editItem) return;
    setBusy(true);
    try {
      await persistRemove(editItem.id);
    } catch (e: any) {
      if (typeof showError === "function") {
        showError("Delete failed", e?.message || String(e));
      } else {
        alert(`Delete failed: ${e?.message || e}`);
      }
    } finally {
      setBusy(false);
      setEditItem(null);
    }
  }

  /* Presigned upload helper (S3) WITH DIAGNOSTICS */
  async function uploadToS3(file: File): Promise<string> {
    const init = await fetch("/api/tenant/inspection/upload-init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: file.type, ext: file.name.split(".").pop() }),
    });

    let initBody = "";
    try { initBody = await init.text(); } catch {}
    if (!init.ok) {
      showError(`upload-init ${init.status} ${init.statusText}`, initBody);
      throw new Error(`upload-init ${init.status} ${init.statusText}`);
    }

    let j: any = {};
    try { j = JSON.parse(initBody); } catch {
      showError("upload-init bad JSON", initBody.slice(0, 200));
      throw new Error("upload-init bad JSON");
    }
    if (!j?.ok || !j?.putUrl || !j?.getUrl) {
      showError("upload-init response missing fields", JSON.stringify(j).slice(0, 200));
      throw new Error("upload-init missing fields");
    }

    const put = await fetch(j.putUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    let putBody = "";
    try { putBody = await put.text(); } catch {}
    if (!put.ok) {
      showError(`s3 put ${put.status} ${put.statusText}`, putBody.slice(0, 240));
      throw new Error(`s3 put ${put.status} ${put.statusText}`);
    }

    return j.getUrl as string; // S3 (or CF) GET URL
  }

  /* Persist helpers — store URL pointers only */
  async function persistAdd(room: string, category: string, description: string, severity: "low"|"medium"|"high", photoUrl: string) {
    const now = new Date().toISOString();
    onChange({
      ...doc,
      items: [...doc.items, { id: Math.random().toString(36).slice(2), room, category, description, severity, photos: photoUrl ? [photoUrl] : [], createdAt: now } as Issue],
      updatedAt: now,
    });

    const res = await fetch("/api/tenant/inspection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "add", item: { room, category, description, severity, photos: photoUrl ? [photoUrl] : [] } }),
    });

    const jrText = await res.text().catch(() => "");
    if (!res.ok) {
      showError(`persist add ${res.status} ${res.statusText}`, jrText.slice(0, 240));
      throw new Error(`persist add failed`);
    }
    let jr: any = {};
    try { jr = JSON.parse(jrText); } catch {
      showError("persist add bad JSON", jrText.slice(0, 240));
      throw new Error("persist add bad JSON");
    }
    if (!jr?.ok) {
      showError("persist add not ok", JSON.stringify(jr).slice(0, 240));
      throw new Error("persist add not ok");
    }
    onChange(jr.inspection);
  }

  async function persistUpdate(itemId: string, patch: { description?: string; severity?: "low"|"medium"|"high" }) {
    onChange({ ...doc, items: doc.items.map(i => i.id === itemId ? { ...i, ...patch } : i), updatedAt: new Date().toISOString() });
    await fetch("/api/tenant/inspection", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "update_item", itemId, ...patch }) });
  }

  async function persistRemove(itemId: string) {
    const prev = doc;
    onChange({ ...doc, items: doc.items.filter(i => i.id !== itemId), updatedAt: new Date().toISOString() });
    try {
      const res = await fetch("/api/tenant/inspection", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "remove_item", itemId }) });
      const jrText = await res.text().catch(() => "");
      if (!res.ok) {
        showError(`remove ${res.status} ${res.statusText}`, jrText.slice(0, 240));
        throw new Error("remove failed");
      }
      const jr = JSON.parse(jrText);
      if (!jr?.ok) showError("remove not ok", jrText.slice(0, 240));
      onChange(jr.inspection);
    } catch {
      onChange(prev);
    }
  }
  
  function openEdit(it: Issue) {
	  if (!it) return;

	  // Normalize fields so the editor always has sane defaults
	  const desc = (it.description ?? "").toString();
	  const sev = ((it.severity as any) ?? "low") as "low" | "medium" | "high";
	  const photos = Array.isArray(it.photos) ? it.photos : [];

	  // Set the item being edited and seed form controls
	  setEditItem({ ...it, description: desc, severity: sev, photos });
	  setEditNote(desc);
	  setEditSev(sev);

	  // Optional: ensure the sheet's scroll starts at the top (nice on mobile)
	  requestAnimationFrame(() => {
		const sheetScroller = document.querySelector(
		  '[role="dialog"] .overflow-y-auto'
		) as HTMLElement | null;
		if (sheetScroller) sheetScroller.scrollTop = 0;
	  });
	}


  /* Save “Other” note */
  async function saveOther() {
    const text = otherText.trim();
    if (!text) return;
    setBusy(true);
    try {
      await persistAdd("Other / Notes", "General", text, "medium", "");
      setOtherText("");
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    } catch (e: any) {
      showError("Save note failed", e?.message);
    } finally {
      setBusy(false);
    }
  }

  /* Smooth jump-to-top */
  function jumpTop() {
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  /* Nav */
  function nextRoom() {
    setStep((s) => {
      const n = Math.min(roomNames.length - 1, s + 1);
      jumpTop();
      return n;
    });
  }
  function prevRoom() {
    setStep((s) => {
      const n = Math.max(0, s - 1);
      jumpTop();
      return n;
    });
  }

  /* Preview actions */
  async function acceptPreview() {
    if (!previewMeta || !pickedFileRef.current) return;
    setBusy(true);
    try {
      const desc = damageMode === "damage" ? noteDraft : "";
      const sev  = damageMode === "damage" ? sevDraft : "low";

      const url = await uploadToS3(pickedFileRef.current);

      const missingBefore = shotsFor(previewMeta.room).filter(cat => {
        const arr = byCategory.get(cat) ?? [];
        return !arr.some(i => (i.photos?.length ?? 0) > 0);
      });

      await persistAdd(previewMeta.room, previewMeta.category, desc, sev, url);

      if (missingBefore.length === 1 && missingBefore[0] === previewMeta.category) {
        nextRoom();
      }
    } catch (e: any) {
      showError("Upload/Save failed", e?.message || String(e));
    } finally {
      setBusy(false);
      setPreviewSrc(null);
      setPreviewMeta(null);
      setNoteDraft("");
      setSevDraft("low");
      setDamageMode("ok");
      pickedFileRef.current = null;
    }
  }

  function retakePreview() { if (previewMeta) { setPreviewSrc(null); fileRef.current?.click(); } }
  function cancelPreview() { setPreviewSrc(null); setPreviewMeta(null); }

  // Avoid hydration mismatches: render nothing until mounted
  if (!mounted) return null;

  return (
    <div className="mx-auto max-w-md px-4 pb-28 space-y-4">
      {/* error toast */}
      <ErrorToast msg={errMsg} detail={errDetail} onClose={() => { setErrMsg(""); setErrDetail(""); }} />

      {/* hidden camera input */}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPick} className="hidden" />

      {/* header */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-xs text-gray-500">Pre-Move Inspection</div>
        <div className="mt-1 flex items-center justify-between">
          <div className="text-sm font-medium text-gray-900">{currentRoom}</div>
          <div className="text-xs text-gray-600">Room {step + 1} / {roomNames.length}</div>
        </div>
        <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-gray-100">
          <div className="h-3 bg-blue-600" style={{ width: `${totals.pct}%` }} />
        </div>
        <div className="mt-1 text-right text-xs text-gray-600">{totals.pct}% complete</div>
      </section>

      {/* Recommended shots */}
      <section className="rounded-xl border border-gray-200 bg-white p-0 overflow-hidden">
        <div className="px-4 py-3 text-sm font-medium text-gray-900">Recommended Shots</div>
        <ul className="divide-y divide-gray-100">
          {shotsFor(currentRoom).map((cat) => {
            const arr = byCategory.get(cat) ?? [];
            const count = arr.reduce((n, i) => n + (i.photos?.length ?? 0), 0);

            return (
              <li key={cat} className="px-4 py-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-gray-900">{cat}</div>
                    <div className="text-[11px] text-gray-500">{count} photo{count === 1 ? "" : "s"} captured</div>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => openCamera(cat)}
                    className="ml-3 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-60"
                  >
                    {count ? "Add Photo" : "Take Photo"}
                  </button>
                </div>

                {/* Thumbnails drawer */}
                {arr.length > 0 && (
                  <div className="mt-3 overflow-x-auto">
                    <div className="flex gap-2">
                      {arr.map((it) => (
                        <button
                          key={it.id}
                          onClick={() => openEdit(it)}
                          className="relative h-24 w-24 shrink-0 rounded overflow-hidden border border-gray-200"
                          title="Tap to edit / delete"
                        >
                          {it.photos?.[0] ? (
                            <img
                              src={`/api/tenant/inspection/img?u=${encodeURIComponent(it.photos[0])}`}
                              alt="thumb"
                              loading="lazy"
                              className="h-full w-full object-cover"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).src =
                                  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='100%' height='100%' fill='%23f3f4f6'/><text x='50%' y='50%' dy='.35em' text-anchor='middle' font-size='12' fill='%23999'>image</text></svg>";
                              }}
                            />
                          ) : (
                            <div className="grid h-full w-full place-items-center text-[10px] text-gray-500">No photo</div>
                          )}
                          <span
                            className={
                              "absolute left-0 top-0 m-1 rounded px-1 text-[10px] text-white " +
                              (it.severity === "high" ? "bg-rose-600" : it.severity === "medium" ? "bg-amber-600" : "bg-gray-700")
                            }
                          >
                            {it.severity ?? "low"}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Other notes */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-sm font-medium text-gray-900">Other Damage / Concerns</div>
        <textarea
          className="mt-2 w-full rounded border border-gray-300 p-2 text-sm"
          rows={3}
          placeholder="Add any other issues you noticed…"
          value={otherText}
          onChange={(e) => setOtherText(e.target.value)}
        />
        <div className="mt-2 flex justify-end">
          <button
            disabled={busy || !otherText.trim()}
            onClick={saveOther}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Save note
          </button>
        </div>
      </section>

      {/* fixed footer navbar (Back / Next + jump-to-top) */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-md px-4">
          <div className="flex gap-2 py-3">
            <button
              onClick={prevRoom}
              disabled={step === 0}
              className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
            >
              Back
            </button>
            <button
              onClick={nextRoom}
              className="flex-1 rounded-md bg-blue-600 text-white px-3 py-2 text-sm"
            >
              Next room
            </button>
          </div>
          <div style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }} />
        </div>
      </div>

      {/* Preview sheet */}
      <Sheet
        open={!!previewMeta}
        title={previewMeta ? `${previewMeta.room} — ${previewMeta.category}` : undefined}
        onClose={cancelPreview}
      >
        {previewSrc ? (
          <img src={previewSrc} alt="Preview" className="w-full rounded" />
        ) : (
          <div className="text-sm text-gray-500">Waiting for camera…</div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setDamageMode("ok")}
            className={"rounded-md px-3 py-1.5 text-sm border " + (damageMode === "ok" ? "border-blue-600 text-blue-700" : "border-gray-300 text-gray-700")}
          >
            Mark OK
          </button>
          <button
            onClick={() => setDamageMode("damage")}
            className={"rounded-md px-3 py-1.5 text-sm border " + (damageMode === "damage" ? "border-rose-600 text-rose-700" : "border-gray-300 text-gray-700")}
          >
            Flag Damage
          </button>
        </div>

        {damageMode === "damage" && (
          <>
            <div className="mt-3">
              <label className="text-[11px] text-gray-500">Damage note</label>
              <textarea
                className="mt-1 w-full rounded border border-gray-300 p-2 text-sm"
                rows={2}
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Describe any damage you see"
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <label className="text-[11px] text-gray-500">Severity</label>
              <select
                value={sevDraft}
                onChange={(e) => setSevDraft(e.target.value as any)}
                className="rounded border border-gray-300 p-1.5 text-xs"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2">
          <button onClick={retakePreview} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">
            Retake
          </button>
          <button onClick={cancelPreview} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">
            Cancel
          </button>
          <button
            disabled={!previewSrc || busy}
            onClick={acceptPreview}
            className="rounded-md bg-blue-600 text-white px-3 py-2 text-sm disabled:opacity-60"
          >
            Accept
          </button>
        </div>
      </Sheet>

      {/* Edit sheet */}
      <Sheet
        open={!!editItem}
        title={editItem ? `${editItem.room} — ${editItem.category}` : undefined}
        onClose={() => setEditItem(null)}
      >
        {editItem?.photos?.[0] ? (
          <img
            src={`/api/tenant/inspection/img?u=${encodeURIComponent(editItem.photos[0])}`}
            alt="Edit"
            className="w-full rounded"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src =
                "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='200'><rect width='100%' height='100%' fill='%23f3f4f6'/><text x='50%' y='50%' dy='.35em' text-anchor='middle' font-size='14' fill='%23999'>image</text></svg>";
            }}
          />
        ) : (
          <div className="text-sm text-gray-500">No photo</div>
        )}

        <div className="mt-3">
          <label className="text-[11px] text-gray-500">Damage note</label>
          <textarea
            className="mt-1 w-full rounded border border-gray-300 p-2 text-sm"
            rows={2}
            value={editNote}
            onChange={(e) => setEditNote(e.target.value)}
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label className="text-[11px] text-gray-500">Severity</label>
          <select
            value={editSev}
            onChange={(e) => setEditSev(e.target.value as any)}
            className="rounded border border-gray-300 p-1.5 text-xs"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <button
            onClick={deleteEdit}
            className="ml-auto rounded-md border border-gray-300 bg-white px-3 py-2 text-xs text-rose-700 hover:bg-rose-50"
          >
            Delete
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={() => setEditItem(null)} className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">
            Close
          </button>
          <button
            disabled={busy}
            onClick={saveEdit}
            className="rounded-md bg-blue-600 text-white px-3 py-2 text-sm disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </Sheet>
    </div>
  );
}
