/**
 * Shared domain model + event schema for the simulation lab.
 * Pure TypeScript, zero UI / browser imports.
 * All money is in integer minor units (cents, centimes, sats …).
 * Everything fictional — simulation only.
 */

export type ActorId =
  | "customer"
  | "merchant"
  | "psp"
  | "acquirer"
  | "network"
  | "issuer"
  | "wallet"
  | "device"
  | "tokenService"
  | "tds"
  | "fraudEngine"
  | "agent"
  | "operator"
  | "telecom"
  | "trustAccount"
  | "bank"
  | "miner"
  | "merchantWallet"
  | "customerWallet"
  | "bnpl"
  | "regulator"
  | "lecturer"
  | "system";

export type Currency = "DZD" | "EUR" | "EUR" | "USD" | "KES" | "CNY" | "BTC" | "USDT" | "GBP" | "MAD" | "PHP";

export interface Explain {
  /** i18n key for the short title shown in timeline + inspector */
  titleKey: string;
  /** i18n key for the 1–2 sentence explanation */
  bodyKey: string;
  /** glossary concept id, e.g. "authorization" */
  concept?: string;
}

export interface SimEvent {
  id: string;
  txId: string;
  /** simulated time, ms since scenario start */
  t: number;
  actor: ActorId;
  type: string;
  payload: Record<string, unknown>;
  explain: Explain;
}

/** Generic transaction lifecycle (spec §2.6). */
export type TxState =
  | "INITIATED"
  | "AUTHENTICATED"
  | "AUTHORIZED"
  | "CAPTURED"
  | "CLEARED"
  | "SETTLED"
  | "DECLINED"
  | "EXPIRED"
  | "CANCELLED"
  | "REVERSED"
  | "REFUNDED"
  | "CHARGEBACK"
  | "DISPUTED"
  | "PENDING_REVIEW";

export type TxSignal =
  | "AUTHENTICATE"
  | "AUTHORIZE"
  | "CAPTURE"
  | "CLEAR"
  | "SETTLE"
  | "DECLINE"
  | "EXPIRE"
  | "CANCEL"
  | "REVERSE"
  | "REFUND"
  | "CHARGEBACK"
  | "DISPUTE"
  | "FLAG_REVIEW"
  | "RESOLVE_REVIEW";

export type LedgerKind =
  | "HOLD"
  | "CAPTURE"
  | "CLEARING"
  | "SETTLEMENT"
  | "FEE"
  | "REFUND"
  | "CHARGEBACK"
  | "MINT"
  | "RELEASE";

export interface FeeRule {
  id: string;
  /** i18n key for the fee label, e.g. "fee.interchange" */
  labelKey: string;
  /** fixed part, minor units */
  fixedMinor: number;
  /** percentage part in basis points (140 = 1.40%) */
  pctBps: number;
  payer: string;
  payee: string;
}

export interface FeeLine {
  ruleId: string;
  labelKey: string;
  amountMinor: number;
  payer: string;
  payee: string;
}

export interface FxQuote {
  pair: string;
  midRate: number;
  spreadBps: number;
  offeredRate: number;
  amountSrcMinor: number;
  srcCurrency: Currency;
  amountDstMinor: number;
  dstCurrency: Currency;
  /** total cost carried by the spread, percent */
  costPct: number;
  illustrative: true;
}

/** Lecturer-forced outcomes (spec §3.5 failure injector). */
export type FailureId =
  | "decline"
  | "insufficient"
  | "expiredCard"
  | "wrongCvc"
  | "tdsFail"
  | "tdsAbandon"
  | "fraud"
  | "duplicate"
  | "timeout"
  | "chargeback"
  | "congestion"
  | "delayedSettlement"
  | "blockFail"
  | "wrongAddress"
  | "wrongNetwork"
  | "underpaid"
  | "depeg"
  | "biometricFail"
  | "lostDevice"
  | "tokenSuspended"
  | "offline"
  | "expiredQr"
  | "tamperedQr"
  | "compromised"
  | "lostSeed"
  | "addressSwap";

export type ModuleId =
  | "checkout"
  | "wallet"
  | "qr"
  | "crypto"
  | "custody"
  | "nfc"
  | "p2p"
  | "mobilemoney"
  | "remit"
  | "bnpl"
  | "demo";

export interface RunOptions {
  seed: number;
  params?: Record<string, unknown>;
  failures?: FailureId[];
  locale?: string;
}

export interface Receipt {
  txId: string;
  moduleId: ModuleId;
  amountMinor: number;
  currency: Currency;
  feeLines: FeeLine[];
  totalFeesMinor: number;
  netAmountMinor: number;
  fxQuote?: FxQuote;
  finalState: TxState;
  /** principal returned to the customer by refunds (staged checkout flow) */
  refundedMinor?: number;
}

export interface RunResult {
  txId: string;
  moduleId: ModuleId;
  seed: number;
  events: SimEvent[];
  ledgerEntries: import("./ledger").LedgerEntry[];
  finalState: TxState;
  receipt: Receipt;
  /** ordered list of actor ids in order of first appearance */
  actors: ActorId[];
}
