/**
 * Deterministic scenario runner.
 * Same module + same seed + same params + same failures = byte-identical
 * event log. No wall-clock, no Math.random — one mulberry32 per run.
 */
import { SimClock } from "./clock";
import { computeWaterfall } from "./fees";
import { quoteFx } from "./fx";
import { Account, Ledger } from "./ledger";
import { INITIAL_STATE, transition } from "./machine";
export { INITIAL_STATE, transition };
import { createRng, type Rng } from "./prng";
import type {
  ActorId,
  Currency,
  Explain,
  FailureId,
  FeeLine,
  FeeRule,
  FxQuote,
  LedgerKind,
  ModuleId,
  Receipt,
  RunOptions,
  RunResult,
  SimEvent,
  TxSignal,
  TxState
} from "./types";

export interface FeeDefaults {
  rules: FeeRule[];
}

export const DAY_MS = 86_400_000;

export function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
export function str(params: Record<string, unknown>, key: string, fallback: string): string {
  const v = params[key];
  return typeof v === "string" ? v : fallback;
}

export function defaultFeeRules(moduleId: ModuleId): FeeRule[] {
  switch (moduleId) {
    case "checkout":
      return [
        { id: "interchange", labelKey: "fee.interchange", fixedMinor: 0, pctBps: 140, payer: "acquirer", payee: "issuer" },
        { id: "scheme", labelKey: "fee.scheme", fixedMinor: 0, pctBps: 12, payer: "acquirer", payee: "network" },
        { id: "psp", labelKey: "fee.psp", fixedMinor: 25, pctBps: 25, payer: "acquirer", payee: "psp" }
      ];
    case "wallet":
      return [
        { id: "token", labelKey: "fee.token", fixedMinor: 5, pctBps: 0, payer: "acquirer", payee: "network" },
        { id: "issuer-w", labelKey: "fee.interchange", fixedMinor: 0, pctBps: 120, payer: "acquirer", payee: "issuer" }
      ];
    case "qr":
      return [{ id: "provider", labelKey: "fee.provider", fixedMinor: 0, pctBps: 50, payer: "acquirer", payee: "psp" }];
    case "crypto":
      return [{ id: "netfee", labelKey: "fee.network", fixedMinor: 150, pctBps: 0, payer: "customerWallet", payee: "miner" }];
    case "custody":
      return [{ id: "netfee", labelKey: "fee.network", fixedMinor: 120, pctBps: 0, payer: "customerWallet", payee: "miner" }];
    case "nfc":
      return [{ id: "interchange", labelKey: "fee.interchange", fixedMinor: 0, pctBps: 130, payer: "acquirer", payee: "issuer" }];
    case "p2p":
      return [{ id: "instant", labelKey: "fee.instant", fixedMinor: 30, pctBps: 100, payer: "customer", payee: "psp" }];
    case "mobilemoney":
      return [{ id: "mm", labelKey: "fee.provider", fixedMinor: 20, pctBps: 80, payer: "customer", payee: "operator" }];
    case "remit":
      return [{ id: "mto", labelKey: "fee.provider", fixedMinor: 199, pctBps: 90, payer: "customer", payee: "psp" }];
    case "bnpl":
      return [{ id: "mdr", labelKey: "fee.mdr", fixedMinor: 0, pctBps: 350, payer: "merchant", payee: "bnpl" }];
    default:
      return [{ id: "demo", labelKey: "fee.provider", fixedMinor: 10, pctBps: 100, payer: "acquirer", payee: "psp" }];
  }
}

function baseAccounts(moduleId: ModuleId, currency: string): Account[] {
  const A = (id: string, kind: Account["kind"], extra?: Partial<Account>): Account => ({
    id,
    labelKey: `acct.${id}`,
    currency,
    kind,
    ...extra
  });
  const common = [
    A("customer", "customer"),
    A("merchant", "merchant", { allowNegative: true }),
    A("issuer", "issuer"),
    A("acquirer", "acquirer", { allowNegative: true }),
    A("psp", "psp"),
    A("network", "scheme"),
    A("escrow", "escrow"),
    A("sink", "sink")
  ];
  void moduleId;
  return [
    ...common,
    A("provider", "other"),
    A("operator", "other"),
    A("agent", "agent"),
    A("trust", "trust"),
    A("customerWallet", "customer"),
    A("merchantWallet", "merchant"),
    A("miner", "network"),
    A("attacker", "other"),
    A("bnpl", "other"),
    A("recipient", "customer")
  ];
}

export interface Ctx {
  rng: Rng;
  clock: SimClock;
  events: SimEvent[];
  ledger: Ledger;
  txId: string;
  moduleId: ModuleId;
  params: Record<string, unknown>;
  failures: FailureId[];
  feeRules: FeeRule[];
  state: TxState;
  currency: Currency;
  amountMinor: number;
  feeLines: FeeLine[];
  totalFees: number;
  netAmount: number;
  fxQuote?: FxQuote;
  n: number;
  /** run seed (drives the single PRNG stream) */
  seed: number;
  /** principal refunded to the customer so far (staged checkout flow) */
  refundedMinor: number;
}

export function fails(ctx: Ctx, id: FailureId): boolean {
  return ctx.failures.includes(id);
}

