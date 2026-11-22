/**
 * FX quotes: mid-market rate vs offered rate. The spread is the hidden fee.
 * Illustrative values for teaching (spec §0.6).
 */
import type { Currency, FxQuote } from "./types";

export function quoteFx(opts: {
  pair: string;
  midRate: number;
  spreadBps: number;
  amountSrcMinor: number;
  srcCurrency: Currency;
  dstCurrency: Currency;
  side?: "buy" | "sell";
}): FxQuote {
  const { pair, midRate, spreadBps, amountSrcMinor, srcCurrency, dstCurrency } = opts;
  if (midRate <= 0) throw new Error("bad mid rate");
  if (amountSrcMinor < 0) throw new Error("negative amount");
  const offeredRate = midRate * (1 - spreadBps / 10000);
  const amountDstMinor = Math.round(amountSrcMinor * offeredRate);
  return {
    pair,
    midRate,
    spreadBps,
    offeredRate,
    amountSrcMinor,
    srcCurrency,
    amountDstMinor,
    dstCurrency,
    costPct: spreadBps / 100,
    illustrative: true
  };
}
