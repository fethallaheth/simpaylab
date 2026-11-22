"use client";
import { commerceText, conceptDef, quizzesFor } from "@sim/content";
import type { FailureId, ModuleId, RunResult, SimEvent } from "@sim/engine";
import { useMemo, useState } from "react";
import { t, tx } from "@/i18n/dict";
import { FAILURE_LABELS, MODULE_FAILURES, formatMoney, formatT } from "@/lib/sim";
import { actorLabel, isFailEvent } from "./journey";
import { usePrefs } from "./providers";
import { Badge, Btn, Card, Field, inputCls } from "./ui";

/* ---------------- Timeline ---------------- */

const PENDING_TYPES = [
  "P2P_PENDING", "TRANSFER_DELAYED", "TX_STUCK", "MEMPOOL_QUEUED",
  "COMPLIANCE_HOLD", "TDS_CHALLENGE_SHOWN", "BIOMETRIC_PROMPT",
  "OTP_SENT", "QR_SCANNED", "CAPTURE_DEFERRED", "SETTLING", "PIN_FALLBACK_SHOWN"
];

export function eventStatus(e: SimEvent): "failed" | "pending" | "info" {
  if (isFailEvent(e)) return "failed";
  if (PENDING_TYPES.includes(e.type)) return "pending";
  return "info";
}

