import "server-only";
import PaymentsDesktop from "./PaymentsDesktop";
import PaymentsMobile from "./PaymentsMobile";

function pickOne(v?: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v ?? "";
}

// Keep this in sync with PaymentsDesktop/PaymentsMobile
type Kind = "" | "upfront" | "deposit";

type SP =
  | { [k: string]: string | string[] | undefined }
  | Promise<{ [k: string]: string | string[] | undefined }>;

export default async function PaymentsRouter({
  searchParams,
}: {
  searchParams?: SP;
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

  const props: { appId: string; firmId?: string; type: Kind } = {
    appId,
    firmId,
    type,
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
