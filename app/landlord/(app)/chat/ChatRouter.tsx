"use client";

import { useEffect, useState } from "react";
import ChatDesktop from "./ChatDesktop";
import ChatMobile from "./ChatMobile";

export default function ChatRouter({ threadId }: { threadId: string }) {
  const [isSmUp, setIsSmUp] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const l = () => setIsSmUp(mq.matches);
    l();
    mq.addEventListener?.("change", l);
    return () => mq.removeEventListener?.("change", l);
  }, []);
  if (!threadId) return null;
  return isSmUp ? <ChatDesktop threadId={threadId} /> : <ChatMobile threadId={threadId} />;
}