export function emit(
  ctx: Ctx,
  actor: ActorId,
  type: string,
  payload: Record<string, unknown>,
  explain: Explain
): SimEvent {
  ctx.n += 1;
  const ev: SimEvent = {
    id: `evt-${String(ctx.n).padStart(4, "0")}`,
    txId: ctx.txId,
    t: ctx.clock.now(),
    actor,
    type,
    payload,
    explain
  };
  ctx.events.push(ev);
  return ev;
}

export function step(ctx: Ctx, baseMs: number, jitter = 80): void {
  ctx.clock.advance(baseMs + ctx.rng.int(0, jitter));
}

export function move(
  ctx: Ctx,
  signal: TxSignal,
  actor: ActorId,
  type: string,
  payload: Record<string, unknown>,
  explain: Explain,
  latencyMs = 150
): void {
  ctx.state = transition(ctx.state, signal);
  step(ctx, latencyMs);
  emit(ctx, actor, type, { ...payload, state: ctx.state }, explain);
}

export function post(
  ctx: Ctx,
  eventId: string,
  kind: LedgerKind,
  debit: string,
  credit: string,
  amountMinor: number,
  currency: string,
  memoKey: string
): void {
  ctx.ledger.post({ eventId, txId: ctx.txId, t: ctx.clock.now(), kind, debit, credit, amountMinor, currency, memoKey });
}

/** Post the standard capture → clearing → settlement chain + fee lines. */
export function settleChain(ctx: Ctx, evId: string, ccy: string): void {
  post(ctx, evId, "CAPTURE", "customer", "acquirer", ctx.amountMinor, ccy, "ledger.capture");
  post(ctx, evId, "CLEARING", "acquirer", "escrow", ctx.netAmount, ccy, "ledger.clearing");
  for (const l of ctx.feeLines) {
    const payee = ctx.ledger.accounts.some((a) => a.id === l.payee) ? l.payee : "sink";
    post(ctx, evId, "FEE", "acquirer", payee, l.amountMinor, ccy, l.labelKey);
  }
  post(ctx, evId, "SETTLEMENT", "escrow", "merchant", ctx.netAmount, ccy, "ledger.settlement");
}

// ---------------------------------------------------------------- builders

function buildDemo(ctx: Ctx): void {
  emit(ctx, "customer", "DEMO_STARTED", { amountMinor: ctx.amountMinor }, { titleKey: "ev.demo.title", bodyKey: "ev.demo.body", concept: "settlement" });
  move(ctx, "AUTHENTICATE", "psp", "AUTHENTICATED", { method: "demo" }, { titleKey: "ev.auth.title", bodyKey: "ev.auth.body", concept: "authentication" });
  ctx.ledger.hold("customer", ctx.amountMinor);
  move(ctx, "AUTHORIZE", "issuer", "AUTHORIZED_HOLD", { holdMinor: ctx.amountMinor }, { titleKey: "ev.hold.title", bodyKey: "ev.hold.body", concept: "authorization" });
  ctx.ledger.releaseHold("customer", ctx.amountMinor);
  move(ctx, "CAPTURE", "acquirer", "CAPTURED", { capturedMinor: ctx.amountMinor }, { titleKey: "ev.capture.title", bodyKey: "ev.capture.body", concept: "capture" });
  move(ctx, "CLEAR", "network", "CLEARED", {}, { titleKey: "ev.clear.title", bodyKey: "ev.clear.body", concept: "clearing" });
  const ev = emit(ctx, "system", "SETTLING", { delayDays: 1 }, { titleKey: "ev.settleWait.title", bodyKey: "ev.settleWait.body", concept: "settlement" });
  settleChain(ctx, ev.id, ctx.currency);
  ctx.clock.advance(DAY_MS);
  move(ctx, "SETTLE", "bank", "SETTLED", { delayDays: 1 }, { titleKey: "ev.settled.title", bodyKey: "ev.settled.body", concept: "settlement" }, 50);
}

