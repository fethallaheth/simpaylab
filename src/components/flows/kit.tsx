/**
 * Shared presentational kit for the high-fidelity module flows.
 * No engine imports here — apps drive their staged runners and use these
 * bricks for screens. Everything starts empty; nothing is prefilled.
 */
"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Card } from "../ui";

export function TestStrip({ text }: { text: string }) {
  return (
    <div className="rounded bg-amber-100 px-2 py-0.5 text-center text-[11px] font-bold tracking-widest text-amber-800 dark:bg-amber-950 dark:text-amber-300">
      {text}
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700">{children}</div>;
}

export function StepHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <div className="font-semibold">{title}</div>
        {sub && <div className="text-[13px] text-zinc-500">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function Phone({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[340px]">
      <div className="mb-1 text-center text-[11px] uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="rounded-[1.8rem] border border-zinc-300 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-950">{children}</div>
    </div>
  );
}

export function MockSms({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3 text-[13px] dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">{title}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export function OtpBoxes({ value, onChange, length = 6, label }: { value: string; onChange: (v: string) => void; length?: number; label: string }) {
  return (
    <input
      dir="ltr"
      inputMode="numeric"
      aria-label={label}
      className="w-full rounded-xl border border-zinc-500 bg-transparent p-2 text-center font-mono text-lg tracking-[0.4em]"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, length))}
      placeholder={"•".repeat(length)}
      autoComplete="off"
    />
  );
}

export function ProcessingLadder({ steps, ms = 480, onDone }: { steps: string[]; ms?: number; onDone: () => void }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (idx >= steps.length) {
      const id = setTimeout(onDone, 350);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setIdx((i) => i + 1), ms);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);
  return (
    <Card className="mx-auto max-w-[340px] space-y-1.5 p-4">
      {steps.map((s, i) => (
        <div key={`${s}-${i}`} className="flex items-center gap-2 text-sm">
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${i < idx ? "bg-emerald-600 text-white" : i === idx ? "bg-sky-600 text-white" : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800"}`}>
            {i < idx ? "✓" : i + 1}
          </span>
          <span className={i <= idx ? "" : "text-zinc-400"}>{s}</span>
          {i === idx && <span className="ms-auto animate-pulse text-[12px] text-sky-600">…</span>}
        </div>
      ))}
    </Card>
  );
}

/** Wall-clock text that renders identically on server and first client pass,
 *  then fills in after mount — immune to hydration mismatch by construction. */
export function Time({ at, timeOnly }: { at?: number; timeOnly?: boolean }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return <span>…</span>;
  const d = at === undefined ? new Date() : new Date(at);
  return <>{timeOnly ? d.toLocaleTimeString() : d.toLocaleString()}</>;
}

/** Reset local flow state when the run spec (or a local key) changes. */
export function useSpecReset(key: string, reset: () => void) {
  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export const inpCls = "mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";
