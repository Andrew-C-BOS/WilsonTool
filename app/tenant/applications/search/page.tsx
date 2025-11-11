// app/tenant/applications/search/page.tsx
import SearchRouter from "./SearchRouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return <SearchRouter />;
}