function buildCheckout(ctx: Ctx): void {
  const p = ctx.params;
  const cardType = str(p, "cardType", "debit");
  const tds = str(p, "tds", "challenge");
  const risk = str(p, "risk", "low");
  const idem = `idem-${ctx.rng.hex(4)}`;

  emit(ctx, "merchant", "CART_CREATED", { items: 2, amountMinor: ctx.amountMinor, currency: ctx.currency }, { titleKey: "ev.cart.title", bodyKey: "ev.cart.body", concept: "acquirer" });
  step(ctx, 120);
  emit(ctx, "psp", "TOKENIZED", { token: `tok_${ctx.rng.hex(6)}`, cardType }, { titleKey: "ev.token.title", bodyKey: "ev.token.body", concept: "tokenization" });
  step(ctx, 100);

  if (fails(ctx, "duplicate")) {
    emit(ctx, "psp", "DUPLICATE_BLOCKED", { idempotencyKey: idem }, { titleKey: "ev.dupe.title", bodyKey: "ev.dupe.body", concept: "idempotency" });
  }
  if (fails(ctx, "timeout")) {
    emit(ctx, "psp", "GATEWAY_TIMEOUT", { idempotencyKey: idem }, { titleKey: "ev.timeout.title", bodyKey: "ev.timeout.body" });
    step(ctx, 900);
    emit(ctx, "psp", "RETRY_SAFE", { idempotencyKey: idem }, { titleKey: "ev.retry.title", bodyKey: "ev.retry.body", concept: "idempotency" });
  }

  let score = risk === "high" ? 82 + ctx.rng.int(0, 10) : risk === "medium" ? 40 + ctx.rng.int(0, 15) : 5 + ctx.rng.int(0, 12);
  if (fails(ctx, "fraud")) score = 95;
  emit(ctx, "fraudEngine", "RISK_SCORED", { score, level: score > 70 ? "high" : score > 30 ? "medium" : "low" }, { titleKey: "ev.risk.title", bodyKey: "ev.risk.body", concept: "risk" });
  step(ctx, 140);

  const needChallenge = tds === "challenge" || (tds !== "off" && score > 30);
  if (tds === "off" || !needChallenge) {
    emit(ctx, "tds", "TDS_FRICTIONLESS", { liabilityShift: false }, { titleKey: "ev.tdsFree.title", bodyKey: "ev.tdsFree.body", concept: "tds" });
  } else {
    emit(ctx, "tds", "TDS_CHALLENGE_SHOWN", { method: "otp" }, { titleKey: "ev.tds.title", bodyKey: "ev.tds.body", concept: "tds" });
    step(ctx, 600);
    if (fails(ctx, "tdsFail") || fails(ctx, "tdsAbandon")) {
      move(ctx, "DECLINE", "issuer", "TDS_FAILED", { reason: fails(ctx, "tdsAbandon") ? "abandoned" : "wrong-otp" }, { titleKey: "ev.tdsFail.title", bodyKey: "ev.tdsFail.body", concept: "tds" });
      return;
    }
    emit(ctx, "tds", "TDS_PASSED", { liabilityShift: true }, { titleKey: "ev.tdsPass.title", bodyKey: "ev.tdsPass.body", concept: "tds" });
    step(ctx, 150);
  }

  ctx.state = transition(ctx.state, "AUTHENTICATE");
  emit(ctx, "psp", "AUTH_REQUESTED", { amountMinor: ctx.amountMinor, idempotencyKey: idem }, { titleKey: "ev.authReq.title", bodyKey: "ev.authReq.body", concept: "authorization" });
  step(ctx, 220);

  const declineReason =
    fails(ctx, "insufficient") ? "insufficient-funds"
    : fails(ctx, "expiredCard") ? "expired-card"
    : fails(ctx, "wrongCvc") ? "wrong-cvc"
    : fails(ctx, "decline") ? "issuer-decline"
    : score > 92 && ctx.rng.bool(0.7) ? "suspected-fraud"
    : null;
  if (declineReason) {
    move(ctx, "DECLINE", "issuer", "ISSUER_DECLINED", { reason: declineReason }, { titleKey: "ev.declined.title", bodyKey: "ev.declined.body", concept: "authorization" });
    return;
  }
  ctx.ledger.hold("customer", ctx.amountMinor);
  move(ctx, "AUTHORIZE", "issuer", "AUTHORIZED_HOLD", { holdMinor: ctx.amountMinor }, { titleKey: "ev.hold.title", bodyKey: "ev.hold.body", concept: "authorization" });

  const delayed = str(p, "capture", "immediate") === "delayed";
  if (delayed) {
    emit(ctx, "merchant", "CAPTURE_DEFERRED", { reason: "ship-later" }, { titleKey: "ev.defer.title", bodyKey: "ev.defer.body", concept: "capture" });
    ctx.clock.advance(DAY_MS);
  }
  ctx.ledger.releaseHold("customer", ctx.amountMinor);
  const partial = num(p, "partialCapturePct", 100);
  void partial;
  move(ctx, "CAPTURE", "acquirer", "CAPTURED", { capturedMinor: ctx.amountMinor, delayed }, { titleKey: "ev.capture.title", bodyKey: "ev.capture.body", concept: "capture" });
  move(ctx, "CLEAR", "network", "CLEARED", { batch: "nightly" }, { titleKey: "ev.clear.title", bodyKey: "ev.clear.body", concept: "clearing" });

  const delayDays = fails(ctx, "delayedSettlement") ? 2 : num(p, "settlementDays", 1);
  const ev = emit(ctx, "system", "SETTLING", { delayDays }, { titleKey: "ev.settleWait.title", bodyKey: "ev.settleWait.body", concept: "settlement" });
  settleChain(ctx, ev.id, ctx.currency);
  ctx.clock.advance(delayDays * DAY_MS);
  move(ctx, "SETTLE", "bank", "SETTLED", { delayDays }, { titleKey: "ev.settled.title", bodyKey: "ev.settled.body", concept: "settlement" }, 50);

  if (fails(ctx, "chargeback")) {
    step(ctx, 3 * DAY_MS);
    post(ctx, ctx.events[ctx.events.length - 1].id, "CHARGEBACK", "merchant", "customer", ctx.amountMinor, ctx.currency, "ledger.chargeback");
    ctx.state = transition(ctx.state, "CHARGEBACK");
    emit(ctx, "issuer", "CHARGEBACK_OPENED", { reason: "not-recognized", amountMinor: ctx.amountMinor }, { titleKey: "ev.cb.title", bodyKey: "ev.cb.body", concept: "chargeback" });
  }
}

