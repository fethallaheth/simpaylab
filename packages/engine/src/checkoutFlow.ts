/**
 * Staged online-checkout runner — C1 of the high-fidelity checkout rebrand.
 *
 * The legacy scripted builder (`buildCheckout` in scenario.ts, kept frozen)
 * precomputes a whole run; the new buyer flow needs user actions to DRIVE the
 * run instead: submit cart -> submit card -> answer the 3DS challenge ->
 * capture -> refund / chargeback. Each action appends to the same event log
 * and ledger through the shared run-context core, so timeline, inspector,
 * receipts, ledger explorer and the guided journey keep working unchanged.
 *
 * Determinism contract (extends DECISIONS.md D5): same seed + same action
 * sequence = byte-identical event log. The action transcript IS the replay key.
 *
 * Pure TypeScript, zero UI / browser imports. All money fictional.
 */
import { DEMO_CARDS, validateDemoCard } from "./demoCards";
import { transition } from "./machine";
import {
  DAY_MS,
  createRunBase,
  emit,
  fails,
  finishRunResult,
  move,
  num,
  post,
  settleChain,
  step,
  str,
  type Ctx
} from "./scenario";
import type { FailureId, FeeRule, RunResult, SimEvent } from "./types";

export class IllegalCheckoutAction extends Error {}

export type CheckoutAction =
  | { type: "submit_cart"; items?: { name: string; qty: number; priceMinor: number }[]; buyer?: { email: string; name: string } }
  | { type: "submit_card"; pan: string; name: string; exp: string; cvc: string }
  | { type: "submit_otp"; code: string }
  | { type: "resend_otp" }
  | { type: "abandon_tds" }
  | { type: "capture" }
  | { type: "refund"; amountMinor?: number }
  | { type: "open_chargeback" }
  | { type: "respond_chargeback"; verdict: "accept" | "fight"; win?: boolean };

export type CheckoutStage = "cart" | "card" | "tds" | "capture" | "post" | "terminal";

export interface CheckoutFlow {
  ctx: Ctx;
  stage: CheckoutStage;
  /** idempotency key minted with the cart (first rng draw, like the legacy path) */
  idem: string;
  otp: { code: string; attemptsLeft: number } | null;
  score: number | null;
  authCode: string | null;
  capturedMinor: number;
  transcript: CheckoutAction[];
}

const OTP_ATTEMPTS = 3;
const OTP_RE = /^[0-9]{6}$/;
const EXP_RE = /^(0[1-9]|1[0-2])\/\d{2}$/;
const CVC_RE = /^\d{3,4}$/;

export function createCheckoutFlow(ctx: Ctx): CheckoutFlow {
  return { ctx, stage: "cart", idem: "", otp: null, score: null, authCode: null, capturedMinor: 0, transcript: [] };
}

function requireStage(flow: CheckoutFlow, ...stages: CheckoutStage[]): void {
  if (!stages.includes(flow.stage)) {
    throw new IllegalCheckoutAction(`action not allowed while checkout is at stage ${flow.stage}`);
  }
}

function newOtp(ctx: Ctx): { code: string; attemptsLeft: number } {
  return { code: String(ctx.rng.int(0, 999999)).padStart(6, "0"), attemptsLeft: OTP_ATTEMPTS };
}

function scoreFor(ctx: Ctx): number {
  if (fails(ctx, "fraud")) return 95;
  const risk = str(ctx.params, "risk", "low");
  return risk === "high"
    ? 82 + ctx.rng.int(0, 10)
    : risk === "medium"
      ? 40 + ctx.rng.int(0, 15)
      : 5 + ctx.rng.int(0, 12);
}

function needChallenge(ctx: Ctx, score: number): boolean {
  const tds = str(ctx.params, "tds", "challenge");
  return tds === "challenge" || (tds !== "off" && score > 30);
}

function declineReason(ctx: Ctx, score: number): string | null {
  return fails(ctx, "insufficient")
    ? "insufficient-funds"
    : fails(ctx, "expiredCard")
      ? "expired-card"
      : fails(ctx, "wrongCvc")
        ? "wrong-cvc"
        : fails(ctx, "decline")
          ? "issuer-decline"
          : score > 92 && ctx.rng.bool(0.7)
            ? "suspected-fraud"
            : null;
}

