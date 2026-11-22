/**
 * Staged BNPL runner (Klarna / Tabby-inspired, generic provider).
 * Apply with income and obligations (soft check, scored), pick a plan,
 * activate (merchant funded minus discount fee), then repay leg by leg.
 * Missed legs accrue late fees; returns cancel what is left and refund
 * what was paid. Illustrative underwriting throughout.
 */
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

export class IllegalBnplAction extends Error {}

export type BnplAction =
  | { type: "apply"; incomeMinor: number; obligationsMinor: number; plan: 4 | 12 }
  | { type: "submit_verification"; code: string }
  | { type: "activate" }
  | { type: "pay_leg"; n: number }
  | { type: "miss_leg"; n: number }
  | { type: "return_goods" };

export type BnplStage = "fresh" | "verify" | "offer" | "active" | "done" | "terminal";

export interface BnplLeg {
  n: number;
  amountMinor: number;
  dueDay: number;
  paid: boolean;
  missed: boolean;
}

export interface BnplFlow {
  ctx: Ctx;
  stage: BnplStage;
  plan: 4 | 12;
  score: number | null;
  verify: { code: string; attemptsLeft: number } | null;
  legs: BnplLeg[];
  lateTotal: number;
  paidTotal: number;
  transcript: BnplAction[];
}

const DAY_MS = 86_400_000;

export function createBnplFlow(ctx: Ctx): BnplFlow {
  return { ctx, stage: "fresh", plan: 4, score: null, verify: null, legs: [], lateTotal: 0, paidTotal: 0, transcript: [] };
}

function need(flow: BnplFlow, ...stages: BnplStage[]): void {
  if (!stages.includes(flow.stage)) throw new IllegalBnplAction(`not allowed at stage ${flow.stage}`);
}

function nextUnpaid(flow: BnplFlow): BnplLeg | undefined {
  return flow.legs.find((l) => !l.paid);
}

function lateFeeOf(ctx: Ctx): number {
  const v = ctx.params.lateFeeMinor;
  return typeof v === "number" && Number.isFinite(v) ? v : 800;
}

/** Identical split math everywhere: floor per leg, remainder on the last. */
function buildLegs(flow: BnplFlow): void {
  const ctx = flow.ctx;
  const n = flow.plan;
  const per = Math.floor(ctx.amountMinor / n);
  flow.legs = Array.from({ length: n }, (_, i) => ({
    n: i + 1,
    amountMinor: i === n - 1 ? ctx.amountMinor - per * (n - 1) : per,
    dueDay: 30 * (i + 1),
    paid: false,
    missed: false
  }));
}

function missLeg(flow: BnplFlow, leg: BnplLeg, via: string): void {
  const ctx = flow.ctx;
  leg.missed = true;
  const fee = lateFeeOf(ctx);
  flow.lateTotal += fee;
  emit(ctx, "bnpl", "INSTALLMENT_MISSED", { n: leg.n, via }, { titleKey: "ev.missed.title", bodyKey: "ev.missed.body", concept: "default-risk" });
  emit(ctx, "bnpl", "LATE_FEE_CHARGED", { feeMinor: fee, lateTotalMinor: flow.lateTotal }, { titleKey: "ev.late.title", bodyKey: "ev.late.body", concept: "late-fee" });
  step(ctx, 150);
}

