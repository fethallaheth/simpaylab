/**
 * Staged QR-payments runner (Alipay / WeChat-inspired, generic labels only).
 * Both models: merchant-presented (static amount-typed-by-customer, dynamic
 * amount-embedded) and customer-presented (wallet shows code, merchant scans).
 * Settlement is wallet-to-wallet: direct debit plus provider fee, instant.
 */
import { computeWaterfall } from "./fees";
import { transition } from "./machine";
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
  type Ctx
} from "./scenario";
import type { FailureId, FeeRule, RunResult } from "./types";

export class IllegalQrAction extends Error {}

export type QrAction =
  | { type: "merchant_make"; mode: "static" | "dynamic"; amountMinor?: number }
  | { type: "wallet_show" }
  | { type: "customer_scan"; amountMinor?: number; source?: "balance" | "card" }
  | { type: "merchant_scan" }
  | { type: "submit_pin"; pin: string };

export type QrStage = "fresh" | "shown" | "mscan" | "pin" | "done" | "terminal";

export interface QrFlow {
  ctx: Ctx;
  stage: QrStage;
  mode: "static" | "dynamic" | "customer";
  codeAmount: number | null;
  expirySec: number;
  pinStrikes: number;
  paid: boolean;
  transcript: QrAction[];
}

const WALLET_PIN = "1234";

export function createQrFlow(ctx: Ctx): QrFlow {
  return { ctx, stage: "fresh", mode: "static", codeAmount: null, expirySec: num(ctx.params, "qrExpirySec", 120), pinStrikes: 0, paid: false, transcript: [] };
}

function need(flow: QrFlow, ...stages: QrStage[]): void {
  if (!stages.includes(flow.stage)) throw new IllegalQrAction(`not allowed at stage ${flow.stage}`);
}

function validateCode(flow: QrFlow): boolean {
  const ctx = flow.ctx;
  if (fails(ctx, "expiredQr")) {
    ctx.clock.advance(flow.expirySec * 1000 + 1000);
    ctx.state = transition(ctx.state, "AUTHENTICATE");
    move(ctx, "EXPIRE", "psp", "QR_EXPIRED", { expirySec: flow.expirySec }, { titleKey: "ev.qrExp.title", bodyKey: "ev.qrExp.body", concept: "qr" });
    flow.stage = "terminal";
    return false;
  }
  if (fails(ctx, "tamperedQr")) {
    ctx.state = transition(ctx.state, "AUTHENTICATE");
    move(ctx, "DECLINE", "psp", "QR_TAMPER_WARNING", { reason: "checksum-mismatch" }, { titleKey: "ev.qrTamper.title", bodyKey: "ev.qrTamper.body", concept: "qr-fraud" });
    flow.stage = "terminal";
    return false;
  }
  emit(ctx, "psp", "QR_VALIDATED", { checksum: "ok", merchantMatch: true }, { titleKey: "ev.qrOk.title", bodyKey: "ev.qrOk.body", concept: "qr" });
  step(ctx, 200);
  flow.stage = "pin";
  flow.pinStrikes = 0;
  return true;
}

function settleTail(flow: QrFlow): void {
  const ctx = flow.ctx;
  if (fails(ctx, "insufficient") || fails(ctx, "decline") || ctx.ledger.availableOf("customer") < ctx.amountMinor) {
    move(ctx, "DECLINE", "psp", "WALLET_DECLINED", { reason: "insufficient-balance" }, { titleKey: "ev.declined.title", bodyKey: "ev.declined.body", concept: "authorization" });
    flow.stage = "terminal";
    return;
  }
  ctx.state = transition(ctx.state, "AUTHORIZE");
  emit(ctx, "psp", "WALLET_TO_WALLET", { amountMinor: ctx.amountMinor, netMinor: ctx.netAmount, state: ctx.state }, { titleKey: "ev.w2w.title", bodyKey: "ev.w2w.body", concept: "settlement" });
  const ref = ctx.events[ctx.events.length - 1].id;
  post(ctx, ref, "CAPTURE", "customer", "merchant", ctx.netAmount, ctx.currency, "ledger.capture");
  for (const l of ctx.feeLines) post(ctx, ref, "FEE", "customer", "psp", l.amountMinor, ctx.currency, l.labelKey);
  ctx.clock.advance(2000);
  ctx.state = transition(ctx.state, "CAPTURE");
  emit(ctx, "merchant", "MERCHANT_NOTIFIED", { soundbox: true }, { titleKey: "ev.notify.title", bodyKey: "ev.notify.body" });
  step(ctx, 300);
  ctx.state = transition(ctx.state, "CLEAR");
  ctx.state = transition(ctx.state, "SETTLE");
  emit(ctx, "psp", "SETTLED", { instant: true }, { titleKey: "ev.settled.title", bodyKey: "ev.settled.body", concept: "settlement" });
  flow.paid = true;
  flow.stage = "done";
}

