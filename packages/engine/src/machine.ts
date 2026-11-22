/**
 * Generic transaction lifecycle state machine (spec §2.6).
 * Tiny typed pure reducer — see DECISIONS.md for why not XState in Phase 1.
 *
 *   INITIATED → AUTHENTICATED → AUTHORIZED → CAPTURED → CLEARED → SETTLED
 *   side/terminal: DECLINED, EXPIRED, CANCELLED, REVERSED, REFUNDED,
 *   CHARGEBACK, DISPUTED, PENDING_REVIEW
 */
import type { TxSignal, TxState } from "./types";

export const INITIAL_STATE: TxState = "INITIATED";

const TERMINAL: TxState[] = [
  "SETTLED",
  "DECLINED",
  "EXPIRED",
  "CANCELLED",
  "REVERSED",
  "REFUNDED",
  "CHARGEBACK"
];

const TRANSITIONS: Record<TxState, Partial<Record<TxSignal, TxState>>> = {
  INITIATED: {
    AUTHENTICATE: "AUTHENTICATED",
    DECLINE: "DECLINED",
    EXPIRE: "EXPIRED",
    CANCEL: "CANCELLED",
    FLAG_REVIEW: "PENDING_REVIEW"
  },
  AUTHENTICATED: {
    AUTHORIZE: "AUTHORIZED",
    DECLINE: "DECLINED",
    EXPIRE: "EXPIRED",
    CANCEL: "CANCELLED",
    FLAG_REVIEW: "PENDING_REVIEW"
  },
  AUTHORIZED: {
    CAPTURE: "CAPTURED",
    DECLINE: "DECLINED",
    EXPIRE: "EXPIRED",
    CANCEL: "CANCELLED",
    REVERSE: "REVERSED",
    FLAG_REVIEW: "PENDING_REVIEW"
  },
  CAPTURED: {
    CLEAR: "CLEARED",
    REFUND: "REFUNDED",
    CHARGEBACK: "CHARGEBACK",
    DISPUTE: "DISPUTED",
    REVERSE: "REVERSED"
  },
  CLEARED: {
    SETTLE: "SETTLED",
    REFUND: "REFUNDED",
    CHARGEBACK: "CHARGEBACK",
    DISPUTE: "DISPUTED"
  },
  SETTLED: {
    REFUND: "REFUNDED",
    CHARGEBACK: "CHARGEBACK",
    DISPUTE: "DISPUTED"
  },
  PENDING_REVIEW: {
    RESOLVE_REVIEW: "AUTHENTICATED",
    DECLINE: "DECLINED",
    CANCEL: "CANCELLED"
  },
  DISPUTED: {
    CHARGEBACK: "CHARGEBACK",
    REFUND: "REFUNDED",
    REVERSE: "REVERSED"
  },
  DECLINED: {},
  EXPIRED: {},
  CANCELLED: {},
  REVERSED: {},
  REFUNDED: {},
  CHARGEBACK: {}
};

export class IllegalTransition extends Error {}

export function transition(state: TxState, signal: TxSignal): TxState {
  const next = TRANSITIONS[state]?.[signal];
  if (!next) throw new IllegalTransition(`${signal} not allowed from ${state}`);
  return next;
}

export function allowedSignals(state: TxState): TxSignal[] {
  return Object.keys(TRANSITIONS[state] ?? {}) as TxSignal[];
}

export function isTerminal(state: TxState): boolean {
  return TERMINAL.includes(state);
}

/** Modules that skip steps declare the signals they actually use. */
export function specialize(signals: TxSignal[]): Set<TxSignal> {
  return new Set(signals);
}