function buildWallet(ctx: Ctx): void {
  emit(ctx, "customer", "WALLET_OPENED", {}, { titleKey: "ev.wopen.title", bodyKey: "ev.wopen.body", concept: "wallet" });
  step(ctx, 150);
  emit(ctx, "wallet", "CARD_PROVISIONED", { dpan: `dpan_...${ctx.rng.hex(2)}` }, { titleKey: "ev.prov.title", bodyKey: "ev.prov.body", concept: "tokenization" });
  step(ctx, 300);
  if (fails(ctx, "tokenSuspended")) {
    ctx.state = transition(ctx.state, "AUTHENTICATE");
    move(ctx, "DECLINE", "tokenService", "TOKEN_SUSPENDED", {}, { titleKey: "ev.tokSusp.title", bodyKey: "ev.tokSusp.body", concept: "tokenization" });
    return;
  }
  emit(ctx, "issuer", "PROVISION_VERIFIED", { method: "otp" }, { titleKey: "ev.provOk.title", bodyKey: "ev.provOk.body", concept: "authentication" });
  step(ctx, 200);
  emit(ctx, "device", "BIOMETRIC_PROMPT", { modality: "fingerprint" }, { titleKey: "ev.bio.title", bodyKey: "ev.bio.body", concept: "biometric" });
  step(ctx, 400);
  if (fails(ctx, "biometricFail")) {
    emit(ctx, "device", "BIOMETRIC_FAILED", { attempts: 3 }, { titleKey: "ev.bioFail.title", bodyKey: "ev.bioFail.body", concept: "biometric" });
    step(ctx, 200);
    emit(ctx, "device", "PIN_FALLBACK_OK", {}, { titleKey: "ev.pinFb.title", bodyKey: "ev.pinFb.body", concept: "authentication" });
    step(ctx, 150);
  } else {
    emit(ctx, "device", "BIOMETRIC_OK", { localOnly: true }, { titleKey: "ev.bioOk.title", bodyKey: "ev.bioOk.body", concept: "biometric" });
    step(ctx, 150);
  }
  if (fails(ctx, "lostDevice")) {
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
    return;
  }
  ctx.state = transition(ctx.state, "AUTHENTICATE");
  emit(ctx, "tokenService", "CRYPTOGRAM_BUILT", { cryptogram: ctx.rng.hex(8) }, { titleKey: "ev.crypt.title", bodyKey: "ev.crypt.body", concept: "cryptogram" });
  step(ctx, 180);
  if (fails(ctx, "decline") || fails(ctx, "insufficient")) {
    move(ctx, "DECLINE", "issuer", "ISSUER_DECLINED", { reason: fails(ctx, "insufficient") ? "insufficient-funds" : "issuer-decline" }, { titleKey: "ev.declined.title", bodyKey: "ev.declined.body", concept: "authorization" });
    return;
  }
  ctx.ledger.hold("customer", ctx.amountMinor);
  move(ctx, "AUTHORIZE", "issuer", "AUTHORIZED_HOLD", { holdMinor: ctx.amountMinor, tokenized: true }, { titleKey: "ev.hold.title", bodyKey: "ev.hold.body", concept: "authorization" });
  ctx.ledger.releaseHold("customer", ctx.amountMinor);
  move(ctx, "CAPTURE", "acquirer", "CAPTURED", { capturedMinor: ctx.amountMinor }, { titleKey: "ev.capture.title", bodyKey: "ev.capture.body", concept: "capture" });
  move(ctx, "CLEAR", "network", "CLEARED", {}, { titleKey: "ev.clear.title", bodyKey: "ev.clear.body", concept: "clearing" });
  const ev = emit(ctx, "system", "SETTLING", { delayDays: 1 }, { titleKey: "ev.settleWait.title", bodyKey: "ev.settleWait.body", concept: "settlement" });
  settleChain(ctx, ev.id, ctx.currency);
  ctx.clock.advance(DAY_MS);
  move(ctx, "SETTLE", "bank", "SETTLED", { delayDays: 1 }, { titleKey: "ev.settled.title", bodyKey: "ev.settled.body", concept: "settlement" }, 50);
}