/** Shared tail: authorize -> hold -> confirm -> capture (or defer) -> clear -> settle. */
function authorizeAndSettle(flow: CheckoutFlow): void {
  const ctx = flow.ctx;
  ctx.state = transition(ctx.state, "AUTHENTICATE");
  flow.authCode = `auth-${ctx.rng.hex(3)}`;
  emit(ctx, "psp", "AUTH_REQUESTED", { amountMinor: ctx.amountMinor, idempotencyKey: flow.idem, authCode: flow.authCode }, { titleKey: "ev.authReq.title", bodyKey: "ev.authReq.body", concept: "authorization" });
  step(ctx, 220);

  const reason = declineReason(ctx, flow.score ?? 0);
  if (reason) {
    move(ctx, "DECLINE", "issuer", "ISSUER_DECLINED", { reason }, { titleKey: "ev.declined.title", bodyKey: "ev.declined.body", concept: "authorization" });
    flow.stage = "terminal";
    return;
  }
  ctx.ledger.hold("customer", ctx.amountMinor);
  move(ctx, "AUTHORIZE", "issuer", "AUTHORIZED_HOLD", { holdMinor: ctx.amountMinor }, { titleKey: "ev.hold.title", bodyKey: "ev.hold.body", concept: "authorization" });
  emit(ctx, "merchant", "ORDER_CONFIRMED", { authCode: flow.authCode, amountMinor: ctx.amountMinor }, { titleKey: "ev.orderConfirmed.title", bodyKey: "ev.orderConfirmed.body", concept: "authorization" });

  if (str(ctx.params, "capture", "immediate") === "delayed") {
    emit(ctx, "merchant", "CAPTURE_DEFERRED", { reason: "ship-later" }, { titleKey: "ev.defer.title", bodyKey: "ev.defer.body", concept: "capture" });
    ctx.clock.advance(DAY_MS);
    flow.stage = "capture";
    return;
  }
  captureTail(flow, false);
}

function captureTail(flow: CheckoutFlow, delayed: boolean): void {
  const ctx = flow.ctx;
  ctx.ledger.releaseHold("customer", ctx.amountMinor);
  move(ctx, "CAPTURE", "acquirer", "CAPTURED", { capturedMinor: ctx.amountMinor, delayed }, { titleKey: "ev.capture.title", bodyKey: "ev.capture.body", concept: "capture" });
  flow.capturedMinor = ctx.amountMinor;
  move(ctx, "CLEAR", "network", "CLEARED", { batch: "nightly" }, { titleKey: "ev.clear.title", bodyKey: "ev.clear.body", concept: "clearing" });

  const delayDays = fails(ctx, "delayedSettlement") ? 2 : num(ctx.params, "settlementDays", 1);
  const ev = emit(ctx, "system", "SETTLING", { delayDays }, { titleKey: "ev.settleWait.title", bodyKey: "ev.settleWait.body", concept: "settlement" });
  settleChain(ctx, ev.id, ctx.currency);
  ctx.clock.advance(delayDays * DAY_MS);
  move(ctx, "SETTLE", "bank", "SETTLED", { delayDays }, { titleKey: "ev.settled.title", bodyKey: "ev.settled.body", concept: "settlement" }, 50);
  flow.stage = "post";
}

export interface AdvanceResult {
  events: SimEvent[];
  stage: CheckoutStage;
}

