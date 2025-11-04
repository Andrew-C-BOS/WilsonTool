import ChatRouter from "../ChatRouter";

type Params = { threadId: string };
type Search = { app?: string };

export default async function TenantChatPage(props: {
  params: Params | Promise<Params>;
  searchParams?: Search | Promise<Search>;
}) {
  // Next >=13.5/15: these can be Promises; resolve them safely
  const { threadId } = await Promise.resolve(props.params);
  const search = await Promise.resolve(props.searchParams ?? {});
  return <ChatRouter threadId={threadId} appId={search.app} />;
}