function buildQr(ctx: Ctx): void {
  const mode = str(ctx.params, "qrMode", "merchant-dynamic");
  const expirySec = num(ctx.params, "qrExpirySec", 120);
  const payloadStr = `SIMQR|v1|m=MERCH-${ctx.rng.hex(3)}|a=${ctx.amountMinor}|c=${ctx.currency}|ref=${ctx.rng.hex(4)}|chk=${ctx.rng.hex(2)}`;
  emit(ctx, "merchant", "QR_GENERATED", { mode, payload: payloadStr, expirySec }, { titleKey: "ev.qrGen.title", bodyKey: "ev.qrGen.body", concept: "qr" });
  step(ctx, 400);
  emit(ctx, "customer", "QR_SCANNED", { mode }, { titleKey: "ev.qrScan.title", bodyKey: "ev.qrScan.body", concept: "qr" });
  step(ctx, 250);
  if (fails(ctx, "expiredQr")) {
    ctx.clock.advance(expirySec * 1000 + 1000);
    ctx.state = transition(ctx.state, "AUTHENTICATE");
    move(ctx, "EXPIRE", "psp", "QR_EXPIRED", { expirySec }, { titleKey: "ev.qrExp.title", bodyKey: "ev.qrExp.body", concept: "qr" });
    return;
  }
  if (fails(ctx, "tamperedQr")) {
    ctx.state = transition(ctx.state, "AUTHENTICATE");
    move(ctx, "DECLINE", "psp", "QR_TAMPER_WARNING", { reason: "checksum-mismatch" }, { titleKey: "ev.qrTamper.title", bodyKey: "ev.qrTamper.body", concept: "qr-fraud" });
    return;
  }
  emit(ctx, "psp", "QR_VALIDATED", { checksum: "ok", merchantMatch: true }, { titleKey: "ev.qrOk.title", bodyKey: "ev.qrOk.body", concept: "qr" });
  step(ctx, 200);
  if (fails(ctx, "duplicate")) {
    emit(ctx, "psp", "DUPLICATE_BLOCKED", { reason: "already-scanned" }, { titleKey: "ev.dupe.title", bodyKey: "ev.dupe.body", concept: "idempotency" });
  }
  ctx.state = transition(ctx.state, "AUTHENTICATE");
  emit(ctx, "customer", "PIN_CONFIRMED", {}, { titleKey: "ev.pinOk.title", bodyKey: "ev.pinOk.body", concept: "authentication" });
  step(ctx, 200);
  if (fails(ctx, "insufficient") || fails(ctx, "decline")) {
    move(ctx, "DECLINE", "psp", "WALLET_DECLINED", { reason: "insufficient-balance" }, { titleKey: "ev.declined.title", bodyKey: "ev.declined.body", concept: "authorization" });
    return;
  }
  ctx.state = transition(ctx.state, "AUTHORIZE");
  emit(ctx, "psp", "WALLET_TO_WALLET", { amountMinor: ctx.amountMinor, netMinor: ctx.netAmount, state: ctx.state }, { titleKey: "ev.w2w.title", bodyKey: "ev.w2w.body", concept: "settlement" });
  // wallet-to-wallet: direct + provider fee
  post(ctx, ctx.events[ctx.events.length - 1].id, "CAPTURE", "customer", "merchant", ctx.netAmount, ctx.currency, "ledger.capture");
  for (const l of ctx.feeLines) post(ctx, ctx.events[ctx.events.length - 1].id, "FEE", "customer", "psp", l.amountMinor, ctx.currency, l.labelKey);
  ctx.clock.advance(2000);
  ctx.state = transition(ctx.state, "CAPTURE");
  emit(ctx, "merchant", "MERCHANT_NOTIFIED", { soundbox: true }, { titleKey: "ev.notify.title", bodyKey: "ev.notify.body" });
  step(ctx, 300);
  ctx.state = transition(ctx.state, "CLEAR");
  ctx.state = transition(ctx.state, "SETTLE");
  emit(ctx, "psp", "SETTLED", { instant: true }, { titleKey: "ev.settled.title", bodyKey: "ev.settled.body", concept: "settlement" });
}

