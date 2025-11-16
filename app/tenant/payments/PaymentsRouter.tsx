// app/tenant/payments/PaymentsRouter.tsx
import "server-only";
import PaymentsDesktop from "./PaymentsDesktop";
import PaymentsMobile from "./PaymentsMobile";
import type { TenantHomeState } from "@/lib/tenant/homeViewState";

function pickOne(v?: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v ?? "";
}

// Keep this in sync with PaymentsDesktop/PaymentsMobile
type Kind = "" | "upfront" | "deposit";

type SP =
  | { [k: string]: string | string[] | undefined }
  | Promise<{ [k: string]: string | string[] | undefined }>;

type SessionUser = { email: string | null };

export default async function PaymentsRouter({
  searchParams,
  user,
  state,
}: {
  searchParams?: SP;
  user: SessionUser;
  state: TenantHomeState | null;
}) {
  const sp = (await searchParams) ?? {};

  const appId = pickOne(sp.appId);
  const firmIdRaw = pickOne(sp.firmId);
  const typeRaw = pickOne(sp.type).toLowerCase();

  const type: Kind =
    typeRaw === "deposit" ? "deposit" :
    typeRaw === "upfront" ? "upfront" :
    "";

  const firmId = firmIdRaw || undefined;

  const props = {
    appId,
    firmId,
    type,
    user,
    state,
  };

  return (
    <>
      <div className="hidden md:block">
        <PaymentsDesktop {...props} />
      </div>
      <div className="md:hidden">
        <PaymentsMobile {...props} />
      </div>
    </>
  );
}
