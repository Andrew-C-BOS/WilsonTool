// app/tenant/chat/ChatRouter.tsx
"use client";

import { useEffect, useState } from "react";
import ChatDesktop from "./ChatDesktop";
import ChatMobile from "./ChatMobile";

export default function ChatRouter({ threadId, appId }: { threadId: string; appId?: string }) {
  const [isSmUp, setIsSmUp] = useState<boolean>(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const l = () => setIsSmUp(mq.matches);
    l(); mq.addEventListener?.("change", l);
    return () => mq.removeEventListener?.("change", l);
  }, []);
  return isSmUp ? (
    <ChatDesktop threadId={threadId} appId={appId} />
  ) : (
    <ChatMobile threadId={threadId} appId={appId} />
  );
}