export function qrAdvance(flow: QrFlow, action: QrAction): { stage: QrStage } {
  const ctx = flow.ctx;
  flow.transcript.push(action);
  switch (action.type) {
    case "merchant_make": {
      need(flow, "fresh");
      const amount = action.mode === "dynamic" ? (action.amountMinor ?? 0) : null;
      if (action.mode === "dynamic" && !(amount! > 0)) throw new IllegalQrAction("dynamic codes embed an amount");
      flow.mode = action.mode;
      flow.codeAmount = amount;
      const payload = `SIMQR|v1|m=MERCH-${ctx.rng.hex(3)}|a=${amount ?? 0}|c=${ctx.currency}|ref=${ctx.rng.hex(4)}|chk=${ctx.rng.hex(2)}`;
      emit(ctx, "merchant", "QR_GENERATED", { mode: action.mode, payload, expirySec: flow.expirySec }, { titleKey: "ev.qrGen.title", bodyKey: "ev.qrGen.body", concept: "qr" });
      step(ctx, 400);
      flow.stage = "shown";
      break;
    }
    case "wallet_show": {
      need(flow, "fresh");
      flow.mode = "customer";
      const payload = `SIMQR|v1|w=WALLET-${ctx.rng.hex(3)}|c=${ctx.currency}|ref=${ctx.rng.hex(4)}|chk=${ctx.rng.hex(2)}`;
      emit(ctx, "customerWallet", "QR_SHOWN", { payload, expirySec: 60 }, { titleKey: "ev.qrShown.title", bodyKey: "ev.qrShown.body", concept: "qr" });
      step(ctx, 300);
      flow.stage = "mscan";
      break;
    }
    case "customer_scan": {
      need(flow, "shown");
      if (flow.paid) {
        emit(ctx, "psp", "DUPLICATE_BLOCKED", { reason: "already-scanned" }, { titleKey: "ev.dupe.title", bodyKey: "ev.dupe.body", concept: "idempotency" });
        flow.stage = "terminal";
        break;
      }
      if (flow.mode === "static") {
        if (!(action.amountMinor && action.amountMinor > 0)) throw new IllegalQrAction("static codes need a typed amount");
        ctx.amountMinor = action.amountMinor;
        ctx.ledger.fund("customer", 4 * action.amountMinor + 10000 - ctx.ledger.balanceOf("customer"));
        const wf = recompute(ctx);
        ctx.feeLines = wf.lines;
        ctx.totalFees = wf.totalFeesMinor;
        ctx.netAmount = wf.netAmountMinor;
      } else if (flow.codeAmount) {
        ctx.amountMinor = flow.codeAmount;
        ctx.ledger.fund("customer", 4 * flow.codeAmount + 10000 - ctx.ledger.balanceOf("customer"));
        const wf = recompute(ctx);
        ctx.feeLines = wf.lines;
        ctx.totalFees = wf.totalFeesMinor;
        ctx.netAmount = wf.netAmountMinor;
      }
      emit(ctx, "customer", "QR_SCANNED", { mode: flow.mode, source: action.source === "card" ? "card" : "balance" }, { titleKey: "ev.qrScan.title", bodyKey: "ev.qrScan.body", concept: "qr" });
      step(ctx, 250);
      if (fails(ctx, "duplicate")) {
        emit(ctx, "psp", "DUPLICATE_BLOCKED", { reason: "already-scanned" }, { titleKey: "ev.dupe.title", bodyKey: "ev.dupe.body", concept: "idempotency" });
      }
      validateCode(flow);
      break;
    }
    case "merchant_scan": {
      need(flow, "mscan");
      emit(ctx, "merchant", "QR_SCANNED", { mode: "customer" }, { titleKey: "ev.qrScan.title", bodyKey: "ev.qrScan.body", concept: "qr" });
      step(ctx, 250);
      validateCode(flow);
      break;
    }
    case "submit_pin": {
      need(flow, "pin");
      if (action.pin === WALLET_PIN) {
        ctx.state = transition(ctx.state, "AUTHENTICATE");
        emit(ctx, "customer", "PIN_CONFIRMED", {}, { titleKey: "ev.pinOk.title", bodyKey: "ev.pinOk.body", concept: "authentication" });
        step(ctx, 200);
        settleTail(flow);
      } else {
        flow.pinStrikes += 1;
        emit(ctx, "customer", "PIN_WRONG", { attemptsLeft: Math.max(0, 3 - flow.pinStrikes) }, { titleKey: "ev.pinWrong.title", bodyKey: "ev.pinWrong.body", concept: "authentication" });
        if (flow.pinStrikes >= 3) {
          move(ctx, "DECLINE", "psp", "WALLET_DECLINED", { reason: "pin-locked" }, { titleKey: "ev.declined.title", bodyKey: "ev.declined.body", concept: "authorization" });
          flow.stage = "terminal";
        }
      }
      break;
    }
  }
  return { stage: flow.stage };
}

function recompute(ctx: Ctx) {
  return computeWaterfall(ctx.amountMinor, ctx.feeRules);
}

export function runQrScript(seed: number, params: Record<string, unknown>, failures: FailureId[], actions: QrAction[], feeRules?: FeeRule[]): RunResult {
  const ctx = createRunBase("qr", { seed, params, failures, feeRules });
  const flow = createQrFlow(ctx);
  for (const a of actions) qrAdvance(flow, a);
  return qrResult(flow);
}

export function qrResult(flow: QrFlow): RunResult {
  return finishRunResult(flow.ctx);
}