/** Apply one user action. Returns only the newly appended events. */
export function checkoutAdvance(flow: CheckoutFlow, action: CheckoutAction): AdvanceResult {
  const ctx = flow.ctx;
  const n0 = ctx.events.length;
  flow.transcript.push(action);

  switch (action.type) {
    case "submit_cart": {
      requireStage(flow, "cart");
      flow.idem = `idem-${ctx.rng.hex(4)}`;
      const items = action.items ?? [];
      emit(ctx, "merchant", "CART_CREATED", { items, itemCount: items.length, buyer: action.buyer ?? null, amountMinor: ctx.amountMinor, currency: ctx.currency }, { titleKey: "ev.cart.title", bodyKey: "ev.cart.body", concept: "acquirer" });
      step(ctx, 120);
      flow.stage = "card";
      break;
    }
    case "submit_card": {
      requireStage(flow, "card");
      // Format-level validation is retryable inline: no token, no state change.
      if (!EXP_RE.test(action.exp)) {
        emit(ctx, "psp", "CARD_REJECTED", { reason: "card.badExpiry" }, { titleKey: "ev.cardRejected.title", bodyKey: "ev.cardRejected.body", concept: "tokenization" });
        break;
      }
      if (!CVC_RE.test(action.cvc)) {
        emit(ctx, "psp", "CARD_REJECTED", { reason: "card.badFormat" }, { titleKey: "ev.cardRejected.title", bodyKey: "ev.cardRejected.body", concept: "tokenization" });
        break;
      }
      const check = validateDemoCard(action.pan);
      if (!check.ok) {
        emit(ctx, "psp", "CARD_REJECTED", { reason: check.reasonKey }, { titleKey: "ev.cardRejected.title", bodyKey: "ev.cardRejected.body", concept: "tokenization" });
        break;
      }
      const digits = action.pan.replace(/\D/g, "");
      emit(ctx, "psp", "CARD_VALIDATED", { bin: digits.slice(0, 6), last4: digits.slice(-4), cardType: str(ctx.params, "cardType", "debit") }, { titleKey: "ev.cardValid.title", bodyKey: "ev.cardValid.body", concept: "tokenization" });
      emit(ctx, "psp", "TOKENIZED", { token: `tok_${ctx.rng.hex(6)}`, cardType: str(ctx.params, "cardType", "debit"), idempotencyKey: flow.idem }, { titleKey: "ev.token.title", bodyKey: "ev.token.body", concept: "tokenization" });
      step(ctx, 100);

      if (fails(ctx, "duplicate")) {
        emit(ctx, "psp", "DUPLICATE_BLOCKED", { idempotencyKey: flow.idem }, { titleKey: "ev.dupe.title", bodyKey: "ev.dupe.body", concept: "idempotency" });
      }
      if (fails(ctx, "timeout")) {
        emit(ctx, "psp", "GATEWAY_TIMEOUT", { idempotencyKey: flow.idem }, { titleKey: "ev.timeout.title", bodyKey: "ev.timeout.body" });
        step(ctx, 900);
        emit(ctx, "psp", "RETRY_SAFE", { idempotencyKey: flow.idem }, { titleKey: "ev.retry.title", bodyKey: "ev.retry.body", concept: "idempotency" });
      }

      const score = scoreFor(ctx);
      flow.score = score;
      emit(ctx, "fraudEngine", "RISK_SCORED", { score, level: score > 70 ? "high" : score > 30 ? "medium" : "low" }, { titleKey: "ev.risk.title", bodyKey: "ev.risk.body", concept: "risk" });
      step(ctx, 140);

      if (!needChallenge(ctx, score)) {
        emit(ctx, "tds", "TDS_FRICTIONLESS", { liabilityShift: false }, { titleKey: "ev.tdsFree.title", bodyKey: "ev.tdsFree.body", concept: "tds" });
        authorizeAndSettle(flow);
      } else {
        emit(ctx, "tds", "TDS_CHALLENGE_SHOWN", { method: "otp" }, { titleKey: "ev.tds.title", bodyKey: "ev.tds.body", concept: "tds" });
        step(ctx, 600);
        flow.otp = newOtp(ctx);
        emit(ctx, "tds", "OTP_SENT", { channel: "sms", attemptsLeft: flow.otp.attemptsLeft, code: flow.otp.code }, { titleKey: "ev.otpSent.title", bodyKey: "ev.otpSent.body", concept: "tds" });
        flow.stage = "tds";
      }
      break;
    }
    case "submit_otp": {
      requireStage(flow, "tds");
      if (!flow.otp) throw new IllegalCheckoutAction("no OTP challenge is open");
      if (!OTP_RE.test(action.code)) {
        emit(ctx, "tds", "OTP_WRONG", { attemptsLeft: flow.otp.attemptsLeft, reason: "bad-format" }, { titleKey: "ev.otpWrong.title", bodyKey: "ev.otpWrong.body", concept: "tds" });
        break;
      }
      if (action.code === flow.otp.code) {
        flow.otp = null;
        emit(ctx, "tds", "TDS_PASSED", { liabilityShift: true }, { titleKey: "ev.tdsPass.title", bodyKey: "ev.tdsPass.body", concept: "tds" });
        step(ctx, 150);
        authorizeAndSettle(flow);
      } else {
        flow.otp.attemptsLeft -= 1;
        if (flow.otp.attemptsLeft <= 0) {
          flow.otp = null;
          move(ctx, "DECLINE", "issuer", "TDS_FAILED", { reason: "wrong-otp" }, { titleKey: "ev.tdsFail.title", bodyKey: "ev.tdsFail.body", concept: "tds" });
          flow.stage = "terminal";
        } else {
          emit(ctx, "tds", "OTP_WRONG", { attemptsLeft: flow.otp.attemptsLeft }, { titleKey: "ev.otpWrong.title", bodyKey: "ev.otpWrong.body", concept: "tds" });
        }
      }
      break;
    }
    case "resend_otp": {
      requireStage(flow, "tds");
      flow.otp = newOtp(ctx);
      emit(ctx, "tds", "OTP_SENT", { channel: "sms", resent: true, attemptsLeft: flow.otp.attemptsLeft, code: flow.otp.code }, { titleKey: "ev.otpSent.title", bodyKey: "ev.otpSent.body", concept: "tds" });
      break;
    }
    case "abandon_tds": {
      requireStage(flow, "tds");
      flow.otp = null;
      move(ctx, "DECLINE", "issuer", "TDS_FAILED", { reason: "abandoned" }, { titleKey: "ev.tdsFail.title", bodyKey: "ev.tdsFail.body", concept: "tds" });
      flow.stage = "terminal";
      break;
    }
    case "capture": {
      requireStage(flow, "capture");
      captureTail(flow, true);
      break;
    }
    case "refund": {
      requireStage(flow, "post");
      if (ctx.state !== "SETTLED") throw new IllegalCheckoutAction("refunds need a settled payment");
      const remaining = flow.capturedMinor - ctx.refundedMinor;
      const amount = Math.min(action.amountMinor ?? remaining, remaining);
      if (!(amount > 0)) throw new IllegalCheckoutAction("nothing left to refund");
      post(ctx, ctx.events[ctx.events.length - 1].id, "REFUND", "merchant", "customer", amount, ctx.currency, "ledger.refund");
      ctx.refundedMinor += amount;
      if (ctx.refundedMinor >= flow.capturedMinor) {
        move(ctx, "REFUND", "acquirer", "REFUND_ISSUED", { refundedMinor: ctx.refundedMinor }, { titleKey: "ev.refund.title", bodyKey: "ev.refund.body", concept: "settlement" });
        flow.stage = "terminal";
      } else {
        emit(ctx, "merchant", "REFUND_PARTIAL", { amountMinor: amount, refundedMinor: ctx.refundedMinor }, { titleKey: "ev.refundPartial.title", bodyKey: "ev.refundPartial.body", concept: "settlement" });
      }
      break;
    }
    case "open_chargeback": {
      requireStage(flow, "post");
      if (ctx.state !== "SETTLED") throw new IllegalCheckoutAction("chargebacks follow settlement");
      step(ctx, 3 * DAY_MS);
      post(ctx, ctx.events[ctx.events.length - 1].id, "CHARGEBACK", "merchant", "customer", ctx.amountMinor, ctx.currency, "ledger.chargeback");
      ctx.state = transition(ctx.state, "CHARGEBACK");
      emit(ctx, "issuer", "CHARGEBACK_OPENED", { reason: "not-recognized", amountMinor: ctx.amountMinor }, { titleKey: "ev.cb.title", bodyKey: "ev.cb.body", concept: "chargeback" });
      break;
    }
    case "respond_chargeback": {
      requireStage(flow, "post");
      if (ctx.state !== "CHARGEBACK") throw new IllegalCheckoutAction("no open chargeback to answer");
      if (action.verdict === "accept") {
        emit(ctx, "merchant", "CHARGEBACK_ACCEPTED", {}, { titleKey: "ev.cbAccept.title", bodyKey: "ev.cbAccept.body", concept: "chargeback" });
        flow.stage = "terminal";
      } else {
        emit(ctx, "merchant", "REPRESENTMENT_SUBMITTED", { evidence: "receipt+tracking" }, { titleKey: "ev.represent.title", bodyKey: "ev.represent.body", concept: "chargeback" });
        const win = action.win ?? ctx.rng.bool(0.5);
        if (win) {
          post(ctx, ctx.events[ctx.events.length - 1].id, "CHARGEBACK", "customer", "merchant", ctx.amountMinor, ctx.currency, "ledger.representmentWon");
          emit(ctx, "issuer", "REPRESENTMENT_WON", { amountMinor: ctx.amountMinor }, { titleKey: "ev.representWon.title", bodyKey: "ev.representWon.body", concept: "chargeback" });
        } else {
          emit(ctx, "issuer", "REPRESENTMENT_LOST", { reason: "insufficient-evidence" }, { titleKey: "ev.representLost.title", bodyKey: "ev.representLost.body", concept: "chargeback" });
        }
        flow.stage = "terminal";
      }
      break;
    }
  }

  return { events: ctx.events.slice(n0), stage: flow.stage };
}