export function bnplAdvance(flow: BnplFlow, action: BnplAction): { stage: BnplStage } {
  const ctx = flow.ctx;
  flow.transcript.push(action);
  switch (action.type) {
    case "apply": {
      need(flow, "fresh");
      if (!(ctx.amountMinor > 0)) throw new IllegalBnplAction("basket total is required");
      if (!(action.incomeMinor > 0) || action.obligationsMinor < 0) throw new IllegalBnplAction("income and obligations are required");
      flow.plan = action.plan;
      if (fails(ctx, "timeout")) {
        emit(ctx, "bnpl", "GATEWAY_TIMEOUT", {}, { titleKey: "ev.timeout.title", bodyKey: "ev.timeout.body" });
        step(ctx, 900);
        emit(ctx, "bnpl", "RETRY_SAFE", {}, { titleKey: "ev.retry.title", bodyKey: "ev.retry.body", concept: "idempotency" });
      }
      const ratio = action.obligationsMinor / action.incomeMinor;
      const existing = typeof ctx.params.existingLoans === "number" ? ctx.params.existingLoans : 0;
      const score = Math.round(78 - ratio * 120 + ctx.rng.int(-4, 4) - (action.plan === 12 ? 8 : 0) - existing * 6);
      flow.score = score;
      emit(ctx, "bnpl", "ELIGIBILITY_CHECKED", { score, debtRatio: Math.round(ratio * 100), plan: action.plan }, { titleKey: "ev.elig.title", bodyKey: "ev.elig.body", concept: "underwriting" });
      step(ctx, 300);
      if (fails(ctx, "decline") || score < 40) {
        const reasons = fails(ctx, "decline")
          ? ["provider-policy"]
          : [ratio > 0.4 ? "debt-ratio" : "thin-file", ...(action.plan === 12 ? ["long-plan" as string] : [])];
        move(ctx, "DECLINE", "bnpl", "BNPL_DENIED", { reasons }, { titleKey: "ev.denied.title", bodyKey: "ev.denied.body", concept: "underwriting" });
        flow.stage = "terminal";
        break;
      }
      if (score < 50) {
        flow.verify = { code: String(ctx.rng.int(0, 999999)).padStart(6, "0"), attemptsLeft: 3 };
        emit(ctx, "bnpl", "VERIFICATION_REQUIRED", { method: "sms-code", attemptsLeft: 3, code: flow.verify.code }, { titleKey: "ev.verifyReq.title", bodyKey: "ev.verifyReq.body", concept: "underwriting" });
        flow.stage = "verify";
        break;
      }
      buildLegs(flow);
      emit(ctx, "bnpl", "BNPL_APPROVED", { plan: action.plan, legs: flow.legs }, { titleKey: "ev.approved.title", bodyKey: "ev.approved.body", concept: "underwriting" });
      step(ctx, 200);
      flow.stage = "offer";
      break;
    }
    case "submit_verification": {
      need(flow, "verify");
      if (!flow.verify) throw new IllegalBnplAction("no verification open");
      if (action.code === flow.verify.code) {
        flow.verify = null;
        buildLegs(flow);
        emit(ctx, "bnpl", "BNPL_APPROVED", { plan: flow.plan, legs: flow.legs, verified: true }, { titleKey: "ev.approved.title", bodyKey: "ev.approved.body", concept: "underwriting" });
        step(ctx, 200);
        flow.stage = "offer";
      } else {
        flow.verify.attemptsLeft -= 1;
        if (flow.verify.attemptsLeft <= 0) {
          flow.verify = null;
          move(ctx, "DECLINE", "bnpl", "BNPL_DENIED", { reasons: ["verification-failed"] }, { titleKey: "ev.denied.title", bodyKey: "ev.denied.body", concept: "underwriting" });
          flow.stage = "terminal";
        } else {
          emit(ctx, "bnpl", "VERIFICATION_WRONG", { attemptsLeft: flow.verify.attemptsLeft }, { titleKey: "ev.verifyWrong.title", bodyKey: "ev.verifyWrong.body", concept: "underwriting" });
        }
      }
      break;
    }
    case "activate": {
      need(flow, "offer");
      ctx.ledger.fund("bnpl", ctx.amountMinor);
      ctx.state = transition(ctx.state, "AUTHENTICATE");
      ctx.state = transition(ctx.state, "AUTHORIZE");
      postActivate(flow);
      flow.stage = "active";
      break;
    }
    case "pay_leg": {
      need(flow, "active");
      const leg = nextUnpaid(flow);
      if (!leg || leg.n !== action.n) throw new IllegalBnplAction("legs pay in order");
      if (fails(ctx, "insufficient")) {
        emit(ctx, "bnpl", "AUTODEBIT_FAILED", { n: leg.n, reason: "nsf" }, { titleKey: "ev.autodebit.title", bodyKey: "ev.autodebit.body", concept: "default-risk" });
        missLeg(flow, leg, "autodebit");
        break;
      }
      if (ctx.ledger.availableOf("customer") < leg.amountMinor) {
        emit(ctx, "bnpl", "AUTODEBIT_FAILED", { n: leg.n, reason: "nsf" }, { titleKey: "ev.autodebit.title", bodyKey: "ev.autodebit.body", concept: "default-risk" });
        missLeg(flow, leg, "autodebit");
        break;
      }
      postLeg(flow, leg);
      if (!nextUnpaid(flow)) {
        emit(ctx, "bnpl", "PLAN_COMPLETE", { paidTotalMinor: flow.paidTotal, lateTotalMinor: flow.lateTotal }, { titleKey: "ev.complete.title", bodyKey: "ev.complete.body", concept: "installment" });
        flow.stage = "done";
      }
      break;
    }
    case "miss_leg": {
      need(flow, "active");
      const leg = nextUnpaid(flow);
      if (!leg || leg.n !== action.n) throw new IllegalBnplAction("legs run in order");
      missLeg(flow, leg, "skipped");
      break;
    }
    case "return_goods": {
      need(flow, "active");
      const cancelled = flow.legs.filter((l) => !l.paid).length;
      postReturn(flow);
      emit(ctx, "bnpl", "LEGS_CANCELLED", { cancelled }, { titleKey: "ev.legsCancelled.title", bodyKey: "ev.legsCancelled.body", concept: "installment" });
      emit(ctx, "bnpl", "RETURNED", { refundedMinor: flow.paidTotal }, { titleKey: "ev.returned.title", bodyKey: "ev.returned.body", concept: "installment" });
      flow.stage = "done";
      break;
    }
  }
  return { stage: flow.stage };
}

