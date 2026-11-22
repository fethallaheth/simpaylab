"use client";
/**
 * Simulation bridge: runs @sim/engine with @sim/content presets.
 * All UI panes render from the returned event log only.
 */
import { FEE_CONFIGS, scenariosFor } from "@sim/content";
import { runScenario, type CheckoutAction, type FailureId, type ModuleId, type RunResult } from "@sim/engine";

export interface ModuleMeta {
  id: ModuleId;
  group: "cards" | "mobile" | "transfers" | "crypto" | "lab";
  tier: "A" | "B";
}

export const MODULES: ModuleMeta[] = [
  { id: "checkout", group: "cards", tier: "A" },
  { id: "nfc", group: "cards", tier: "B" },
  { id: "bnpl", group: "cards", tier: "B" },
  { id: "wallet", group: "mobile", tier: "A" },
  { id: "qr", group: "mobile", tier: "A" },
  { id: "p2p", group: "transfers", tier: "B" },
  { id: "mobilemoney", group: "transfers", tier: "B" },
  { id: "remit", group: "transfers", tier: "B" },
  { id: "crypto", group: "crypto", tier: "A" },
  { id: "custody", group: "crypto", tier: "A" }
];

export const FAILURE_LABELS: { id: FailureId; key: string }[] = [
  { id: "decline", key: "fail.decline" },
  { id: "insufficient", key: "fail.insufficient" },
  { id: "expiredCard", key: "fail.expiredCard" },
  { id: "wrongCvc", key: "fail.wrongCvc" },
  { id: "tdsFail", key: "fail.tdsFail" },
  { id: "tdsAbandon", key: "fail.tdsAbandon" },
  { id: "fraud", key: "fail.fraud" },
  { id: "duplicate", key: "fail.duplicate" },
  { id: "timeout", key: "fail.timeout" },
  { id: "chargeback", key: "fail.chargeback" },
  { id: "congestion", key: "fail.congestion" },
  { id: "delayedSettlement", key: "fail.delayedSettlement" },
  { id: "blockFail", key: "fail.blockFail" },
  { id: "wrongAddress", key: "fail.wrongAddress" },
  { id: "wrongNetwork", key: "fail.wrongNetwork" },
  { id: "underpaid", key: "fail.underpaid" },
  { id: "depeg", key: "fail.depeg" },
  { id: "biometricFail", key: "fail.biometricFail" },
  { id: "lostDevice", key: "fail.lostDevice" },
  { id: "tokenSuspended", key: "fail.tokenSuspended" },
  { id: "offline", key: "fail.offline" },
  { id: "expiredQr", key: "fail.expiredQr" },
  { id: "tamperedQr", key: "fail.tamperedQr" },
  { id: "compromised", key: "fail.compromised" },
  { id: "lostSeed", key: "fail.lostSeed" },
  { id: "addressSwap", key: "fail.addressSwap" }
];

export const FAILURE_NAMES: Record<FailureId, string> = {
  decline: "Issuer decline",
  insufficient: "Insufficient funds",
  expiredCard: "Expired card",
  wrongCvc: "Wrong CVC",
  tdsFail: "3DS failure",
  tdsAbandon: "3DS abandoned",
  fraud: "Fraud flag",
  duplicate: "Duplicate submission",
  timeout: "Timeout then retry",
  chargeback: "Chargeback",
  congestion: "Network congestion",
  delayedSettlement: "Delayed settlement",
  blockFail: "Block confirmation fails",
  wrongAddress: "Wrong address",
  wrongNetwork: "Wrong network",
  underpaid: "Underpaid invoice",
  depeg: "Stablecoin depeg",
  biometricFail: "Biometric fail ×3",
  lostDevice: "Lost device",
  tokenSuspended: "Token suspended",
  offline: "Offline device",
  expiredQr: "Expired QR",
  tamperedQr: "Tampered QR",
  compromised: "Hot wallet compromised",
  lostSeed: "Lost seed phrase",
  addressSwap: "Clipboard address swap"
};

/** Failures relevant per module (injector shows these first). */
export const MODULE_FAILURES: Record<ModuleId, FailureId[]> = {
  checkout: ["insufficient", "expiredCard", "wrongCvc", "tdsFail", "tdsAbandon", "decline", "fraud", "duplicate", "timeout", "chargeback", "delayedSettlement"],
  wallet: ["biometricFail", "tokenSuspended", "lostDevice", "offline", "decline", "insufficient"],
  qr: ["expiredQr", "tamperedQr", "duplicate", "insufficient", "decline"],
  crypto: ["congestion", "blockFail", "wrongAddress", "wrongNetwork", "underpaid", "depeg"],
  custody: ["compromised", "lostSeed", "addressSwap"],
  nfc: ["decline", "offline"],
  p2p: ["insufficient", "decline"],
  mobilemoney: ["insufficient", "timeout"],
  remit: ["congestion", "delayedSettlement", "fraud"],
  bnpl: ["decline", "insufficient"],
  demo: []
};