export function Timeline({ result, cursor, selected, onSelect }: { result: RunResult; cursor: number; selected: string | null; onSelect: (id: string) => void }) {
  const { locale } = usePrefs();
  const visible = result.events.slice(0, cursor + 1);
  if (visible.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-[13px] text-zinc-500 dark:border-zinc-700">
        {t(locale, "sim.tl.empty")}
      </div>
    );
  }
  return (
    <ol className="space-y-1" aria-label={t(locale, "sim.timeline")}>
      {visible.map((e, i) => {
        const st = eventStatus(e);
        return (
          <li key={e.id}>
            <button
              onClick={() => onSelect(e.id)}
              aria-current={selected === e.id ? "true" : undefined}
              aria-label={tx(locale, "sim.tl.item", { n: i + 1, title: t(locale, e.explain.titleKey), actor: actorLabel(locale, e.actor) })}
              className={`w-full rounded-lg border px-2.5 py-1.5 text-start text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-sky-500 ${selected === e.id ? "border-sky-500 bg-sky-50 dark:bg-sky-950" : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"}`}
            >
              <span className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-zinc-500" dir="ltr">{String(i + 1).padStart(2, "0")}</span>
                <span className={`h-2 w-2 shrink-0 rounded-full ${st === "failed" ? "bg-red-500" : st === "pending" ? "bg-amber-500" : "bg-emerald-500"}`} aria-hidden />
                <Badge tone={st === "failed" ? "red" : st === "pending" ? "amber" : "zinc"}>{actorLabel(locale, e.actor)}</Badge>
                <span className="font-medium">{t(locale, e.explain.titleKey)}</span>
                <span className="ms-auto shrink-0 font-mono text-[11px] text-zinc-500" dir="ltr">t+{formatT(e.t)}</span>
              </span>
              <span className="mt-0.5 flex items-center gap-2">
                <span className="text-[11px] font-medium text-zinc-500">{t(locale, `st.${st}`)}</span>
                <span className="font-mono text-[10px] text-zinc-400" dir="ltr" title={t(locale, "sim.tl.codeHint")}>{e.type}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------- Inspector ---------------- */

/** Never render secrets even if a payload ever carried them. */
const SECRET_RE = /seed|phrase|private|secret|pan|cvc|cvv|pin|otp|password|passwd|key/i;
function sanitizedPayload(payload: SimEvent["payload"]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload ?? {})) {
    out[k] = SECRET_RE.test(k) ? "•••" : v;
  }
  return out;
}

export function Inspector({ result, eventId, cursor }: { result: RunResult; eventId: string | null; cursor: number }) {
  const { locale } = usePrefs();
  const visible = result.events.slice(0, cursor + 1);
  if (visible.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700">
        <div className="font-semibold text-zinc-700 dark:text-zinc-300">{t(locale, "sim.insp.empty")}</div>
        <div className="mt-1">{t(locale, "sim.insp.emptyHint")}</div>
      </div>
    );
  }
  const e = visible.find((x) => x.id === eventId) ?? visible[visible.length - 1];
  const concept = conceptDef(e.explain.concept);
  const money = commerceText(e.type, locale);
  const st = eventStatus(e);
  const maxFee = Math.max(1, ...result.receipt.feeLines.map((l) => l.amountMinor));
  const amountMinor = typeof e.payload?.amountMinor === "number" ? (e.payload.amountMinor as number) : null;
  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="text-xs text-zinc-500"><span dir="ltr">{e.id}</span> · <span className="font-mono" dir="ltr">t+{formatT(e.t)}</span> · <Badge tone={st === "failed" ? "red" : st === "pending" ? "amber" : "green"}>{t(locale, `st.${st}`)}</Badge></div>
        <h3 className="text-base font-semibold">{t(locale, e.explain.titleKey)}</h3>
        <p className="text-zinc-600 dark:text-zinc-400">{t(locale, e.explain.bodyKey)}</p>
      </div>
      {money && (
        <Card className="border-emerald-200 bg-emerald-50 p-2.5 text-[13px] dark:border-emerald-900 dark:bg-emerald-950">
          <span className="font-semibold">{t(locale, "sim.insp.money")}: </span>{money.money}
          {money.watch && <span className="mt-1 block text-zinc-600 dark:text-zinc-400"><span className="font-semibold">{t(locale, "sim.insp.watch")}: </span>{money.watch}</span>}
        </Card>
      )}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
        <div><dt className="text-xs text-zinc-500">{t(locale, "sim.insp.actor")}</dt><dd className="font-medium">{actorLabel(locale, e.actor)}</dd></div>
        <div><dt className="text-xs text-zinc-500">{t(locale, "sim.insp.code")}</dt><dd className="font-mono text-[12px]" dir="ltr">{e.type}</dd></div>
        {amountMinor !== null && (
          <div><dt className="text-xs text-zinc-500">{t(locale, "rcpt.amount")}</dt><dd className="font-mono" dir="auto"><bdi>{formatMoney(amountMinor, result.receipt.currency, locale)}</bdi></dd></div>
        )}
        <div><dt className="text-xs text-zinc-500">{t(locale, "rcpt.tx")}</dt><dd className="break-all font-mono text-[12px]" dir="ltr">{result.txId}</dd></div>
      </dl>
      {concept && (
        <Card className="p-2.5 text-[13px]">
          <span className="font-semibold">{concept.term[locale] ?? concept.term.en}: </span>
          <span className="text-zinc-600 dark:text-zinc-400">{concept.def[locale] ?? concept.def.en}</span>
        </Card>
      )}
      <details>
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-zinc-500">{t(locale, "sim.insp.raw")}</summary>
        <pre className="mt-1 overflow-x-auto rounded-lg bg-zinc-950 p-2.5 font-mono text-[11px] text-emerald-200" dir="ltr">{JSON.stringify(sanitizedPayload(e.payload), null, 1)}</pre>
      </details>
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t(locale, "rcpt.fees")}</div>
        {result.receipt.feeLines.map((l) => (
          <div key={l.ruleId} className="mb-1">
            <div className="flex justify-between gap-2 text-[13px]"><span>{t(locale, l.labelKey)} <span className="text-zinc-500" dir="ltr">({l.payer}→{l.payee})</span></span><span className="font-mono" dir="auto"><bdi>{formatMoney(l.amountMinor, result.receipt.currency, locale)}</bdi></span></div>
            <div className="h-1.5 rounded bg-zinc-100 dark:bg-zinc-800"><div className="h-1.5 rounded bg-sky-500" style={{ width: `${(100 * l.amountMinor) / maxFee}%` }} /></div>
          </div>
        ))}
        <div className="flex justify-between border-t border-zinc-200 pt-1 text-[13px] font-semibold dark:border-zinc-800">
          <span>{t(locale, "rcpt.net")}</span><span className="font-mono" dir="auto"><bdi>{formatMoney(result.receipt.netAmountMinor, result.receipt.currency, locale)}</bdi></span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Receipt + Ledger ---------------- */

export function ReceiptView({ result }: { result: RunResult }) {
  const { locale } = usePrefs();
  const r = result.receipt;
  const note = t(locale, "rcpt.note");
  const rows = (
    <>
      <Row k={t(locale, "rcpt.amount")} v={formatMoney(r.amountMinor, r.currency, locale)} />
      {r.feeLines.map((l) => <Row key={l.ruleId} k={`${t(locale, l.labelKey)} (${note})`} v={formatMoney(l.amountMinor, r.currency, locale)} />)}
      <Row k={t(locale, "rcpt.total")} v={formatMoney(r.amountMinor, r.currency, locale)} strong />
      <Row k={t(locale, "rcpt.net")} v={formatMoney(r.netAmountMinor, r.currency, locale)} strong />
      <Row k={t(locale, "rcpt.state")} v={r.finalState} />
      {r.fxQuote && <Row k={`FX ${r.fxQuote.pair} (${note})`} v={`${r.fxQuote.offeredRate} (mid ${r.fxQuote.midRate})`} />}
      <Row k={t(locale, "rcpt.tx")} v={r.txId} mono />
    </>
  );
  return (
    <div className="grid gap-2 md:grid-cols-3">
      {[t(locale, "rcpt.customer"), t(locale, "rcpt.merchant"), t(locale, "rcpt.audit")].map((h) => (
        <Card key={h} className="p-3 font-mono text-[12px]">
          <div className="mb-2 text-center font-sans font-bold">SimPay Lab · {h}</div>
          {rows}
          <div className="mt-2 text-center font-sans text-[11px] text-zinc-500">{t(locale, "rcpt.simnote")}</div>
        </Card>
      ))}
    </div>
  );
}

function Row({ k, v, strong, mono }: { k: string; v: string; strong?: boolean; mono?: boolean }) {
  return <div className={`flex justify-between gap-2 py-0.5 ${strong ? "font-bold" : ""}`}><span>{k}</span><span dir="auto" className={mono ? "break-all text-[10px]" : ""}><bdi>{v}</bdi></span></div>;
}

export function LedgerView({ result }: { result: RunResult }) {
  const { locale } = usePrefs();
  const nets = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of result.ledgerEntries) {
      m.set(e.credit, (m.get(e.credit) ?? 0) + e.amountMinor);
      m.set(e.debit, (m.get(e.debit) ?? 0) - e.amountMinor);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [result]);
  const ccy = result.receipt.currency;
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead><tr className="text-start text-zinc-500"><th className="p-1 text-start" scope="col">{t(locale, "led.entry")}</th><th className="p-1 text-start" scope="col">{t(locale, "led.kind")}</th><th className="p-1 text-start" scope="col">{t(locale, "led.flow")}</th><th className="p-1 text-end" scope="col">{t(locale, "led.amount")}</th><th className="p-1 text-start" scope="col">{t(locale, "led.memo")}</th></tr></thead>
          <tbody>
            {result.ledgerEntries.map((e) => (
              <tr key={e.id} className="border-t border-zinc-100 dark:border-zinc-900">
                <td className="p-1 font-mono" dir="ltr">{e.id}</td>
                <td className="p-1"><Badge>{e.kind}</Badge></td>
                <td className="p-1 font-mono" dir="ltr">{e.debit} → {e.credit}</td>
                <td className="p-1 text-end font-mono" dir="auto"><bdi>{formatMoney(e.amountMinor, ccy, locale)}</bdi></td>
                <td className="p-1">{t(locale, e.memoKey)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[13px]">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t(locale, "led.netflow")}</div>
        {nets.map(([a, n]) => (
          <div key={a} className="flex justify-between border-b border-zinc-100 py-0.5 dark:border-zinc-900"><span className="font-mono" dir="ltr">{a}</span><span dir="auto" className={`font-mono ${n < 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}><bdi>{n >= 0 ? "+" : ""}{formatMoney(n, ccy, locale)}</bdi></span></div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Params / failures ---------------- */

const SELECTS: Record<string, { key: string; options: string[] }> = {
  risk: { key: "p.risk", options: ["low", "medium", "high"] },
  tds: { key: "p.tds", options: ["auto", "challenge", "off"] },
  capture: { key: "p.capture", options: ["immediate", "delayed"] },
  qrMode: { key: "p.qrMode", options: ["merchant-dynamic", "merchant-static", "customer-presented"] },
  chain: { key: "p.chain", options: ["btc-like", "stablecoin", "fast-low-fee"] },
  feeTier: { key: "p.feeTier", options: ["low", "medium", "high"] },
  congestion: { key: "p.congestion", options: ["normal", "high"] }
};

/** Only relevant controls per module — no invalid combos, less clutter. */
const MODULE_SELECTS: Record<string, string[]> = {
  checkout: ["risk", "tds", "capture"],
  wallet: [],
  qr: ["qrMode"],
  crypto: ["chain", "feeTier", "congestion"],
  custody: [],
  demo: []
};

const MODULE_NUMBERS: Record<string, { key: string; label: string }[]> = {
  checkout: [{ key: "amountMinor", label: "p.amount" }, { key: "seed", label: "p.seed" }, { key: "settlementDays", label: "p.settlementDays" }],
  wallet: [{ key: "amountMinor", label: "p.amount" }, { key: "seed", label: "p.seed" }],
  qr: [{ key: "amountMinor", label: "p.amount" }, { key: "seed", label: "p.seed" }, { key: "qrExpirySec", label: "p.qrExpirySec" }],
  crypto: [{ key: "amountMinor", label: "p.amount" }, { key: "seed", label: "p.seed" }, { key: "confirmations", label: "p.confirmations" }],
  custody: [{ key: "amountMinor", label: "p.amount" }, { key: "seed", label: "p.seed" }],
  demo: [{ key: "amountMinor", label: "p.amount" }, { key: "seed", label: "p.seed" }]
};

const CURRENCIES = ["USD", "EUR", "BTC", "USDT"];

function optLabel(locale: Parameters<typeof t>[0], o: string): string {
  const s = t(locale, `p.opt.${o}`);
  return s === `p.opt.${o}` ? o : s;
}

export function ParamPanel({ moduleId, params, onChange }: { moduleId: ModuleId; params: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  const { locale } = usePrefs();
  const set = (k: string, v: unknown) => onChange({ ...params, [k]: v });
  const numbers = MODULE_NUMBERS[moduleId] ?? MODULE_NUMBERS.demo;
  const selects = MODULE_SELECTS[moduleId] ?? [];
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
      {numbers.map(({ key: k, label }) => (
        <Field key={k} label={t(locale, label)}>
          <input type="number" dir="ltr" className={inputCls} value={Number(params[k] ?? (k === "seed" ? 42 : 0))} onChange={(e) => set(k, Number(e.target.value))} />
        </Field>
      ))}
      {selects.map((k) => (
        <Field key={k} label={t(locale, SELECTS[k].key)}>
          <select className={inputCls} value={String(params[k] ?? SELECTS[k].options[0])} onChange={(e) => set(k, e.target.value)}>
            {SELECTS[k].options.map((o) => <option key={o} value={o}>{optLabel(locale, o)}</option>)}
          </select>
        </Field>
      ))}
      <Field label={t(locale, "p.currency")}>
        <select dir="ltr" className={inputCls} value={String(params.currency ?? CURRENCIES[0])} onChange={(e) => set("currency", e.target.value)}>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
    </div>
  );
}

const FAIL_KEY: Partial<Record<FailureId, string>> = Object.fromEntries(FAILURE_LABELS.map((f) => [f.id, f.key]));

export function FailureInjector({ moduleId, failures, onChange }: { moduleId: ModuleId; failures: FailureId[]; onChange: (f: FailureId[]) => void }) {
  const { locale } = usePrefs();
  const toggle = (id: FailureId) => onChange(failures.includes(id) ? failures.filter((x) => x !== id) : [...failures, id]);
  const first = MODULE_FAILURES[moduleId];
  const rest: FailureId[] = (Object.keys(FAIL_KEY) as FailureId[]).filter((x) => !first.includes(x));
  const pill = (id: FailureId) => (
    <button key={id} onClick={() => toggle(id)} aria-pressed={failures.includes(id)}
      className={`rounded-full border px-2.5 py-1 text-[12px] ${failures.includes(id) ? "border-red-500 bg-red-50 font-semibold dark:bg-red-950" : "border-zinc-300 dark:border-zinc-700"}`}>
      {failures.includes(id) ? "✕ " : "+ "}{t(locale, FAIL_KEY[id] ?? id)}
    </button>
  );
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">{first.map(pill)}</div>
      {rest.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-zinc-500">{tx(locale, "sim.failuresAll", { n: rest.length })}</summary>
          <div className="mt-1.5 flex flex-wrap gap-1.5">{rest.map(pill)}</div>
        </details>
      )}
    </div>
  );
}

/* ---------------- Quiz ---------------- */

export function QuizPanel({ moduleId }: { moduleId: ModuleId }) {
  const { locale } = usePrefs();
  const qs = quizzesFor(moduleId);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [done, setDone] = useState(false);
  const correctIndex = (q: (typeof qs)[number]) => q.text.options.findIndex((o) => o.en === q.text.answer);
  const score = qs.filter((q) => picked[q.id] === correctIndex(q)).length;
  // Question bank content is English-only (content layer, Phase 5); chrome is translated.
  return (
    <div className="space-y-3">
      {qs.map((q) => (
        <Card key={q.id} className="p-3">
          <div className="mb-1.5 text-sm font-medium" dir="ltr">{q.text.q.en}</div>
          <div className="grid gap-1">
            {q.text.options.map((o, i) => {
              const correct = o.en === q.text.answer;
              const chosen = picked[q.id] === i;
              return (
                <button key={i} disabled={done} onClick={() => setPicked({ ...picked, [q.id]: i })}
                  className={`rounded-lg border px-2.5 py-1.5 text-start text-[13px] ${done && correct ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950" : done && chosen ? "border-red-500 bg-red-50 dark:bg-red-950" : chosen ? "border-sky-500 bg-sky-50 dark:bg-sky-950" : "border-zinc-200 dark:border-zinc-800"}`}>
                  <span dir="ltr">{o.en}</span>
                </button>
              );
            })}
          </div>
          {done && <div className="mt-1.5 text-[13px] text-zinc-600 dark:text-zinc-400"><span className="font-semibold">{t(locale, "quiz.why")}: </span><span dir="ltr">{q.text.explanation.en}</span></div>}
        </Card>
      ))}
      <div className="flex items-center gap-2">
        <Btn onClick={() => setDone(true)}>{done ? tx(locale, "quiz.scoreOut", { score, total: qs.length }) : t(locale, "quiz.submit")}</Btn>
        {done && <Btn variant="outline" onClick={() => { setDone(false); setPicked({}); }}>{t(locale, "quiz.retry")}</Btn>}
      </div>
    </div>
  );
}
