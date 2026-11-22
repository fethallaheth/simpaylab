/**
 * Demo-store catalog + order math for the wallet module.
 * Prices in EUR minor units. Shipping free over €50, otherwise €4.90.
 * Tax (TVA-style) 19% on the subtotal — illustrative rates, labeled as such.
 * BaridiMob-style payments convert to DZD at an illustrative rate + spread.
 */

export interface StoreProduct {
  id: string;
  name: string;
  blurb: string;
  priceMinor: number;
  hue: string;
  glyph: string;
}

export const STORE: StoreProduct[] = [
  { id: "textbook", name: "Textbook — Economics of Money", blurb: "Fictional course book, 420 pages.", priceMinor: 4999, hue: "bg-sky-600", glyph: "E" },
  { id: "reader", name: "Course reader + notes", blurb: "Printed companion pack.", priceMinor: 1250, hue: "bg-emerald-600", glyph: "R" },
  { id: "cable", name: "USB-C cable (1 m)", blurb: "Braided, fictional brand.", priceMinor: 999, hue: "bg-zinc-600", glyph: "U" },
  { id: "notebook", name: "Notebook (dotted)", blurb: "192 pages, lies flat.", priceMinor: 675, hue: "bg-amber-600", glyph: "N" },
  { id: "lamp", name: "Desk lamp", blurb: "Warm white, USB powered.", priceMinor: 2490, hue: "bg-orange-500", glyph: "L" },
  { id: "backpack", name: "Backpack 20 L", blurb: "Laptop sleeve, water resistant.", priceMinor: 3900, hue: "bg-indigo-600", glyph: "B" },
  { id: "bottle", name: "Water bottle", blurb: "750 ml, keeps cold 12 h.", priceMinor: 1425, hue: "bg-cyan-600", glyph: "W" },
  { id: "headphones", name: "Headphones (wired)", blurb: "Closed back, 3.5 mm jack.", priceMinor: 2999, hue: "bg-rose-600", glyph: "H" }
];

export function storeProduct(id: string): StoreProduct | undefined {
  return STORE.find((p) => p.id === id);
}

export interface CartLine {
  id: string;
  qty: number;
}

export interface Totals {
  sub: number;
  ship: number;
  tax: number;
  total: number;
}

export const FREE_SHIP_AT = 5000;
export const SHIP_FLAT = 490;
export const TAX_BPS = 1900;

export function totals(lines: CartLine[]): Totals {
  const sub = lines.reduce((s, l) => s + (storeProduct(l.id)?.priceMinor ?? 0) * l.qty, 0);
  const ship = sub === 0 || sub >= FREE_SHIP_AT ? 0 : SHIP_FLAT;
  const tax = Math.round((sub * TAX_BPS) / 10_000);
  return { sub, ship, tax, total: sub + ship + tax };
}

/**
 * Illustrative provider-flow rate used to convert into the provider's quote
 * currency. Now that payments are in EUR, the rate is 1:1 (kept as a named
 * constant for the provider-flow spread/fee tiering).
 */
export const EUR_DZD = 1;
export const DZD_SPREAD_BPS = 150;

/** Tiered illustrative provider fee on the converted gross (DZD minor). */
export function baridiFee(dzdGross: number): number {
  if (dzdGross <= 100_000) return 2_000;
  if (dzdGross <= 1_000_000) return 10_000;
  return 20_000;
}

export interface DzdQuote {
  gross: number;
  spread: number;
  fee: number;
  total: number;
}

export function eurToDzd(eurMinor: number): DzdQuote {
  const gross = Math.round((eurMinor * EUR_DZD) / 100);
  const spread = Math.round((gross * DZD_SPREAD_BPS) / 10_000);
  const fee = baridiFee(gross);
  return { gross, spread, fee, total: gross + spread + fee };
}

/** Daily transfer cap, DZD minor (mirrors the real 50,000 DA/day rule). */
export const DAILY_CAP = 5_000_000;
export const FAUCET_DZD = 2_000_000;
export const OTP_WINDOW_SEC = 90;