function buildCrypto(ctx: Ctx): void {
  const chain = str(ctx.params, "chain", "btc-like");
  const ccy: Currency = chain === "stablecoin" ? "USDT" : "BTC";
  const confRequired = num(ctx.params, "confirmations", chain === "btc-like" ? 3 : 1);
  const feeTier = str(ctx.params, "feeTier", "medium");
  const congested = fails(ctx, "congestion") || str(ctx.params, "congestion", "normal") === "high";
  const rate = 97_000 + ctx.rng.int(-800, 800);
  const override = typeof ctx.params.destOverride === "string" && ctx.params.destOverride.length > 0
    ? ctx.params.destOverride
    : null;
  const address = override ?? `sim1${ctx.rng.hex(10)}`;
  emit(ctx, "merchant", "INVOICE_CREATED", { address, amountMinor: ctx.amountMinor, currency: ccy, rate, lockMin: 15 }, { titleKey: "ev.invoice.title", bodyKey: "ev.invoice.body", concept: "invoice" });
  step(ctx, 300);
  const addrValid = /^(sim1[0-9a-f]{6,}|0x[0-9a-fA-F]{6,})$/.test(address);
  if (fails(ctx, "wrongAddress") || (override !== null && !addrValid)) {
    ctx.state = transition(ctx.state, "AUTHENTICATE");
    move(ctx, "DECLINE", "customerWallet", "WRONG_ADDRESS", { reason: "address-mismatch" }, { titleKey: "ev.wrongAddr.title", bodyKey: "ev.wrongAddr.body", concept: "address" });
    return;
  }
  if (fails(ctx, "wrongNetwork")) {
    ctx.state = transition(ctx.state, "AUTHENTICATE");
    move(ctx, "DECLINE", "customerWallet", "WRONG_NETWORK", {}, { titleKey: "ev.wrongNet.title", bodyKey: "ev.wrongNet.body", concept: "network" });
    return;
  }
  const feeRate = feeTier === "high" ? 42 : feeTier === "low" ? 3 : 15;
  if (chain === "btc-like") {
    emit(ctx, "customerWallet", "TX_BUILT", { inputs: 2, outputs: 2, changeMinor: ctx.rng.int(100, 900), feeRateSatVb: feeRate }, { titleKey: "ev.utxo.title", bodyKey: "ev.utxo.body", concept: "utxo" });
  } else {
    emit(ctx, "customerWallet", "TX_BUILT", { nonce: ctx.rng.int(1, 40), gas: 21000 + ctx.rng.int(0, 30000), token: "SIM-USD" }, { titleKey: "ev.evm.title", bodyKey: "ev.evm.body", concept: "gas" });
  }
  step(ctx, 250);
  emit(ctx, "customerWallet", "FEE_CHOSEN", { tier: feeTier, feeRateSatVb: feeRate }, { titleKey: "ev.feeTier.title", bodyKey: "ev.feeTier.body", concept: "fee-market" });
  step(ctx, 200);
  ctx.state = transition(ctx.state, "AUTHENTICATE");
  emit(ctx, "customerWallet", "BROADCAST", { txHash: `0x${ctx.rng.hex(16)}` }, { titleKey: "ev.broadcast.title", bodyKey: "ev.broadcast.body", concept: "mempool" });
  step(ctx, 400);
  const position = congested ? ctx.rng.int(800, 4000) : ctx.rng.int(1, 40);
  emit(ctx, "miner", "MEMPOOL_QUEUED", { position, feeRateSatVb: feeRate, congested }, { titleKey: "ev.mempool.title", bodyKey: "ev.mempool.body", concept: "mempool" });
  step(ctx, congested ? 3000 : 800);
  if ((feeTier === "low" && congested) || fails(ctx, "blockFail")) {
    emit(ctx, "miner", "TX_STUCK", { reason: "fee-too-low" }, { titleKey: "ev.stuck.title", bodyKey: "ev.stuck.body", concept: "fee-market" });
    step(ctx, 1200);
    if (!fails(ctx, "blockFail")) {
      emit(ctx, "customerWallet", "RBF_REPLACED", { newFeeRateSatVb: 38 }, { titleKey: "ev.rbf.title", bodyKey: "ev.rbf.body", concept: "rbf" });
      step(ctx, 600);
    } else {
      move(ctx, "EXPIRE", "merchant", "INVOICE_EXPIRED", {}, { titleKey: "ev.invExp.title", bodyKey: "ev.invExp.body", concept: "invoice" });
      return;
    }
  }
  if (fails(ctx, "underpaid")) {
    move(ctx, "EXPIRE", "merchant", "UNDERPAID", { shortMinor: 120 }, { titleKey: "ev.under.title", bodyKey: "ev.under.body", concept: "invoice" });
    return;
  }
  ctx.state = transition(ctx.state, "AUTHORIZE");
  for (let depth = 1; depth <= confRequired; depth++) {
    ctx.clock.advance(chain === "btc-like" ? 600_000 : 12_000);
    emit(ctx, "miner", "BLOCK_MINED", { depth, of: confRequired, intervalSec: chain === "btc-like" ? 600 : 12 }, { titleKey: "ev.block.title", bodyKey: "ev.block.body", concept: "finality" });
  }
  if (fails(ctx, "depeg")) {
    emit(ctx, "system", "DEPEG", { peg: 1, market: 0.94 }, { titleKey: "ev.depeg.title", bodyKey: "ev.depeg.body", concept: "stablecoin" });
    step(ctx, 300);
  }
  const ev = emit(ctx, "miner", "CONFIRMED", { confirmations: confRequired }, { titleKey: "ev.conf.title", bodyKey: "ev.conf.body", concept: "finality" });
  post(ctx, ev.id, "SETTLEMENT", "customerWallet", "merchantWallet", ctx.amountMinor, ccy, "ledger.settlement");
  for (const l of ctx.feeLines) post(ctx, ev.id, "FEE", "customerWallet", "miner", l.amountMinor, ccy, l.labelKey);
  ctx.state = transition(ctx.state, "CAPTURE");
  ctx.state = transition(ctx.state, "CLEAR");
  ctx.state = transition(ctx.state, "SETTLE");
  emit(ctx, "merchant", "MARKED_PAID", { confirmations: confRequired }, { titleKey: "ev.paid.title", bodyKey: "ev.paid.body", concept: "finality" });
}

const FAKE_WORDS = ["river", "candle", "orbit", "meadow", "cipher", "harbor", "lantern", "prairie", "quartz", "signal", "tundra", "velvet", "willow", "yonder", "zephyr", "anchor"];

