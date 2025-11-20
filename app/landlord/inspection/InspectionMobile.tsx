"use client";

import type { InspectionDoc } from "./[id]/LeaseInspectionClient";
import { useEffect, useMemo, useRef, useState } from "react";

/* ---- Recommended shots per room ---- */
const TEMPLATE: { name: string; shots: string[] }[] = [
  {
    name: "Kitchen",
    shots: ["Floor", "Walls", "Ceiling", "Sink/Counter", "Stove/Oven", "Fridge", "Windows", "Doors"],
  },
  {
    name: "Living Room",
    shots: ["Floor", "Walls", "Ceiling", "Windows", "Doors", "Outlets/Switches"],
  },
  {
    name: "Bedroom 1",
    shots: ["Floor", "Walls", "Ceiling", "Closet", "Windows", "Doors"],
  },
  {
    name: "Bathroom 1",
    shots: ["Floor", "Walls", "Ceiling", "Sink/Vanity", "Toilet", "Tub/Shower", "Tiles/Grout", "Vent/Fan"],
  },
  {
    name: "Exterior / Entry",
    shots: ["Door/Lock", "Mailbox/Package Area"],
  },
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

/* ---------- Scroll lock utility ---------- */
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
        className="absolute bottom-0 left-0 right-0 mx-auto w-full max-w-md rounded-t-2xl bg-white shadow"
        style={{ maxHeight: "100dvh", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 12px)" }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-100 px-4 pt-3 pb-2">
          <div className="mx-auto h-1.5 w-12 rounded-full bg-gray-200" />
          {title ? <div className="mt-2 text-sm font-medium text-gray-900">{title}</div> : null}
        </div>
        <div className="overflow-y-auto px-4 pt-2 pb-3" style={{ maxHeight: "calc(100dvh - 56px)" }}>
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
            <div className="text-sm font-medium text-rose-700">Error</div>
            <button onClick={onClose} className="ml-auto text-xs text-rose-700 underline">
              Dismiss
            </button>
          </div>
          <div className="mt-1 break-words text-xs text-rose-900">{msg}</div>
          {detail ? (
            <div className="mt-1 break-words text-[11px] text-rose-900/80">
              {detail.length > 220 ? detail.slice(0, 220) + "…" : detail}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ---------- Component ---------- */
export default function InspectionMobile({
  doc,
  onChange,
}: {
  doc: InspectionDoc;
  onChange: (d: InspectionDoc) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

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

  // Other notes
  const [otherText, setOtherText] = useState("");

  // Add room sheet
  const [addRoomOpen, setAddRoomOpen] = useState(false);
  const [roomNameDraft, setRoomNameDraft] = useState("");

  // Submit sheet
  const [submitOpen, setSubmitOpen] = useState(false);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const pickedFileRef = useRef<File | null>(null);

  const isSubmitted = doc.status === "submitted";

  // Always pass leaseId to landlord API so we mutate the correct document
  const baseApi = useMemo(() => {
    const id = doc.leaseId;
    return id ? `/api/landlord/inspection?leaseId=${encodeURIComponent(id)}` : "/api/landlord/inspection";
  }, [doc.leaseId]);

  /* ---------- derived structure ---------- */
  const discoveredRooms = useMemo(() => uniq(doc.items.map((i) => i.room || "General")), [doc.items]);

  const roomNames = useMemo(() => {
    const baseline = TEMPLATE.map((r) => r.name);
    const all = uniq([...baseline, ...discoveredRooms]);
    return all.length ? all : ["General"];
  }, [discoveredRooms]);

  const currentRoom = roomNames[step] ?? roomNames[0];
  const shotsFor = (room: string) => TEMPLATE.find((r) => r.name === room)?.shots ?? ["General"];

  const itemsInRoom = useMemo(
    () => doc.items.filter((i) => (i.room || "General") === currentRoom),
    [doc.items, currentRoom],
  );

  const byCategory = useMemo(() => {
    const m = new Map<string, Issue[]>();
    shotsFor(currentRoom).forEach((s) => m.set(s, []));
    for (const it of itemsInRoom) {
      const key = it.category || "General";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(it);
    }
    return m;
  }, [itemsInRoom, currentRoom]);

  const totals = useMemo(() => {
    const required = shotsFor(currentRoom).length;
    const have = Array.from(byCategory.values()).filter((arr) => arr.some((i) => (i.photos?.length ?? 0) > 0)).length;
    return { required, have, pct: required ? Math.round((have / required) * 100) : 0 };
  }, [byCategory, currentRoom]);

  const summary = useMemo(() => {
    const totalPhotos = doc.items.reduce((n, it) => n + (it.photos?.length ?? 0), 0);
    const damageItems = doc.items.filter(
      (it) =>
        (it.description && it.description.trim().length > 0) ||
        (it.severity && it.severity !== "low"),
    );
    const flaggedCount = damageItems.length;
    const roomsCovered = uniq(doc.items.map((i) => i.room || "General")).length;
    return { totalPhotos, flaggedCount, roomsCovered };
  }, [doc.items]);

  /* ---------- helpers ---------- */
  function showError(msg: string, detail?: string) {
    setErrMsg(msg);
    setErrDetail(detail || "");
    window.clearTimeout((showError as any)._t);
    (showError as any)._t = window.setTimeout(() => {
      setErrMsg("");
      setErrDetail("");
    }, 7000);
  }

  function jumpTop() {
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

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

  /* ---------- S3 upload ---------- */
  async function uploadToS3(file: File): Promise<string> {
    const init = await fetch("/api/landlord/inspection/upload-init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: file.type, ext: file.name.split(".").pop() }),
    });

    let initBody = "";
    try {
      initBody = await init.text();
    } catch {}
    if (!init.ok) {
      showError(`upload-init ${init.status} ${init.statusText}`, initBody);
      throw new Error(`upload-init ${init.status} ${init.statusText}`);
    }

    let j: any = {};
    try {
      j = JSON.parse(initBody);
    } catch {
      showError("upload-init bad JSON", initBody.slice(0, 200));
      throw new Error("upload-init bad JSON");
    }
    if (!j?.ok || !j?.putUrl || !j?.getUrl) {
      showError("upload-init response missing fields", JSON.stringify(j).slice(0, 200));
      throw new Error("upload-init missing fields");
    }

    const put = await fetch(j.putUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    let putBody = "";
    try {
      putBody = await put.text();
    } catch {}
    if (!put.ok) {
      showError(`s3 put ${put.status} ${put.statusText}`, putBody.slice(0, 240));
      throw new Error(`s3 put ${put.status} ${put.statusText}`);
    }

    return j.getUrl as string;
  }

  /* ---------- persistence ---------- */
  async function persistAdd(
    room: string,
    category: string,
    description: string,
    severity: "low" | "medium" | "high",
    photoUrl: string,
  ) {
    const now = new Date().toISOString();
    onChange({
      ...doc,
      items: [
        ...doc.items,
        {
          id: Math.random().toString(36).slice(2),
          room,
          category,
          description,
          severity,
          photos: photoUrl ? [photoUrl] : [],
          createdAt: now,
        } as Issue,
      ],
      updatedAt: now,
    });

    const res = await fetch(baseApi, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        op: "add",
        item: { room, category, description, severity, photos: photoUrl ? [photoUrl] : [] },
      }),
    });

    const jrText = await res.text().catch(() => "");
    if (!res.ok) {
      showError(`persist add ${res.status} ${res.statusText}`, jrText.slice(0, 240));
      throw new Error("persist add failed");
    }
    let jr: any = {};
    try {
      jr = JSON.parse(jrText);
    } catch {
      showError("persist add bad JSON", jrText.slice(0, 240));
      throw new Error("persist add bad JSON");
    }
    if (!jr?.ok) {
      showError("persist add not ok", JSON.stringify(jr).slice(0, 240));
      throw new Error("persist add not ok");
    }
    onChange(jr.inspection);
  }
  
  async function persistUpdate(
    itemId: string,
    patch: { description?: string; severity?: "low" | "medium" | "high" },
  ) {
    const now = new Date().toISOString();

    // Optimistic local update
    onChange({
      ...doc,
      items: doc.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
      updatedAt: now,
    });

    const res = await fetch(baseApi, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "update_item", itemId, ...patch }),
    });

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      showError(`update ${res.status} ${res.statusText}`, text.slice(0, 240));
      throw new Error("persist update failed");
    }

    let jr: any = {};
    try {
      jr = JSON.parse(text);
    } catch {
      showError("update bad JSON", text.slice(0, 240));
      throw new Error("persist update bad JSON");
    }
    if (!jr?.ok || !jr.inspection) {
      showError("update not ok", JSON.stringify(jr).slice(0, 240));
      throw new Error("persist update not ok");
    }

    onChange(jr.inspection as InspectionDoc);
  }

  async function persistRemove(itemId: string) {
    const prev = doc;
    onChange({
      ...doc,
      items: doc.items.filter((i) => i.id !== itemId),
      updatedAt: new Date().toISOString(),
    });
    try {
      const res = await fetch(baseApi, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "remove_item", itemId }),
      });
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

  /* ---------- interactions ---------- */
  function openCamera(cat: string) {
    if (isSubmitted) return;
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
    pickedFileRef.current = f;
    setPreviewSrc(await toDataURL(f));
  };

  function openEdit(it: Issue) {
    if (!it || isSubmitted) return;
    const desc = (it.description ?? "").toString();
    const sev = ((it.severity as any) ?? "low") as "low" | "medium" | "high";
    const photos = Array.isArray(it.photos) ? it.photos : [];
    setEditItem({ ...it, description: desc, severity: sev, photos });
    setEditNote(desc);
    setEditSev(sev);
    requestAnimationFrame(() => {
      const scroller = document.querySelector('[role="dialog"] .overflow-y-auto') as HTMLElement | null;
      if (scroller) scroller.scrollTop = 0;
    });
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
      showError("Save failed", e?.message || String(e));
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
      showError("Delete failed", e?.message || String(e));
    } finally {
      setBusy(false);
      setEditItem(null);
    }
  }

  async function saveOther() {
    const text = otherText.trim();
    if (!text || isSubmitted) return;
    setBusy(true);
    try {
      await persistAdd("Other / Notes", "General", text, "medium", "");
      setOtherText("");
      jumpTop();
    } catch (e: any) {
      showError("Save note failed", e?.message);
    } finally {
      setBusy(false);
    }
  }

  async function acceptPreview() {
    if (!previewMeta || !pickedFileRef.current || isSubmitted) return;
    setBusy(true);
    try {
      const desc = damageMode === "damage" ? noteDraft : "";
      const sev = damageMode === "damage" ? sevDraft : "low";
      const url = await uploadToS3(pickedFileRef.current);

      const missingBefore = shotsFor(previewMeta.room).filter((cat) => {
        const arr = byCategory.get(cat) ?? [];
        return !arr.some((i) => (i.photos?.length ?? 0) > 0);
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

  function retakePreview() {
    if (previewMeta && !isSubmitted) {
      setPreviewSrc(null);
      fileRef.current?.click();
    }
  }

  function cancelPreview() {
    setPreviewSrc(null);
    setPreviewMeta(null);
  }

  async function handleAddRoom() {
    const name = roomNameDraft.trim();
    if (!name || isSubmitted) return;
    setBusy(true);
    try {
      await persistAdd(name, "General", "", "low", "");
      const idx = roomNames.indexOf(name);
      if (idx >= 0) setStep(idx);
      setRoomNameDraft("");
      setAddRoomOpen(false);
    } catch (e: any) {
      showError("Couldn’t add room", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }
  
  async function updateStatus(next: "draft" | "submitted") {
    setBusy(true);
    try {
      const res = await fetch(baseApi, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "set_status", status: next }),
      });

      const txt = await res.text().catch(() => "");
      if (!res.ok) {
        showError(`Status update failed (${res.status})`, txt.slice(0, 240));
        throw new Error(`HTTP ${res.status}`);
      }

      let data: any = {};
      try {
        data = JSON.parse(txt);
      } catch {
        showError("Status update: bad JSON", txt.slice(0, 240));
        throw new Error("bad_json");
      }

      if (!data?.ok || !data.inspection) {
        showError("Status update: not ok", JSON.stringify(data).slice(0, 240));
        throw new Error("not_ok");
      }

      onChange(data.inspection as InspectionDoc);

      if (next === "submitted") {
        setSubmitOpen(false);
      }
    } catch (e: any) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) return null;

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 pb-28">
      <ErrorToast msg={errMsg} detail={errDetail} onClose={() => { setErrMsg(""); setErrDetail(""); }} />

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onPick}
        className="hidden"
      />

      {/* Header */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
              Pre-move inspection (landlord)
            </div>
            <div className="mt-0.5 text-sm font-semibold text-gray-900">{currentRoom}</div>
            <div className="mt-1 text-[11px] text-gray-500">
              Room <span className="font-medium">{step + 1}</span> / {roomNames.length}
            </div>
          </div>

          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={() => (window.location.href = "/landlord/inspection")}
              className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
            >
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
              Change unit
            </button>
            {!isSubmitted && (
              <button
                type="button"
                onClick={() => setAddRoomOpen(true)}
                className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
              >
                + Add room
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-gray-100">
          <div className="h-3 bg-blue-600" style={{ width: `${totals.pct}%` }} />
        </div>
        <div className="mt-1 text-right text-xs text-gray-600">{totals.pct}% complete</div>
      </section>

      {/* Shots */}
      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white p-0">
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
                    <div className="text-[11px] text-gray-500">
                      {count} photo{count === 1 ? "" : "s"} captured
                    </div>
                  </div>
                  <button
                    disabled={busy || isSubmitted}
                    onClick={() => openCamera(cat)}
                    className="ml-3 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-60"
                  >
                    {count ? "Add Photo" : "Take Photo"}
                  </button>
                </div>

                {arr.length > 0 && (
                  <div className="mt-3 overflow-x-auto">
                    <div className="flex gap-2">
                      {arr.map((it) => (
                        <button
                          key={it.id}
                          onClick={() => openEdit(it)}
                          className="relative h-24 w-24 shrink-0 overflow-hidden rounded border border-gray-200"
                          title="Tap to view / edit"
                        >
                          {it.photos?.[0] ? (
                            <img
                              src={`/api/landlord/inspection/img?u=${encodeURIComponent(it.photos[0])}`}
                              alt="thumb"
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="grid h-full w-full place-items-center text-[10px] text-gray-500">
                              No photo
                            </div>
                          )}
                          <span
                            className={
                              "absolute left-0 top-0 m-1 rounded px-1 text-[10px] text-white " +
                              (it.severity === "high"
                                ? "bg-rose-600"
                                : it.severity === "medium"
                                ? "bg-amber-600"
                                : "bg-gray-700")
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
          disabled={isSubmitted}
        />
        <div className="mt-2 flex justify-end">
          <button
            disabled={busy || !otherText.trim() || isSubmitted}
            onClick={saveOther}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Save note
          </button>
        </div>
      </section>

      {/* Review & submit (just the UI shell, status already handled on API) */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900">Review & submit</div>
            <div className="mt-1 text-[11px] text-gray-600">
              Photos: <span className="font-medium">{summary.totalPhotos}</span> • Damage flags:{" "}
              <span className="font-medium">{summary.flaggedCount}</span> • Rooms with issues:{" "}
              <span className="font-medium">{summary.roomsCovered}</span>
            </div>
          </div>
          <span className="inline-flex items-center rounded-full bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-700 border border-gray-200">
            {isSubmitted ? "Submitted" : "Draft"}
          </span>
        </div>

        {!isSubmitted && (
          <div className="mt-3 space-y-2 text-xs">
            <button
              type="button"
              onClick={() => setSubmitOpen(true)}
              className="w-full rounded-md bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500"
            >
              Submit final report
            </button>
          </div>
        )}

        {isSubmitted && (
          <p className="mt-2 text-[11px] text-gray-600">
            This report is locked. If you notice anything major that was missed, contact your manager to document it
            separately,
          </p>
        )}
      </section>

      {/* Footer nav */}
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
              className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-sm text-white"
            >
              Next room
            </button>
          </div>
          <div style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }} />
        </div>
      </div>

      {/* Add Room sheet */}
      <Sheet open={addRoomOpen} title="Add a room" onClose={() => setAddRoomOpen(false)}>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-gray-500">Room name</label>
            <input
              value={roomNameDraft}
              onChange={(e) => setRoomNameDraft(e.target.value)}
              placeholder='e.g., "Bedroom 2", "Dining Room"'
              className="mt-1 w-full rounded border border-gray-300 p-2 text-sm"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => setAddRoomOpen(false)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!roomNameDraft.trim() || busy}
              onClick={handleAddRoom}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-60"
            >
              Add room
            </button>
          </div>
        </div>
      </Sheet>

      {/* Submit confirmation sheet */}
      <Sheet open={submitOpen} title="Submit inspection report" onClose={() => setSubmitOpen(false)}>
        <p className="text-sm text-gray-800">
          Submitting this report is a <span className="font-semibold">serious</span> step,
        </p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-gray-700">
          <li>Tenants and your firm may rely on this record in future disputes,</li>
          <li>You should only submit when you’ve walked the unit carefully and captured clear photos,</li>
          <li>After submission, you won’t be able to change photos or notes in this report,</li>
        </ul>
        <p className="mt-3 text-xs text-gray-700">
          If you’re not completely done, save as a draft instead and come back later,
        </p>
		<div className="mt-4 space-y-2">
		  <button
			type="button"
			onClick={() => updateStatus("submitted")}
			disabled={busy}
			className="w-full rounded-md bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-60"
		  >
			{busy ? "Submitting…" : "Yes, submit this inspection"}
		  </button>

		  <button
			type="button"
			onClick={() => setSubmitOpen(false)}
			className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900 hover:bg-gray-50"
		  >
			Cancel
		  </button>
		</div>

      </Sheet>

      {/* Preview sheet — THIS is what triggers upload + PATCH */}
      <Sheet
        open={!!previewMeta && !!previewSrc}
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
            className={
              "rounded-md border px-3 py-1.5 text-sm " +
              (damageMode === "ok"
                ? "border-blue-600 text-blue-700"
                : "border-gray-300 text-gray-700")
            }
          >
            Mark OK
          </button>
          <button
            onClick={() => setDamageMode("damage")}
            className={
              "rounded-md border px-3 py-1.5 text-sm " +
              (damageMode === "damage"
                ? "border-rose-600 text-rose-700"
                : "border-gray-300 text-gray-700")
            }
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
          <button
            onClick={retakePreview}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            Retake
          </button>
          <button
            onClick={cancelPreview}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            disabled={!previewSrc || busy}
            onClick={acceptPreview}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-60"
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
            src={`/api/landlord/inspection/img?u=${encodeURIComponent(editItem.photos[0])}`}
            alt="Edit"
            className="w-full rounded"
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
          <button
            onClick={() => setEditItem(null)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            Close
          </button>
          <button
            disabled={busy}
            onClick={saveEdit}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </Sheet>
    </div>
  );
}
