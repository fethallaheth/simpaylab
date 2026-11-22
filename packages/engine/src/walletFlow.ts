/**
 * Staged mobile-wallet runner (Apple Pay / Google Wallet / BaridiMob-inspired,
 * generic labels only). Two enrollment models: card-linked (DPAN token +
 * biometric/PIN unlock) and account-linked (RIB + SMS OTP debit).
 * Legacy `buildWallet` stays frozen; this is the interactive path.
 */
import { validateDemoCard } from "./demoCards";
import { transition } from "./machine";
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
  str,
  type Ctx
} from "./scenario";
import type { FailureId, FeeRule, RunResult } from "./types";

export class IllegalWalletAction extends Error {}

export type WalletAction =
  | { type: "add_card"; pan: string; name: string; exp: string; cvc: string }
  | { type: "present_token"; last4: string; dpan: string }
  | { type: "link_account"; rib: string; phone: string }
  | { type: "start_pay"; merchant: string }
  | { type: "unlock_bio"; pass: boolean }
  | { type: "unlock_pin"; pin: string }
  | { type: "submit_otp"; code: string }
  | { type: "resend_otp" }
  | { type: "report_lost" };

export type WalletStage = "empty" | "ready" | "bio" | "pin" | "otp" | "done" | "terminal";

export interface WalletCard {
  last4: string;
  dpan: string;
}

export interface WalletFlow {
  ctx: Ctx;
  stage: WalletStage;
  kind: "card" | "account";
  cards: WalletCard[];
  merchant: string;
  idem: string;
  otp: { code: string; attemptsLeft: number } | null;
  bioStrikes: number;
  pinStrikes: number;
  transcript: WalletAction[];
}

const EXP_RE = /^(0[1-9]|1[0-2])\/\d{2}$/;
const CVC_RE = /^\d{3,4}$/;
const RIB_RE = /^\d{20}$/;
const PHONE_RE = /^\d{9,12}$/;
const DEVICE_PIN = "1234";

export function createWalletFlow(ctx: Ctx): WalletFlow {
  return {
    ctx, stage: "empty", kind: str(ctx.params, "walletKind", "card") === "account" ? "account" : "card",
    cards: [], merchant: "", idem: "", otp: null, bioStrikes: 0, pinStrikes: 0, transcript: []
  };
}

function need(flow: WalletFlow, ...stages: WalletStage[]): void {
  if (!stages.includes(flow.stage)) throw new IllegalWalletAction(`not allowed at stage ${flow.stage}`);
}

/** Timeout-then-safe-retry around authorization; duplicates collapse to one. */
function gatewayAnomalies(flow: WalletFlow): void {
  const ctx = flow.ctx;
  if (fails(ctx, "duplicate")) {
    emit(ctx, "psp", "DUPLICATE_BLOCKED", { idempotencyKey: flow.idem }, { titleKey: "ev.dupe.title", bodyKey: "ev.dupe.body", concept: "idempotency" });
  }
  if (fails(ctx, "timeout")) {
    emit(ctx, "psp", "GATEWAY_TIMEOUT", { idempotencyKey: flow.idem }, { titleKey: "ev.timeout.title", bodyKey: "ev.timeout.body" });
    step(ctx, 900);
    emit(ctx, "psp", "RETRY_SAFE", { idempotencyKey: flow.idem }, { titleKey: "ev.retry.title", bodyKey: "ev.retry.body", concept: "idempotency" });
  }
}

function tailSettle(flow: WalletFlow): void {
  const ctx = flow.ctx;
  ctx.ledger.releaseHold("customer", ctx.amountMinor);
  move(ctx, "CAPTURE", "acquirer", "CAPTURED", { capturedMinor: ctx.amountMinor, tokenized: flow.kind === "card" }, { titleKey: "ev.capture.title", bodyKey: "ev.capture.body", concept: "capture" });
  move(ctx, "CLEAR", "network", "CLEARED", {}, { titleKey: "ev.clear.title", bodyKey: "ev.clear.body", concept: "clearing" });
  const delayDays = fails(ctx, "delayedSettlement") ? 2 : num(ctx.params, "settlementDays", 1);
  const ev = emit(ctx, "system", "SETTLING", { delayDays }, { titleKey: "ev.settleWait.title", bodyKey: "ev.settleWait.body", concept: "settlement" });
  settleChain(ctx, ev.id, ctx.currency);
  ctx.clock.advance(delayDays * DAY_MS);
  move(ctx, "SETTLE", "bank", "SETTLED", { delayDays }, { titleKey: "ev.settled.title", bodyKey: "ev.settled.body", concept: "settlement" }, 50);
  flow.stage = "done";
}

