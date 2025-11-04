// app/tenant/chat/ChatDesktop.tsx
"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { id: string; from: "tenant" | "firm"; by: string | null; text: string; createdAt: string };
type Thread = { id: string; firmId: string; firmName: string | null; householdId: string };

export default function ChatDesktop({ threadId }: { threadId: string; appId?: string }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    const res = await fetch(`/api/tenant/chat/${encodeURIComponent(threadId)}`, { cache: "no-store" });
    const j = await res.json();
    if (res.ok && j?.ok) {
      setThread(j.thread);
      setMsgs(j.messages.map((m: any) => ({ ...m, createdAt: String(m.createdAt) })));
      // scroll to bottom
      setTimeout(() => {
        boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
      }, 0);
    }
  }

  async function send() {
    const t = text.trim();
    if (!t) return;
    setText("");
    // optimistic
    const tmp: Msg = {
      id: `tmp_${Date.now()}`,
      from: "tenant",
      by: null,
      text: t,
      createdAt: new Date().toISOString(),
    };
    setMsgs((xs) => [...xs, tmp]);
    setTimeout(() => {
      boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
    }, 0);
    const res = await fetch(`/api/tenant/chat/${encodeURIComponent(threadId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: t }),
    });
    if (!res.ok) {
      // Optionally revert optimistic on error
    } else {
      load();
    }
  }

  useEffect(() => {
    if (!threadId) return;
    load();
  }, [threadId]);

  const lastIndex = msgs.length - 1;

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6">
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="text-sm font-semibold text-gray-900">
            Chat with {thread?.firmName ?? "Leasing Team"}
          </div>
        </div>
        <div ref={boxRef} className="h-[52vh] overflow-auto px-5 py-4 space-y-3 bg-gray-50">
          {msgs.length === 0 ? (
            <div className="text-sm text-gray-600">No messages yet, say hi,</div>
          ) : (
            msgs.map((m, i) => {
              const mine = m.from === "tenant";
              const isLast = i === lastIndex;
              return (
                <div key={m.id} className={`max-w-[80%] ${mine ? "ml-auto text-right" : ""}`}>
                  <div
                    className={`inline-block rounded-lg px-3 py-2 text-sm ${
                      mine
                        ? "bg-blue-600 text-white"
                        : "bg-white border border-gray-200 text-gray-900"
                    }`}
                  >
                    {m.text}
                  </div>
                  {isLast && (
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {new Date(m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a message"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            onClick={send}
            className="rounded-md bg-gray-900 text-white text-sm font-medium px-3 py-2 hover:bg-black"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