function buildCustody(ctx: Ctx): void {
  const mode = str(ctx.params, "custodyMode", "side-by-side");
  void mode;
  const words = Array.from({ length: 12 }, () => ctx.rng.pick(FAKE_WORDS));
  emit(ctx, "customerWallet", "SEED_GENERATED", { words, fake: true }, { titleKey: "ev.seed.title", bodyKey: "ev.seed.body", concept: "custody" });
  step(ctx, 300);
  // hot path
  emit(ctx, "customerWallet", "HOT_SIGNED", { online: true }, { titleKey: "ev.hot.title", bodyKey: "ev.hot.body", concept: "hot-wallet" });
  step(ctx, 250);
  if (fails(ctx, "compromised")) {
    emit(ctx, "system", "HOT_COMPROMISED", { vector: "malware" }, { titleKey: "ev.comp.title", bodyKey: "ev.comp.body", concept: "custody" });
  }
  // cold path
  emit(ctx, "customerWallet", "WATCHONLY_BUILT", { unsigned: true }, { titleKey: "ev.watch.title", bodyKey: "ev.watch.body", concept: "cold-wallet" });
  step(ctx, 300);
  emit(ctx, "customer", "QTRANSFER_TO_OFFLINE", { via: "qr" }, { titleKey: "ev.qoff.title", bodyKey: "ev.qoff.body", concept: "cold-wallet" });
  step(ctx, 400);
  emit(ctx, "device", "DEVICE_VERIFIED", { amountMinor: ctx.amountMinor, addressOk: !fails(ctx, "addressSwap") }, { titleKey: "ev.devVer.title", bodyKey: "ev.devVer.body", concept: "verification" });
  step(ctx, 300);
  if (fails(ctx, "addressSwap")) {
    emit(ctx, "system", "ADDRESS_SWAP", { caught: false }, { titleKey: "ev.swap.title", bodyKey: "ev.swap.body", concept: "phishing" });
    ctx.state = transition(ctx.state, "AUTHENTICATE");
    ctx.state = transition(ctx.state, "AUTHORIZE");
    const ev = emit(ctx, "customerWallet", "BROADCAST", { to: "attacker" }, { titleKey: "ev.broadcast.title", bodyKey: "ev.broadcast.body", concept: "mempool" });
    post(ctx, ev.id, "SETTLEMENT", "customerWallet", "attacker", ctx.amountMinor, ctx.currency, "ledger.settlement");
    ctx.state = transition(ctx.state, "CAPTURE");
    ctx.state = transition(ctx.state, "CLEAR");
    ctx.state = transition(ctx.state, "SETTLE");
    emit(ctx, "system", "FUNDS_LOST", { reversible: false }, { titleKey: "ev.lost2.title", bodyKey: "ev.lost2.body", concept: "irreversibility" });
    return;
  }
  if (fails(ctx, "lostSeed")) {
    ctx.state = transition(ctx.state, "AUTHENTICATE");
    move(ctx, "CANCEL", "customer", "SEED_LOST", {}, { titleKey: "ev.seedLost.title", bodyKey: "ev.seedLost.body", concept: "recovery" });
    return;
  }
  emit(ctx, "device", "SIGNED_OFFLINE", { airgapped: true }, { titleKey: "ev.signed.title", bodyKey: "ev.signed.body", concept: "cold-wallet" });
  step(ctx, 300);
  emit(ctx, "customer", "QTRANSFER_BACK", { via: "qr" }, { titleKey: "ev.qback.title", bodyKey: "ev.qback.body", concept: "cold-wallet" });
  step(ctx, 250);
  ctx.state = transition(ctx.state, "AUTHENTICATE");
  ctx.state = transition(ctx.state, "AUTHORIZE");
  const ev = emit(ctx, "customerWallet", "BROADCAST", { multisig: "2-of-3" }, { titleKey: "ev.broadcast.title", bodyKey: "ev.broadcast.body", concept: "multisig" });
  post(ctx, ev.id, "SETTLEMENT", "customerWallet", "merchantWallet", ctx.amountMinor, ctx.currency, "ledger.settlement");
  for (const l of ctx.feeLines) post(ctx, ev.id, "FEE", "customerWallet", "miner", l.amountMinor, ctx.currency, l.labelKey);
  ctx.state = transition(ctx.state, "CAPTURE");
  ctx.state = transition(ctx.state, "CLEAR");
  ctx.state = transition(ctx.state, "SETTLE");
  emit(ctx, "miner", "CONFIRMED", { confirmations: 1 }, { titleKey: "ev.conf.title", bodyKey: "ev.conf.body", concept: "finality" });
}

/** Tier B stubs — playable flows, deepened in Phase 3. */
function buildStub(ctx: Ctx, label: string): void {
  emit(ctx, "customer", "FLOW_STARTED", { module: label }, { titleKey: "ev.start.title", bodyKey: "ev.start.body" });
  step(ctx, 200);
  ctx.state = transition(ctx.state, "AUTHENTICATE");
  emit(ctx, "psp", "AUTH_REQUESTED", { amountMinor: ctx.amountMinor }, { titleKey: "ev.authReq.title", bodyKey: "ev.authReq.body", concept: "authorization" });
  step(ctx, 200);
  if (fails(ctx, "decline") || fails(ctx, "insufficient")) {
    move(ctx, "DECLINE", "issuer", "ISSUER_DECLINED", { reason: "declined" }, { titleKey: "ev.declined.title", bodyKey: "ev.declined.body", concept: "authorization" });
    return;
  }
  ctx.ledger.hold("customer", ctx.amountMinor);
  move(ctx, "AUTHORIZE", "issuer", "AUTHORIZED_HOLD", { holdMinor: ctx.amountMinor }, { titleKey: "ev.hold.title", bodyKey: "ev.hold.body", concept: "authorization" });
  ctx.ledger.releaseHold("customer", ctx.amountMinor);
  move(ctx, "CAPTURE", "acquirer", "CAPTURED", { capturedMinor: ctx.amountMinor }, { titleKey: "ev.capture.title", bodyKey: "ev.capture.body", concept: "capture" });
  move(ctx, "CLEAR", "network", "CLEARED", {}, { titleKey: "ev.clear.title", bodyKey: "ev.clear.body", concept: "clearing" });
  const ev = emit(ctx, "system", "SETTLING", { delayDays: 1 }, { titleKey: "ev.settleWait.title", bodyKey: "ev.settleWait.body", concept: "settlement" });
  settleChain(ctx, ev.id, ctx.currency);
  ctx.clock.advance(DAY_MS);
  move(ctx, "SETTLE", "bank", "SETTLED", { delayDays: 1 }, { titleKey: "ev.settled.title", bodyKey: "ev.settled.body", concept: "settlement" }, 50);
}

