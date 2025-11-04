// lib/holding/validate.ts
export function validateMAHolding(amounts: {first:number; last:number; security:number; key:number}, monthlyRent: number) {
  const errs: string[] = [];
  const caps: Record<keyof typeof amounts, number> = {
    first: monthlyRent,
    last: monthlyRent,
    security: monthlyRent, // max one month security
    key: monthlyRent,      // treat as ≤ one month (key/lock changes usually far less)
  };
  (Object.keys(amounts) as (keyof typeof amounts)[]).forEach(k => {
    if (amounts[k] < 0) errs.push(`${k} cannot be negative`);
    if (amounts[k] > caps[k]) errs.push(`${k} cannot exceed one month’s rent`);
  });
  const total = amounts.first + amounts.last + amounts.security + amounts.key;
  return { ok: errs.length === 0, errs, total };
}
