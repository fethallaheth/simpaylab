/**
 * Remittance app v2 — a complete international transfer experience.
 * Wizard (corridor -> amount -> provider -> recipient -> payout -> funding ->
 * review with quote expiry -> tracker with manual/auto advance -> receipt),
 * recipient-side delivery views, transfers dashboard with filters, activity,
 * rates comparison with true-cost panel and instructor sandbox. All math
 * integer minor units via the staged engine; no live rates anywhere.
 */
"use client";
import { useEffect, useRef, useState } from "react";
import {
  CORRIDORS,
  FUNDING_RAILS,
  REMIT_PROVIDERS,
  createRemitFlow,
  createRunBase,
  remitAdvance,
  remitQuote,
  remitQuoteForReceive,
  remitResult,
  type Corridor,
  type FailureId,
  type FundingId,
  type RemitFlow,
  type RemitQuote,
  type RunResult
} from "@sim/engine";
import { t } from "@/i18n/dict";
import { formatMoney, formatT, listSessions, saveSession, type StoredSession } from "@/lib/sim";
import { usePrefs } from "../providers";
import { Badge, Btn, Card } from "../ui";
import { EmptyNote, StepHead, Time, inpCls, useSpecReset } from "../flows/kit";

type Tab = "send" | "rates" | "recipients" | "transfers" | "activity";
type Payout = "bank" | "wallet" | "cash";
type Mode = "send" | "receive";

interface Recipient {
  id: string;
  name: string;
  country: string;
  payout: Payout;
  bank?: string;
  acct?: string;
  walletProvider?: string;
  walletId?: string;
  network?: string;
  city?: string;
  contact?: string;
}

const RECIP_KEY = "simpay.remit.recipients.v1";
const RBAL_KEY = "simpay.remit.rbalances.v1";
const RCOLL_KEY = "simpay.remit.collected.v1";
const QUOTE_VALID_MS = 120_000;

