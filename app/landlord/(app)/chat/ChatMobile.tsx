"use client";
import ChatDesktop from "./ChatDesktop";
export default function ChatMobile(props: { threadId: string }) {
  return <ChatDesktop {...props} />;
}
