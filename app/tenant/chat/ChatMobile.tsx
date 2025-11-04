// app/tenant/chat/ChatMobile.tsx
"use client";

import ChatDesktop from "./ChatDesktop";
export default function ChatMobile(props: any) {
  // For now, reuse Desktop UI; you can specialize later
  return <ChatDesktop {...props} />;
}
