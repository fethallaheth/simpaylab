/**
 * Staged NFC contactless runner. The tap carries an EMV-style exchange
 * (select application -> read data -> cryptogram), then the CVM rule decides:
 * under the contactless limit no PIN, over it PIN (card) or biometrics
 * (phone). Offline terminals decide locally against a floor limit.
 */
import { computeWaterfall } from "./fees";
import {
  DAY_MS,
  createRunBase,
  emit,
  fails,
  finishRunResult,
  move,
  num,
  settleChain,
  step,
  type Ctx
} from "./scenario";
import { transition } from "./machine";
import type { FailureId, FeeRule, RunResult } from "./types";

export class IllegalNfcAction extends Error {}

export type NfcAction =
  | { type: "setup"; amountMinor: number }
  | { type: "tap"; method: "card" | "phone" }
  | { type: "unlock"; ok: boolean }
  | { type: "enter_pin"; pin: string };

export type NfcStage = "fresh" | "ready" | "cvm" | "done" | "terminal";

export interface NfcFlow {
  ctx: Ctx;
  stage: NfcStage;
  method: "card" | "phone" | null;
  limit: number;
  floor: number;
  online: boolean;
  pinStrikes: number;
  transcript: NfcAction[];
}

const DEVICE_PIN = "1234";

export function createNfcFlow(ctx: Ctx): NfcFlow {
  return {
    ctx, stage: "fresh", method: null,
    limit: num(ctx.params, "contactlessLimit", 5000),
    floor: num(ctx.params, "offlineFloor", 2500),
    online: String(ctx.params.linkOnline ?? "online") !== "offline",
    pinStrikes: 0, transcript: []
  };
}

function need(flow: NfcFlow, ...stages: NfcStage[]): void {
  if (!stages.includes(flow.stage)) throw new IllegalNfcAction(`not allowed at stage ${flow.stage}`);
}

function authorize(flow: NfcFlow): void {
  const ctx = flow.ctx;
  if (ctx.state === "INITIATED") ctx.state = transition(ctx.state, "AUTHENTICATE");
  if (!flow.online) {
    if (ctx.amountMinor > flow.floor) {
      move(ctx, "DECLINE", "device", "OFFLINE_DECLINED", { reason: "over-floor" }, { titleKey: "ev.offline.title", bodyKey: "ev.offline.body" });
      flow.stage = "terminal";
      return;
    }
    emit(ctx, "device", "OFFLINE_AUTH", { floor: flow.floor }, { titleKey: "ev.offAuth.title", bodyKey: "ev.offAuth.body", concept: "nfc" });
  }
  if (fails(ctx, "decline") || fails(ctx, "insufficient") || ctx.ledger.availableOf("customer") < ctx.amountMinor) {
    move(ctx, "DECLINE", "issuer", "ISSUER_DECLINED", { reason: fails(ctx, "insufficient") ? "insufficient-funds" : "issuer-decline" }, { titleKey: "ev.declined.title", bodyKey: "ev.declined.body", concept: "authorization" });
    flow.stage = "terminal";
    return;
  }
  ctx.ledger.hold("customer", ctx.amountMinor);
  move(ctx, "AUTHORIZE", "issuer", "AUTHORIZED_HOLD", { holdMinor: ctx.amountMinor, contactless: true }, { titleKey: "ev.hold.title", bodyKey: "ev.hold.body", concept: "authorization" });
  ctx.ledger.releaseHold("customer", ctx.amountMinor);
  move(ctx, "CAPTURE", "acquirer", "CAPTURED", { capturedMinor: ctx.amountMinor }, { titleKey: "ev.capture.title", bodyKey: "ev.capture.body", concept: "capture" });
  move(ctx, "CLEAR", "network", "CLEARED", {}, { titleKey: "ev.clear.title", bodyKey: "ev.clear.body", concept: "clearing" });
  const delayDays = fails(ctx, "delayedSettlement") ? 2 : num(ctx.params, "settlementDays", 1);
  const ev = emit(ctx, "system", "SETTLING", { delayDays }, { titleKey: "ev.settleWait.title", bodyKey: "ev.settleWait.body", concept: "settlement" });
  settleChain(ctx, ev.id, ctx.currency);
  ctx.clock.advance(delayDays * DAY_MS);
  move(ctx, "SETTLE", "bank", "SETTLED", { delayDays }, { titleKey: "ev.settled.title", bodyKey: "ev.settled.body", concept: "settlement" }, 50);
  flow.stage = "done";
}