function postActivate(flow: BnplFlow): void {
  const ctx = flow.ctx;
  post(ctx, ctx.events[ctx.events.length - 1].id, "CAPTURE", "bnpl", "merchant", ctx.netAmount, ctx.currency, "ledger.capture");
  emit(ctx, "bnpl", "PLAN_ACTIVATED", { merchantNetMinor: ctx.netAmount, legs: flow.legs.length }, { titleKey: "ev.activated.title", bodyKey: "ev.activated.body", concept: "installment" });
  ctx.clock.advance(DAY_MS);
  ctx.state = transition(ctx.state, "CAPTURE");
  ctx.state = transition(ctx.state, "CLEAR");
  ctx.state = transition(ctx.state, "SETTLE");
}

function postLeg(flow: BnplFlow, leg: BnplLeg): void {
  const ctx = flow.ctx;
  ctx.clock.advance(30 * DAY_MS);
  post(ctx, ctx.events[ctx.events.length - 1].id, "CAPTURE", "customer", "bnpl", leg.amountMinor, ctx.currency, "ledger.capture");
  leg.paid = true;
  flow.paidTotal += leg.amountMinor;
  emit(ctx, "bnpl", "INSTALLMENT_PAID", { n: leg.n, of: flow.legs.length, paidTotalMinor: flow.paidTotal }, { titleKey: "ev.legPaid.title", bodyKey: "ev.legPaid.body", concept: "installment" });
  step(ctx, 150);
}

function postReturn(flow: BnplFlow): void {
  const ctx = flow.ctx;
  if (flow.paidTotal > 0) {
    post(ctx, ctx.events[ctx.events.length - 1].id, "REFUND", "bnpl", "customer", flow.paidTotal, ctx.currency, "ledger.refund");
  }
}

export function runBnplScript(seed: number, params: Record<string, unknown>, failures: FailureId[], actions: BnplAction[], feeRules?: FeeRule[]): RunResult {
  const ctx = createRunBase("bnpl", { seed, params, failures, feeRules });
  const flow = createBnplFlow(ctx);
  for (const a of actions) bnplAdvance(flow, a);
  return bnplResult(flow);
}

export function bnplResult(flow: BnplFlow): RunResult {
  return finishRunResult(flow.ctx);
}

export function bnplOwed(flow: BnplFlow): number {
  return flow.legs.filter((l) => !l.paid).reduce((s, l) => s + l.amountMinor, 0) + flow.lateTotal;
}