function authorizeCard(flow: WalletFlow): void {
  const ctx = flow.ctx;
  ctx.state = transition(ctx.state, "AUTHENTICATE");
  gatewayAnomalies(flow);
  emit(ctx, "tokenService", "CRYPTOGRAM_BUILT", { cryptogram: ctx.rng.hex(8), idempotencyKey: flow.idem }, { titleKey: "ev.crypt.title", bodyKey: "ev.crypt.body", concept: "cryptogram" });
  step(ctx, 180);
  if (fails(ctx, "decline") || fails(ctx, "insufficient")) {
    move(ctx, "DECLINE", "issuer", "ISSUER_DECLINED", { reason: fails(ctx, "insufficient") ? "insufficient-funds" : "issuer-decline" }, { titleKey: "ev.declined.title", bodyKey: "ev.declined.body", concept: "authorization" });
    flow.stage = "terminal";
    return;
  }
  ctx.ledger.hold("customer", ctx.amountMinor);
  move(ctx, "AUTHORIZE", "issuer", "AUTHORIZED_HOLD", { holdMinor: ctx.amountMinor, tokenized: true }, { titleKey: "ev.hold.title", bodyKey: "ev.hold.body", concept: "authorization" });
  tailSettle(flow);
}

function authorizeAccount(flow: WalletFlow): void {
  const ctx = flow.ctx;
  ctx.state = transition(ctx.state, "AUTHENTICATE");
  gatewayAnomalies(flow);
  emit(ctx, "operator", "MANDATE_CHARGED", { amountMinor: ctx.amountMinor, merchant: flow.merchant }, { titleKey: "ev.mandate.title", bodyKey: "ev.mandate.body", concept: "authorization" });
  step(ctx, 200);
  if (fails(ctx, "decline") || fails(ctx, "insufficient")) {
    move(ctx, "DECLINE", "operator", "ISSUER_DECLINED", { reason: fails(ctx, "insufficient") ? "insufficient-funds" : "issuer-decline" }, { titleKey: "ev.declined.title", bodyKey: "ev.declined.body", concept: "authorization" });
    flow.stage = "terminal";
    return;
  }
  ctx.ledger.hold("customer", ctx.amountMinor);
  move(ctx, "AUTHORIZE", "operator", "AUTHORIZED_HOLD", { holdMinor: ctx.amountMinor, directDebit: true }, { titleKey: "ev.hold.title", bodyKey: "ev.hold.body", concept: "authorization" });
  tailSettle(flow);
}