function load<T>(key: string, fallback: T): T {
  try {
    if (typeof window === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* noop */ }
}
const major = (v: string) => Math.round(Number(v.replace(",", ".")) * 100);

function fmtRate(r: number): string {
  return r >= 100 ? r.toFixed(2) : r >= 1 ? r.toFixed(4) : r.toFixed(6);
}

export function RemitApp({ seed, params, failures, onLive }: {
  seed: number;
  params: Record<string, unknown>;
  failures: FailureId[];
  onLive: (r: RunResult) => void;
}) {
  const { locale } = usePrefs();
  const [tab, setTab] = useState<Tab>("send");
  // wizard state
  const [step, setStep] = useState(0);
  const [corridor, setCorridor] = useState("fr-dz");
  const [mode, setMode] = useState<Mode>("send");
  const [budgetIsTotal, setBudgetIsTotal] = useState(false);
  const [amount, setAmount] = useState("");
  const [provider, setProvider] = useState("fintech");
  const [recipientId, setRecipientId] = useState("");
  const [deliver, setDeliver] = useState<Payout>("wallet");
  const [funding, setFunding] = useState<FundingId>("balance");
  const [quoteAt, setQuoteAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shown, setShown] = useState(0);
  const [auto, setAuto] = useState(false);
  // directory + balances
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [rbal, setRbal] = useState<Record<string, number>>({});
  const [collected, setCollected] = useState<string[]>([]);
  const [orders, setOrders] = useState<StoredSession[]>([]);
  const [filter, setFilter] = useState("all");
  const [detail, setDetail] = useState<StoredSession | null>(null);
  // recipient form
  const [rf, setRf] = useState({ name: "", country: "", payout: "bank" as Payout, bank: "", acct: "", walletProvider: "", walletId: "", network: "", city: "", contact: "" });
  const [rfErr, setRfErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // rates tab
  const [rCorridor, setRCorridor] = useState("fr-dz");
  const [rAmount, setRAmount] = useState("500.00");
  const [rMode, setRMode] = useState<Mode>("send");
  const [sandbox, setSandbox] = useState({ feeBps: 60, spreadBps: 90 });

  const flowRef = useRef<RemitFlow | null>(null);
  const savedRef = useRef(false);
  const timers = useRef<number[]>([]);

  const cor: Corridor = CORRIDORS.find((c) => c.id === corridor) ?? CORRIDORS[0];
  const rCor: Corridor = CORRIDORS.find((c) => c.id === rCorridor) ?? CORRIDORS[0];

  useEffect(() => {
    setRecipients(load<Recipient[]>(RECIP_KEY, []));
    setRbal(load<Record<string, number>>(RBAL_KEY, {}));
    setCollected(load<string[]>(RCOLL_KEY, []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useSpecReset(JSON.stringify({ seed, params, failures }), () => {
    flowRef.current = null;
    savedRef.current = false;
    setStep(0);
    setShown(0);
    setAuto(false);
  });
  useEffect(() => {
    if (tab === "transfers" || tab === "activity") setOrders(listSessions().filter((s) => s.spec.moduleId === "remit"));
  }, [tab]);
  useEffect(() => () => { timers.current.forEach((id) => window.clearTimeout(id)); }, []);
  useEffect(() => {
    if (!auto || step !== 7) return;
    if (shown >= milestones().length) { setAuto(false); return; }
    const id = window.setTimeout(() => setShown((s) => s + 1), 1200);
    timers.current.push(id);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, shown, step]);

  const push = (): RunResult => {
    const r = remitResult(flowRef.current!);
    onLive(r);
    return r;
  };
  const persistRecipients = (rs: Recipient[]) => {
    setRecipients(rs);
    store(RECIP_KEY, rs);
  };

  // ---------- quote math (send-amount and receive-amount modes) ----------
  interface Calc {
    srcMinor: number;
    quote: RemitQuote | null;
    error: string | null;
  }
  const calc = (cid: string, amtMajor: string, m: Mode, pid: string, del: Payout, fund: FundingId, asBudget: boolean): Calc => {
    const c = CORRIDORS.find((x) => x.id === cid);
    if (!c) return { srcMinor: 0, quote: null, error: "corridor" };
    try {
      if (m === "send") {
        const typed = major(amtMajor);
        if (!(typed > 0)) return { srcMinor: 0, quote: null, error: "amount" };
        if (!asBudget) return { srcMinor: typed, quote: remitQuote(cid, typed, pid, del, fund), error: null };
        // budget mode: principal + fees must fit the typed total
        let principal = typed;
        for (let i = 0; i < 3; i++) {
          const q0 = remitQuote(cid, principal, pid, del, fund);
          principal = Math.max(1, typed - q0.feeMinor);
        }
        return { srcMinor: principal, quote: remitQuote(cid, principal, pid, del, fund), error: null };
      }
      const want = major(amtMajor);
      if (!(want > 0)) return { srcMinor: 0, quote: null, error: "amount" };
      const { srcMinor, quote } = remitQuoteForReceive(cid, want, pid, del, fund);
      return { srcMinor, quote, error: null };
    } catch {
      return { srcMinor: 0, quote: null, error: "quote" };
    }
  };
  const live = calc(corridor, amount, mode, provider, deliver, funding, budgetIsTotal);
  const flow = flowRef.current;
  const quote = flow?.quote ?? null;

  // ---------- wizard actions ----------
  const confirmQuote = () => {
    if (!live.quote) return;
    const amt = live.srcMinor;
    const base = createRunBase("remit", { seed, params: { ...params, currency: cor.src }, failures });
    const f = createRemitFlow(base);
    flowRef.current = f;
    savedRef.current = false;
    try {
      const recip = recipients.find((r) => r.id === recipientId);
      remitAdvance(f, {
        type: "quote", corridor, amountSrcMinor: amt, provider, deliver, funding,
        ...(recip ? { recipient: recip.name } : {})
      });
      push();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return;
    }
    setErr(null);
    setQuoteAt(Date.now());
    setShown(0);
    setAuto(false);
    setStep(7);
  };

  const confirmSend = () => {
    const f = flowRef.current;
    if (!f || busy) return;
    if (Date.now() - quoteAt > QUOTE_VALID_MS) {
      setErr(t(locale, "rx.expired"));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      remitAdvance(f, { type: "send" });
      push();
    } catch (e) {
      setBusy(false);
      setErr(e instanceof Error ? e.message : String(e));
      return;
    }
    setBusy(false);
    const r = remitResult(f);
    if (!savedRef.current && (f.stage === "done" || f.stage === "terminal")) {
      savedRef.current = true;
      saveSession({
        moduleId: "remit", seed,
        params: {
          ...params, currency: cor.src, corridor, amountSrcMinor: f.ctx.amountMinor,
          provider, deliver, funding, recipientId, mode, totalSrc: f.quote?.totalSrcMinor
        },
        failures
      }, r);
      setOrders(listSessions().filter((s) => s.spec.moduleId === "remit"));
    }
    setShown(1);
  };

  const retryTransfer = (o: StoredSession) => {
    const p = o.spec.params as Record<string, unknown>;
    if (typeof p.corridor === "string") setCorridor(p.corridor);
    if (typeof p.amountSrcMinor === "number") setAmount(String((p.amountSrcMinor as number) / 100));
    if (typeof p.provider === "string") setProvider(p.provider);
    if (p.deliver === "bank" || p.deliver === "wallet" || p.deliver === "cash") setDeliver(p.deliver);
    if (p.funding === "bank" || p.funding === "card" || p.funding === "balance") setFunding(p.funding);
    if (typeof p.recipientId === "string") setRecipientId(p.recipientId);
    flowRef.current = null;
    savedRef.current = false;
    setStep(6);
    setTab("send");
  };

  // ---------- tracker milestones ----------
  interface Mile {
    key: string;
    reached: boolean;
    detail: string;
  }
  const milestones = (): Mile[] => {
    if (!flow) return [];
    const evs = flow.ctx.events;
    const has = (...ts: string[]) => evs.some((e) => ts.includes(e.type));
    const q = flow.quote;
    const hops = evs.filter((e) => e.type === "CORRIDOR_HOP").length;
    const delayed = has("TRANSFER_DELAYED");
    return [
      { key: "rx.m.submitted", reached: true, detail: `${t(locale, "rx.m.party")}: ${t(locale, "rx.m.you")}` },
      { key: "rx.m.screening", reached: has("COMPLIANCE_PASSED", "COMPLIANCE_HOLD"), detail: has("COMPLIANCE_HOLD") ? t(locale, "rx.m.held") : t(locale, "rx.m.passed") },
      { key: "rx.m.funding", reached: has("DEBITED", "FUNDING_DECLINED"), detail: q ? `${formatMoney(q.totalSrcMinor, cor.src, locale)} · ${t(locale, `rx.fund.${q.funding}`)}` : "" },
      { key: "rx.m.conversion", reached: has("FX_QUOTED"), detail: q ? `1 ${cor.src} ≈ ${(cor.mid * (1 - q.spreadBps / 10_000)).toFixed(4)} ${cor.dst}` : "" },
      { key: "rx.m.transit", reached: hops > 0 || delayed || has("DELIVERED"), detail: q && q.hops > 0 ? `${hops}/${q.hops} · ${t(locale, "rx.m.hops")}` : delayed ? t(locale, "rx.m.delayed") : t(locale, "rx.m.direct") },
      { key: "rx.m.partner", reached: has("DELIVERED"), detail: q ? t(locale, `rx.del.${q.deliver}`) : "" },
      { key: "rx.m.delivered", reached: has("DELIVERED"), detail: q ? `${formatMoney(q.receiveMinor, q.receiveCcy, locale)}${q.recipient ? ` → ${q.recipient}` : ""}` : "" }
    ];
  };
  const miles = milestones();
  const terminalFailed = flow?.stage === "terminal";

  // ---------- recipient side ----------
  const creditRecipient = (txId: string, ref: string, amountMinor: number, ccy: string) => {
    if (collected.includes(txId)) return;
    const next = { ...rbal, [ref]: (rbal[ref] ?? 0) + amountMinor };
    void ccy;
    setRbal(next);
    store(RBAL_KEY, next);
    const c = [...collected, txId];
    setCollected(c);
    store(RCOLL_KEY, c);
  };

  const statusOf = (o: StoredSession): "delivered" | "held" | "failed" | "processing" => {
    if (o.result.finalState === "SETTLED") return "delivered";
    if (o.result.events.some((e) => e.type === "COMPLIANCE_HOLD")) return "held";
    return "failed";
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {(["send", "rates", "recipients", "transfers", "activity"] as const).map((x) => (
          <button key={x} onClick={() => setTab(x)} className={`rounded-lg px-3 py-1 text-sm ${tab === x ? "bg-zinc-900 font-bold text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}>
            {t(locale, `rx.tab.${x}`)}
          </button>
        ))}
      </div>

      {tab === "send" && (
        <div className="space-y-2">
          {/* steps 0-1: corridor + amount */}
          {step <= 1 && (
            <Card className="space-y-2 p-3">
              <StepHead title={t(locale, step === 0 ? "rx.corT" : "rx.amtT")} sub={t(locale, step === 0 ? "rx.corB" : "rx.amtB")} />
              {step === 0 && (
                <>
                  <div className="grid gap-1.5">
                    {CORRIDORS.map((c) => (
                      <button key={c.id} onClick={() => {
                        setCorridor(c.id);
                        setProvider("fintech");
                        setDeliver(c.payouts.includes("wallet") ? "wallet" : c.payouts[0]);
                        setFunding(c.funding.includes("balance") ? "balance" : c.funding[0]);
                      }} className={`rounded-xl border p-2.5 text-left ${corridor === c.id ? "border-sky-500 bg-sky-50 dark:bg-sky-950" : "border-zinc-200 dark:border-zinc-800"}`}>
                        <div className="text-sm font-bold">{c.from} → {c.to}</div>
                        <div className="font-mono text-[12px] text-zinc-500">{c.src} → {c.dst} · ≈{c.mid}</div>
                        <div className="text-[12px] text-zinc-500">{c.note}</div>
                      </button>
                    ))}
                  </div>
                  <Btn small onClick={() => setStep(1)}>{t(locale, "cr.s.next")}</Btn>
                </>
              )}
              {step === 1 && (
                <>
                  <div className="flex overflow-hidden rounded-lg border border-zinc-300 text-[13px] dark:border-zinc-700" role="group" aria-label="mode">
                    {(["send", "receive"] as const).map((m) => (
                      <button key={m} onClick={() => setMode(m)} className={`flex-1 px-2 py-1.5 ${mode === m ? "bg-zinc-900 font-bold text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500"}`}>
                        {t(locale, `rx.mode.${m}`)}
                      </button>
                    ))}
                  </div>
                  <label className="block text-[13px]"><span className="mb-1 block font-medium">
                    {mode === "send" ? `${t(locale, "rx.youSend")} (${cor.src})` : `${t(locale, "rx.theyGet")} (${cor.dst})`}</span>
                    <input dir="ltr" inputMode="decimal" className={`${inpCls} font-mono`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder={mode === "send" ? "500.00" : "72500.00"} autoComplete="off" /></label>
                  {mode === "send" && (
                    <label className="flex items-center gap-2 text-[13px]">
                      <input type="checkbox" checked={budgetIsTotal} onChange={(e) => setBudgetIsTotal(e.target.checked)} />
                      {t(locale, "rx.budget")}
                    </label>
                  )}
                  {live.error && <div className="text-[13px] text-zinc-500">{t(locale, "rx.amtHint")}</div>}
                  <div className="flex gap-1.5">
                    <Btn small variant="outline" onClick={() => setStep(0)}>{t(locale, "wsh.back")}</Btn>
                    <Btn small onClick={() => live.quote && setStep(2)} disabled={!live.quote}>{t(locale, "rx.toProviders")}</Btn>
                  </div>
                </>
              )}
            </Card>
          )}

          {/* steps 2-3: provider + recipient */}
          {step === 2 && (
            <Card className="space-y-1.5 p-3">
              <StepHead title={t(locale, "rx.provT")} sub={t(locale, "rx.provB")} />
              {REMIT_PROVIDERS.map((p) => {
                let pv = null;
                try {
                  pv = mode === "send"
                    ? remitQuote(corridor, live.srcMinor || major(amount) || 0, p.id, deliver, funding)
                    : null;
                } catch { pv = null; }
                void pv;
                const row = (() => {
                  try {
                    if (mode !== "send" || !(major(amount) > 0)) {
                      if (mode !== "receive" || !(major(amount) > 0)) return null;
                      return remitQuoteForReceive(corridor, major(amount), p.id, deliver, funding).quote;
                    }
                    const base = budgetIsTotal
                      ? (() => { let s = major(amount); for (let i = 0; i < 3; i++) s = Math.max(1, major(amount) - remitQuote(corridor, s, p.id, deliver, funding).feeMinor); return s; })()
                      : major(amount);
                    return remitQuote(corridor, base, p.id, deliver, funding);
                  } catch {
                    return null;
                  }
                })();
                return (
                  <button key={p.id} onClick={() => setProvider(p.id)} className={`w-full rounded-xl border p-2.5 text-left ${provider === p.id ? "border-sky-500 bg-sky-50 dark:bg-sky-950" : "border-zinc-200 dark:border-zinc-800"}`}>
                    <div className="flex justify-between text-sm font-bold">
                      <span>{t(locale, `rm.prov.${p.id}`)}</span>
                      <span className="font-mono">{row ? `${row.totalCostPct.toFixed(2)}%` : "—"}</span>
                    </div>
                    <div className="mt-0.5 flex justify-between font-mono text-[12px] text-zinc-500">
                      <span>{t(locale, "rm.eta")}: {p.etaLabel}</span>
                      <span>{row ? formatMoney(row.receiveMinor, row.receiveCcy, locale) : ""}</span>
                    </div>
                  </button>
                );
              })}
              <div className="flex gap-1.5">
                <Btn small variant="outline" onClick={() => setStep(1)}>{t(locale, "wsh.back")}</Btn>
                <Btn small onClick={() => setStep(3)}>{t(locale, "rx.toRecipient")}</Btn>
              </div>
            </Card>
          )}
          {step === 3 && (
            <Card className="space-y-2 p-3">
              <StepHead title={t(locale, "rx.recipT")} sub={t(locale, "rx.recipB")} />
              {recipients.length === 0 && <EmptyNote>{t(locale, "rx.noRecip")}</EmptyNote>}
              <div className="grid gap-1.5">
                {recipients.filter((r) => r.country === cor.to).map((r) => (
                  <button key={r.id} onClick={() => setRecipientId(r.id)} className={`rounded-xl border p-2.5 text-left ${recipientId === r.id ? "border-sky-500 bg-sky-50 dark:bg-sky-950" : "border-zinc-200 dark:border-zinc-800"}`}>
                    <div className="text-sm font-bold">{r.name}</div>
                    <div className="font-mono text-[12px] text-zinc-500">{t(locale, `rx.del.${r.payout}`)} · {r.country}</div>
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <Btn small variant="outline" onClick={() => setStep(2)}>{t(locale, "wsh.back")}</Btn>
                <Btn small variant="outline" onClick={() => setTab("recipients")}>{t(locale, "rx.manageRecip")}</Btn>
                <Btn small onClick={() => recipientId && setStep(4)} disabled={!recipientId}>{t(locale, "rx.toPayout")}</Btn>
              </div>
            </Card>
          )}

          {/* steps 4-5: payout + funding */}
          {step === 4 && (
            <Card className="space-y-2 p-3">
              <StepHead title={t(locale, "rx.payoutT")} sub={t(locale, "rx.payoutB")} />
              <div className="grid gap-1.5">
                {cor.payouts.map((d) => (
                  <button key={d} onClick={() => setDeliver(d)} className={`rounded-xl border p-2.5 text-left ${deliver === d ? "border-sky-500 bg-sky-50 dark:bg-sky-950" : "border-zinc-200 dark:border-zinc-800"}`}>
                    <div className="text-sm font-bold">{t(locale, `rx.del.${d}`)}</div>
                    <div className="text-[12px] text-zinc-500">{t(locale, `rx.del.${d}.d`)}</div>
                  </button>
                ))}
              </div>
              <PayoutPreview />
              <div className="flex gap-1.5">
                <Btn small variant="outline" onClick={() => setStep(3)}>{t(locale, "wsh.back")}</Btn>
                <Btn small onClick={() => setStep(5)}>{t(locale, "rx.toFunding")}</Btn>
              </div>
            </Card>
          )}
          {step === 5 && (
            <Card className="space-y-2 p-3">
              <StepHead title={t(locale, "rx.fundT")} sub={t(locale, "rx.fundB")} />
              <div className="grid gap-1.5">
                {cor.funding.map((f) => (
                  <button key={f} onClick={() => setFunding(f)} className={`rounded-xl border p-2.5 text-left ${funding === f ? "border-sky-500 bg-sky-50 dark:bg-sky-950" : "border-zinc-200 dark:border-zinc-800"}`}>
                    <div className="text-sm font-bold">{t(locale, `rx.fund.${f}`)}</div>
                    <div className="text-[12px] text-zinc-500">{t(locale, `rx.fund.${f}.d`)}</div>
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <Btn small variant="outline" onClick={() => setStep(4)}>{t(locale, "wsh.back")}</Btn>
                <Btn small onClick={() => { confirmQuote(); }}>{t(locale, "rx.toReview")}</Btn>
              </div>
            </Card>
          )}

          {/* step 6: review */}
          {step === 6 && flow && quote && (
            <div className="space-y-2">
              <Card className="space-y-1 p-3 text-sm">
                <div className="font-bold">{t(locale, "rx.reviewT")}</div>
                <ReviewRow k={t(locale, "rx.review.from")} v={`${cor.from} (${cor.src})`} />
                <ReviewRow k={t(locale, "rx.review.to")} v={`${recipient()?.name ?? "?"} · ${cor.to} (${cor.dst})`} />
                <ReviewRow k={t(locale, "rx.review.sent")} v={formatMoney(quote.totalSrcMinor - quote.feeMinor, cor.src, locale)} />
                <ReviewRow k={t(locale, "rm.fee")} v={formatMoney(quote.feeMinor, cor.src, locale)} />
                <ReviewRow k={t(locale, "rx.review.rate")} v={`1 ${cor.src} ≈ ${quote ? (cor.mid * (1 - quote.spreadBps / 10_000)).toFixed(4) : ""} ${cor.dst}`} />
                <ReviewRow k={t(locale, "rx.review.total")} v={formatMoney(quote.totalSrcMinor, cor.src, locale)} big />
                <ReviewRow k={t(locale, "rx.review.get")} v={formatMoney(quote.receiveMinor, quote.receiveCcy, locale)} big />
                <ReviewRow k={t(locale, "rx.review.via")} v={`${t(locale, `rm.prov.${quote.provider}`)} · ${t(locale, `rx.del.${quote.deliver}`)}`} />
                <ReviewRow k={t(locale, "rx.review.fund")} v={t(locale, `rx.fund.${quote.funding}`)} />
                <ReviewRow k={t(locale, "rm.eta")} v={quote.etaLabel} />
                <div className="text-[12px] text-zinc-500">{t(locale, "rx.quoteValid")}: {Math.max(0, Math.round((QUOTE_VALID_MS - (Date.now() - quoteAt)) / 1000))}s</div>
              </Card>
              {err && <div className="rounded-lg bg-red-50 p-2 text-[13px] text-red-800 dark:bg-red-950 dark:text-red-200">{err}</div>}
              <div className="flex gap-1.5">
                <Btn small variant="outline" onClick={() => setStep(5)}>{t(locale, "wsh.back")}</Btn>
                <Btn small variant="outline" onClick={() => { flowRef.current = null; setStep(0); }}>{t(locale, "wba.cancel")}</Btn>
                <Btn small disabled={busy} onClick={confirmSend}>{t(locale, "rx.confirm")}</Btn>
              </div>
            </div>
          )}

          {/* step 7: tracker */}
          {step === 7 && flow && (
            <div className="space-y-2">
              <Card className="space-y-1.5 p-3">
                <div className="flex items-center justify-between">
                  <div className="font-bold">{t(locale, "rx.trackT")}</div>
                  <label className="flex items-center gap-1.5 text-[12px] text-zinc-500">
                    <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                    {t(locale, "rx.auto")}
                  </label>
                </div>
                <ol className="space-y-1.5">
                  {miles.slice(0, shown).map((m, i) => (
                    <li key={m.key} className="flex gap-2 text-[13px]">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">✓</span>
                      <div>
                        <div className="font-semibold">{t(locale, m.key)}</div>
                        <div className="text-zinc-500">{m.detail}</div>
                      </div>
                      <span className="ms-auto font-mono text-[11px] text-zinc-400">#{i + 1}</span>
                    </li>
                  ))}
                  {shown < miles.length && (
                    <li className="flex gap-2 text-[13px]">
                      <span className="h-5 w-5 animate-pulse rounded-full bg-sky-500" />
                      <div className="text-zinc-500">{t(locale, miles[shown].key)}…</div>
                    </li>
                  )}
                </ol>
                {terminalFailed ? (
                  <div className="rounded-lg bg-red-50 p-2 text-[13px] text-red-800 dark:bg-red-950 dark:text-red-200">
                    {t(locale, flow.ctx.events.some((e) => e.type === "COMPLIANCE_HOLD") ? "rm.heldB" : "rx.failedB")}
                  </div>
                ) : shown < miles.length ? (
                  <Btn small onClick={() => setShown((s) => Math.min(miles.length, s + 1))}>{t(locale, "rx.advance")}</Btn>
                ) : (
                  <ReceiptCard flow={flow} onNew={() => { flowRef.current = null; setStep(0); }} onDetail={() => setTab("transfers")} />
                )}
                {terminalFailed && (
                  <div className="flex gap-1.5">
                    <Btn small variant="outline" onClick={() => { flowRef.current = null; setStep(6); }}>{t(locale, "bx.retry")}</Btn>
                    <Btn small variant="outline" onClick={() => { flowRef.current = null; setStep(0); }}>{t(locale, "rm.newTransfer")}</Btn>
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>
      )}

      {tab === "rates" && (
        <div className="space-y-2">
          <Card className="space-y-2 p-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "rm.corridor")}</span>
                <select className={inpCls} value={rCorridor} onChange={(e) => setRCorridor(e.target.value)}>
                  {CORRIDORS.map((c) => <option key={c.id} value={c.id}>{c.from} → {c.to}</option>)}
                </select></label>
              <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "rx.rAmount")} ({rMode === "send" ? rCor.src : rCor.dst})</span>
                <input dir="ltr" inputMode="decimal" className={`${inpCls} font-mono`} value={rAmount} onChange={(e) => setRAmount(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="500.00" autoComplete="off" /></label>
              <div>
                <div className="mb-1 text-[13px] font-medium"> </div>
                <div className="flex overflow-hidden rounded-lg border border-zinc-300 text-[13px] dark:border-zinc-700" role="group" aria-label="mode">
                  {(["send", "receive"] as const).map((m) => (
                    <button key={m} onClick={() => setRMode(m)} className={`flex-1 px-2 py-1.5 ${rMode === m ? "bg-zinc-900 font-bold text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500"}`}>
                      {t(locale, `rx.mode.${m}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr className="text-left text-zinc-500">
                  <th className="py-1">{t(locale, "rm.provCol")}</th>
                  <th className="text-right">{t(locale, "rm.fee")}</th>
                  <th className="text-right">{t(locale, "rx.rate")}</th>
                  <th className="text-right">{t(locale, "rx.theyGet")}</th>
                  <th className="text-right">{t(locale, "rm.eta")}</th>
                </tr></thead>
                <tbody>
                  {REMIT_PROVIDERS.map((p) => {
                    const row = rateRow(rCor.id, p.id);
                    const best = bestRow()?.provider === p.id;
                    return (
                      <tr key={p.id} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-1 font-medium">{t(locale, `rm.prov.${p.id}`)}{best && row ? " ★" : ""}</td>
                        <td className="text-right font-mono">{row ? formatMoney(row.feeMinor, rCor.src, locale) : "—"}</td>
                        <td className="text-right font-mono">{row ? fmtRate(rCor.mid * (1 - row.spreadBps / 10_000)) : "—"}</td>
                        <td className="text-right font-mono font-bold">{row ? formatMoney(row.receiveMinor, row.receiveCcy, locale) : "—"}</td>
                        <td className="text-right">{row ? row.etaLabel : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <TrueCost />
          <Card className="space-y-2 p-3">
            <div className="font-semibold">{t(locale, "rx.sandboxT")}</div>
            <div className="text-[13px] text-zinc-500">{t(locale, "rx.sandboxB")}</div>
            <label className="block text-[13px]">{t(locale, "rx.sandboxFee")}: {sandbox.feeBps} bps
              <input type="range" min={0} max={300} value={sandbox.feeBps} onChange={(e) => setSandbox({ ...sandbox, feeBps: Number(e.target.value) })} className="w-full" /></label>
            <label className="block text-[13px]">{t(locale, "rx.sandboxSpread")}: {sandbox.spreadBps} bps
              <input type="range" min={0} max={400} value={sandbox.spreadBps} onChange={(e) => setSandbox({ ...sandbox, spreadBps: Number(e.target.value) })} className="w-full" /></label>
            <SandboxRow />
          </Card>
          {challengeBox()}
        </div>
      )}

      {tab === "recipients" && (
        <div className="space-y-2">
          <Card className="space-y-2 p-3">
            <StepHead title={t(locale, "rx.recipientsT")} sub={t(locale, "rx.recipientsB")} />
            {recipients.length === 0 && <EmptyNote>{t(locale, "rx.noRecip2")}</EmptyNote>}
            {recipients.map((r) => (
              <div key={r.id} className="flex items-center gap-2 rounded-lg bg-zinc-50 p-2 text-[13px] dark:bg-zinc-900">
                <div className="flex-1">
                  <div className="font-bold">{r.name}</div>
                  <div className="font-mono text-[12px] text-zinc-500">{r.country} · {t(locale, `rx.del.${r.payout}`)}</div>
                </div>
                <button className="text-[12px] underline opacity-70" onClick={() => {
                  setEditing(r.id);
                  setRf({ name: r.name, country: r.country, payout: r.payout, bank: r.bank ?? "", acct: r.acct ?? "", walletProvider: r.walletProvider ?? "", walletId: r.walletId ?? "", network: r.network ?? "", city: r.city ?? "", contact: r.contact ?? "" });
                  setRfErr(null);
                }}>{t(locale, "rx.edit")}</button>
                <button className="text-[12px] underline opacity-70" onClick={() => persistRecipients(recipients.filter((x) => x.id !== r.id))}>×</button>
              </div>
            ))}
          </Card>
          <RecipientForm />
        </div>
      )}

      {tab === "transfers" && (
        <div className="space-y-2">
          <div className="flex gap-1.5">
            {(["all", "delivered", "held", "failed"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`rounded-lg px-2.5 py-1 text-[13px] ${filter === f ? "bg-zinc-900 font-bold text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}>
                {t(locale, `rx.filter.${f}`)}
              </button>
            ))}
          </div>
          {filteredOrders().length === 0 && <EmptyNote>{t(locale, "co.orders.empty")}</EmptyNote>}
          {filteredOrders().map((o) => (
            <TransferRow key={o.id} order={o} />
          ))}
          {detail && <TransferDetail order={detail} onClose={() => setDetail(null)} />}
        </div>
      )}

      {tab === "activity" && (
        <div className="space-y-2">
          {orders.filter((o) => o.result.finalState === "SETTLED").length === 0 && <EmptyNote>{t(locale, "co.orders.empty")}</EmptyNote>}
          {orders.filter((o) => o.result.finalState === "SETTLED").map((o) => (
            <Card key={o.id} className="space-y-1 p-3 text-sm">
              <ActivityRow order={o} />
              <ReceiptMini order={o} />
            </Card>
          ))}
          <div><Btn small variant="outline" onClick={resetAll}>{t(locale, "rx.reset")}</Btn></div>
        </div>
      )}
    </div>
  );

  // ---------- helpers used above ----------
  function recipient() {
    return recipients.find((r) => r.id === recipientId) ?? null;
  }

  function PayoutPreview() {
    const r = recipients.find((x) => x.id === recipientId);
    if (!r) return null;
    return (
      <div className="rounded-xl bg-zinc-50 p-2.5 text-[13px] dark:bg-zinc-900">
        {r.payout === "bank" && <div>{r.bank} ····{(r.acct ?? "").slice(-4)}</div>}
        {r.payout === "wallet" && <div>{r.walletProvider} · {r.walletId}</div>}
        {r.payout === "cash" && <div>{r.network} · {r.city}</div>}
        <div className="mt-0.5 text-[12px] text-zinc-500">{t(locale, `rx.del.${r.payout}.d`)}</div>
      </div>
    );
  }

  function ReviewRow({ k, v, big }: { k: string; v: string; big?: boolean }) {
    return <div className={`flex justify-between gap-2 ${big ? "font-bold" : ""}`}><span className="text-zinc-500">{k}</span><span className="font-mono text-right">{v}</span></div>;
  }

  function rateRow(cid: string, pid: string) {
    try {
      if (!(major(rAmount) > 0)) return null;
      if (rMode === "send") return remitQuote(cid, major(rAmount), pid, "wallet", "balance");
      return remitQuoteForReceive(cid, major(rAmount), pid, "wallet", "balance").quote;
    } catch {
      return null;
    }
  }

  function bestRow() {
    const rows = REMIT_PROVIDERS.map((p) => rateRow(rCor.id, p.id)).filter((r): r is RemitQuote => r !== null);
    if (rows.length === 0) return null;
    return rows.reduce((a, b) => (a.receiveMinor > b.receiveMinor ? a : b));
  }

  function TrueCost() {
    const b = bestRow();
    const mid = rCor.mid;
    if (!b) return null;
    return (
      <Card className="space-y-1 p-3 text-sm">
        <div className="font-bold">{t(locale, "rx.trueT")}</div>
        <div className="text-[13px] text-zinc-500">{t(locale, "rx.trueB")}</div>
        <ReviewRow k={t(locale, "rm.fee")} v={formatMoney(b.feeMinor, rCor.src, locale)} />
        <ReviewRow k={t(locale, "rm.spread")} v={`${formatMoney(b.spreadMinor, rCor.src, locale)} (${b.spreadBps} bps vs ${mid})`} />
        <ReviewRow k={t(locale, "rx.review.total")} v={formatMoney(b.totalSrcMinor, rCor.src, locale)} big />
        <ReviewRow k={t(locale, "rx.theyGet")} v={formatMoney(b.receiveMinor, b.receiveCcy, locale)} big />
      </Card>
    );
  }

  function SandboxRow() {
    let display = null;
    try {
      display = major(rAmount) > 0
        ? remitQuote(rCor.id, major(rAmount), "fintech", "wallet", "balance", { feeBps: sandbox.feeBps, spreadBps: sandbox.spreadBps })
        : null;
    } catch { display = null; }
    return (
      <div className="rounded-xl bg-zinc-50 p-2.5 font-mono text-[13px] dark:bg-zinc-900">
        {display ? (
          <>
            <div className="flex justify-between"><span>fee</span><span>{formatMoney(display.feeMinor, rCor.src, locale)}</span></div>
            <div className="flex justify-between"><span>spread</span><span>{formatMoney(display.spreadMinor, rCor.src, locale)}</span></div>
            <div className="flex justify-between font-bold"><span>receive</span><span>{formatMoney(display.receiveMinor, display.receiveCcy, locale)}</span></div>
          </>
        ) : <span className="text-zinc-500">—</span>}
      </div>
    );
  }

  function challengeBox() {
    let best: RemitQuote | null = null;
    let ok = false;
    try {
      const rows = REMIT_PROVIDERS.map((p) => remitQuote("fr-dz", 50000, p.id, "wallet", "balance"));
      best = rows.reduce((a, b) => (a.totalCostPct < b.totalCostPct ? a : b));
      ok = rows.some((r) => r.totalCostPct < 2 && r.etaMs < 24 * 3_600_000);
    } catch { best = null; }
    if (!best) return null;
    return (
      <div className="rounded-lg bg-sky-50 p-2 text-[13px] dark:bg-sky-950">
        {t(locale, "rm.challenge")}: <b>{t(locale, `rm.prov.${best.provider}`)}</b> {best.totalCostPct.toFixed(2)}% · {ok ? t(locale, "rm.challengeOk") : t(locale, "rm.challengeFail")}
      </div>
    );
  }

  function RecipientForm() {
    return (
      <Card className="space-y-2 p-3">
        <div className="font-semibold">{editing ? t(locale, "rx.edit") : t(locale, "rx.addRecip")}</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "rx.rName")}</span>
            <input className={inpCls} value={rf.name} onChange={(e) => setRf({ ...rf, name: e.target.value })} autoComplete="off" /></label>
          <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "rx.rCountry")}</span>
            <input className={inpCls} value={rf.country || cor.to} onChange={(e) => setRf({ ...rf, country: e.target.value })} autoComplete="off" /></label>
        </div>
        <div>
          <div className="mb-1 text-[13px] font-medium">{t(locale, "rx.rPayout")}</div>
          <div className="flex gap-1.5">
            {(["bank", "wallet", "cash"] as const).map((d) => (
              <button key={d} onClick={() => setRf({ ...rf, payout: d })} className={`rounded-lg border px-2.5 py-1 text-[13px] ${rf.payout === d ? "border-sky-500 bg-sky-50 font-bold dark:bg-sky-950" : "border-zinc-300 dark:border-zinc-700"}`}>
                {t(locale, `rx.del.${d}`)}
              </button>
            ))}
          </div>
        </div>
        {rf.payout === "bank" && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "rx.rBank")}</span>
              <input className={inpCls} value={rf.bank} onChange={(e) => setRf({ ...rf, bank: e.target.value })} autoComplete="off" /></label>
            <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "rx.rAcct")}</span>
              <input dir="ltr" className={`${inpCls} font-mono`} value={rf.acct} onChange={(e) => setRf({ ...rf, acct: e.target.value.replace(/\D/g, "").slice(0, 20) })} autoComplete="off" /></label>
          </div>
        )}
        {rf.payout === "wallet" && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "rx.rProvider")}</span>
              <input className={inpCls} value={rf.walletProvider} onChange={(e) => setRf({ ...rf, walletProvider: e.target.value })} autoComplete="off" /></label>
            <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "rx.rWalletId")}</span>
              <input dir="ltr" className={`${inpCls} font-mono`} value={rf.walletId} onChange={(e) => setRf({ ...rf, walletId: e.target.value })} autoComplete="off" /></label>
          </div>
        )}
        {rf.payout === "cash" && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "rx.rNetwork")}</span>
              <input className={inpCls} value={rf.network} onChange={(e) => setRf({ ...rf, network: e.target.value })} autoComplete="off" /></label>
            <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "rx.rCity")}</span>
              <input className={inpCls} value={rf.city} onChange={(e) => setRf({ ...rf, city: e.target.value })} autoComplete="off" /></label>
          </div>
        )}
        <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "rx.rContact")} ({t(locale, "rx.optional")})</span>
          <input className={inpCls} value={rf.contact} onChange={(e) => setRf({ ...rf, contact: e.target.value })} autoComplete="off" /></label>
        {rfErr && <div className="text-[13px] text-red-700 dark:text-red-400">{rfErr}</div>}
        <div className="flex gap-1.5">
          {editing && <Btn small variant="outline" onClick={() => { setEditing(null); setRfErr(null); }}>{t(locale, "wsh.back")}</Btn>}
          <Btn small onClick={saveRecipient}>{editing ? t(locale, "rx.save") : t(locale, "rx.addRecip")}</Btn>
        </div>
      </Card>
    );
  }

  function saveRecipient() {
    const country = rf.country.trim() || cor.to;
    if (rf.name.trim().length < 2 || country.length < 2) { setRfErr(t(locale, "co.err.required")); return; }
    if (rf.payout === "bank" && (rf.bank.trim().length < 2 || rf.acct.replace(/\D/g, "").length < 6)) { setRfErr(t(locale, "rx.rBankBad")); return; }
    if (rf.payout === "wallet" && (rf.walletProvider.trim().length < 2 || rf.walletId.trim().length < 3)) { setRfErr(t(locale, "rx.rWalletBad")); return; }
    if (rf.payout === "cash" && (rf.network.trim().length < 2 || rf.city.trim().length < 2)) { setRfErr(t(locale, "rx.rCashBad")); return; }
    setRfErr(null);
    const entry: Recipient = {
      id: editing ?? `rcpt-${Date.now()}`,
      name: rf.name.trim(), country,
      payout: rf.payout,
      bank: rf.bank.trim() || undefined,
      acct: rf.acct.replace(/\D/g, "") || undefined,
      walletProvider: rf.walletProvider.trim() || undefined,
      walletId: rf.walletId.trim() || undefined,
      network: rf.network.trim() || undefined,
      city: rf.city.trim() || undefined,
      contact: rf.contact.trim() || undefined
    };
    persistRecipients(editing ? recipients.map((r) => (r.id === editing ? entry : r)) : [...recipients, entry]);
    setEditing(null);
    setRf({ name: "", country: "", payout: "bank", bank: "", acct: "", walletProvider: "", walletId: "", network: "", city: "", contact: "" });
  }

  function filteredOrders() {
    return orders.filter((o) => {
      if (filter === "all") return true;
      return statusOf(o) === filter;
    });
  }

  function TransferRow({ order: o }: { order: StoredSession }) {
    const st = statusOf(o);
    const p = o.spec.params as Record<string, unknown>;
    return (
      <div className="rounded-xl border border-zinc-200 p-2.5 text-[13px] dark:border-zinc-800">
        <button className="flex w-full items-center gap-2 text-left" onClick={() => setDetail(detail?.id === o.id ? null : o)}>
          <div className="flex-1">
            <div className="font-mono font-bold">{o.result.txId}</div>
            <div className="text-zinc-500"><Time at={o.at} /> · {typeof p.corridor === "string" ? p.corridor : ""} · {typeof p.provider === "string" ? t(locale, `rm.prov.${p.provider}`) : ""}</div>
          </div>
          <Badge tone={st === "delivered" ? "green" : st === "held" ? "amber" : st === "failed" ? "red" : "blue"}>{t(locale, `rx.status.${st}`)}</Badge>
          <span className="text-zinc-400">{detail?.id === o.id ? "▾" : "▸"}</span>
        </button>
      </div>
    );
  }

  function TransferDetail({ order: o, onClose }: { order: StoredSession; onClose: () => void }) {
    const p = o.spec.params as Record<string, unknown>;
    const q = o.result.events.find((e) => e.type === "QUOTE_MADE")?.payload as Record<string, unknown> | undefined;
    const d = o.result.events.find((e) => e.type === "DELIVERED")?.payload as Record<string, unknown> | undefined;
    return (
      <div className="space-y-1.5 rounded-xl border border-zinc-200 p-3 text-[13px] dark:border-zinc-800">
        <div className="font-bold">{t(locale, "rx.detailT")} · <span className="font-mono">{o.result.txId}</span></div>
        <ReviewRow k={t(locale, "rx.review.from")} v={`${String(p.corridor ?? "").split("-")[0].toUpperCase()} (${o.result.receipt.currency})`} />
        <ReviewRow k={t(locale, "rx.review.to")} v={`${typeof q?.receiveCcy === "string" ? q.receiveCcy : ""}${q?.recipient ? ` · ${q.recipient}` : ""}`} />
        <ReviewRow k={t(locale, "rx.review.sent")} v={typeof q?.totalSrcMinor === "number" ? formatMoney(q.totalSrcMinor - (typeof q?.feeMinor === "number" ? q.feeMinor : 0), o.result.receipt.currency, locale) : "—"} />
        <ReviewRow k={t(locale, "rm.fee")} v={typeof q?.feeMinor === "number" ? formatMoney(q.feeMinor, o.result.receipt.currency, locale) : "—"} />
        <ReviewRow k={t(locale, "rx.review.total")} v={typeof q?.totalSrcMinor === "number" ? formatMoney(q.totalSrcMinor, o.result.receipt.currency, locale) : "—"} big />
        <ReviewRow k={t(locale, "rx.review.get")} v={typeof q?.receiveMinor === "number" && typeof q?.receiveCcy === "string" ? formatMoney(q.receiveMinor, q.receiveCcy, locale) : "—"} big />
        <ReviewRow k={t(locale, "rx.review.fund")} v={typeof q?.funding === "string" ? t(locale, `rx.fund.${q.funding}`) : "—"} />
        <ReviewRow k={t(locale, "rx.review.via")} v={`${typeof p.provider === "string" ? t(locale, `rm.prov.${p.provider}`) : ""} · ${typeof q?.deliver === "string" ? t(locale, `rx.del.${q.deliver}`) : ""}`} />
        <div className="text-[12px] text-zinc-500">{t(locale, "rx.lifecycle")}:</div>
        <div className="max-h-36 space-y-0.5 overflow-auto font-mono text-[11px] text-zinc-500">
          {o.result.events.map((e) => <div key={e.id}>{e.type} · +{formatT(e.t)}</div>)}
        </div>
        {d && typeof d.receiveMinor === "number" && typeof d.receiveCcy === "string" && (
          <RecipientPanel refKey={o.result.txId} method={String((d as Record<string, unknown>).method ?? q?.deliver ?? "bank")} amountMinor={d.receiveMinor} ccy={d.receiveCcy} />
        )}
        <div className="flex gap-1.5">
          <Btn small variant="outline" onClick={onClose}>{t(locale, "pv.close")}</Btn>
          <Btn small variant="outline" onClick={() => { retryTransfer(o); setDetail(null); }}>{t(locale, "bx.retry")}</Btn>
        </div>
      </div>
    );
  }

  function RecipientPanel({ refKey, method, amountMinor, ccy }: { refKey: string; method: string; amountMinor: number; ccy: string }) {
    const credited = collected.includes(refKey);
    useEffect(() => {
      if (!credited && method === "wallet") {
        const next = { ...rbal, [refKey]: amountMinor };
        setRbal(next);
        store(RBAL_KEY, next);
        const c = [...collected, refKey];
        setCollected(c);
        store(RCOLL_KEY, c);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refKey]);
    if (method === "bank") {
      return <div className="rounded-lg bg-emerald-50 p-2 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{t(locale, "rx.rcpt.bank")} {formatMoney(amountMinor, ccy, locale)}</div>;
    }
    if (method === "cash") {
      const done = collected.includes(`${refKey}:cash`);
      return (
        <div className="space-y-1.5 rounded-lg bg-amber-50 p-2 dark:bg-amber-950">
          <div className="text-[13px] text-amber-800 dark:text-amber-200">{done ? t(locale, "rx.rcpt.collected") : t(locale, "rx.rcpt.ready")}</div>
          {!done && (
            <Btn small variant="outline" onClick={() => {
              const c = [...collected, `${refKey}:cash`];
              setCollected(c);
              store(RCOLL_KEY, c);
            }}>{t(locale, "rx.rcpt.collect")}</Btn>
          )}
        </div>
      );
    }
    return (
      <div className="rounded-lg bg-emerald-50 p-2 text-[13px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
        {t(locale, "rx.rcpt.wallet")} {formatMoney(credited ? amountMinor : 0, ccy, locale)}
      </div>
    );
  }

  function ReceiptCard({ flow, onNew, onDetail }: { flow: RemitFlow; onNew: () => void; onDetail: () => void }) {
    const r = remitResult(flow);
    const q = flow.quote!;
    return (
      <Card className="space-y-1 p-3 text-sm">
        <div className="font-semibold text-emerald-700 dark:text-emerald-300">✓ {t(locale, "rm.delivered")}</div>
        <div className="font-mono text-xl font-bold">{formatMoney(q.receiveMinor, q.receiveCcy, locale)}</div>
        <div className="space-y-0.5 rounded-xl bg-zinc-50 p-2.5 font-mono text-[12px] dark:bg-zinc-900">
          <div className="flex justify-between"><span>ref</span><span>{r.txId}</span></div>
          <div className="flex justify-between"><span>{t(locale, "rx.review.total")}</span><span>{formatMoney(q.totalSrcMinor, flow.ctx.currency, locale)}</span></div>
          <div className="flex justify-between"><span>{t(locale, "rm.eta")}</span><span>{q.etaLabel}</span></div>
        </div>
        <div className="flex gap-1.5">
          <Btn small variant="outline" onClick={onNew}>{t(locale, "rm.newTransfer")}</Btn>
          <Btn small variant="outline" onClick={onDetail}>{t(locale, "rx.detailT")}</Btn>
        </div>
      </Card>
    );
  }

  function ActivityRow({ order: o }: { order: StoredSession }) {
    const q = o.result.events.find((e) => e.type === "QUOTE_MADE")?.payload as Record<string, unknown> | undefined;
    return (
      <>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <div className="font-mono font-bold">{typeof q?.receiveMinor === "number" && typeof q?.receiveCcy === "string" ? formatMoney(q.receiveMinor, q.receiveCcy, locale) : o.result.txId}</div>
            <div className="text-zinc-500"><Time at={o.at} /> · {typeof q?.corridor === "string" ? q.corridor : ""} · {typeof q?.provider === "string" ? t(locale, `rm.prov.${q.provider}`) : ""}</div>
          </div>
          <Badge tone="green">{t(locale, "rx.status.delivered")}</Badge>
        </div>
        <ReceiptMini order={o} />
      </>
    );
  }

  function ReceiptMini({ order: o }: { order: StoredSession }) {
    const q = o.result.events.find((e) => e.type === "QUOTE_MADE")?.payload as Record<string, unknown> | undefined;
    if (!q) return null;
    return (
      <div className="space-y-0.5 rounded-xl bg-zinc-50 p-2 font-mono text-[12px] dark:bg-zinc-900">
        <div className="flex justify-between"><span>ref</span><span>{o.result.txId}</span></div>
        {typeof q.feeMinor === "number" && <div className="flex justify-between"><span>{t(locale, "rm.fee")}</span><span>{formatMoney(q.feeMinor, o.result.receipt.currency, locale)}</span></div>}
        {typeof q.spreadMinor === "number" && <div className="flex justify-between"><span>{t(locale, "rm.spread")}</span><span>{formatMoney(q.spreadMinor, o.result.receipt.currency, locale)}</span></div>}
        {typeof q.totalSrcMinor === "number" && <div className="flex justify-between font-bold"><span>{t(locale, "rx.review.total")}</span><span>{formatMoney(q.totalSrcMinor, o.result.receipt.currency, locale)}</span></div>}
        {typeof q.receiveMinor === "number" && typeof q.receiveCcy === "string" && <div className="flex justify-between font-bold"><span>{t(locale, "rx.review.get")}</span><span>{formatMoney(q.receiveMinor, q.receiveCcy, locale)}</span></div>}
      </div>
    );
  }

  function resetAll() {
    flowRef.current = null;
    savedRef.current = false;
    try {
      const all = listSessions().filter((s) => s.spec.moduleId !== "remit");
      localStorage.setItem("simpay.sessions.v1", JSON.stringify(all));
    } catch { /* noop */ }
    setOrders([]);
    setRbal({});
    store(RBAL_KEY, {});
    setCollected([]);
    store(RCOLL_KEY, []);
    setStep(0);
    setShown(0);
    setAuto(false);
    setTab("send");
  }
}
