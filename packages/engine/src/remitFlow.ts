/**
 * Staged remittance runner (Wise / Remitly-inspired, generic providers).
 * Quote first (mid rate vs offered rate exposes the spread), then send:
 * compliance screening, debit, corridor hops for bank wires, delivery.
 * All numbers illustrative. Availability notes stay in the UI copy.
 */
import { computeWaterfall } from "./fees";
import { quoteFx } from "./fx";
import {
  createRunBase,
  emit,
  fails,
  finishRunResult,
  move,
  post,
  step,
  transition,
  type Ctx
} from "./scenario";
import type { Currency, FailureId, FeeRule, RunResult } from "./types";

export class IllegalRemitAction extends Error {}

export interface RemitProvider {
  id: string;
  feeFixed: number;
  feeBps: number;
  spreadBps: number;
  etaMs: number;
  etaLabel: string;
  hops: number;
  hopFee: number;
}

export const REMIT_PROVIDERS: RemitProvider[] = [
  { id: "bank", feeFixed: 1500, feeBps: 80, spreadBps: 150, etaMs: 4 * 86_400_000, etaLabel: "3–5 days", hops: 2, hopFee: 300 },
  { id: "mto", feeFixed: 499, feeBps: 120, spreadBps: 220, etaMs: 6 * 3_600_000, etaLabel: "~6 hours", hops: 0, hopFee: 0 },
  { id: "fintech", feeFixed: 299, feeBps: 60, spreadBps: 90, etaMs: 20 * 3_600_000, etaLabel: "~20 hours", hops: 0, hopFee: 0 },
  { id: "mobile", feeFixed: 199, feeBps: 50, spreadBps: 130, etaMs: 15 * 60_000, etaLabel: "~15 minutes", hops: 0, hopFee: 0 },
  { id: "stable", feeFixed: 99, feeBps: 10, spreadBps: 20, etaMs: 10 * 60_000, etaLabel: "~10 minutes", hops: 0, hopFee: 0 }
];

export interface Corridor {
  id: string;
  from: string;
  to: string;
  src: Currency;
  dst: Currency;
  mid: number;
  /** payout methods enabled on this educational corridor */
  payouts: ("bank" | "wallet" | "cash")[];
  /** funding methods enabled on this educational corridor */
  funding: ("bank" | "card" | "balance")[];
  /** honest availability note (illustrative corridors ≠ live coverage) */
  note: string;
}

export const CORRIDORS: Corridor[] = [
  { id: "us-dz", from: "United States", to: "Algeria", src: "USD", dst: "DZD", mid: 135, payouts: ["bank", "wallet", "cash"], funding: ["bank", "card", "balance"], note: "Illustrative corridor for study; not a live coverage claim." },
  { id: "fr-dz", from: "France", to: "Algeria", src: "EUR", dst: "DZD", mid: 145, payouts: ["bank", "wallet", "cash"], funding: ["bank", "card", "balance"], note: "Illustrative corridor for study; not a live coverage claim." },
  { id: "us-ke", from: "United States", to: "Kenya", src: "USD", dst: "KES", mid: 129, payouts: ["bank", "wallet"], funding: ["bank", "card", "balance"], note: "Illustrative corridor for study; cash pickup not modeled here." },
  { id: "es-ma", from: "Spain", to: "Morocco", src: "EUR", dst: "MAD", mid: 10.8, payouts: ["bank", "cash"], funding: ["bank", "card"], note: "Illustrative corridor for study; wallet payout not modeled here." },
  { id: "us-ph", from: "United States", to: "Philippines", src: "USD", dst: "PHP", mid: 58.5, payouts: ["bank", "wallet", "cash"], funding: ["bank", "card", "balance"], note: "Illustrative corridor for study; not a live coverage claim." }
];

export type FundingId = "bank" | "card" | "balance";

export interface FundingRail {
  id: FundingId;
  feeBps: number;
  etaAddMs: number;
}

