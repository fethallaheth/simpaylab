/**
 * Demo-card validation. Reserved fake ranges only (spec §0.2):
 * must start with 400000 / 555555 / 353011 AND pass Luhn.
 * Anything else is rejected with an educational message — even if Luhn-valid.
 */

export const DEMO_PREFIXES = ["400000", "555555", "353011"];

export interface DemoCard {
  id: string;
  label: string;
  pan: string;
  exp: string;
  cvc: string;
}

export const DEMO_CARDS: DemoCard[] = [
  { id: "demo-debit", label: "Demo debit", pan: "4000000000000002", exp: "12/29", cvc: "123" },
  { id: "demo-credit", label: "Demo credit", pan: "5555555555554444", exp: "08/28", cvc: "456" },
  { id: "demo-prepaid", label: "Demo prepaid", pan: "3530110000000000", exp: "05/27", cvc: "789" }
];

export function luhnCheck(pan: string): boolean {
  const digits = pan.replace(/\D/g, "");
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

export function isDemoRange(pan: string): boolean {
  const digits = pan.replace(/\D/g, "");
  return DEMO_PREFIXES.some((p) => digits.startsWith(p));
}

export type CardCheck =
  | { ok: true }
  | { ok: false; reasonKey: "card.notDemoRange" | "card.badLuhn" | "card.badFormat" };

export function validateDemoCard(pan: string): CardCheck {
  const digits = pan.replace(/\D/g, "");
  if (digits.length < 12 || digits.length > 19) return { ok: false, reasonKey: "card.badFormat" };
  if (!isDemoRange(pan)) return { ok: false, reasonKey: "card.notDemoRange" };
  if (!luhnCheck(pan)) return { ok: false, reasonKey: "card.badLuhn" };
  return { ok: true };
}
