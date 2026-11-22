/**
 * Shared HotWallet state: one engine state object, persisted locally,
 * mutated through a guarded runner. Auto-lock counts down from the last
 * wallet action (simulated inactivity model, documented in-app).
 */
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  hwEmpty,
  hwLock,
  type HWState
} from "@sim/engine";

export interface PayIntent {
  to: string;
  amountMinor: number;
  asset: string;
  note?: string;
}

const LS_KEY = "simpay.hotwallet.v1";

function load(seed: number): HWState | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as HWState;
    if (!s || s.version !== 1 || !Array.isArray(s.accounts)) return null;
    return s;
  } catch {
    return null;
  }
}

export function useHotWallet(seed: number) {
  const [s, setS] = useState<HWState>(() => load(seed) ?? hwEmpty(seed));
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef(s);
  ref.current = s;
  const lastActive = useRef(Date.now());

  const save = useCallback((next: HWState) => {
    setS({ ...next });
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* noop */ }
  }, []);

  const run = useCallback(<T,>(fn: (st: HWState) => T): T | null => {
    try {
      const r = fn(ref.current);
      lastActive.current = Date.now();
      save(ref.current);
      setErr(null);
      return r;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [save]);

  const resetAll = useCallback(() => {
    const fresh = hwEmpty(seed);
    try { localStorage.removeItem(LS_KEY); } catch { /* noop */ }
    setS(fresh);
    setErr(null);
    lastActive.current = Date.now();
  }, [seed]);

  // simulated auto-lock: no wallet action for autoLockSec seconds
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      const st = ref.current;
      if (st.unlocked && st.seedWords && Date.now() - lastActive.current > st.autoLockSec * 1000) {
        hwLock(st);
        save(st);
      }
      setTick((x) => x + 1);
    }, 5000);
    return () => window.clearInterval(id);
  }, [save]);
  void tick;

  return { s, err, setErr, run, save, resetAll };
}

export function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function fmtUnits(minor: number, decimals: number, maxDp = 6): string {
  const v = minor / 10 ** decimals;
  return v.toLocaleString(undefined, { maximumFractionDigits: maxDp });
}