export interface RunSpec {
  moduleId: ModuleId;
  scenarioId?: string;
  seed: number;
  params: Record<string, unknown>;
  failures: FailureId[];
}

export function executeRun(spec: RunSpec): RunResult {
  const scenarios = scenariosFor(spec.moduleId);
  const sc = scenarios.find((s) => s.id === spec.scenarioId) ?? scenarios[0];
  const feeCfg = FEE_CONFIGS.find((f) => f.moduleId === spec.moduleId);
  return runScenario(spec.moduleId, {
    seed: spec.seed,
    params: { ...(sc?.preset.params ?? {}), ...spec.params },
    failures: spec.failures,
    feeRules: feeCfg?.rules.map((r) => ({ ...r }))
  });
}

export function defaultParams(moduleId: ModuleId): Record<string, unknown> {
  const sc = scenariosFor(moduleId)[0];
  return { ...(sc?.preset.params ?? {}), seed: sc?.preset.seed ?? 42 };
}

// ---- sessions (localStorage primary, Dexie mirror when available) ----

export interface StoredSession {
  id: string;
  at: number;
  spec: RunSpec;
  result: RunResult;
  /** staged-engine action transcript; resuming it reproduces the log exactly */
  transcript?: CheckoutAction[];
}

const LS_KEY = "simpay.sessions.v1";

export function listSessions(): StoredSession[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StoredSession[];
  } catch {
    return [];
  }
}

export function saveSession(spec: RunSpec, result: RunResult, transcript?: CheckoutAction[]): StoredSession {
  const s: StoredSession = { id: `${result.txId}-${Date.now()}`, at: Date.now(), spec, result, transcript: transcript ? [...transcript] : undefined };
  try {
    const all = [s, ...listSessions()].slice(0, 30);
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* storage full/blocked — session still shown in-memory */
  }
  void mirrorToDexie(s);
  return s;
}

/** Replace the stored result/transcript after a merchant action on a resumed order. */
export function updateSession(id: string, result: RunResult, transcript?: CheckoutAction[]): void {
  try {
    const all = listSessions().map((s) => (s.id === id ? { ...s, result, transcript: transcript ? [...transcript] : s.transcript } : s));
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* storage full/blocked — live panes already show the new result */
  }
}

/** Forget every stored session of one module (demo reset for the next student). */
export function clearSessionsForModule(moduleId: ModuleId): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(listSessions().filter((s) => s.spec.moduleId !== moduleId)));
  } catch {
    /* storage blocked — nothing persisted anyway */
  }
}

async function mirrorToDexie(s: StoredSession): Promise<void> {
  try {
    if (typeof indexedDB === "undefined") return;
    const { Dexie } = await import("dexie");
    const db = new Dexie("simpay-lab");
    db.version(1).stores({ sessions: "id,at" });
    await (db as unknown as { sessions: { put: (x: unknown) => Promise<void> } }).sessions.put({
      id: s.id,
      at: s.at,
      spec: s.spec,
      result: s.result
    });
  } catch {
    /* Dexie is a best-effort mirror in Phase 1 */
  }
}

export function exportSession(s: StoredSession): string {
  return JSON.stringify({ app: "simpay-lab", version: 1, session: s }, null, 2);
}

// ---- guided learner journey ----------------------------------------------
// ---- guided learner journey ----------------------------------------------
// Where is the money RIGHT NOW? Derived from visible events only.
// Per-module step definitions live in src/components/journey.tsx; the
// failure catalogue below is shared by the journey, timeline and inspector.

export type JourneyStatus = "done" | "now" | "todo" | "failed";

export const FAIL_TYPES = [
  "ISSUER_DECLINED", "TDS_FAILED", "TOKEN_SUSPENDED", "OFFLINE_DECLINED",
  "QR_EXPIRED", "QR_TAMPER_WARNING", "WRONG_ADDRESS", "WRONG_NETWORK",
  "INVOICE_EXPIRED", "UNDERPAID", "SEED_LOST", "WALLET_DECLINED",
  "PIN_LOCKED", "SESSION_TIMEOUT", "COMPLIANCE_HOLD", "BNPL_DENIED",
  "BANK_PULL_FAILED", "CHARGEBACK_OPENED", "CHARGEBACK_ACCEPTED",
  "REPRESENTMENT_LOST", "FUNDS_LOST", "FUNDING_DECLINED", "SIM_SWAP_FLAG",
  "ADDRESS_SWAP", "HOT_COMPROMISED", "INSTALLMENT_MISSED", "AUTODEBIT_FAILED"
];

// ---- money formatting ----

const CRYPTO = new Set(["BTC", "USDT"]);

export function formatMoney(minor: number, currency: string, locale = "en"): string {
  if (CRYPTO.has(currency)) {
    const v = minor / 100_000_000;
    return `${v} ${currency} (sim)`;
  }
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

export function formatT(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 3_600_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}