export function walletAdvance(flow: WalletFlow, action: WalletAction): { stage: WalletStage } {
  const ctx = flow.ctx;
  flow.transcript.push(action);
  switch (action.type) {
    case "add_card": {
      need(flow, "empty", "ready");
      if (flow.kind !== "card") throw new IllegalWalletAction("card enrollment is for card wallets");
      if (!EXP_RE.test(action.exp) || !CVC_RE.test(action.cvc) || action.name.trim().length < 2) {
        emit(ctx, "wallet", "CARD_REJECTED", { reason: "card.badFormat" }, { titleKey: "ev.cardRejected.title", bodyKey: "ev.cardRejected.body", concept: "tokenization" });
        break;
      }
      const check = validateDemoCard(action.pan);
      if (!check.ok) {
        emit(ctx, "wallet", "CARD_REJECTED", { reason: check.reasonKey }, { titleKey: "ev.cardRejected.title", bodyKey: "ev.cardRejected.body", concept: "tokenization" });
        break;
      }
      const digits = action.pan.replace(/\D/g, "");
      const dpan = `dpan_...${ctx.rng.hex(2)}`;
      emit(ctx, "customer", "WALLET_OPENED", {}, { titleKey: "ev.wopen.title", bodyKey: "ev.wopen.body", concept: "wallet" });
      step(ctx, 150);
      emit(ctx, "wallet", "CARD_PROVISIONED", { dpan, last4: digits.slice(-4) }, { titleKey: "ev.prov.title", bodyKey: "ev.prov.body", concept: "tokenization" });
      step(ctx, 300);
      if (fails(ctx, "tokenSuspended")) {
        ctx.state = transition(ctx.state, "AUTHENTICATE");
        move(ctx, "DECLINE", "tokenService", "TOKEN_SUSPENDED", {}, { titleKey: "ev.tokSusp.title", bodyKey: "ev.tokSusp.body", concept: "tokenization" });
        flow.stage = "terminal";
        break;
      }
      emit(ctx, "issuer", "PROVISION_VERIFIED", { method: "otp" }, { titleKey: "ev.provOk.title", bodyKey: "ev.provOk.body", concept: "authentication" });
      step(ctx, 200);
      flow.cards.push({ last4: digits.slice(-4), dpan });
      flow.stage = "ready";
      break;
    }
    case "present_token": {
      need(flow, "empty", "ready");
      if (flow.kind !== "card") throw new IllegalWalletAction("tokens belong to card wallets");
      if (!/^\d{4}$/.test(action.last4) || action.dpan.length < 6) {
        throw new IllegalWalletAction("token reference is required");
      }
      emit(ctx, "customer", "WALLET_OPENED", {}, { titleKey: "ev.wopen.title", bodyKey: "ev.wopen.body", concept: "wallet" });
      step(ctx, 150);
      emit(ctx, "wallet", "TOKEN_PRESENTED", { dpan: action.dpan, last4: action.last4 }, { titleKey: "ev.tokenUse.title", bodyKey: "ev.tokenUse.body", concept: "tokenization" });
      step(ctx, 200);
      if (fails(ctx, "tokenSuspended")) {
        ctx.state = transition(ctx.state, "AUTHENTICATE");
        move(ctx, "DECLINE", "tokenService", "TOKEN_SUSPENDED", {}, { titleKey: "ev.tokSusp.title", bodyKey: "ev.tokSusp.body", concept: "tokenization" });
        flow.stage = "terminal";
        break;
      }
      emit(ctx, "issuer", "PROVISION_VERIFIED", { method: "cached-token" }, { titleKey: "ev.provOk.title", bodyKey: "ev.provOk.body", concept: "authentication" });
      step(ctx, 150);
      flow.stage = "ready";
      break;
    }
    case "link_account": {
      need(flow, "empty", "ready");
      if (flow.kind !== "account") throw new IllegalWalletAction("account linking is for account wallets");
      if (!RIB_RE.test(action.rib.replace(/\D/g, "")) || !PHONE_RE.test(action.phone.replace(/\D/g, ""))) {
        emit(ctx, "wallet", "ACCOUNT_REJECTED", { reason: "account.badFormat" }, { titleKey: "ev.acctRej.title", bodyKey: "ev.acctRej.body", concept: "wallet" });
        break;
      }
      const rib = action.rib.replace(/\D/g, "");
      emit(ctx, "customer", "WALLET_OPENED", {}, { titleKey: "ev.wopen.title", bodyKey: "ev.wopen.body", concept: "wallet" });
      step(ctx, 150);
      emit(ctx, "operator", "ACCOUNT_LINKED", { ribLast4: rib.slice(-4) }, { titleKey: "ev.acctOk.title", bodyKey: "ev.acctOk.body", concept: "wallet" });
      step(ctx, 200);
      flow.stage = "ready";
      break;
    }
    case "start_pay": {
      need(flow, "ready");
      if (action.merchant.trim().length < 2) throw new IllegalWalletAction("merchant is required");
      flow.merchant = action.merchant.trim();
      flow.idem = `idem-${ctx.rng.hex(4)}`;
      if (fails(ctx, "lostDevice") && flow.kind === "card") {
        emit(ctx, "wallet", "DEVICE_LOST", {}, { titleKey: "ev.lost.title", bodyKey: "ev.lost.body" });
        step(ctx, 300);
        emit(ctx, "tokenService", "TOKEN_REVOKED", { dpan: "revoked" }, { titleKey: "ev.revoke.title", bodyKey: "ev.revoke.body", concept: "tokenization" });
        step(ctx, 200);
        emit(ctx, "wallet", "REPROVISIONED", {}, { titleKey: "ev.reprov.title", bodyKey: "ev.reprov.body" });
        step(ctx, 200);
      }
      if (fails(ctx, "offline")) {
        ctx.state = transition(ctx.state, "AUTHENTICATE");
        move(ctx, "DECLINE", "device", "OFFLINE_DECLINED", {}, { titleKey: "ev.offline.title", bodyKey: "ev.offline.body" });
        flow.stage = "terminal";
        break;
      }
      if (flow.kind === "card") {
        emit(ctx, "device", "BIOMETRIC_PROMPT", { modality: "fingerprint", merchant: action.merchant, amountMinor: ctx.amountMinor }, { titleKey: "ev.bio.title", bodyKey: "ev.bio.body", concept: "biometric" });
        step(ctx, 400);
        flow.bioStrikes = 0;
        flow.stage = "bio";
      } else {
        flow.otp = { code: String(ctx.rng.int(0, 999999)).padStart(6, "0"), attemptsLeft: 3 };
        emit(ctx, "operator", "OTP_SENT", { channel: "sms", attemptsLeft: 3, code: flow.otp.code }, { titleKey: "ev.otpSent.title", bodyKey: "ev.otpSent.body", concept: "authentication" });
        flow.stage = "otp";
      }
      break;
    }
    case "unlock_bio": {
      need(flow, "bio");
      const forced = fails(ctx, "biometricFail");
      if (action.pass && !forced) {
        emit(ctx, "device", "BIOMETRIC_OK", { localOnly: true }, { titleKey: "ev.bioOk.title", bodyKey: "ev.bioOk.body", concept: "biometric" });
        step(ctx, 150);
        authorizeCard(flow);
      } else {
        flow.bioStrikes += 1;
        emit(ctx, "device", "BIOMETRIC_FAILED", { attempts: flow.bioStrikes }, { titleKey: "ev.bioFail.title", bodyKey: "ev.bioFail.body", concept: "biometric" });
        step(ctx, 200);
        if (flow.bioStrikes >= 3) {
          emit(ctx, "device", "PIN_FALLBACK_SHOWN", {}, { titleKey: "ev.pinFbShow.title", bodyKey: "ev.pinFbShow.body", concept: "authentication" });
          flow.pinStrikes = 0;
          flow.stage = "pin";
        }
      }
      break;
    }
    case "unlock_pin": {
      need(flow, "pin");
      if (action.pin === DEVICE_PIN) {
        emit(ctx, "device", "PIN_FALLBACK_OK", {}, { titleKey: "ev.pinFb.title", bodyKey: "ev.pinFb.body", concept: "authentication" });
        step(ctx, 150);
        authorizeCard(flow);
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
    case "submit_otp": {
      need(flow, "otp");
      if (!flow.otp) throw new IllegalWalletAction("no OTP open");
      if (action.code === flow.otp.code) {
        flow.otp = null;
        emit(ctx, "operator", "OTP_VERIFIED", {}, { titleKey: "ev.otpOk.title", bodyKey: "ev.otpOk.body", concept: "authentication" });
        step(ctx, 150);
        authorizeAccount(flow);
      } else {
        flow.otp.attemptsLeft -= 1;
        if (flow.otp.attemptsLeft <= 0) {
          flow.otp = null;
          move(ctx, "DECLINE", "operator", "WALLET_DECLINED", { reason: "wrong-otp" }, { titleKey: "ev.declined.title", bodyKey: "ev.declined.body", concept: "authorization" });
          flow.stage = "terminal";
        } else {
          emit(ctx, "operator", "OTP_WRONG", { attemptsLeft: flow.otp.attemptsLeft }, { titleKey: "ev.otpWrong.title", bodyKey: "ev.otpWrong.body", concept: "tds" });
        }
      }
      break;
    }
    case "resend_otp": {
      need(flow, "otp");
      flow.otp = { code: String(ctx.rng.int(0, 999999)).padStart(6, "0"), attemptsLeft: 3 };
      emit(ctx, "operator", "OTP_SENT", { channel: "sms", resent: true, attemptsLeft: 3, code: flow.otp.code }, { titleKey: "ev.otpSent.title", bodyKey: "ev.otpSent.body", concept: "authentication" });
      break;
    }
    case "report_lost": {
      need(flow, "ready");
      emit(ctx, "wallet", "DEVICE_LOST", {}, { titleKey: "ev.lost.title", bodyKey: "ev.lost.body" });
      step(ctx, 300);
      emit(ctx, "tokenService", "TOKEN_REVOKED", { dpan: "revoked" }, { titleKey: "ev.revoke.title", bodyKey: "ev.revoke.body", concept: "tokenization" });
      step(ctx, 200);
      emit(ctx, "wallet", "REPROVISIONED", {}, { titleKey: "ev.reprov.title", bodyKey: "ev.reprov.body" });
      step(ctx, 200);
      break;
    }
  }
  return { stage: flow.stage };
}

export function runWalletScript(seed: number, params: Record<string, unknown>, failures: FailureId[], actions: WalletAction[], feeRules?: FeeRule[]): RunResult {
  const ctx = createRunBase("wallet", { seed, params, failures, feeRules });
  const flow = createWalletFlow(ctx);
  for (const a of actions) walletAdvance(flow, a);
  return walletResult(flow);
}

export function walletResult(flow: WalletFlow): RunResult {
  return finishRunResult(flow.ctx);
}

export function walletBalances(flow: WalletFlow): Record<string, number> {
  return flow.ctx.ledger.snapshot();
}
