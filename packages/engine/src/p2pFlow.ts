/**
 * Staged P2P transfers runner v2 (social payment app engine).
 * One sitting, many operations, one shared ledger plus a per-user balance
 * mirror (the student starts at $0 and tops up; fictional counterparties
 * hold deterministic demo balances). Three funding rails with different
 * behavior: balance (instant, free), card (instant + fee), bank (pending
 * overnight pull that can still fail). Requests, tracked bill splits with
 * per-leg outcomes, privacy audiences and a scam drill included.
 */
import { computeWaterfall } from "./fees";
import { INITIAL_STATE } from "./machine";
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
import type { FailureId, FeeRule, RunResult } from "./types";

export class IllegalP2pAction extends Error {}

export type Audience = "private" | "friends" | "public";
export type Funding = "balance" | "card" | "bank";

export type P2pAction =
  | { type: "topup"; amountMinor: number; account: string }
  | { type: "send"; to: string; amountMinor: number; note: string; funding: Funding; audience: Audience }
  | { type: "request"; from: string; amountMinor: number; note: string; audience?: Audience }
  | { type: "friend_pays" }
  | { type: "cancel_request" }
  | { type: "incoming_request"; from: string; amountMinor: number }
  | { type: "answer_request"; pay: boolean }
  | { type: "split"; totalMinor: number; legs: { to: string; shareMinor: number }[]; note: string }
  | { type: "leg_paid"; to: string }
  | { type: "leg_declined"; to: string }
  | { type: "settle_bank" }
  | { type: "fail_bank" };

export type P2pStage = "fresh" | "pending" | "incoming" | "pending_bank" | "split" | "done" | "terminal";

export interface P2pLeg {
  to: string;
  shareMinor: number;
  status: "pending" | "paid" | "declined";
}

export interface P2pFlow {
  ctx: Ctx;
  stage: P2pStage;
  /** per-user simulated balances; the student starts at zero, fictional
   *  counterparties hold deterministic demo funds on first contact */
  users: Record<string, number>;
  me: string;
  pendingRequest: { from: string; amountMinor: number; note: string; audience: Audience } | null;
  pendingBank: { to: string; amountMinor: number; note: string; audience: Audience } | null;
  split: { totalMinor: number; note: string; legs: P2pLeg[] } | null;
  transcript: P2pAction[];
}

export function createP2pFlow(ctx: Ctx, me = "@you"): P2pFlow {
  // the provider balance is user-visible: start it at zero (top up first)
  ctx.ledger.fund("customerWallet", -ctx.ledger.balanceOf("customerWallet"));
  return { ctx, stage: "fresh", users: {}, me, pendingRequest: null, pendingBank: null, split: null, transcript: [] };
}

/** Deterministic demo funds for fictional counterparties ($40–$120). */
function seeded(handle: string): number {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  return 4000 + (h % 8001);
}

function ensure(flow: P2pFlow, handle: string): number {
  const u = flow.users[handle];
  if (typeof u === "number") return u;
  const v = handle === flow.me ? 0 : seeded(handle);
  flow.users[handle] = v;
  return v;
}

function need(flow: P2pFlow, ...stages: P2pStage[]): void {
  if (!stages.includes(flow.stage)) throw new IllegalP2pAction(`not allowed at stage ${flow.stage}`);
}

/** A sitting holds many operations; each new one restarts the lifecycle. */
function reopen(flow: P2pFlow): void {
  if (flow.stage === "done" || flow.stage === "split") flow.ctx.state = INITIAL_STATE;
}

function feedPost(flow: P2pFlow, audience: Audience, payload: Record<string, unknown>): void {
  if (audience === "private") return;
  emit(flow.ctx, "psp", "FEED_POSTED", { ...payload, audience }, { titleKey: "ev.feed.title", bodyKey: "ev.feed.body", concept: "wallet" });
}

