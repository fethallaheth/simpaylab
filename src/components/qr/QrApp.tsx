/**
 * QR two-phone playground. One shared staged session drives two synchronized
 * device mockups: the merchant till (requests, codes, soundbox) and the
 * customer wallet (scanner, review, PIN, receipt). Scenario A (merchant
 * presents, default) and B (customer presents) use genuinely different flows.
 */
"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import QRCode from "react-qr-code";
import {
  createQrFlow,
  createRunBase,
  qrAdvance,
  qrResult,
  type FailureId,
  type QrFlow,
  type RunResult
} from "@sim/engine";
import { t } from "@/i18n/dict";
import { formatMoney, listSessions, saveSession, type StoredSession } from "@/lib/sim";
import { usePrefs } from "../providers";
import { Badge, Btn, Card } from "../ui";
import { OtpBoxes, Time, inpCls, useSpecReset } from "../flows/kit";

type Scenario = "A" | "B";
const CCY = "EUR";

function major(v: string): number {
  return Math.round(Number(v.replace(",", ".")) * 100);
}

function parsePayload(p: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const seg of p.split("|")) {
    const i = seg.indexOf("=");
    if (i > 0) out[seg.slice(0, i)] = seg.slice(i + 1);
  }
  return out;
}

function Device({ tone, title, sub, children }: {
  tone: "merchant" | "customer";
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  const head = tone === "merchant" ? "bg-amber-700" : "bg-sky-700";
  return (
    <div className="mx-auto w-full max-w-[360px]">
      <div className="rounded-[1.8rem] border border-zinc-300 bg-zinc-900 p-2 shadow-xl dark:border-zinc-700 dark:bg-black">
        <div className="flex items-center justify-between px-3 pt-1 text-[11px] text-zinc-300">
          <span className="font-mono"><Time timeOnly /></span>
          <span className="flex gap-1" aria-hidden>
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
          </span>
        </div>
        <div className={`${head} mt-1 rounded-t-[1.3rem] px-3 py-2 text-white`}>
          <div className="text-sm font-bold">{title}</div>
          {sub && <div className="text-[11px] opacity-80">{sub}</div>}
        </div>
        <div className="min-h-[300px] rounded-b-[1.3rem] bg-white p-3 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
          {children}
        </div>
        <div className="mx-auto my-1.5 h-1 w-24 rounded-full bg-zinc-700" />
      </div>
    </div>
  );
}

function QrBox({ value }: { value: string }) {
  return (
    <div className="mx-auto w-fit bg-white p-2 ring-1 ring-zinc-200">
      <QRCode value={value} size={140} />
    </div>
  );
}

function Scanner({ onScan, onCancel, scanning, label }: {
  onScan: () => void;
  onCancel: () => void;
  scanning: boolean;
  label: string;
}) {
  const { locale } = usePrefs();
  return (
    <div className="space-y-2 text-center">
      <div className="relative mx-auto h-40 w-40 overflow-hidden rounded-xl border-2 border-dashed border-zinc-400">
        <div className={`absolute inset-x-2 h-0.5 bg-sky-500 ${scanning ? "animate-pulse" : ""}`} style={{ top: scanning ? undefined : "50%", animation: scanning ? "qscan 1.1s linear infinite" : undefined }} />
        <style>{`@keyframes qscan { 0% { top: 8%; } 50% { top: 88%; } 100% { top: 8%; } }`}</style>
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-zinc-400">{label}</div>
      </div>
      {scanning ? (
        <div className="text-[13px] text-zinc-500">{t(locale, "qpg.scanning")}</div>
      ) : (
        <div className="flex gap-1.5">
          <Btn small variant="outline" onClick={onCancel}>{t(locale, "wsh.cancel")}</Btn>
          <Btn small onClick={onScan}>{t(locale, "qpg.scanBtn")}</Btn>
        </div>
      )}
    </div>
  );
}

export function QrApp({ seed, params, failures, onLive }: {
  seed: number;
  params: Record<string, unknown>;
  failures: FailureId[];
  onLive: (r: RunResult) => void;
}) {
  const { locale } = usePrefs();
  const [scenario, setScenario] = useState<Scenario>("A");
  const [desc, setDesc] = useState("");
  const [mMode, setMMode] = useState<"static" | "dynamic">("dynamic");
  const [mAmount, setMAmount] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [source, setSource] = useState<"balance" | "card">("balance");
  const [tillExpected, setTillExpected] = useState("");
  const [mView, setMView] = useState<"form" | "code">("form");
  const [cView, setCView] = useState<"idle" | "scanner" | "details" | "pin" | "processing" | "receipt">("idle");
  const [scanning, setScanning] = useState(false);
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [orders, setOrders] = useState<StoredSession[]>([]);

  const flowRef = useRef<QrFlow | null>(null);
  const savedRef = useRef(false);
  const timers = useRef<number[]>([]);

  useSpecReset(JSON.stringify({ seed, params, failures, scenario }), () => {
    flowRef.current = null;
    savedRef.current = false;
    setMView("form");
    setCView("idle");
    setNotice(null);
    setScanning(false);
  });
  useEffect(() => () => { timers.current.forEach((id) => window.clearTimeout(id)); }, []);
  const refreshOrders = () => setOrders(listSessions().filter((s) => s.spec.moduleId === "qr"));

  const push = (): RunResult => {
    const r = qrResult(flowRef.current!);
    onLive(r);
    return r;
  };
  const maybeSave = () => {
    const flow = flowRef.current;
    if (!flow || savedRef.current) return;
    if (flow.stage !== "done" && flow.stage !== "terminal") return;
    savedRef.current = true;
    saveSession({
      moduleId: "qr", seed,
      params: { ...params, amountMinor: flow.ctx.amountMinor, currency: CCY, qrScenario: scenario, qrMode: flow.mode },
      failures
    }, qrResult(flow));
    refreshOrders();
  };

  const startBase = (amountMinor: number) => {
    const base = createRunBase("qr", { seed, params: { ...params, amountMinor, currency: CCY }, failures });
    const flow = createQrFlow(base);
    flowRef.current = flow;
    savedRef.current = false;
    return flow;
  };

  const resetTx = (keepForms = true) => {
    flowRef.current = null;
    savedRef.current = false;
    setMView("form");
    setCView("idle");
    setNotice(null);
    setScanning(false);
    setPinErr(null);
    if (!keepForms) {
      setMAmount(""); setPayAmount(""); setTillExpected(""); setDesc("");
    }
  };

  // ---------- Scenario A ----------
  const merchantCreate = () => {
    const amt = major(mAmount);
    if (mMode === "dynamic" && !(amt > 0)) return;
    const flow = startBase(mMode === "dynamic" ? amt : 4999);
    qrAdvance(flow, { type: "merchant_make", mode: mMode, amountMinor: mMode === "dynamic" ? amt : undefined });
    push();
    setMView("code");
    setCView("idle");
  };

  const customerScan = () => {
    const flow = flowRef.current;
    if (!flow || flow.stage !== "shown") return;
    setScanning(true);
    timers.current.push(window.setTimeout(() => {
      setScanning(false);
      try {
        qrAdvance(flow, {
          type: "customer_scan",
          amountMinor: flow.mode === "static" ? major(payAmount) : undefined,
          source
        });
        push();
      } catch {
        setNotice(t(locale, "qpg.scanNeedAmount"));
        return;
      }
      if (flow.stage === "pin") {
        setPin("");
        setPinErr(null);
      }
      setCView(flow.stage === "pin" ? "details" : "receipt");
    }, 1100));
  };

  // ---------- Scenario B ----------
  const customerShow = () => {
    const amt = major(tillExpected);
    if (!(amt > 0)) return;
    const flow = startBase(amt);
    qrAdvance(flow, { type: "wallet_show" });
    push();
    setMView("code");
  };

  const merchantScan = () => {
    const flow = flowRef.current;
    if (!flow || flow.stage !== "mscan") return;
    setScanning(true);
    timers.current.push(window.setTimeout(() => {
      setScanning(false);
      qrAdvance(flow, { type: "merchant_scan" });
      push();
      setCView(flow.stage === "pin" ? "details" : "receipt");
    }, 1100));
  };

  // ---------- shared tail ----------
  const confirmPay = () => {
    // details reviewed -> ask for PIN
    setPin("");
    setPinErr(null);
    setCView("pin");
  };

  const submitPin = () => {
    const flow = flowRef.current;
    if (!flow) return;
    qrAdvance(flow, { type: "submit_pin", pin: pin.trim() });
    push();
    if (flow.stage === "pin") {
      setPinErr(t(locale, "wa.pinWrong") + ` (${Math.max(0, 3 - flow.pinStrikes)} ${t(locale, "co.ch.attempts")})`);
      return;
    }
    setPinErr(null);
    setCView("processing");
    timers.current.push(window.setTimeout(() => {
      setCView("receipt");
      maybeSave();
    }, 900));
  };

  const cancelTx = () => {
    // abandoned before approval: nothing charged; the partial log stays visible
    flowRef.current = null;
    savedRef.current = false;
    setMView("form");
    setCView("idle");
    setScanning(false);
    setNotice(t(locale, "qpg.cancelled"));
  };

  // ---------- derived shared state ----------
  const flow = flowRef.current;
  const evs = flow?.ctx.events ?? [];
  const has = (...ts: string[]) => evs.some((e) => ts.includes(e.type));
  const codeEv = [...evs].reverse().find((e) => e.type === "QR_GENERATED" || e.type === "QR_SHOWN");
  const code = typeof codeEv?.payload.payload === "string" ? codeEv.payload.payload : null;
  const parsed = code ? parsePayload(code) : {};
  const failed = flow?.stage === "terminal";
  const done = flow?.stage === "done";
  const stepIdx = !has("QR_GENERATED", "QR_SHOWN") ? -1
    : !has("QR_SCANNED") ? 0
    : !has("QR_VALIDATED") ? 1
    : !has("PIN_CONFIRMED") ? 2
    : !has("SETTLED") ? 3 : 4;
  const steps = ["qpg.s0", "qpg.s1", "qpg.s2", "qpg.s3", "qpg.s4"];

  const declineOf = (): string | null => {
    const d = [...evs].reverse().find((e) => /DECLINED|WARNING|EXPIRED/.test(e.type));
    if (!d) return null;
    if (d.type === "QR_EXPIRED") return t(locale, "qr.expiredNote");
    if (d.type === "QR_TAMPER_WARNING") return t(locale, "qr.tamperNote");
    const r = String((d.payload as Record<string, unknown>).reason ?? "");
    if (r === "pin-locked") return t(locale, "wa.pinLocked");
    return t(locale, "co.decline.insufficient-funds");
  };

  const amountMinor = flow?.ctx.amountMinor ?? 0;
  const ref = parsed.ref ?? flow?.ctx.txId ?? "";
  const merchantId = parsed.m ? `till ${parsed.m}` : t(locale, "qpg.demoTill");

  return (
    <div className="space-y-3">
      {/* scenario selector */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[13px] font-semibold">{t(locale, "qpg.scenario")}:</span>
        {(["A", "B"] as const).map((s) => (
          <button key={s} onClick={() => { setScenario(s); resetTx(); }} className={`rounded-lg px-3 py-1 text-sm ${scenario === s ? "bg-zinc-900 font-bold text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}>
            {t(locale, `qpg.sc.${s}`)}
          </button>
        ))}
        <Btn small variant="outline" onClick={() => resetTx(false)}>{t(locale, "qpg.newTx")}</Btn>
      </div>
      <p className="max-w-2xl text-[13px] text-zinc-500">{t(locale, scenario === "A" ? "qpg.scAd" : "qpg.scBd")}</p>

      {/* shared status strip */}
      <Card className="p-3">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-500">{t(locale, "qpg.status")}</div>
        {stepIdx < 0 && !failed ? (
          <div className="text-[13px] text-zinc-500">{t(locale, "qpg.statusIdle")}</div>
        ) : (
          <ol className="flex items-start">
            {steps.map((s, i) => {
              const doneStep = failed ? i < stepIdx : i <= stepIdx;
              const now = !failed && i === stepIdx && stepIdx < 4;
              return (
                <li key={s} className="flex flex-1 items-start last:flex-none">
                  <div className="flex flex-col items-center gap-1">
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${doneStep ? "bg-emerald-600 text-white" : now ? "border-2 border-sky-500 text-sky-700 dark:text-sky-300" : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800"}`}>
                      {doneStep ? "✓" : i + 1}
                    </span>
                    <span className="text-center text-[10px] leading-tight">{t(locale, s)}</span>
                  </div>
                  {i < steps.length - 1 && <span className={`mx-1 mt-2 h-0.5 flex-1 ${doneStep ? "bg-emerald-400" : "bg-zinc-200 dark:bg-zinc-800"}`} />}
                </li>
              );
            })}
          </ol>
        )}
        {failed && <div className="mt-1 text-[13px] font-semibold text-red-700 dark:text-red-400">✕ {declineOf() ?? flow?.stage}</div>}
        {done && <div className="mt-1 text-[13px] font-semibold text-emerald-700 dark:text-emerald-300">✓ {t(locale, "qpg.completed")}</div>}
      </Card>

      {/* playground */}
      <div className="grid items-start gap-3 md:grid-cols-2">
        {/* merchant phone */}
        <Device tone="merchant" title={t(locale, "qpg.merchantT")} sub={t(locale, "qpg.merchantS")}>
          {scenario === "A" ? (
            mView === "form" || !flow ? (
              <div className="space-y-2">
                <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "qpg.desc")}</span>
                  <input className={inpCls} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t(locale, "qpg.descPh")} autoComplete="off" /></label>
                <div className="flex overflow-hidden rounded-lg border border-zinc-300 text-[13px] dark:border-zinc-700" role="group" aria-label="mode">
                  {(["static", "dynamic"] as const).map((m) => (
                    <button key={m} onClick={() => setMMode(m)} className={`flex-1 px-2 py-1.5 ${mMode === m ? "bg-zinc-900 font-bold text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500"}`}>
                      {t(locale, `qr.mode.${m}`)}
                    </button>
                  ))}
                </div>
                {mMode === "dynamic" && (
                  <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "qr.amount")} (CNY)</span>
                    <input dir="ltr" inputMode="decimal" className={`${inpCls} font-mono`} value={mAmount} onChange={(e) => setMAmount(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="58.00" autoComplete="off" /></label>
                )}
                <Btn small onClick={merchantCreate}>{t(locale, "qr.generate")}</Btn>
              </div>
            ) : (
              <div className="space-y-2 text-center">
                {code && <QrBox value={code} />}
                <div className="font-mono text-[12px] text-zinc-500">
                  {desc || t(locale, "qpg.sale")} · {flow.mode === "dynamic" ? formatMoney(amountMinor, CCY, locale) : t(locale, "qr.mode.static")}
                </div>
                <MerchantStatus flow={flow} notice={notice} />
                <div className="flex gap-1.5">
                  <Btn small variant="outline" onClick={() => resetTx()}>{t(locale, "qr.newCode")}</Btn>
                </div>
              </div>
            )
          ) : (
            <div className="space-y-2">
              <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "qpg.tillTotal")} (CNY)</span>
                <input dir="ltr" inputMode="decimal" className={`${inpCls} font-mono`} value={tillExpected} onChange={(e) => setTillExpected(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="58.00" autoComplete="off" /></label>
              {!flow || flow.stage === "fresh" ? (
                <div className="text-[13px] text-zinc-500">{t(locale, "qpg.mAwait")}</div>
              ) : flow.stage === "mscan" ? (
                <div className="space-y-2 text-center">
                  {code && <QrBox value={code} />}
                  <div className="text-[12px] text-zinc-500">{t(locale, "qpg.mFound")}</div>
                  <Btn small onClick={merchantScan}>{t(locale, "qpg.mscanCta")}</Btn>
                </div>
              ) : (
                <MerchantStatus flow={flow} notice={notice} />
              )}
            </div>
          )}
        </Device>

        {/* customer phone */}
        <Device tone="customer" title={t(locale, "qpg.customerT")} sub={t(locale, "qpg.customerS")}>
          {scenario === "A" ? (
            !flow || flow.stage === "fresh" ? (
              <div className="space-y-2 text-center">
                <div className="text-[13px] text-zinc-500">{t(locale, "qpg.cIdle")}</div>
              </div>
            ) : cView === "scanner" || (flow.stage === "shown" && cView !== "details" && cView !== "pin" && cView !== "processing" && cView !== "receipt") ? (
              <div className="space-y-2">
                <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "qpg.source")}</span>
                  <select className={inpCls} value={source} onChange={(e) => setSource(e.target.value as "balance" | "card")}>
                    <option value="balance">{t(locale, "qpg.src.balance")}</option>
                    <option value="card">{t(locale, "qpg.src.card")}</option>
                  </select></label>
                {flow.mode === "static" && (
                  <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "qr.typeAmount")} (CNY)</span>
                    <input dir="ltr" inputMode="decimal" className={`${inpCls} font-mono`} value={payAmount} onChange={(e) => setPayAmount(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="58.00" autoComplete="off" /></label>
                )}
                <Scanner onScan={customerScan} onCancel={cancelTx} scanning={scanning} label={t(locale, "qpg.scanLabel")} />
              </div>
            ) : null
          ) : !flow || flow.stage === "fresh" ? (
            <div className="space-y-2 text-center">
              <div className="text-[13px] text-zinc-500">{t(locale, "qpg.cIdleB")}</div>
              <Btn small onClick={customerShow}>{t(locale, "qr.showMine")}</Btn>
            </div>
          ) : null}

          {flow && flow.stage === "mscan" && scenario === "B" && code && (
            <div className="space-y-2 text-center">
              <QrBox value={code} />
              <div className="text-[12px] text-zinc-500">{t(locale, "qpg.myCodeNote")}</div>
            </div>
          )}

          {cView === "details" && flow && (flow.stage === "pin" || hasValidated(flow)) && (
            <div className="space-y-2">
              <div className="rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
                <div className="flex justify-between"><span className="text-zinc-500">{scenario === "A" ? t(locale, "qpg.merchantT") : t(locale, "qpg.chargeTo")}</span><b>{scenario === "A" ? merchantId : parsed.w ? `wallet ${parsed.w}` : merchantId}</b></div>
                <div className="mt-1 flex justify-between"><span className="text-zinc-500">{t(locale, "qr.amount")}</span><b className="font-mono text-base">{formatMoney(amountMinor, CCY, locale)}</b></div>
                <div className="mt-1 flex justify-between font-mono text-[12px] text-zinc-500"><span>ref</span><span>{ref || "—"}</span></div>
                {scenario === "A" && <div className="mt-1 flex justify-between text-[13px]"><span className="text-zinc-500">{t(locale, "qpg.source")}</span><span>{t(locale, source === "balance" ? "qpg.src.balance" : "qpg.src.card")}</span></div>}
              </div>
              <div className="flex gap-1.5">
                <Btn small variant="outline" onClick={cancelTx}>{t(locale, "wsh.cancel")}</Btn>
                <Btn small onClick={confirmPay}>{t(locale, "qr.confirmPay")}</Btn>
              </div>
            </div>
          )}

          {cView === "pin" && flow && flow.stage === "pin" && (
            <div className="space-y-2">
              <div className="text-center font-mono font-bold">{formatMoney(amountMinor, CCY, locale)}</div>
              <OtpBoxes value={pin} onChange={setPin} length={4} label={t(locale, "qr.pinTitle")} />
              {pinErr && <div className="text-center text-[13px] text-red-700 dark:text-red-400">{pinErr}</div>}
              <div className="text-center text-[12px] text-zinc-500">{t(locale, "qr.pinHint")}</div>
              <div className="flex gap-1.5">
                <Btn small variant="outline" onClick={cancelTx}>{t(locale, "wsh.cancel")}</Btn>
                <Btn small onClick={submitPin}>{t(locale, "qr.confirmPay")}</Btn>
              </div>
            </div>
          )}

          {cView === "processing" && (
            <div className="space-y-2 py-6 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-zinc-300 border-t-sky-600" />
              <div className="text-[13px] text-zinc-500">{t(locale, "co.proc.title")}</div>
            </div>
          )}

          {cView === "receipt" && flow && (flow.stage === "done" || flow.stage === "terminal") && (
            <div className="space-y-2">
              {flow.stage === "done" ? (
                <div className="rounded-xl bg-emerald-50 p-3 text-sm dark:bg-emerald-950">
                  <div className="font-bold text-emerald-800 dark:text-emerald-200">✓ {t(locale, "qr.paid")}</div>
                  <div className="mt-1 font-mono text-lg font-bold">{formatMoney(amountMinor, CCY, locale)}</div>
                  <div className="text-[12px] text-zinc-500">{merchantId} · <Time /></div>
                  <div className="font-mono text-[12px] text-zinc-500">ref {ref || flow.ctx.txId}</div>
                </div>
              ) : (
                <div className="rounded-xl bg-red-50 p-3 text-sm dark:bg-red-950">
                  <div className="font-bold text-red-800 dark:text-red-200">✕ {t(locale, "co.no.title")}</div>
                  <div className="mt-1 text-[13px]">{declineOf() ?? flow.stage}</div>
                </div>
              )}
              <div className="flex gap-1.5">
                <Btn small variant="outline" onClick={() => resetTx()}>{t(locale, "qr.newPay")}</Btn>
              </div>
            </div>
          )}
        </Device>
      </div>

      {notice && (
        <div className="rounded-lg bg-sky-50 p-2 text-center text-[13px] text-sky-900 dark:bg-sky-950 dark:text-sky-200">{notice}</div>
      )}

      {/* recent */}
      {orders.length > 0 && (
        <Card className="space-y-1.5 p-3">
          <div className="text-[12px] font-bold uppercase tracking-widest text-zinc-500">{t(locale, "qpg.recent")}</div>
          {orders.slice(0, 3).map((o) => (
            <div key={o.id} className="flex items-center gap-2 text-[13px]">
              <span className="font-mono">{typeof o.spec.params.qrMode === "string" ? o.spec.params.qrMode : "?"} · {formatMoney(o.result.receipt.amountMinor, o.result.receipt.currency, locale)}</span>
              <Badge tone={o.result.finalState === "SETTLED" ? "green" : "red"}>{o.result.finalState}</Badge>
              <span className="ms-auto text-zinc-500"><Time at={o.at} /></span>
            </div>
          ))}
        </Card>
      )}

      {/* learning panel */}
      <Card className="space-y-1.5 p-3 text-[13px]">
        <div className="font-bold">{t(locale, "qpg.learnT")}</div>
        <div className="text-zinc-600 dark:text-zinc-400">{t(locale, scenario === "A" ? "qpg.learnA" : "qpg.learnB")}</div>
        <details className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900">
          <summary className="cursor-pointer font-semibold">{t(locale, "qpg.payloadT")}</summary>
          <div className="mt-1 font-mono text-[12px]">{code ?? t(locale, "qpg.noLiveCode")}</div>
          <div className="mt-1 text-zinc-600 dark:text-zinc-400">{t(locale, "qpg.payloadB")}</div>
        </details>
        <details className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900">
          <summary className="cursor-pointer font-semibold">{t(locale, "qpg.failT")}</summary>
          <div className="mt-1 text-zinc-600 dark:text-zinc-400">{t(locale, "qpg.failB")}</div>
        </details>
      </Card>
    </div>
  );

  function hasValidated(f: QrFlow): boolean {
    return f.ctx.events.some((e) => e.type === "QR_VALIDATED");
  }
}
function MerchantStatus({ flow, notice }: { flow: QrFlow; notice: string | null }) {
  const { locale } = usePrefs();
  const evs = flow.ctx.events;
  const has = (...ts: string[]) => evs.some((e) => ts.includes(e.type));
  const paid = flow.stage === "done";
  const failed = flow.stage === "terminal";
  const amount = evs.length > 0 ? flow.ctx.amountMinor : 0;
  return (
    <div className="space-y-1.5">
      <div className={`rounded-xl p-2 text-center text-[13px] font-bold ${paid ? "bg-emerald-600 text-white" : failed ? "bg-red-600 text-white" : has("QR_SCANNED") ? "bg-sky-600 text-white" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800"}`}>
        {paid ? `✓ ${t(locale, "qr.received")}` : failed ? `✕ ${t(locale, "co.no.title")}` : has("PIN_CONFIRMED") ? t(locale, "co.proc.title") : has("QR_SCANNED") ? t(locale, "qpg.mScanned") : t(locale, "qpg.mOpen")}
      </div>
      {(paid || failed) && (
        <div className="font-mono text-[12px] text-zinc-500">
          {formatMoney(amount, flow.ctx.currency, locale)}{failed && notice ? ` · ${notice}` : ""}
        </div>
      )}
    </div>
  );
}
