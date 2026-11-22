/**
 * Staged crypto-payments runner (BitPay / Trust Wallet-inspired, fake chains).
 * Invoice with rate lock -> user-built transaction with fee choice -> mempool
 * -> one action per block until the required confirmations. Stuck low-fee
 * transactions can be replaced (RBF). No real RPC, no real addresses.
 */
import {
  createRunBase,
  emit,
  fails,
  finishRunResult,
  move,
  num,
  post,
  step,
  str,
  transition,
  type Ctx
} from "./scenario";
import type { Currency, FailureId, FeeRule, RunResult } from "./types";

export class IllegalCryptoAction extends Error {}

export type CryptoAction =
  | { type: "make_invoice" }
  | { type: "build_tx"; feeTier: "low" | "medium" | "high"; dest: string; amountMinor: number }
  | { type: "rbf" }
  | { type: "mine" };

export type CryptoStage = "fresh" | "built" | "mining" | "stuck" | "done" | "terminal";

export interface CryptoFlow {
  ctx: Ctx;
  stage: CryptoStage;
  chain: string;
  ccy: Currency;
  address: string;
  rate: number;
  confRequired: number;
  depth: number;
  feeRate: number;
  transcript: CryptoAction[];
}

const ADDR_RE = /^(sim1[0-9a-f]{6,}|0x[0-9a-fA-F]{6,})$/;

export function createCryptoFlow(ctx: Ctx): CryptoFlow {
  const chain = str(ctx.params, "chain", "btc-like");
  return {
    ctx, stage: "fresh", chain,
    ccy: chain === "btc-like" ? "BTC" : "USDT",
    address: "", rate: 0,
    confRequired: num(ctx.params, "confirmations", chain === "btc-like" ? 3 : 1),
    depth: 0, feeRate: 15, transcript: []
  };
}

function need(flow: CryptoFlow, ...stages: CryptoStage[]): void {
  if (!stages.includes(flow.stage)) throw new IllegalCryptoAction(`not allowed at stage ${flow.stage}`);
}

function congested(flow: CryptoFlow): boolean {
  return fails(flow.ctx, "congestion") || str(flow.ctx.params, "congestion", "normal") === "high";
}

