/**
 * Staged mobile-money runner (M-PESA-inspired, generic labels).
 * One USSD sitting per session: open -> set/enter PIN -> one money service.
 * The wallet starts at ZERO (cash-in first, like real life); the ledger is
 * only ever funded by agent cash-ins, never by a hidden faucet. Agents have
 * floats that can run dry; the 120s USSD clock is enforced by the UI.
 */
import { computeWaterfall } from "./fees";
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
import type { ActorId, FailureId, FeeRule, RunResult } from "./types";

export class IllegalMmAction extends Error {}

export type MmService =
  | { kind: "send"; to: string; amountMinor: number }
  | { kind: "cashout"; agentFloat: number; amountMinor: number }
  | { kind: "cashin"; agentFloat: number; amountMinor: number }
  | { kind: "bill"; biller: string; account: string; amountMinor: number }
  | { kind: "airtime"; phone: string; amountMinor: number };

export type MmAction =
  | { type: "ussd_open" }
  | { type: "set_pin"; pin: string; confirm: string }
  | { type: "send"; to: string; amountMinor: number }
  | { type: "cashout"; agentFloat: number; amountMinor: number }
  | { type: "cashin"; agentFloat: number; amountMinor: number }
  | { type: "paybill"; biller: string; account: string; amountMinor: number }
  | { type: "airtime"; phone: string; amountMinor: number }
  | { type: "balance" }
  | { type: "submit_pin"; pin: string }
  | { type: "ussd_timeout" };

export type MmStage = "fresh" | "pinsetup" | "menu" | "pin" | "done" | "terminal";

export interface MmFlow {
  ctx: Ctx;
  stage: MmStage;
  pin: string | null;
  pinStrikes: number;
  pending: MmService | null;
  transcript: MmAction[];
}

const PHONE_RE = /^\d{9,12}$/;
const PIN_RE = /^\d{4}$/;

export function createMmFlow(ctx: Ctx): MmFlow {
  return { ctx, stage: "fresh", pin: null, pinStrikes: 0, pending: null, transcript: [] };
}

function need(flow: MmFlow, ...stages: MmStage[]): void {
  if (!stages.includes(flow.stage)) throw new IllegalMmAction(`not allowed at stage ${flow.stage}`);
}

function feeFor(ctx: Ctx, amountMinor: number) {
  return computeWaterfall(amountMinor, ctx.feeRules);
}

/** Point the run at the user-typed amount (fees + receipt follow it). */
function setAmount(ctx: Ctx, amountMinor: number): void {
  ctx.amountMinor = amountMinor;
  const wf = feeFor(ctx, amountMinor);
  ctx.feeLines = wf.lines;
  ctx.totalFees = wf.totalFeesMinor;
  ctx.netAmount = wf.netAmountMinor;
}

function settleService(
  flow: MmFlow,
  postings: () => void,
  actor: ActorId,
  type: string,
  payload: Record<string, unknown>,
  titleKey: string,
  bodyKey: string
): void {
  const ctx = flow.ctx;
  ctx.state = transition(ctx.state, "AUTHENTICATE");
  ctx.state = transition(ctx.state, "AUTHORIZE");
  postings();
  emit(ctx, actor, type, payload, { titleKey, bodyKey, concept: "settlement" });
  ctx.state = transition(ctx.state, "CAPTURE");
  ctx.state = transition(ctx.state, "CLEAR");
  ctx.state = transition(ctx.state, "SETTLE");
  emit(ctx, "operator", "SETTLED", { instant: true }, { titleKey: "ev.settled.title", bodyKey: "ev.settled.body", concept: "settlement" });
  flow.pending = null;
  flow.stage = "done";
}