// ---------------------------------------------------------------- runner

const MODULE_CURRENCY: Record<ModuleId, Currency> = {
  checkout: "EUR",
  wallet: "EUR",
  qr: "EUR",
  crypto: "BTC",
  custody: "BTC",
  nfc: "EUR",
  p2p: "EUR",
  mobilemoney: "EUR",
  remit: "EUR", // exception: cross-border corridor (src EUR, dst DZD)
  bnpl: "EUR",
  demo: "EUR"
};

export interface ScenarioPreset {
  params?: Record<string, unknown>;
  seed?: number;
}

export function createRunBase(
  moduleId: ModuleId,
  options: RunOptions & { feeRules?: FeeRule[]; preset?: ScenarioPreset }
): Ctx {
  const seed = options.preset?.seed ?? options.seed;
  const params = { ...(options.preset?.params ?? {}), ...(options.params ?? {}) };
  const failures = options.failures ?? [];
  const rng = createRng(seed);
  const clock = new SimClock();
  const currency = (params.currency as Currency | undefined) ?? MODULE_CURRENCY[moduleId];
  const amountMinor = num(params, "amountMinor", moduleId === "crypto" || moduleId === "custody" ? 25000 : 4999);
  const feeRules = options.feeRules ?? defaultFeeRules(moduleId);
  const wf = computeWaterfall(amountMinor, feeRules);

  const ledger = new Ledger(baseAccounts(moduleId, currency));
  // fund customer (and wallets) so happy paths post cleanly
  ledger.fund("customer", amountMinor * 4 + 10000);
  ledger.fund("customerWallet", amountMinor * 4 + 10000);
  if (fails({ failures } as Ctx, "insufficient")) {
    // drain to force the decline branch deterministically
    ledger.fund("customer", -(amountMinor * 4 + 10000));
    ledger.fund("customer", 100);
    ledger.fund("customerWallet", -(amountMinor * 4 + 10000));
    ledger.fund("customerWallet", 100);
  }

  const ctx: Ctx = {
    rng,
    clock,
    events: [],
    ledger,
    txId: `tx-${moduleId}-${seed}`,
    seed,
    moduleId,
    params,
    failures,
    feeRules,
    state: INITIAL_STATE,
    currency,
    amountMinor,
    feeLines: wf.lines,
    totalFees: wf.totalFeesMinor,
    netAmount: wf.netAmountMinor,
    n: 0,
    refundedMinor: 0
  };

  // FX for cross-border-flavored runs
  if (params.fxPair && params.fxMidRate) {
    ctx.fxQuote = quoteFx({
      pair: String(params.fxPair),
      midRate: Number(params.fxMidRate),
      spreadBps: num(params, "fxSpreadBps", 120),
      amountSrcMinor: amountMinor,
      srcCurrency: currency,
      dstCurrency: (params.dstCurrency as Currency | undefined) ?? "DZD"
    });
    emit(ctx, "psp", "FX_QUOTED", { quote: ctx.fxQuote }, { titleKey: "ev.fx.title", bodyKey: "ev.fx.body", concept: "spread" });
    step(ctx, 150);
  }

  return ctx;
}

export function runScenario(
  moduleId: ModuleId,
  options: RunOptions & { feeRules?: FeeRule[]; preset?: ScenarioPreset }
): RunResult {
  const ctx = createRunBase(moduleId, options);
  switch (moduleId) {
    case "checkout": buildCheckout(ctx); break;
    case "wallet": buildWallet(ctx); break;
    case "qr": buildQr(ctx); break;
    case "crypto": buildCrypto(ctx); break;
    case "custody": buildCustody(ctx); break;
    case "demo": buildDemo(ctx); break;
    default: buildStub(ctx, moduleId); break;
  }

  return finishRunResult(ctx);
}

/** Assemble the immutable run result (asserts ledger invariants). Shared with staged flows. */
export function finishRunResult(ctx: Ctx): RunResult {
  ctx.ledger.assertBalanced();
  ctx.ledger.assertNoNegative();

  const actors: ActorId[] = [];
  for (const e of ctx.events) if (!actors.includes(e.actor)) actors.push(e.actor);

  const receipt: Receipt = {
    txId: ctx.txId,
    moduleId: ctx.moduleId,
    amountMinor: ctx.amountMinor,
    currency: ctx.currency,
    feeLines: ctx.feeLines,
    totalFeesMinor: ctx.totalFees,
    netAmountMinor: ctx.netAmount,
    fxQuote: ctx.fxQuote,
    finalState: ctx.state,
    refundedMinor: ctx.refundedMinor
  };

  return {
    txId: ctx.txId,
    moduleId: ctx.moduleId,
    seed: ctx.seed,
    events: ctx.events,
    ledgerEntries: [...ctx.ledger.entries],
    finalState: ctx.state,
    receipt,
    actors
  };
}

/** Byte-identical replay check helper (acceptance criterion). */
export function replayKey(result: RunResult): string {
  return JSON.stringify(result.events);
}