export function cryptoAdvance(flow: CryptoFlow, action: CryptoAction): { stage: CryptoStage } {
  const ctx = flow.ctx;
  flow.transcript.push(action);
  switch (action.type) {
    case "make_invoice": {
      need(flow, "fresh");
      if (!(ctx.amountMinor > 0)) throw new IllegalCryptoAction("invoice amount is required");
      if (ctx.currency !== flow.ccy) throw new IllegalCryptoAction(`session currency ${ctx.currency} does not match chain asset ${flow.ccy}`);
      flow.address = `sim1${ctx.rng.hex(10)}`;
      flow.rate = 97_000 + ctx.rng.int(-800, 800);
      emit(ctx, "merchant", "INVOICE_CREATED", { address: flow.address, amountMinor: ctx.amountMinor, currency: flow.ccy, rate: flow.rate, lockMin: 15 }, { titleKey: "ev.invoice.title", bodyKey: "ev.invoice.body", concept: "invoice" });
      step(ctx, 300);
      flow.stage = "built";
      break;
    }
    case "build_tx": {
      need(flow, "built");
      if (!ADDR_RE.test(action.dest)) {
        ctx.state = transition(ctx.state, "AUTHENTICATE");
        move(ctx, "DECLINE", "customerWallet", "WRONG_ADDRESS", { reason: "address-mismatch" }, { titleKey: "ev.wrongAddr.title", bodyKey: "ev.wrongAddr.body", concept: "address" });
        flow.stage = "terminal";
        break;
      }
      if (fails(ctx, "wrongNetwork")) {
        ctx.state = transition(ctx.state, "AUTHENTICATE");
        move(ctx, "DECLINE", "customerWallet", "WRONG_NETWORK", {}, { titleKey: "ev.wrongNet.title", bodyKey: "ev.wrongNet.body", concept: "network" });
        flow.stage = "terminal";
        break;
      }
      flow.feeRate = action.feeTier === "high" ? 42 : action.feeTier === "low" ? 3 : 15;
      if (flow.chain === "btc-like") {
        emit(ctx, "customerWallet", "TX_BUILT", { inputs: 2, outputs: 2, changeMinor: ctx.rng.int(100, 900), feeRateSatVb: flow.feeRate }, { titleKey: "ev.utxo.title", bodyKey: "ev.utxo.body", concept: "utxo" });
      } else {
        emit(ctx, "customerWallet", "TX_BUILT", { nonce: ctx.rng.int(1, 40), gas: 21000 + ctx.rng.int(0, 30000), token: "SIM-USD" }, { titleKey: "ev.evm.title", bodyKey: "ev.evm.body", concept: "gas" });
      }
      step(ctx, 250);
      emit(ctx, "customerWallet", "FEE_CHOSEN", { tier: action.feeTier, feeRateSatVb: flow.feeRate }, { titleKey: "ev.feeTier.title", bodyKey: "ev.feeTier.body", concept: "fee-market" });
      step(ctx, 200);
      ctx.state = transition(ctx.state, "AUTHENTICATE");
      emit(ctx, "customerWallet", "BROADCAST", { txHash: `0x${ctx.rng.hex(16)}`, to: action.dest, sentMinor: action.amountMinor }, { titleKey: "ev.broadcast.title", bodyKey: "ev.broadcast.body", concept: "mempool" });
      step(ctx, 400);
      if (action.amountMinor < ctx.amountMinor) {
        move(ctx, "EXPIRE", "merchant", "UNDERPAID", { shortMinor: ctx.amountMinor - action.amountMinor }, { titleKey: "ev.under.title", bodyKey: "ev.under.body", concept: "invoice" });
        flow.stage = "terminal";
        break;
      }
      const position = congested(flow) ? ctx.rng.int(800, 4000) : ctx.rng.int(1, 40);
      emit(ctx, "miner", "MEMPOOL_QUEUED", { position, feeRateSatVb: flow.feeRate, congested: congested(flow) }, { titleKey: "ev.mempool.title", bodyKey: "ev.mempool.body", concept: "mempool" });
      step(ctx, congested(flow) ? 3000 : 800);
      if ((action.feeTier === "low" && congested(flow)) || fails(ctx, "blockFail")) {
        emit(ctx, "miner", "TX_STUCK", { reason: "fee-too-low" }, { titleKey: "ev.stuck.title", bodyKey: "ev.stuck.body", concept: "fee-market" });
        step(ctx, 1200);
        if (fails(ctx, "blockFail")) {
          move(ctx, "EXPIRE", "merchant", "INVOICE_EXPIRED", {}, { titleKey: "ev.invExp.title", bodyKey: "ev.invExp.body", concept: "invoice" });
          flow.stage = "terminal";
        } else {
          flow.stage = "stuck";
        }
        break;
      }
      ctx.state = transition(ctx.state, "AUTHORIZE");
      flow.depth = 0;
      flow.stage = "mining";
      break;
    }
    case "rbf": {
      need(flow, "stuck");
      flow.feeRate = 38;
      emit(ctx, "customerWallet", "RBF_REPLACED", { newFeeRateSatVb: 38 }, { titleKey: "ev.rbf.title", bodyKey: "ev.rbf.body", concept: "rbf" });
      step(ctx, 600);
      ctx.state = transition(ctx.state, "AUTHORIZE");
      flow.depth = 0;
      flow.stage = "mining";
      break;
    }
    case "mine": {
      need(flow, "mining");
      flow.depth += 1;
      ctx.clock.advance(flow.chain === "btc-like" ? 600_000 : 12_000);
      emit(ctx, "miner", "BLOCK_MINED", { depth: flow.depth, of: flow.confRequired, intervalSec: flow.chain === "btc-like" ? 600 : 12 }, { titleKey: "ev.block.title", bodyKey: "ev.block.body", concept: "finality" });
      if (flow.depth >= flow.confRequired) {
        if (fails(ctx, "depeg")) {
          emit(ctx, "system", "DEPEG", { peg: 1, market: 0.94 }, { titleKey: "ev.depeg.title", bodyKey: "ev.depeg.body", concept: "stablecoin" });
          step(ctx, 300);
        }
        const ev = emit(ctx, "miner", "CONFIRMED", { confirmations: flow.confRequired }, { titleKey: "ev.conf.title", bodyKey: "ev.conf.body", concept: "finality" });
        post(ctx, ev.id, "SETTLEMENT", "customerWallet", "merchantWallet", ctx.amountMinor, flow.ccy, "ledger.settlement");
        for (const l of ctx.feeLines) post(ctx, ev.id, "FEE", "customerWallet", "miner", l.amountMinor, flow.ccy, l.labelKey);
        ctx.state = transition(ctx.state, "CAPTURE");
        ctx.state = transition(ctx.state, "CLEAR");
        ctx.state = transition(ctx.state, "SETTLE");
        emit(ctx, "merchant", "MARKED_PAID", { confirmations: flow.confRequired }, { titleKey: "ev.paid.title", bodyKey: "ev.paid.body", concept: "finality" });
        flow.stage = "done";
      }
      break;
    }
  }
  return { stage: flow.stage };
}

export function runCryptoScript(seed: number, params: Record<string, unknown>, failures: FailureId[], actions: CryptoAction[], feeRules?: FeeRule[]): RunResult {
  const ctx = createRunBase("crypto", { seed, params, failures, feeRules });
  const flow = createCryptoFlow(ctx);
  for (const a of actions) cryptoAdvance(flow, a);
  return cryptoResult(flow);
}

export function cryptoResult(flow: CryptoFlow): RunResult {
  return finishRunResult(flow.ctx);
}
