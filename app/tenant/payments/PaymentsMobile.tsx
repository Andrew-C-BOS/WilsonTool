// app/tenant/payments/PaymentsMobile.tsx
"use client";

import PaymentsDesktop from "./PaymentsDesktop";

export default function PaymentsMobile(props: {
  appId: string;
  firmId?: string;
  type: "" | "upfront" | "deposit";
}) {
  // Mobile uses the same component/layout (keeps logic in one place).
  return <PaymentsDesktop {...props} />;
}