/** Demo card matching the `cardType` param (used by scripted/canonical runs). */
export function defaultCardFor(cardType: string): { pan: string; name: string; exp: string; cvc: string } {
  const card = cardType === "credit" ? DEMO_CARDS[1] : cardType === "prepaid" ? DEMO_CARDS[2] : DEMO_CARDS[0];
  return { pan: card.pan, name: "AMINA BENALI", exp: card.exp, cvc: card.cvc };
}

/** Apply a full action list to a fresh deterministic session. */
export function runCheckoutScript(
  seed: number,
  params: Record<string, unknown>,
  failures: FailureId[],
  actions: CheckoutAction[],
  feeRules?: FeeRule[]
): RunResult {
  const ctx = createRunBase("checkout", { seed, params, failures, feeRules });
  const flow = createCheckoutFlow(ctx);
  for (const a of actions) checkoutAdvance(flow, a);
  return checkoutResult(flow);
}

export function driveCheckout(ctx: Ctx, actions: CheckoutAction[]): CheckoutFlow {
  const flow = createCheckoutFlow(ctx);
  for (const a of actions) checkoutAdvance(flow, a);
  return flow;
}

/**
 * Canonical driver: reproduces the legacy scripted path (params + failures)
 * through the staged core. Used by tests; `runScenario("checkout")` keeps the
 * frozen legacy builder until the C4 cutover.
 */
