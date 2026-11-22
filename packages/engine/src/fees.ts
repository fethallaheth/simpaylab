/**
 * Rule-based fee engine. Illustrative values for teaching (spec §0.6).
 * All math in integer minor units; pct in basis points.
 */
import type { FeeLine, FeeRule } from "./types";

export interface Waterfall {
  lines: FeeLine[];
  totalFeesMinor: number;
  netAmountMinor: number;
}

export function feeForAmount(amountMinor: number, rule: FeeRule): number {
  const pct = Math.round((amountMinor * rule.pctBps) / 10000);
  return rule.fixedMinor + pct;
}

export function computeWaterfall(amountMinor: number, rules: FeeRule[]): Waterfall {
  if (amountMinor < 0) throw new Error("negative amount");
  const lines: FeeLine[] = rules.map((r) => ({
    ruleId: r.id,
    labelKey: r.labelKey,
    amountMinor: feeForAmount(amountMinor, r),
    payer: r.payer,
    payee: r.payee
  }));
  const totalFeesMinor = lines.reduce((s, l) => s + l.amountMinor, 0);
  if (totalFeesMinor > amountMinor) throw new Error("fees exceed amount");
  return { lines, totalFeesMinor, netAmountMinor: amountMinor - totalFeesMinor };
}