export const FUNDING_RAILS: FundingRail[] = [
  { id: "bank", feeBps: 0, etaAddMs: 24 * 3_600_000 },
  { id: "card", feeBps: 100, etaAddMs: 0 },
  { id: "balance", feeBps: 0, etaAddMs: 0 }
];

/** Quote validity window (ms of wall time in the UI; the log stays timeless). */
export const QUOTE_VALID_MS = 120_000;

function fmtEta(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `~${Math.max(1, mins)} minutes`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return `~${hours} hours`;
  const days = Math.round(ms / 86_400_000);
  return `${days}–${days + 1} days`;
}

export type RemitAction =
  | { type: "quote"; corridor: string; amountSrcMinor: number; provider: string; deliver: "bank" | "wallet" | "cash"; funding?: FundingId; recipient?: string }
  | { type: "send" };

export type RemitStage = "fresh" | "quoted" | "done" | "terminal";

export interface RemitQuote {
  provider: string;
  corridor: string;
  deliver: string;
  funding: FundingId;
  feeMinor: number;
  fundingFeeMinor: number;
  spreadBps: number;
  spreadMinor: number;
  totalSrcMinor: number;
  receiveMinor: number;
  receiveCcy: Currency;
  totalCostPct: number;
  etaMs: number;
  etaLabel: string;
  hops: number;
  recipient?: string;
}

export interface RemitFlow {
  ctx: Ctx;
  stage: RemitStage;
  quote: RemitQuote | null;
  transcript: RemitAction[];
}

/** Pure quote math shared by the engine and the Compare tab. Amounts are integer
 *  minor units throughout — no floating-point money. `overrides` powers the
 *  instructor sandbox (adjust a fee or spread and watch the total move). */
export function remitQuote(
  corridorId: string,
  amountSrcMinor: number,
  providerId: string,
  deliver: string,
  funding: FundingId = "balance",
  overrides?: { feeFixed?: number; feeBps?: number; spreadBps?: number }
): RemitQuote {
  const corridor = CORRIDORS.find((c) => c.id === corridorId);
  const provider = REMIT_PROVIDERS.find((p) => p.id === providerId);
  const rail = FUNDING_RAILS.find((r) => r.id === funding);
  if (!corridor || !provider || !rail) throw new IllegalRemitAction("unknown corridor, provider or funding");
  if (!(amountSrcMinor > 0)) throw new IllegalRemitAction("amount is required");
  const feeFixed = overrides?.feeFixed ?? provider.feeFixed;
  const feeBps = overrides?.feeBps ?? provider.feeBps;
  const spreadBps = overrides?.spreadBps ?? provider.spreadBps;
  const wf = computeWaterfall(amountSrcMinor, [{ id: "fee", labelKey: "fee.provider", fixedMinor: feeFixed, pctBps: feeBps, payer: "customer", payee: "psp" }]);
  const fundingFee = Math.round((amountSrcMinor * rail.feeBps) / 10_000);
  const q = quoteFx({
    pair: `${corridor.src}/${corridor.dst}`,
    midRate: corridor.mid,
    spreadBps,
    amountSrcMinor,
    srcCurrency: corridor.src,
    dstCurrency: corridor.dst
  });
  const spreadMinor = Math.round((amountSrcMinor * spreadBps) / 10_000);
  const feeMinor = wf.totalFeesMinor + fundingFee;
  const totalSrcMinor = amountSrcMinor + feeMinor;
  const etaMs = provider.etaMs + rail.etaAddMs;
  return {
    provider: provider.id,
    corridor: corridor.id,
    deliver,
    funding,
    feeMinor,
    fundingFeeMinor: fundingFee,
    spreadBps,
    spreadMinor,
    totalSrcMinor,
    receiveMinor: q.amountDstMinor,
    receiveCcy: corridor.dst,
    totalCostPct: ((feeMinor + spreadMinor) / amountSrcMinor) * 100,
    etaMs,
    etaLabel: fmtEta(etaMs),
    hops: provider.hops
  };
}

/** Reverse mode: how much must the sender pay so the recipient gets exactly
 *  `receiveMinor`? Iterates the forward math to a stable integer answer. */
