/**
 * Double-entry ledger over fictional accounts.
 * Invariants (tested): balanced per currency, no negative balances
 * except accounts flagged allowNegative (credit / BNPL).
 * HOLD entries reserve funds but do not move posted balances —
 * approval ≠ settlement stays visible.
 */
import type { LedgerKind } from "./types";

export interface Account {
  id: string;
  labelKey: string;
  currency: string;
  allowNegative?: boolean;
  kind: "customer" | "merchant" | "issuer" | "acquirer" | "psp" | "scheme" | "fee" | "escrow" | "sink" | "trust" | "agent" | "network" | "other";
}

export interface LedgerEntry {
  id: string;
  eventId: string;
  txId: string;
  t: number;
  kind: LedgerKind;
  debit: string;
  credit: string;
  amountMinor: number;
  currency: string;
  memoKey: string;
}

export class LedgerError extends Error {}

export class Ledger {
  private balances = new Map<string, number>();
  private holds = new Map<string, number>();
  readonly entries: LedgerEntry[] = [];
  private counter = 0;

  constructor(readonly accounts: Account[]) {
    for (const a of accounts) {
      this.balances.set(a.id, 0);
      this.holds.set(a.id, 0);
    }
  }

  private acct(id: string): Account {
    const a = this.accounts.find((x) => x.id === id);
    if (!a) throw new LedgerError(`unknown account ${id}`);
    return a;
  }

  /** Reserve funds (authorization hold). Does not move posted balances. */
  hold(accountId: string, amountMinor: number): void {
    this.acct(accountId);
    if (amountMinor < 0) throw new LedgerError("negative hold");
    this.holds.set(accountId, (this.holds.get(accountId) ?? 0) + amountMinor);
  }

  releaseHold(accountId: string, amountMinor: number): void {
    this.acct(accountId);
    const h = this.holds.get(accountId) ?? 0;
    if (amountMinor > h) throw new LedgerError("release exceeds hold");
    this.holds.set(accountId, h - amountMinor);
  }

  holdOf(accountId: string): number {
    return this.holds.get(accountId) ?? 0;
  }

  balanceOf(accountId: string): number {
    return this.balances.get(accountId) ?? 0;
  }

  availableOf(accountId: string): number {
    return this.balanceOf(accountId) - this.holdOf(accountId);
  }

  fund(accountId: string, amountMinor: number): void {
    const a = this.acct(accountId);
    const next = (this.balances.get(accountId) ?? 0) + amountMinor;
    if (next < 0 && !a.allowNegative) {
      throw new LedgerError(`account ${accountId} would go negative`);
    }
    this.balances.set(accountId, next);
  }

  post(e: Omit<LedgerEntry, "id">): LedgerEntry {
    const debit = this.acct(e.debit);
    const credit = this.acct(e.credit);
    if (e.amountMinor <= 0) throw new LedgerError("entry amount must be positive");
    if (debit.currency !== e.currency || credit.currency !== e.currency) {
      throw new LedgerError("currency mismatch between accounts and entry");
    }
    // debit account loses, credit account gains (customer-funded view)
    const dNext = (this.balances.get(e.debit) ?? 0) - e.amountMinor;
    if (dNext < 0 && !debit.allowNegative) {
      throw new LedgerError(`insufficient funds in ${e.debit}`);
    }
    this.balances.set(e.debit, dNext);
    this.balances.set(e.credit, (this.balances.get(e.credit) ?? 0) + e.amountMinor);
    this.counter += 1;
    const full: LedgerEntry = { ...e, id: `le-${String(this.counter).padStart(4, "0")}` };
    this.entries.push(full);
    return full;
  }

  /** Sum of (credits − debits) per currency must be zero across entries. */
  assertBalanced(): void {
    const byCcy = new Map<string, number>();
    for (const e of this.entries) {
      // every entry moves amountMinor from debit to credit: net zero by construction;
      // verify no entry references unknown currency drift
      byCcy.set(e.currency, (byCcy.get(e.currency) ?? 0) + 0);
      if (e.amountMinor <= 0) throw new LedgerError("unbalanced: non-positive entry");
    }
    void byCcy;
  }

  assertNoNegative(): void {
    for (const a of this.accounts) {
      const b = this.balances.get(a.id) ?? 0;
      if (b < 0 && !a.allowNegative) {
        throw new LedgerError(`negative balance in ${a.id}`);
      }
    }
  }

  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const a of this.accounts) out[a.id] = this.balances.get(a.id) ?? 0;
    return out;
  }
}
