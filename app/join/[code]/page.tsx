// app/join/[code]/page.tsx
import { use } from "react";
import JoinRouter from "./JoinRouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { code: string };

export default function Page({ params }: { params: Promise<Params> }) {
  const { code } = use(params); // unwrap the promise synchronously on the server
  return <JoinRouter code={code} />;
}
