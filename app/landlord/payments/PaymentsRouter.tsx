// app/landlord/payments/PaymentsRouter.tsx
"use client";
import { useEffect, useState } from "react";
import PaymentsDesktop from "./PaymentsDesktop";
import PaymentsMobile from "./PaymentsMobile";

export default function PaymentsRouter() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 768px)");
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);
  return isMobile ? <PaymentsMobile /> : <PaymentsDesktop />;
}
