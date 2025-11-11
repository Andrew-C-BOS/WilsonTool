// app/tenant/payments/PaymentsRouter.tsx
import "server-only";
import PaymentsDesktop from "./PaymentsDesktop";
import PaymentsMobile from "./PaymentsMobile";

function pickOne(v?: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v ?? "";
}

type SP =
  | { [k: string]: string | string[] | undefined }
  | Promise<{ [k: string]: string | string[] | undefined }>;

export default async function PaymentsRouter({
  searchParams,
}: {
  searchParams?: SP;
}) {
  // ✅ Unwrap searchParams if it's a Promise (per Next.js dynamic APIs rule)
  const sp = (await searchParams) ?? {};

  const appId = pickOne(sp.appId);
  const firmId = pickOne(sp.firmId);
  const typeRaw = pickOne(sp.type).toLowerCase();
  const type = typeRaw === "deposit" ? "deposit" : typeRaw === "upfront" ? "upfront" : "";

  const props = { appId, firmId, type };

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