export function mmAdvance(flow: MmFlow, action: MmAction): { stage: MmStage } {
  const ctx = flow.ctx;
  flow.transcript.push(action);
  switch (action.type) {
    case "ussd_open": {
      need(flow, "fresh");
      // Carry-over wallet: a fresh ledger starts at zero, so fund it with the
      // verified closing balance of the previous session (defaults to 0 —
      // the wallet still starts empty on first use).
      const openBal = typeof ctx.params.openBalanceMinor === "number" && ctx.params.openBalanceMinor > 0
        ? Math.floor(ctx.params.openBalanceMinor) : 0;
      ctx.ledger.fund("customer", openBal - ctx.ledger.balanceOf("customer"));
      ctx.ledger.fund("agent", 100_000_000);
      // Operator pays agent cash-out commission out of its own float, just
      // like the till floats above — otherwise the commission posting would
      // overdraw an account the ledger correctly refuses to fund implicitly.
      ctx.ledger.fund("operator", 100_000_000);
      emit(ctx, "customer", "USSD_OPENED", { session: `ussd-${ctx.rng.hex(3)}` }, { titleKey: "ev.ussd.title", bodyKey: "ev.ussd.body", concept: "ussd" });
      step(ctx, 200);
      const returning = typeof ctx.params.pinExpected === "string" && PIN_RE.test(ctx.params.pinExpected);
      if (returning) {
        flow.pin = ctx.params.pinExpected as string;
        emit(ctx, "telecom", "USSD_MENU", { screen: "root" }, { titleKey: "ev.menu.title", bodyKey: "ev.menu.body", concept: "ussd" });
        flow.stage = "menu";
      } else {
        flow.stage = "pinsetup";
      }
      break;
    }
    case "set_pin": {
      need(flow, "pinsetup");
      if (!PIN_RE.test(action.pin) || action.pin !== action.confirm) {
        throw new IllegalMmAction("PINs must be 4 digits and match");
      }
      flow.pin = action.pin;
      emit(ctx, "customer", "PIN_SET", {}, { titleKey: "ev.pinSet.title", bodyKey: "ev.pinSet.body", concept: "authentication" });
      step(ctx, 200);
      emit(ctx, "telecom", "USSD_MENU", { screen: "root" }, { titleKey: "ev.menu.title", bodyKey: "ev.menu.body", concept: "ussd" });
      flow.stage = "menu";
      break;
    }
    case "send": {
      need(flow, "menu");
      if (!PHONE_RE.test(action.to.replace(/\D/g, "")) || !(action.amountMinor > 0)) throw new IllegalMmAction("send needs a phone number and an amount");
      emit(ctx, "telecom", "USSD_MENU", { screen: "send-confirm", to: action.to, amountMinor: action.amountMinor }, { titleKey: "ev.menu.title", bodyKey: "ev.menu.body", concept: "ussd" });
      setAmount(ctx, action.amountMinor);
      flow.pending = { kind: "send", to: action.to.replace(/\D/g, ""), amountMinor: action.amountMinor };
      flow.pinStrikes = 0;
      flow.stage = "pin";
      break;
    }
    case "cashout": {
      need(flow, "menu");
      if (!(action.amountMinor > 0)) throw new IllegalMmAction("cash-out needs an amount");
      if (action.agentFloat < action.amountMinor) {
        emit(ctx, "agent", "AGENT_NO_FLOAT", { agentFloat: action.agentFloat, amountMinor: action.amountMinor }, { titleKey: "ev.noFloat.title", bodyKey: "ev.noFloat.body", concept: "float" });
        break;
      }
      emit(ctx, "telecom", "USSD_MENU", { screen: "cashout-confirm", amountMinor: action.amountMinor }, { titleKey: "ev.menu.title", bodyKey: "ev.menu.body", concept: "ussd" });
      setAmount(ctx, action.amountMinor);
      flow.pending = { kind: "cashout", agentFloat: action.agentFloat, amountMinor: action.amountMinor };
      flow.pinStrikes = 0;
      flow.stage = "pin";
      break;
    }
    case "cashin": {
      need(flow, "menu");
      if (!(action.amountMinor > 0)) throw new IllegalMmAction("cash-in needs an amount");
      if (action.agentFloat < action.amountMinor) {
        emit(ctx, "agent", "AGENT_NO_FLOAT", { agentFloat: action.agentFloat, amountMinor: action.amountMinor }, { titleKey: "ev.noFloat.title", bodyKey: "ev.noFloat.body", concept: "float" });
        break;
      }
      emit(ctx, "telecom", "USSD_MENU", { screen: "cashin-confirm", amountMinor: action.amountMinor }, { titleKey: "ev.menu.title", bodyKey: "ev.menu.body", concept: "ussd" });
      setAmount(ctx, action.amountMinor);
      flow.pending = { kind: "cashin", agentFloat: action.agentFloat, amountMinor: action.amountMinor };
      flow.pinStrikes = 0;
      flow.stage = "pin";
      break;
    }
    case "paybill": {
      need(flow, "menu");
      if (action.biller.trim().length < 2 || action.account.trim().length < 3 || !(action.amountMinor > 0)) {
        throw new IllegalMmAction("bill needs a biller, an account and an amount");
      }
      emit(ctx, "telecom", "USSD_MENU", { screen: "bill-confirm", biller: action.biller }, { titleKey: "ev.menu.title", bodyKey: "ev.menu.body", concept: "ussd" });
      setAmount(ctx, action.amountMinor);
      flow.pending = { kind: "bill", biller: action.biller.trim(), account: action.account.trim(), amountMinor: action.amountMinor };
      flow.pinStrikes = 0;
      flow.stage = "pin";
      break;
    }
    case "airtime": {
      need(flow, "menu");
      if (!PHONE_RE.test(action.phone.replace(/\D/g, "")) || !(action.amountMinor > 0)) throw new IllegalMmAction("airtime needs a phone number and an amount");
      emit(ctx, "telecom", "USSD_MENU", { screen: "airtime-confirm" }, { titleKey: "ev.menu.title", bodyKey: "ev.menu.body", concept: "ussd" });
      setAmount(ctx, action.amountMinor);
      flow.pending = { kind: "airtime", phone: action.phone.replace(/\D/g, ""), amountMinor: action.amountMinor };
      flow.pinStrikes = 0;
      flow.stage = "pin";
      break;
    }
    case "balance": {
      need(flow, "menu");
      emit(ctx, "operator", "BALANCE_SHOWN", { balanceMinor: ctx.ledger.balanceOf("customer") }, { titleKey: "ev.balance.title", bodyKey: "ev.balance.body", concept: "ussd" });
      step(ctx, 150);
      break;
    }
    case "submit_pin": {
      need(flow, "pin");
      if (!flow.pending) throw new IllegalMmAction("nothing to confirm");
      if (fails(ctx, "fraud")) {
        emit(ctx, "operator", "SIM_SWAP_FLAG", {}, { titleKey: "ev.simSwap.title", bodyKey: "ev.simSwap.body", concept: "phishing" });
        ctx.state = transition(ctx.state, "FLAG_REVIEW");
        flow.stage = "terminal";
        break;
      }
      if (action.pin !== flow.pin) {
        flow.pinStrikes += 1;
        emit(ctx, "customer", "PIN_WRONG", { attemptsLeft: Math.max(0, 3 - flow.pinStrikes) }, { titleKey: "ev.pinWrong.title", bodyKey: "ev.pinWrong.body", concept: "authentication" });
        if (flow.pinStrikes >= 3) {
          move(ctx, "DECLINE", "operator", "PIN_LOCKED", {}, { titleKey: "ev.pinLocked.title", bodyKey: "ev.pinLocked.body", concept: "authentication" });
          flow.stage = "terminal";
        }
        break;
      }
      const p = flow.pending;
      const totalOf = (amountMinor: number) => amountMinor + feeFor(ctx, amountMinor).totalFeesMinor;
      if (p.kind !== "cashin" && ctx.ledger.availableOf("customer") < totalOf(p.amountMinor)) {
        move(ctx, "DECLINE", "operator", "WALLET_DECLINED", { reason: "insufficient-balance" }, { titleKey: "ev.declined.title", bodyKey: "ev.declined.body", concept: "authorization" });
        flow.stage = "terminal";
        break;
      }
      const ref = () => ctx.events[ctx.events.length - 1].id;
      if (p.kind === "send") {
        const wf = feeFor(ctx, p.amountMinor);
        settleService(flow,
          () => {
            post(ctx, ref(), "CAPTURE", "customer", "recipient", p.amountMinor, ctx.currency, "ledger.capture");
            post(ctx, ref(), "FEE", "customer", "operator", wf.totalFeesMinor, ctx.currency, "ledger.fee");
          },
          "customer", "MM_SENT", { to: p.to, amountMinor: p.amountMinor }, "ev.mmSent.title", "ev.mmSent.body");
      } else if (p.kind === "cashout") {
        const wf = feeFor(ctx, p.amountMinor);
        const comm = Math.max(100, Math.round(p.amountMinor / 100));
        settleService(flow,
          () => {
            post(ctx, ref(), "CAPTURE", "customer", "agent", p.amountMinor, ctx.currency, "ledger.capture");
            post(ctx, ref(), "FEE", "customer", "operator", wf.totalFeesMinor, ctx.currency, "ledger.fee");
            post(ctx, ref(), "FEE", "operator", "agent", comm, ctx.currency, "ledger.commission");
          },
          "agent", "CASHOUT_DONE", { amountMinor: p.amountMinor, commissionMinor: comm }, "ev.cashout.title", "ev.cashout.body");
      } else if (p.kind === "cashin") {
        settleService(flow,
          () => {
            post(ctx, ref(), "CAPTURE", "agent", "customer", p.amountMinor, ctx.currency, "ledger.capture");
          },
          "agent", "CASHIN_DONE", { amountMinor: p.amountMinor }, "ev.cashin.title", "ev.cashin.body");
      } else if (p.kind === "bill") {
        const wf = feeFor(ctx, p.amountMinor);
        settleService(flow,
          () => {
            post(ctx, ref(), "CAPTURE", "customer", "provider", p.amountMinor, ctx.currency, "ledger.capture");
            post(ctx, ref(), "FEE", "customer", "operator", wf.totalFeesMinor, ctx.currency, "ledger.fee");
          },
          "customer", "BILL_PAID", { biller: p.biller, amountMinor: p.amountMinor }, "ev.billPaid.title", "ev.billPaid.body");
      } else {
        const wf = feeFor(ctx, p.amountMinor);
        settleService(flow,
          () => {
            post(ctx, ref(), "CAPTURE", "customer", "provider", p.amountMinor, ctx.currency, "ledger.capture");
            post(ctx, ref(), "FEE", "customer", "operator", wf.totalFeesMinor, ctx.currency, "ledger.fee");
          },
          "customer", "AIRTIME_BOUGHT", { phone: p.phone, amountMinor: p.amountMinor }, "ev.airtime.title", "ev.airtime.body");
      }
      break;
    }
    case "ussd_timeout": {
      need(flow, "menu", "pin", "pinsetup");
      move(ctx, "EXPIRE", "telecom", "SESSION_TIMEOUT", {}, { titleKey: "ev.ussdTimeout.title", bodyKey: "ev.ussdTimeout.body", concept: "ussd" });
      flow.stage = "terminal";
      break;
    }
  }
  return { stage: flow.stage };
}

export function runMmScript(seed: number, params: Record<string, unknown>, failures: FailureId[], actions: MmAction[], feeRules?: FeeRule[]): RunResult {
  const ctx = createRunBase("mobilemoney", { seed, params, failures, feeRules });
  const flow = createMmFlow(ctx);
  for (const a of actions) mmAdvance(flow, a);
  return mmResult(flow);
}

export function mmResult(flow: MmFlow): RunResult {
  return finishRunResult(flow.ctx);
}

export function mmBalance(flow: MmFlow): number {
  return flow.ctx.ledger.balanceOf("customer");
}
