// app/landlord/chat/page.tsx
import ChatOpenClient from "./ChatOpenClient";

type Search = { appId?: string; hh?: string };

export default async function LandlordChatEntry(props: {
  searchParams: Search | Promise<Search>;
}) {
  const sp = await Promise.resolve(props.searchParams);
  const appId = sp?.appId || "";
  const hh = sp?.hh || "";
  return <ChatOpenClient appId={appId} householdId={hh} />;
}