export function nfcAdvance(flow: NfcFlow, action: NfcAction): { stage: NfcStage } {
  const ctx = flow.ctx;
  flow.transcript.push(action);
  switch (action.type) {
    case "setup": {
      need(flow, "fresh");
      if (!(action.amountMinor > 0)) throw new IllegalNfcAction("till amount is required");
      ctx.amountMinor = action.amountMinor;
      // standard backend funding applies once the amount is known
      ctx.ledger.fund("customer", 4 * action.amountMinor + 10000 - ctx.ledger.balanceOf("customer"));
      const wf = recompute(ctx);
      ctx.feeLines = wf.lines;
      ctx.totalFees = wf.totalFeesMinor;
      ctx.netAmount = wf.netAmountMinor;
      emit(ctx, "merchant", "TERMINAL_READY", { amountMinor: ctx.amountMinor, limit: flow.limit, online: flow.online }, { titleKey: "ev.termReady.title", bodyKey: "ev.termReady.body", concept: "nfc" });
      step(ctx, 200);
      flow.stage = "ready";
      break;
    }
    case "tap": {
      need(flow, "ready");
      flow.method = action.method;
      emit(ctx, "device", "APP_SELECTED", { aid: "A0000000031010", method: action.method }, { titleKey: "ev.appSel.title", bodyKey: "ev.appSel.body", concept: "nfc" });
      step(ctx, 150);
      emit(ctx, "device", "DATA_READ", { panLast4: "0002" }, { titleKey: "ev.dataRead.title", bodyKey: "ev.dataRead.body", concept: "nfc" });
      step(ctx, 150);
      if (ctx.amountMinor > flow.limit) {
        emit(ctx, "device", "CVM_REQUIRED", { limit: flow.limit, method: action.method }, { titleKey: "ev.cvm.title", bodyKey: "ev.cvm.body", concept: "cvm" });
        flow.pinStrikes = 0;
        flow.stage = "cvm";
        break;
      }
      emit(ctx, "device", "CRYPTOGRAM", { offline: !flow.online }, { titleKey: "ev.crypt.title", bodyKey: "ev.crypt.body", concept: "cryptogram" });
      step(ctx, 180);
      authorize(flow);
      break;
    }
    case "unlock": {
      need(flow, "cvm");
      if (flow.method !== "phone") throw new IllegalNfcAction("phones unlock with biometrics");
      if (action.ok) {
        emit(ctx, "device", "BIOMETRIC_OK", { localOnly: true }, { titleKey: "ev.bioOk.title", bodyKey: "ev.bioOk.body", concept: "biometric" });
        step(ctx, 150);
        emit(ctx, "device", "CVM_OK", { method: "biometric" }, { titleKey: "ev.cvmOk.title", bodyKey: "ev.cvmOk.body", concept: "cvm" });
        authorize(flow);
      } else {
        emit(ctx, "device", "BIOMETRIC_FAILED", { attempts: 1 }, { titleKey: "ev.bioFail.title", bodyKey: "ev.bioFail.body", concept: "biometric" });
      }
      break;
    }
    case "enter_pin": {
      need(flow, "cvm");
      if (action.pin === DEVICE_PIN) {
        emit(ctx, "device", "CVM_OK", { method: "pin" }, { titleKey: "ev.cvmOk.title", bodyKey: "ev.cvmOk.body", concept: "cvm" });
        step(ctx, 150);
        authorize(flow);
      } else {
        flow.pinStrikes += 1;
        emit(ctx, "device", "PIN_WRONG", { attemptsLeft: Math.max(0, 3 - flow.pinStrikes) }, { titleKey: "ev.pinWrong.title", bodyKey: "ev.pinWrong.body", concept: "authentication" });
        if (flow.pinStrikes >= 3) {
          move(ctx, "DECLINE", "device", "WALLET_DECLINED", { reason: "pin-locked" }, { titleKey: "ev.declined.title", bodyKey: "ev.declined.body", concept: "authorization" });
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

export function runNfcScript(seed: number, params: Record<string, unknown>, failures: FailureId[], actions: NfcAction[], feeRules?: FeeRule[]): RunResult {
  const ctx = createRunBase("nfc", { seed, params, failures, feeRules });
  const flow = createNfcFlow(ctx);
  for (const a of actions) nfcAdvance(flow, a);
  return nfcResult(flow);
}

export function nfcResult(flow: NfcFlow): RunResult {
  return finishRunResult(flow.ctx);
}