function settleSend(flow: P2pFlow, to: string, amountMinor: number, note: string, audience: Audience, funding: Funding): void {
  const ctx = flow.ctx;
  if (fails(ctx, "duplicate")) {
    emit(ctx, "psp", "DUPLICATE_BLOCKED", { reason: "double-submit" }, { titleKey: "ev.dupe.title", bodyKey: "ev.dupe.body", concept: "idempotency" });
  }
  if (fails(ctx, "timeout")) {
    emit(ctx, "psp", "GATEWAY_TIMEOUT", {}, { titleKey: "ev.timeout.title", bodyKey: "ev.timeout.body" });
    step(ctx, 900);
    emit(ctx, "psp", "RETRY_SAFE", {}, { titleKey: "ev.retry.title", bodyKey: "ev.retry.body", concept: "idempotency" });
  }
  if (funding === "balance" && ensure(flow, flow.me) < amountMinor) {
    move(ctx, "DECLINE", "psp", "WALLET_DECLINED", { reason: "insufficient-balance" }, { titleKey: "ev.declined.title", bodyKey: "ev.declined.body", concept: "authorization" });
    flow.stage = "terminal";
    return;
  }
  if (fails(ctx, "decline") || fails(ctx, "insufficient")) {
    move(ctx, "DECLINE", "psp", "WALLET_DECLINED", { reason: "insufficient-balance" }, { titleKey: "ev.declined.title", bodyKey: "ev.declined.body", concept: "authorization" });
    flow.stage = "terminal";
    return;
  }
  ctx.state = transition(ctx.state, "AUTHENTICATE");
  if (funding === "balance") {
    flow.users[flow.me] -= amountMinor;
    ensure(flow, to);
    flow.users[to] += amountMinor;
    postSend(flow, "customerWallet", "recipient", amountMinor, "ledger.capture");
  } else if (funding === "card") {
    const wf = computeWaterfall(amountMinor, ctx.feeRules);
    if (ctx.ledger.availableOf("customer") < amountMinor + wf.totalFeesMinor) {
      move(ctx, "DECLINE", "psp", "WALLET_DECLINED", { reason: "insufficient-balance" }, { titleKey: "ev.declined.title", bodyKey: "ev.declined.body", concept: "authorization" });
      flow.stage = "terminal";
      return;
    }
    ensure(flow, to);
    flow.users[to] += amountMinor;
    postSend(flow, "customer", "recipient", amountMinor, "ledger.capture");
    postSend(flow, "customer", "psp", wf.totalFeesMinor, "ledger.fee");
  } else {
    // bank rail: reserve now, move money only when the pull settles
    ctx.ledger.hold("customer", amountMinor);
    emit(ctx, "psp", "P2P_PENDING", { to, amountMinor, note, funding, audience, from: flow.me }, { titleKey: "ev.pending.title", bodyKey: "ev.pending.body", concept: "wallet" });
    step(ctx, 200);
    flow.pendingBank = { to, amountMinor, note, audience };
    flow.stage = "pending_bank";
    return;
  }
  emit(ctx, "psp", "P2P_SENT", { from: flow.me, to, amountMinor, note, funding, audience }, { titleKey: "ev.p2pSent.title", bodyKey: "ev.p2pSent.body", concept: "wallet" });
  step(ctx, 200);
  feedPost(flow, audience, { from: flow.me, to, note });
  ctx.state = transition(ctx.state, "AUTHORIZE");
  ctx.state = transition(ctx.state, "CAPTURE");
  ctx.state = transition(ctx.state, "CLEAR");
  ctx.state = transition(ctx.state, "SETTLE");
  emit(ctx, "psp", "SETTLED", { instant: true }, { titleKey: "ev.settled.title", bodyKey: "ev.settled.body", concept: "settlement" });
  flow.stage = "done";
}

function postSend(flow: P2pFlow, debit: string, credit: string, amountMinor: number, memoKey: string): void {
  const ctx = flow.ctx;
  post(ctx, ctx.events[ctx.events.length - 1].id, "CAPTURE", debit, credit, amountMinor, ctx.currency, memoKey);
}

