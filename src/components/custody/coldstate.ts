/**
 * Cold-wallet UI state: engine state object persisted to localStorage,
 * mutated through a guarded runner. Demo PIN + demo seed words live in the
 * browser only and are always labeled DEMO — never real credentials.
 */
"use client";
import { useCallback, useRef, useState } from "react";
import {
  COLD_ASSETS,
  coldEmpty,
  type ColdState,
  type FailureId
} from "@sim/engine";

const LS_KEY = "simpay.coldwallet.v1";

function load(): ColdState | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as ColdState;
    if (!s || s.version !== 1 || !s.device || !Array.isArray(s.accounts)) return null;
    return s;
  } catch {
    return null;
  }
}

function applyFailureDefaults(s: ColdState, failures: FailureId[]): void {
  if (failures.includes("wrongAddress")) s.scenarios.tamperSend = true;
  if (failures.includes("compromised")) s.scenarios.tamperReceive = true;
  if (failures.includes("blockFail")) s.scenarios.failNextBroadcast = true;
}

export function useColdWallet(seed: number, failures: FailureId[]) {
  const [s, setS] = useState<ColdState>(() => {
    const prev = load();
    if (prev) return prev;
    const fresh = coldEmpty(seed);
    applyFailureDefaults(fresh, failures);
    return fresh;
  });
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef(s);
  ref.current = s;

  const save = useCallback((next: ColdState) => {
    setS({ ...next });
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* noop */ }
  }, []);

  const run = useCallback(<T,>(fn: (st: ColdState) => T): T | null => {
    try {
      const r = fn(ref.current);
      save(ref.current);
      setErr(null);
      return r;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [save]);

  const resetAll = useCallback(() => {
    const fresh = coldEmpty(seed);
    applyFailureDefaults(fresh, failures);
    try { localStorage.removeItem(LS_KEY); } catch { /* noop */ }
    setS(fresh);
    setErr(null);
  }, [seed, failures]);

  return { s, err, setErr, run, save, resetAll };
}

export function fmtAsset(minor: number, sym: string): string {
  const a = COLD_ASSETS.find((x) => x.symbol === sym);
  const d = a?.decimals ?? 8;
  const v = minor / 10 ** d;
  return `${v.toFixed(Math.min(d, 8))} ${sym} (sim)`;
}

/** Major-unit decimal string → minor units, or null when invalid/imprecise. */
export function toMinor(major: string, sym: string): number | null {
  const a = COLD_ASSETS.find((x) => x.symbol === sym);
  if (!a) return null;
  const v = Number(major.replace(",", "."));
  if (!Number.isFinite(v) || !(v > 0)) return null;
  const scaled = v * 10 ** a.decimals;
  const m = Math.round(scaled);
  if (Math.abs(scaled - m) > 1e-6) return null;
  if (!Number.isSafeInteger(m)) return null;
  return m;
}

export function shortAddr(a: string): string {
  return a.length > 16 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a;
}
