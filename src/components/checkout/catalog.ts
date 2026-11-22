/** Fictional demo-store catalog (simulation only). Prices in EUR minor units. */

export interface Product {
  id: string;
  name: string;
  blurb: string;
  priceMinor: number;
}

export const PRODUCTS: Product[] = [
  { id: "textbook", name: "Textbook — Economics of Money", blurb: "Fictional course book, 420 pages.", priceMinor: 4999 },
  { id: "reader", name: "Course reader + notes", blurb: "Printed companion pack.", priceMinor: 1250 },
  { id: "cable", name: "USB-C cable (1 m)", blurb: "Braided, fictional brand.", priceMinor: 999 },
  { id: "notebook", name: "Notebook (dotted)", blurb: "192 pages, lies flat.", priceMinor: 675 },
  { id: "lamp", name: "Desk lamp", blurb: "Warm white, USB powered.", priceMinor: 2490 },
  { id: "backpack", name: "Backpack 20 L", blurb: "Laptop sleeve, water resistant.", priceMinor: 3900 },
  { id: "bottle", name: "Water bottle", blurb: "750 ml, keeps cold 12 h.", priceMinor: 1425 },
  { id: "headphones", name: "Headphones (wired)", blurb: "Closed back, 3.5 mm jack.", priceMinor: 2999 }
];

export function productById(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

/** Illustrative EUR→DZD store rate (teaching value, not a market rate). */
export const EUR_DZD = 145;

/** Display price in the order currency (DZD rounded to whole dinars). */
export function priceFor(p: Product, currency: string): number {
  if (currency === "DZD") return Math.round((p.priceMinor * EUR_DZD) / 100);
  return p.priceMinor;
}