function resolveSplit(flow: P2pFlow): void {
  const s = flow.split;
  if (!s) return;
  if (s.legs.every((l) => l.status !== "pending")) {
    const paid = s.legs.filter((l) => l.status === "paid").reduce((sum, l) => sum + l.shareMinor, 0);
    emit(flow.ctx, "customer", "SPLIT_COMPLETE", { paidMinor: paid, legs: s.legs.length }, { titleKey: "ev.splitDone.title", bodyKey: "ev.splitDone.body", concept: "wallet" });
  }
}

export function p2pAdvance(flow: P2pFlow, action: P2pAction): { stage: P2pStage } {
  const ctx = flow.ctx;
  flow.transcript.push(action);
  switch (action.type) {
    case "topup": {
      need(flow, "fresh", "done", "split");
      reopen(flow);
      if (!(action.amountMinor > 0) || action.account.replace(/\D/g, "").length < 6) {
        throw new IllegalP2pAction("top-up needs an amount and a bank account");
      }
      const wf = computeWaterfall(action.amountMinor, ctx.feeRules);
      ctx.ledger.fund("customerWallet", action.amountMinor - wf.totalFeesMinor);
      ensure(flow, flow.me);
      flow.users[flow.me] += action.amountMinor - wf.totalFeesMinor;
      emit(ctx, "psp", "TOPUP_FUNDED", { amountMinor: action.amountMinor, feeMinor: wf.totalFeesMinor, balanceMinor: flow.users[flow.me] }, { titleKey: "ev.topup.title", bodyKey: "ev.topup.body", concept: "wallet" });
      step(ctx, 250);
      postSend(flow, "customer", "psp", wf.totalFeesMinor, "ledger.fee");
      if (flow.stage === "fresh") flow.stage = "done";
      break;
    }
    case "send": {
      need(flow, "fresh", "done", "split");
      reopen(flow);
      if (action.to.trim().length < 2) throw new IllegalP2pAction("recipient is required");
      if (!(action.amountMinor > 0)) throw new IllegalP2pAction("amount is required");
      settleSend(flow, action.to.trim(), action.amountMinor, action.note, action.audience, action.funding);
      break;
    }
    case "settle_bank": {
      need(flow, "pending_bank");
      const p = flow.pendingBank!;
      ctx.ledger.releaseHold("customer", p.amountMinor);
      ensure(flow, p.to);
      flow.users[p.to] += p.amountMinor;
      postSend(flow, "customer", "recipient", p.amountMinor, "ledger.capture");
      emit(ctx, "psp", "P2P_SENT", { from: flow.me, to: p.to, amountMinor: p.amountMinor, note: p.note, funding: "bank", audience: p.audience }, { titleKey: "ev.p2pSent.title", bodyKey: "ev.p2pSent.body", concept: "wallet" });
      step(ctx, 200);
      feedPost(flow, p.audience, { from: flow.me, to: p.to, note: p.note });
      ctx.state = transition(ctx.state, "AUTHORIZE");
      ctx.state = transition(ctx.state, "CAPTURE");
      ctx.state = transition(ctx.state, "CLEAR");
      ctx.state = transition(ctx.state, "SETTLE");
      emit(ctx, "psp", "SETTLED", { instant: false }, { titleKey: "ev.settled.title", bodyKey: "ev.settled.body", concept: "settlement" });
      flow.pendingBank = null;
      flow.stage = "done";
      break;
    }
    case "fail_bank": {
      need(flow, "pending_bank");
      ctx.ledger.releaseHold("customer", flow.pendingBank!.amountMinor);
      emit(ctx, "psp", "BANK_PULL_FAILED", { reason: "nsf-at-bank" }, { titleKey: "ev.bankFail.title", bodyKey: "ev.bankFail.body", concept: "wallet" });
      move(ctx, "CANCEL", "customer", "CANCELLED", {}, { titleKey: "ev.cancelled.title", bodyKey: "ev.cancelled.body" });
      flow.pendingBank = null;
      flow.stage = "terminal";
      break;
    }
    case "request": {
      need(flow, "fresh", "done", "split");
      reopen(flow);
      if (action.from.trim().length < 2 || !(action.amountMinor > 0)) throw new IllegalP2pAction("request needs a friend and an amount");
      emit(ctx, "customer", "REQUEST_SENT", { from: action.from.trim(), to: flow.me, amountMinor: action.amountMinor, note: action.note, audience: action.audience ?? "friends" }, { titleKey: "ev.reqSent.title", bodyKey: "ev.reqSent.body", concept: "wallet" });
      step(ctx, 200);
      ctx.state = transition(ctx.state, "FLAG_REVIEW");
      flow.pendingRequest = { from: action.from.trim(), amountMinor: action.amountMinor, note: action.note, audience: action.audience ?? "friends" };
      flow.stage = "pending";
      break;
    }
    case "friend_pays": {
      need(flow, "pending");
      const r = flow.pendingRequest!;
      ensure(flow, flow.me);
      flow.users[flow.me] += r.amountMinor;
      ctx.ledger.fund("customerWallet", r.amountMinor);
      emit(ctx, "psp", "REQUEST_PAID", { from: r.from, to: flow.me, amountMinor: r.amountMinor }, { titleKey: "ev.reqPaid.title", bodyKey: "ev.reqPaid.body", concept: "wallet" });
      step(ctx, 200);
      feedPost(flow, r.audience, { from: r.from, to: flow.me, note: r.note });
      ctx.state = transition(ctx.state, "RESOLVE_REVIEW");
      ctx.state = transition(ctx.state, "AUTHORIZE");
      ctx.state = transition(ctx.state, "CAPTURE");
      ctx.state = transition(ctx.state, "CLEAR");
      ctx.state = transition(ctx.state, "SETTLE");
      emit(ctx, "psp", "SETTLED", { instant: true }, { titleKey: "ev.settled.title", bodyKey: "ev.settled.body", concept: "settlement" });
      flow.pendingRequest = null;
      flow.stage = "done";
      break;
    }
    case "cancel_request": {
      need(flow, "pending");
      emit(ctx, "customer", "REQUEST_CANCELLED", { from: flow.pendingRequest!.from }, { titleKey: "ev.reqCancel.title", bodyKey: "ev.reqCancel.body", concept: "wallet" });
      if (ctx.state === "PENDING_REVIEW") {
        move(ctx, "CANCEL", "customer", "CANCELLED", {}, { titleKey: "ev.cancelled.title", bodyKey: "ev.cancelled.body" });
      }
      flow.pendingRequest = null;
      flow.stage = "terminal";
      break;
    }
    case "incoming_request": {
      need(flow, "fresh", "done", "split");
      reopen(flow);
      emit(ctx, "psp", "INCOMING_REQUEST", { from: action.from, amountMinor: action.amountMinor, unknown: true }, { titleKey: "ev.incoming.title", bodyKey: "ev.incoming.body", concept: "phishing" });
      step(ctx, 200);
      flow.pendingRequest = { from: action.from, amountMinor: action.amountMinor, note: "", audience: "private" };
      flow.stage = "incoming";
      break;
    }
    case "answer_request": {
      need(flow, "incoming");
      const r = flow.pendingRequest!;
      if (action.pay) {
        settleSend(flow, r.from, r.amountMinor, "scam payment", "private", "balance");
        emit(ctx, "system", "SCAM_WARNING", { to: r.from, paid: flow.stage === "done" }, { titleKey: "ev.scamWarn.title", bodyKey: "ev.scamWarn.body", concept: "phishing" });
      } else {
        emit(ctx, "customer", "SCAM_REPORTED", { from: r.from }, { titleKey: "ev.scamRep.title", bodyKey: "ev.scamRep.body", concept: "phishing" });
        if (ctx.state === "INITIATED") {
          move(ctx, "CANCEL", "customer", "CANCELLED", {}, { titleKey: "ev.cancelled.title", bodyKey: "ev.cancelled.body" });
        }
        flow.stage = "terminal";
      }
      flow.pendingRequest = null;
      break;
    }
    case "split": {
      need(flow, "fresh", "done", "split");
      reopen(flow);
      const sum = action.legs.reduce((s, l) => s + l.shareMinor, 0);
      if (sum !== action.totalMinor) throw new IllegalP2pAction("shares must add up to the total");
      if (action.legs.some((l) => l.to.trim().length < 2 || !(l.shareMinor > 0))) throw new IllegalP2pAction("each leg needs a friend and a share");
      emit(ctx, "customer", "SPLIT_CREATED", { totalMinor: action.totalMinor, legs: action.legs.length, note: action.note }, { titleKey: "ev.split.title", bodyKey: "ev.split.body", concept: "wallet" });
      step(ctx, 200);
      for (const leg of action.legs) {
        ensure(flow, leg.to.trim());
        emit(ctx, "customer", "REQUEST_SENT", { from: leg.to.trim(), to: flow.me, amountMinor: leg.shareMinor, note: `${action.note} (split)` }, { titleKey: "ev.reqSent.title", bodyKey: "ev.reqSent.body", concept: "wallet" });
        step(ctx, 120);
      }
      flow.split = { totalMinor: action.totalMinor, note: action.note, legs: action.legs.map((l) => ({ to: l.to.trim(), shareMinor: l.shareMinor, status: "pending" as const })) };
      flow.stage = "split";
      break;
    }
    case "leg_paid": {
      need(flow, "split");
      const leg = flow.split?.legs.find((l) => l.to === action.to && l.status === "pending");
      if (!leg) throw new IllegalP2pAction("no pending leg for that friend");
      leg.status = "paid";
      ensure(flow, flow.me);
      flow.users[flow.me] += leg.shareMinor;
      ctx.ledger.fund("customerWallet", leg.shareMinor);
      emit(ctx, "psp", "LEG_PAID", { from: leg.to, to: flow.me, shareMinor: leg.shareMinor }, { titleKey: "ev.sharePaid.title", bodyKey: "ev.sharePaid.body", concept: "wallet" });
      step(ctx, 150);
      feedPost(flow, "friends", { from: leg.to, to: flow.me, note: flow.split!.note });
      resolveSplit(flow);
      break;
    }
    case "leg_declined": {
      need(flow, "split");
      const leg = flow.split?.legs.find((l) => l.to === action.to && l.status === "pending");
      if (!leg) throw new IllegalP2pAction("no pending leg for that friend");
      leg.status = "declined";
      emit(ctx, "customer", "LEG_DECLINED", { from: leg.to, shareMinor: leg.shareMinor }, { titleKey: "ev.legDeclined.title", bodyKey: "ev.legDeclined.body", concept: "wallet" });
      step(ctx, 150);
      resolveSplit(flow);
      break;
    }
  }
  return { stage: flow.stage };
}

export function runP2pScript(seed: number, params: Record<string, unknown>, failures: FailureId[], actions: P2pAction[], feeRules?: FeeRule[]): RunResult {
  const ctx = createRunBase("p2p", { seed, params, failures, feeRules });
  const flow = createP2pFlow(ctx);
  for (const a of actions) p2pAdvance(flow, a);
  return p2pResult(flow);
}

export function p2pResult(flow: P2pFlow): RunResult {
  return finishRunResult(flow.ctx);
}

export function p2pBalance(flow: P2pFlow): number {
  return flow.ctx.ledger.balanceOf("customerWallet");
}

/** Per-user simulated balances (the shared state behind user switching). */
export function p2pUsers(flow: P2pFlow): Record<string, number> {
  return { ...flow.users };
}
