import ChatRouter from "../ChatRouter";

type Params = { threadId: string };
export default async function LandlordChatThread({
  params,
}: {
  params: Params | Promise<Params>;
}) {
  const { threadId } = await Promise.resolve(params);
  return <ChatRouter threadId={threadId} />;
}