export function remitQuoteForReceive(
  corridorId: string,
  receiveMinor: number,
  providerId: string,
  deliver: string,
  funding: FundingId = "balance"
): { srcMinor: number; quote: RemitQuote } {
  if (!(receiveMinor > 0)) throw new IllegalRemitAction("receive amount is required");
  const corridor = CORRIDORS.find((c) => c.id === corridorId);
  const provider = REMIT_PROVIDERS.find((p) => p.id === providerId);
  if (!corridor || !provider) throw new IllegalRemitAction("unknown corridor or provider");
  const offered = corridor.mid * (1 - provider.spreadBps / 10_000);
  let src = Math.max(1, Math.round(receiveMinor / offered));
  let quote = remitQuote(corridorId, src, providerId, deliver, funding);
  for (let i = 0; i < 3 && quote.receiveMinor !== receiveMinor; i++) {
    src = Math.max(1, Math.round((src * receiveMinor) / Math.max(1, quote.receiveMinor)));
    quote = remitQuote(corridorId, src, providerId, deliver, funding);
  }
  return { srcMinor: src, quote };
}

export function createRemitFlow(ctx: Ctx): RemitFlow {
  return { ctx, stage: "fresh", quote: null, transcript: [] };
}

export function remitAdvance(flow: RemitFlow, action: RemitAction): { stage: RemitStage } {
  const ctx = flow.ctx;
  flow.transcript.push(action);
  switch (action.type) {
    case "quote": {
      if (flow.stage !== "fresh") throw new IllegalRemitAction("already quoted");
      const corridor = CORRIDORS.find((c) => c.id === action.corridor);
      if (!corridor) throw new IllegalRemitAction("unknown corridor");
      if (ctx.currency !== corridor.src) throw new IllegalRemitAction(`session currency ${ctx.currency} is not ${corridor.src}`);
      const funding = action.funding ?? "balance";
      if (!corridor.funding.includes(funding)) throw new IllegalRemitAction(`${funding} funding is not enabled on this corridor`);
      if (!corridor.payouts.includes(action.deliver as "bank" | "wallet" | "cash")) throw new IllegalRemitAction(`${action.deliver} payout is not enabled on this corridor`);
      const q = remitQuote(action.corridor, action.amountSrcMinor, action.provider, action.deliver, funding);
      if (action.recipient) q.recipient = action.recipient;
      ctx.amountMinor = action.amountSrcMinor;
      // standard backend funding applies once the amount is known
      ctx.ledger.fund("customer", 4 * action.amountSrcMinor + 10000 - ctx.ledger.balanceOf("customer"));
      ctx.feeLines = [
        { ruleId: "fee", labelKey: "fee.provider", amountMinor: q.feeMinor - q.fundingFeeMinor, payer: "customer", payee: "psp" },
        ...(q.fundingFeeMinor > 0 ? [{ ruleId: "funding", labelKey: "fee.funding", amountMinor: q.fundingFeeMinor, payer: "customer", payee: "psp" }] : [])
      ];
      ctx.totalFees = q.feeMinor;
      ctx.netAmount = action.amountSrcMinor - q.feeMinor;
      flow.quote = q;
      emit(ctx, "psp", "FX_QUOTED", { quote: { pair: `${corridor.src}/${corridor.dst}`, midRate: corridor.mid, spreadBps: q.spreadBps, offeredRate: corridor.mid * (1 - q.spreadBps / 10_000), illustrative: true } }, { titleKey: "ev.fx.title", bodyKey: "ev.fx.body", concept: "spread" });
      step(ctx, 150);
      emit(ctx, "psp", "QUOTE_MADE", { ...q }, { titleKey: "ev.quote.title", bodyKey: "ev.quote.body", concept: "spread" });
      step(ctx, 200);
      flow.stage = "quoted";
      break;
    }
    case "send": {
      if (flow.stage !== "quoted" || !flow.quote) throw new IllegalRemitAction("quote first");
      const q = flow.quote;
      const provider = REMIT_PROVIDERS.find((p) => p.id === q.provider)!;
      if (fails(ctx, "fraud")) {
        emit(ctx, "psp", "COMPLIANCE_HOLD", { reason: "sanctions-screening" }, { titleKey: "ev.compliance.title", bodyKey: "ev.compliance.body", concept: "kyc" });
        ctx.state = transition(ctx.state, "FLAG_REVIEW");
        flow.stage = "terminal";
        break;
      }
      emit(ctx, "psp", "COMPLIANCE_PASSED", {}, { titleKey: "ev.complianceOk.title", bodyKey: "ev.complianceOk.body", concept: "kyc" });
      step(ctx, 300);
      ctx.state = transition(ctx.state, "AUTHENTICATE");
      if (fails(ctx, "decline")) {
        move(ctx, "DECLINE", "psp", "FUNDING_DECLINED", { reason: "funding-declined" }, { titleKey: "ev.fundDeclined.title", bodyKey: "ev.fundDeclined.body", concept: "authorization" });
        flow.stage = "terminal";
        break;
      }
      if (ctx.ledger.availableOf("customer") < q.totalSrcMinor) {
        move(ctx, "DECLINE", "psp", "WALLET_DECLINED", { reason: "insufficient-balance" }, { titleKey: "ev.declined.title", bodyKey: "ev.declined.body", concept: "authorization" });
        flow.stage = "terminal";
        break;
      }
      ctx.state = transition(ctx.state, "AUTHORIZE");
      post(ctx, ctx.events[ctx.events.length - 1].id, "CAPTURE", "customer", "psp", q.totalSrcMinor, ctx.currency, "ledger.capture");
      emit(ctx, "psp", "DEBITED", { totalSrcMinor: q.totalSrcMinor }, { titleKey: "ev.debited.title", bodyKey: "ev.debited.body", concept: "settlement" });
      step(ctx, 300);
      if (fails(ctx, "timeout")) {
        emit(ctx, "psp", "TRANSFER_DELAYED", { reason: "partner-backlog", extraMs: 12 * 3_600_000 }, { titleKey: "ev.delayed.title", bodyKey: "ev.delayed.body", concept: "payout" });
        ctx.clock.advance(12 * 3_600_000);
        step(ctx, 400);
      }
      for (let h = 1; h <= provider.hops; h++) {
        emit(ctx, "bank", "CORRIDOR_HOP", { hop: h, of: provider.hops, feeMinor: provider.hopFee }, { titleKey: "ev.hop.title", bodyKey: "ev.hop.body", concept: "correspondent" });
        post(ctx, ctx.events[ctx.events.length - 1].id, "FEE", "psp", "sink", provider.hopFee, ctx.currency, "ledger.hopfee");
        ctx.clock.advance(Math.round(provider.etaMs / (provider.hops + 1)));
        step(ctx, 200);
      }
      ctx.clock.advance(provider.hops === 0 ? provider.etaMs : Math.round(provider.etaMs / (provider.hops + 1)));
      ctx.state = transition(ctx.state, "CAPTURE");
      ctx.state = transition(ctx.state, "CLEAR");
      ctx.state = transition(ctx.state, "SETTLE");
      emit(ctx, provider.id === "mobile" ? "operator" : "psp", "DELIVERED", { method: q.deliver, receiveMinor: q.receiveMinor, receiveCcy: q.receiveCcy, ...(q.recipient ? { recipient: q.recipient } : {}) }, { titleKey: "ev.delivered.title", bodyKey: "ev.delivered.body", concept: "payout" });
      flow.stage = "done";
      break;
    }
  }
  return { stage: flow.stage };
}

export function runRemitScript(seed: number, params: Record<string, unknown>, failures: FailureId[], actions: RemitAction[], feeRules?: FeeRule[]): RunResult {
  const ctx = createRunBase("remit", { seed, params, failures, feeRules });
  const flow = createRemitFlow(ctx);
  for (const a of actions) remitAdvance(flow, a);
  return remitResult(flow);
}

export function remitResult(flow: RemitFlow): RunResult {
  return finishRunResult(flow.ctx);
}
