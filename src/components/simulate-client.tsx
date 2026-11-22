"use client";
import type { FailureId, ModuleId, RunResult } from "@sim/engine";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Experience } from "@/components/experience";
import { Guided } from "@/components/experience";
import { Inspector, LedgerView, QuizPanel, ReceiptView, Timeline } from "@/components/panels";
import { ReplayBar, SequenceView, ProcessView, SPEEDS } from "@/components/journey";
import { usePrefs } from "@/components/providers";
import { Badge, Btn } from "@/components/ui";
import { t, tx } from "@/i18n/dict";
import { MODULES, defaultParams, executeRun, exportSession, type RunSpec } from "@/lib/sim";

export const VALID: ModuleId[] = ["checkout", "wallet", "qr", "crypto", "custody", "nfc", "p2p", "mobilemoney", "remit", "bnpl", "demo"];

function PaneHead({ n, children, aside }: { n: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        <span className="font-mono text-[10px] font-normal text-zinc-400">{n}</span>
        {children}
      </h2>
      {aside}
    </div>
  );
}

export function SimulateClient({ moduleId }: { moduleId: ModuleId }) {
  const { locale } = usePrefs();
  const [seed, setSeed] = useState<number>(42);
  const [p, setP] = useState<Record<string, unknown>>({});
  const [failures, setFailures] = useState<FailureId[]>([]);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(SPEEDS[1]);
  const [tab, setTab] = useState<"receipt" | "ledger" | "quiz">("receipt");
  const [runId, setRunId] = useState(0);
  /** Learner has performed the payment gesture (pay / tap / sign). Replay unfolds from it. */
  const [acted, setActed] = useState(false);

  const tier = MODULES.find((m) => m.id === moduleId)?.tier;

  useEffect(() => {
    const d = defaultParams(moduleId);
    setSeed((d.seed as number) ?? 42);
    const { seed: _s, ...rest } = d as Record<string, unknown>;
    void _s;
    setP(rest);
    setFailures([]);
    setRunId((x) => x + 1);
  }, [moduleId]);

  const spec: RunSpec = useMemo(
    () => ({ moduleId, seed, params: p, failures }),
    [moduleId, seed, p, failures]
  );

  const computed = useMemo(() => {
    if (!VALID.includes(moduleId)) return null;
    try {
      return executeRun(spec);
    } catch (err) {
      return { error: String(err) } as const;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, runId, moduleId]);
  /** Live staged runs (e.g. the interactive checkout) push their log here. */
  const [live, setLive] = useState<RunResult | null>(null);
  const result = live ?? computed;
  const pushLive = (r: RunResult) => {
    setLive(r);
    setActed(true);
    setCursor(r.events.length - 1);
    setPlaying(false);
  };
  const total = result && !("error" in result) ? result.events.length : 0;

  const clampCursor = (c: number) => Math.max(-1, Math.min(total - 1, c));

  // Lecturer shortcut: arrows move through the timeline. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowRight") { setPlaying(false); setCursor((c) => clampCursor(c + 1)); }
      if (e.key === "ArrowLeft") { setPlaying(false); setCursor((c) => clampCursor(c - 1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  // Playback: advance the cursor on a timer. Cursor only slices the visible
  // log — replaying never re-executes financial actions.
  useEffect(() => {
    if (!playing) return;
    if (cursor >= total - 1) { setPlaying(false); return; }
    const id = window.setTimeout(() => setCursor((c) => clampCursor(c + 1)), speed);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, cursor, total, speed]);

  useEffect(() => {
    if (computed && !("error" in computed)) {
      // Fresh run waits for the learner's gesture — no autoplay spoilers.
      // Live staged sessions are untouched here (they push their own cursor).
      setCursor(-1);
      setSelected(null);
      setActed(false);
      setPlaying(false);
      setLive(null);
    }
  }, [computed]);

  if (!VALID.includes(moduleId)) return <section className="rounded-xl border border-zinc-200 p-6 text-sm dark:border-zinc-800">{t(locale, "sim.unknown")}</section>;
  if (!result) return <div className="h-40 animate-pulse rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950" aria-label={t(locale, "sim.loading")} />;
  if ("error" in result) {
    return (
      <section className="rounded-xl border border-red-300 bg-red-50/60 p-6 dark:border-red-900 dark:bg-red-950/30">
        <div className="font-semibold text-red-700 dark:text-red-300">{t(locale, "sim.runFailed")}</div>
        <pre className="mt-2 overflow-x-auto text-[12px]" dir="ltr">{result.error}</pre>
        <div className="mt-3">
          <Btn onClick={() => { setFailures([]); setRunId((x) => x + 1); }}>{t(locale, "sim.reset")}</Btn>
        </div>
      </section>
    );
  }

  /** Selecting an event pauses playback, moves the cursor to it and shows it. */
  const selectEvent = (id: string) => {
    const idx = result.events.findIndex((e) => e.id === id);
    setPlaying(false);
    setSelected(id);
    if (idx >= 0) setCursor(idx);
  };

  const resetAll = () => {
    const d = defaultParams(moduleId);
    setSeed((d.seed as number) ?? 42);
    const { seed: _s, ...rest } = d as Record<string, unknown>;
    void _s;
    setP(rest);
    setFailures([]);
    setRunId((x) => x + 1);
    setLive(null);
    setActed(false);
    setCursor(-1);
    setSelected(null);
    setPlaying(false);
    setTab("receipt");
  };

  const cursorEvent = cursor >= 0 && cursor < total ? result.events[cursor] : undefined;

  const exportRun = () => {
    const json = exportSession({ id: `${result.txId}-export`, at: Date.now(), spec, result });
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${moduleId}-seed-${seed}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <div>
          <nav className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400" aria-label="Breadcrumb">
            <Link href="/" className="hover:text-zinc-700 dark:hover:text-zinc-200">Lab</Link>
            <span aria-hidden>/</span>
            <span className="text-zinc-500">{t(locale, `mod.${moduleId}`)}</span>
          </nav>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">{t(locale, `mod.${moduleId}`)}</h1>
          <p className="mt-1 max-w-[70ch] text-[13px] leading-6 text-zinc-600 dark:text-zinc-400">{t(locale, `mod.${moduleId}.d`)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tier && <Badge tone="zinc">{t(locale, tier === "A" ? "dash.tier.a" : "dash.tier.b")}</Badge>}
          <Btn small variant="outline" onClick={exportRun}>{t(locale, "sim.export")}</Btn>
          <Btn small variant="outline" onClick={resetAll}>{t(locale, "sim.reset")}</Btn>
        </div>
      </header>

      <section>
        <PaneHead n="01">{t(locale, "sim.experience")}</PaneHead>
        <Experience moduleId={moduleId} result={result} cursor={cursor} params={p} failures={failures} seed={seed} onLive={pushLive} />
      </section>

      <section>
        <PaneHead n="02">{t(locale, "sim.lesson")}</PaneHead>
        <Guided moduleId={moduleId} result={result} cursor={cursor} />
      </section>

      <div>
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{t(locale, "sim.process")}</h2>
        <div className="mt-2"><ProcessView moduleId={moduleId} result={result} /></div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <span className="flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              <span className="font-mono text-[10px] font-normal text-zinc-400">03</span>
              {t(locale, "sim.timeline")}
            </span>
            <span className="font-mono text-[10px] text-zinc-400">{tx(locale, "sim.eventsCount", { n: total })}</span>
          </div>
          <div className="space-y-3 p-3">
            <ReplayBar
              total={total} cursor={cursor} caption={cursorEvent}
              playing={playing} speed={speed}
              onToggle={() => { if (total === 0) return; if (!playing && cursor >= total - 1) setCursor(-1); setPlaying((v) => !v); }}
              onPrev={() => { setPlaying(false); setCursor((c) => clampCursor(c - 1)); }}
              onNext={() => { setPlaying(false); setCursor((c) => clampCursor(c + 1)); }}
              onRestart={() => { setSelected(null); setCursor(-1); setPlaying(total > 0); }}
              onScrub={(i) => { setPlaying(false); setCursor(clampCursor(i)); }}
              onSpeed={setSpeed}
            />
            <div>
              <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">{t(locale, "sim.sequence")}</h3>
              <SequenceView result={result} cursor={cursor} selected={selected} onSelect={selectEvent} />
            </div>
            <div>
              <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">{t(locale, "sim.events")}</h3>
              <div className="max-h-96 overflow-auto pe-1">
                <Timeline result={result} cursor={cursor} selected={selected} onSelect={selectEvent} />
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 xl:sticky xl:top-16">
          <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <span className="flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              <span className="font-mono text-[10px] font-normal text-zinc-400">04</span>
              {t(locale, "sim.inspector")}
            </span>
            {selected && <span className="font-mono text-[9px] text-zinc-400" dir="ltr">{selected}</span>}
          </div>
          <div className="p-3">
            <Inspector result={result} eventId={selected} cursor={cursor} />
          </div>
        </section>
      </div>

      <section className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <div className="flex gap-1" role="tablist">
          {(["receipt", "ledger", "quiz"] as const).map((x) => (
            <button
              key={x}
              role="tab"
              aria-selected={tab === x}
              onClick={() => setTab(x)}
              className={`border-b-2 px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
                tab === x
                  ? "border-zinc-900 text-zinc-900 dark:border-zinc-200 dark:text-zinc-50"
                  : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              {t(locale, `sim.${x}`)}
            </button>
          ))}
        </div>
        <div className="mt-3">
          {tab === "receipt" && (acted ? <ReceiptView result={result} /> : <GateNotice />)}
          {tab === "ledger" && (acted ? <LedgerView result={result} /> : <GateNotice />)}
          {tab === "quiz" && <QuizPanel moduleId={moduleId} />}
        </div>
      </section>
    </div>
  );
}

function GateNotice() {
  const { locale } = usePrefs();
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-[12px] text-zinc-500 dark:border-zinc-700">
      {t(locale, "sim.gate")}
    </div>
  );
}