export function driveCheckoutCanonical(ctx: Ctx): CheckoutFlow {
  const flow = createCheckoutFlow(ctx);
  checkoutAdvance(flow, { type: "submit_cart" });
  const card = defaultCardFor(str(ctx.params, "cardType", "debit"));
  checkoutAdvance(flow, { type: "submit_card", ...card });
  if (flow.stage === "tds") {
    if (fails(ctx, "tdsAbandon")) {
      checkoutAdvance(flow, { type: "abandon_tds" });
    } else if (fails(ctx, "tdsFail")) {
      const wrong = flow.otp && flow.otp.code === "000000" ? "000001" : "000000";
      for (let i = 0; i < OTP_ATTEMPTS; i++) checkoutAdvance(flow, { type: "submit_otp", code: wrong });
    } else if (flow.otp) {
      checkoutAdvance(flow, { type: "submit_otp", code: flow.otp.code });
    }
  }
  if (flow.stage === "capture") checkoutAdvance(flow, { type: "capture" });
  if (fails(ctx, "chargeback") && ctx.state === "SETTLED") checkoutAdvance(flow, { type: "open_chargeback" });
  return flow;
}

export function checkoutResult(flow: CheckoutFlow): RunResult {
  return finishRunResult(flow.ctx);
}

/** Posted balances per account (also handy for the C2 merchant dashboard). */
export function flowBalances(flow: CheckoutFlow): Record<string, number> {
  return flow.ctx.ledger.snapshot();
}

/** Outstanding authorization hold on the buyer (must be 0 when money moved). */
export function flowCustomerHold(flow: CheckoutFlow): number {
  return flow.ctx.ledger.holdOf("customer");
}
