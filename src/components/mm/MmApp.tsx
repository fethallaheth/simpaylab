/**
 * Mobile-money phone (M-PESA-inspired, generic operator).
 * One real-phone demo: 120-second USSD sitting with numbered menus typed by
 * code, first-use PIN setup stored only in this browser, agent tills with
 * floats that run dry, cash-in/out, bills, airtime and balance. Every
 * completed operation lands in the phone's SMS inbox as a receipt message —
 * the history lives inside the messages, like a real handset. The wallet
 * starts at zero and carries across sessions — cash in first.
 */
"use client";
import { useEffect, useRef, useState } from "react";
import {
  createMmFlow,
  createRunBase,
  mmAdvance,
  mmBalance,
  mmResult,
  type FailureId,
  type MmFlow,
  type RunResult
} from "@sim/engine";
import { t } from "@/i18n/dict";
import { formatMoney, saveSession } from "@/lib/sim";
import { usePrefs } from "../providers";
import { OtpBoxes, Time, useSpecReset } from "../flows/kit";
import { PhoneMock } from "./PhoneMock";

type Svc = "send" | "cashout" | "cashin" | "bill" | "airtime" | "balance" | null;
type View = "ussd" | "inbox" | "msg";

const PIN_KEY = "simpay.mm.pin.v1";
const WALLET_KEY = "simpay.mm.wallet.v1";
const SMS_KEY = "simpay.mm.sms.v1";
const CCY = "EUR";
const SESSION_SEC = 120;

const AGENTS = [
  { id: "cbd", name: "CBD Kiosk 12", float: 85000_00 },
  { id: "kisumu", name: "Kisumu Market", float: 42000_00 },
  { id: "eldoret", name: "Eldoret Road", float: 30000_00 }
];

const BILLERS = ["Kenya Power", "Water Trust", "School Fees"];

interface SmsRow { k: string; v: string }
interface Sms { id: string; at: number; titleKey: string; rows: SmsRow[]; bad?: boolean }

function loadSms(): Sms[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem(SMS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Sms[];
    return Array.isArray(arr) ? arr.slice(-30) : [];
  } catch {
    return [];
  }
}

export function MmApp({ seed, params, failures, onLive }: {
  seed: number;
  params: Record<string, unknown>;
  failures: FailureId[];
  onLive: (r: RunResult) => void;
}) {
  const { locale } = usePrefs();
  const [storedPin, setStoredPin] = useState<string | null>(null);
  const [sp1, setSp1] = useState("");
  const [sp2, setSp2] = useState("");
  const [menuCode, setMenuCode] = useState("");
  const [svc, setSvc] = useState<Svc>(null);
  const [fPhone, setFPhone] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fAgent, setFAgent] = useState(AGENTS[0].id);
  const [fBiller, setFBiller] = useState(BILLERS[0]);
  const [fAccount, setFAccount] = useState("");
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [agents, setAgents] = useState(AGENTS);
  const [left, setLeft] = useState(SESSION_SEC);
  const [wallet, setWallet] = useState(0);
  const [balShown, setBalShown] = useState<number | null>(null);
  const [view, setView] = useState<View>("ussd");
  const [inbox, setInbox] = useState<Sms[]>([]);
  const [openMsg, setOpenMsg] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [dialer, setDialer] = useState(false);
  const [dialed, setDialed] = useState("");
  const [dialErr, setDialErr] = useState<string | null>(null);
  const [needPin, setNeedPin] = useState(false);

  const flowRef = useRef<MmFlow | null>(null);
  const savedRef = useRef(false);
  const openedAt = useRef(0);

  useEffect(() => {
    try {
      const p = localStorage.getItem(PIN_KEY);
      if (p && /^\d{4}$/.test(p)) setStoredPin(p);
      const w = Number(localStorage.getItem(WALLET_KEY));
      if (Number.isSafeInteger(w) && w > 0) setWallet(w);
      setInbox(loadSms());
    } catch { /* noop */ }
  }, []);
  useSpecReset(JSON.stringify({ seed, params, failures }), () => {
    flowRef.current = null;
    savedRef.current = false;
    setSvc(null);
    setBalShown(null);
    setWallet(0);
    setInbox([]);
    setOpenMsg(null);
    setUnread(0);
    setView("ussd");
    setDialer(false);
    setDialed("");
    setDialErr(null);
    setNeedPin(false);
    try {
      localStorage.removeItem(WALLET_KEY);
      localStorage.removeItem(SMS_KEY);
    } catch { /* noop */ }
  });

  const push = (): RunResult => {
    const r = mmResult(flowRef.current!);
    onLive(r);
    return r;
  };
  const maybeSave = () => {
    const flow = flowRef.current;
    if (!flow || savedRef.current) return;
    if (flow.stage !== "done" && flow.stage !== "terminal") return;
    savedRef.current = true;
    saveSession({ moduleId: "mobilemoney", seed, params, failures }, mmResult(flow));
  };
  const major = (v: string) => Math.round(Number(v.replace(",", ".")) * 100);

  const pushSms = (m: Sms) => {
    setInbox((prev) => {
      const next = [...prev, m].slice(-30);
      try { localStorage.setItem(SMS_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
    setUnread((u) => u + 1);
  };

  /** Turn a finished session into a handset SMS receipt. */
  const smsFor = (flow: MmFlow): Sms | null => {
    const evs = flow.ctx.events;
    const types = evs.map((e) => e.type);
    const last = [...evs].reverse().find((e) => !["SETTLED", "USSD_MENU", "USSD_OPENED", "BALANCE_SHOWN"].includes(e.type));
    if (!last) return null;
    const bal = formatMoney(mmBalance(flow), CCY, locale);
    const fee = formatMoney(mmResult(flow).receipt.totalFeesMinor, CCY, locale);
    const amtOf = (e: (typeof evs)[number]) => formatMoney(Number(e.payload.amountMinor ?? 0), CCY, locale);
    const base = { id: `sms${Date.now()}${evs.length}`, at: Date.now(), rows: [] as SmsRow[] };
    const till = agents.find((a) => a.id === fAgent)?.name ?? fAgent;
    switch (last.type) {
      case "CASHIN_DONE":
        return { ...base, titleKey: "mm.sms.cashin", rows: [{ k: "mm.tx.amount", v: amtOf(last) }, { k: "mm.sms.till", v: till }, { k: "mm.walletBal", v: bal }] };
      case "CASHOUT_DONE":
        return { ...base, titleKey: "mm.sms.cashout", rows: [{ k: "mm.tx.amount", v: amtOf(last) }, { k: "mm.sms.till", v: till }, { k: "mm.sms.fee", v: fee }, { k: "mm.walletBal", v: bal }] };
      case "MM_SENT":
        return { ...base, titleKey: "mm.sms.sent", rows: [{ k: "mm.tx.amount", v: amtOf(last) }, { k: "mm.sms.to", v: String(last.payload.to ?? "") }, { k: "mm.sms.fee", v: fee }, { k: "mm.walletBal", v: bal }] };
      case "BILL_PAID":
        return { ...base, titleKey: "mm.sms.bill", rows: [{ k: "mm.tx.amount", v: amtOf(last) }, { k: "mm.sms.biller", v: String(last.payload.biller ?? "") }, { k: "mm.sms.fee", v: fee }, { k: "mm.walletBal", v: bal }] };
      case "AIRTIME_BOUGHT":
        return { ...base, titleKey: "mm.sms.airtime", rows: [{ k: "mm.tx.amount", v: amtOf(last) }, { k: "mm.sms.to", v: String(last.payload.phone ?? "") }, { k: "mm.walletBal", v: bal }] };
      case "PIN_LOCKED":
        return { ...base, titleKey: "mm.sms.locked", bad: true, rows: [{ k: "mm.sms.reason", v: t(locale, "mm.sms.lockedB") }, { k: "mm.walletBal", v: bal }] };
      case "SESSION_TIMEOUT":
        return { ...base, titleKey: "mm.sms.timeout", bad: true, rows: [{ k: "mm.sms.reason", v: t(locale, "mm.sms.timeoutB") }] };
      default:
        if (types.includes("WALLET_DECLINED")) {
          return { ...base, titleKey: "mm.sms.failed", bad: true, rows: [{ k: "mm.sms.reason", v: t(locale, "mm.sms.nofunds") }, { k: "mm.walletBal", v: bal }] };
        }
        if (types.includes("SIM_SWAP_FLAG")) {
          return { ...base, titleKey: "mm.sms.failed", bad: true, rows: [{ k: "mm.sms.reason", v: t(locale, "mm.sms.fraud") }] };
        }
        return null;
    }
  };

  /** Closing balance of a finished session becomes the next opening balance. */
  const syncWallet = (flow: MmFlow | null) => {
    if (!flow) return;
    if (flow.stage !== "done" && flow.stage !== "terminal") return;
    const bal = Math.max(0, mmBalance(flow));
    setWallet(bal);
    try { localStorage.setItem(WALLET_KEY, String(bal)); } catch { /* noop */ }
  };

  const finishSession = (flow: MmFlow | null) => {
    if (!flow) return;
    syncWallet(flow);
    const m = smsFor(flow);
    if (m) pushSms(m);
    maybeSave();
  };

  // 120s USSD clock
  useEffect(() => {
    if (!flowRef.current || (flowRef.current.stage !== "menu" && flowRef.current.stage !== "pin" && flowRef.current.stage !== "pinsetup")) return;
    const id = setInterval(() => {
      const remain = SESSION_SEC - Math.floor((Date.now() - openedAt.current) / 1000);
      setLeft(Math.max(0, remain));
      if (remain <= 0) {
        clearInterval(id);
        try {
          mmAdvance(flowRef.current!, { type: "ussd_timeout" });
          push();
          finishSession(flowRef.current);
        } catch { /* already closed */ }
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowRef.current?.stage]);

  const savePinAndCall = () => {
    if (!/^\d{4}$/.test(sp1) || sp1 !== sp2) return;
    try { localStorage.setItem(PIN_KEY, sp1); } catch { /* noop */ }
    setStoredPin(sp1);
    setSp1(""); setSp2("");
    openSession(sp1);
  };

  const callDialed = () => {
    if (dialed !== "*144#") {
      setDialErr(t(locale, "mm.dial.wrong"));
      return;
    }
    setDialErr(null);
    if (storedPin) openSession(storedPin);
    else setNeedPin(true);
  };

  const openSession = (pinToUse: string) => {
    if (!/^\d{4}$/.test(pinToUse)) return;
    const base = createRunBase("mobilemoney", { seed, params: { ...params, pinExpected: pinToUse, openBalanceMinor: wallet }, failures });
    const flow = createMmFlow(base);
    flowRef.current = flow;
    savedRef.current = false;
    mmAdvance(flow, { type: "ussd_open" });
    push();
    openedAt.current = Date.now();
    setLeft(SESSION_SEC);
    setSvc(null);
    setBalShown(null);
    setView("ussd");
    setDialer(false);
    setDialed("");
    setDialErr(null);
    setNeedPin(false);
  };

  const pick = (code: string) => {
    const map: Record<string, Svc> = { "1": "send", "2": "cashout", "3": "cashin", "4": "bill", "5": "airtime", "6": "balance" };
    const s = map[code.trim()];
    if (s) { setSvc(s); setFormErr(null); setBalShown(null); }
    setMenuCode("");
  };

  const agentFloat = () => agents.find((a) => a.id === fAgent)?.float ?? 0;

  const confirmService = () => {
    const flow = flowRef.current;
    if (!flow || !svc) return;
    setFormErr(null);
    try {
      const amt = major(fAmount);
      if (svc === "send") mmAdvance(flow, { type: "send", to: fPhone.trim(), amountMinor: amt });
      else if (svc === "cashout") mmAdvance(flow, { type: "cashout", agentFloat: agentFloat(), amountMinor: amt });
      else if (svc === "cashin") mmAdvance(flow, { type: "cashin", agentFloat: agentFloat(), amountMinor: amt });
      else if (svc === "bill") mmAdvance(flow, { type: "paybill", biller: fBiller, account: fAccount.trim(), amountMinor: amt });
      else if (svc === "airtime") mmAdvance(flow, { type: "airtime", phone: fPhone.trim(), amountMinor: amt });
      else if (svc === "balance") {
        mmAdvance(flow, { type: "balance" });
        push();
        const bal = mmBalance(flow);
        setBalShown(bal);
        pushSms({
          id: `sms${Date.now()}bal`,
          at: Date.now(),
          titleKey: "mm.sms.balance",
          rows: [{ k: "mm.walletBal", v: formatMoney(bal, CCY, locale) }]
        });
        setSvc(null);
        return;
      }
      push();
      // dry till: engine stays in menu with AGENT_NO_FLOAT — say so out loud
      const lastEv = flow.ctx.events[flow.ctx.events.length - 1];
      if (flow.stage === "menu" && lastEv?.type === "AGENT_NO_FLOAT") {
        setFormErr(t(locale, "mm.noFloat"));
        return;
      }
      setPin(""); setPinErr(null);
    } catch {
      setFormErr(t(locale, "mm.formBad"));
    }
  };

  const submitPin = () => {
    const flow = flowRef.current;
    if (!flow) return;
    mmAdvance(flow, { type: "submit_pin", pin: pin.trim() });
    push();
    if (flow.stage === "pin") {
      setPinErr(t(locale, "wa.pinWrong") + ` (${Math.max(0, 3 - flow.pinStrikes)} ${t(locale, "co.ch.attempts")})`);
      return;
    }
    setPinErr(null);
    // settle agent floats from the receipt events
    const evs = flow.ctx.events;
    const done = evs.find((e) => e.type === "CASHOUT_DONE" || e.type === "CASHIN_DONE");
    if (done) {
      const amt = Number(done.payload.amountMinor ?? 0);
      setAgents((as) => as.map((a) => (a.id === fAgent
        ? { ...a, float: done.type === "CASHOUT_DONE" ? a.float + amt : Math.max(0, a.float - amt) }
        : a)));
    }
    finishSession(flow);
  };

  const flow = flowRef.current;
  const stage = flow?.stage ?? "fresh";
  const sessionLive = !!flow && (stage === "menu" || stage === "pin" || stage === "pinsetup");
  const lastMeaningful = [...(flow?.ctx.events ?? [])].reverse().find((e) => !["SETTLED", "USSD_MENU", "USSD_OPENED"].includes(e.type));
  const MENU = [
    ["1", "mm.m1"], ["2", "mm.m2"], ["3", "mm.m3"], ["4", "mm.m4"], ["5", "mm.m5"], ["6", "mm.m6"]
  ] as const;
  const openDetail = inbox.find((m) => m.id === openMsg) ?? null;

  return (
    <div className="mx-auto w-fit space-y-2">
      <PhoneMock>
        <>
          <div className="py-1 font-mono text-[13px] text-emerald-300">
            <div className="flex items-center justify-between text-[11px] opacity-70">
              <span>SimTel *144#</span>
              <span className="flex items-center gap-2">
                <button
                  aria-label={t(locale, "mm.sms.title")}
                  onClick={() => { setView("inbox"); setOpenMsg(null); setUnread(0); }}
                  className="relative rounded px-1.5 py-0.5 text-[13px] hover:bg-zinc-700"
                >
                  ✉
                  {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unread}</span>}
                </button>
                <span>{sessionLive ? `${left}s` : "○"}</span>
              </span>
            </div>

            {view === "inbox" && (
              <div className="mt-1 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold">{t(locale, "mm.sms.title")}</span>
                  <button onClick={() => setView("ussd")} className="rounded px-2 py-0.5 underline opacity-70">{t(locale, "mm.back")}</button>
                </div>
                {inbox.length === 0 && <div className="py-3 text-center opacity-60">{t(locale, "mm.sms.empty")}</div>}
                {[...inbox].reverse().map((m) => (
                  <button key={m.id} onClick={() => { setOpenMsg(m.id); setView("msg"); }} className="w-full rounded bg-zinc-800 px-2 py-1.5 text-left hover:bg-zinc-700">
                    <div className={`text-[12px] font-bold ${m.bad ? "text-red-300" : ""}`}>{t(locale, m.titleKey)}</div>
                    <div className="text-[11px] opacity-60"><Time at={m.at} /></div>
                  </button>
                ))}
              </div>
            )}

            {view === "msg" && (
              <div className="mt-1 space-y-1.5">
                <button onClick={() => { setView("inbox"); setOpenMsg(null); }} className="rounded px-1 underline opacity-70">‹ {t(locale, "mm.back")}</button>
                {openDetail ? (
                  <div className={`space-y-1 rounded bg-zinc-800 p-2 ${openDetail.bad ? "border border-red-500" : ""}`}>
                    <div className={`font-bold ${openDetail.bad ? "text-red-300" : ""}`}>{t(locale, openDetail.titleKey)}</div>
                    {openDetail.rows.map((r, i) => (
                      <div key={i} className="flex justify-between gap-2 text-[12px]">
                        <span className="opacity-60">{t(locale, r.k)}</span>
                        <span className="break-all text-right">{r.v}</span>
                      </div>
                    ))}
                    <div className="text-[11px] opacity-60"><Time at={openDetail.at} /></div>
                  </div>
                ) : (
                  <div className="py-3 text-center opacity-60">{t(locale, "mm.sms.empty")}</div>
                )}
              </div>
            )}

            {view === "ussd" && (
              <>
                {!flow || stage === "fresh" ? (
                  needPin ? (
                    <div className="mt-1 space-y-2 rounded-xl bg-black/70 p-3">
                      <div className="font-bold text-zinc-100">{t(locale, "mm.setupTitle")}</div>
                      <div className="font-sans text-[12px] text-zinc-400">{t(locale, "mm.setup.choose")}</div>
                      <OtpBoxes value={sp1} onChange={setSp1} length={4} label="PIN" />
                      <OtpBoxes value={sp2} onChange={setSp2} length={4} label="PIN" />
                      <button onClick={savePinAndCall} className="w-full rounded bg-emerald-700 py-1.5 font-bold text-white">{t(locale, "mm.setup.start")}</button>
                      <button onClick={() => setNeedPin(false)} className="w-full rounded py-1 underline opacity-70">{t(locale, "mm.back")}</button>
                    </div>
                  ) : !dialer ? (
                    <div className="mt-6 space-y-5 p-1">
                      <div className="grid grid-cols-2 gap-3 px-3">
                        <button onClick={() => { setDialer(true); setDialed(""); setDialErr(null); }} className="flex flex-col items-center gap-1.5">
                          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-2xl shadow-lg">📲</span>
                          <span className="font-sans text-[11px] text-zinc-200">{t(locale, "mm.home.money")}</span>
                        </button>
                        <button onClick={() => { setView("inbox"); setOpenMsg(null); setUnread(0); }} className="relative flex flex-col items-center gap-1.5">
                          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-700 text-2xl shadow-lg">✉</span>
                          {unread > 0 && <span className="absolute right-4 top-0 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{unread}</span>}
                          <span className="font-sans text-[11px] text-zinc-200">{t(locale, "mm.home.msgs")}</span>
                        </button>
                      </div>
                      <div className="text-center font-sans text-[11px] text-zinc-400">{t(locale, "mm.home.hint")}</div>
                    </div>
                  ) : (
                    <div className="mt-1 space-y-2 rounded-xl bg-black/70 p-3 text-center">
                      <div className="min-h-[28px] break-all text-xl font-bold tracking-widest text-zinc-100">{dialed || " "}</div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((d) => (
                          <button key={d} onClick={() => { setDialed((v) => (v + d).slice(0, 16)); setDialErr(null); }} className="rounded-full bg-zinc-800 py-2 text-lg text-zinc-100 hover:bg-zinc-700">{d}</button>
                        ))}
                      </div>
                      <div className="flex items-center justify-center gap-3">
                        <button onClick={() => setDialer(false)} className="rounded px-2 py-1 underline opacity-70">{t(locale, "mm.back")}</button>
                        <button onClick={() => setDialed((v) => v.slice(0, -1))} aria-label="backspace" className="rounded bg-zinc-800 px-3 py-1.5">⌫</button>
                        <button onClick={callDialed} aria-label={t(locale, "mm.dial.call")} className="rounded-full bg-emerald-600 px-6 py-2 text-xl shadow-lg">📞</button>
                      </div>
                      {dialErr && <div className="font-sans text-[12px] text-red-300">{dialErr}</div>}
                      <div className="font-sans text-[11px] text-zinc-500">{t(locale, "mm.dial.hint")}</div>
                    </div>
                  )
                ) : (
                  <>
                    {stage === "menu" && !svc && (
                      balShown !== null ? (
                        <div className="mt-1 space-y-1.5 rounded-xl bg-black/70 p-2 text-center">
                          <div className="opacity-70">{t(locale, "mm.walletBal")}</div>
                          <div className="text-xl font-bold text-emerald-200">{formatMoney(balShown, CCY, locale)}</div>
                          <button onClick={() => setBalShown(null)} className="w-full rounded bg-zinc-700 py-1.5 font-bold">{t(locale, "mm.back")}</button>
                        </div>
                      ) : (
                        <div className="mt-1 space-y-0.5 rounded-xl bg-black/70 p-2">
                          {MENU.map(([c, k]) => <div key={c}>{c}. {t(locale, k)}</div>)}
                          <div className="flex gap-1 pt-1">
                            <input dir="ltr" inputMode="numeric" aria-label="menu code" className="w-14 rounded bg-zinc-800 px-2 py-1 text-center" value={menuCode} onChange={(e) => setMenuCode(e.target.value.replace(/\D/g, "").slice(0, 1))} onKeyDown={(e) => { if (e.key === "Enter") pick(menuCode); }} />
                            <button onClick={() => pick(menuCode)} className="rounded bg-emerald-700 px-3 py-1 font-bold">{t(locale, "mm.send")}</button>
                          </div>
                        </div>
                      )
                    )}
                    {stage === "menu" && svc && (
                      <div className="mt-1 space-y-1.5 rounded-xl bg-black/70 p-2">
                        <div className="font-bold">{t(locale, `mm.m${svc === "send" ? 1 : svc === "cashout" ? 2 : svc === "cashin" ? 3 : svc === "bill" ? 4 : svc === "airtime" ? 5 : 6}`)}</div>
                        {(svc === "send" || svc === "airtime") && (
                          <input dir="ltr" inputMode="numeric" aria-label="phone" className="w-full rounded bg-zinc-800 px-2 py-1" value={fPhone} onChange={(e) => setFPhone(e.target.value.replace(/\D/g, "").slice(0, 12))} placeholder="07…" />
                        )}
                        {(svc === "cashout" || svc === "cashin") && (
                          <select aria-label="agent" className="w-full rounded bg-zinc-800 px-2 py-1" value={fAgent} onChange={(e) => setFAgent(e.target.value)}>
                            {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({formatMoney(a.float, CCY, locale)})</option>)}
                          </select>
                        )}
                        {svc === "bill" && (
                          <div className="space-y-1.5">
                            <select aria-label="biller" className="w-full rounded bg-zinc-800 px-2 py-1" value={fBiller} onChange={(e) => setFBiller(e.target.value)}>
                              {BILLERS.map((b) => <option key={b} value={b}>{b}</option>)}
                            </select>
                            <input aria-label="account" className="w-full rounded bg-zinc-800 px-2 py-1" value={fAccount} onChange={(e) => setFAccount(e.target.value)} placeholder={t(locale, "mm.account")} />
                          </div>
                        )}
                        {svc !== "balance" && (
                          <>
                            <div className="flex flex-wrap gap-1" role="group" aria-label="quick amounts">
                              {[100, 500, 1000, 5000].map((q) => (
                                <button key={q} onClick={() => { setFAmount(String(q)); setFormErr(null); }} className={`rounded-full border px-2.5 py-0.5 text-[12px] ${fAmount === String(q) ? "border-emerald-400 bg-emerald-900" : "border-zinc-600"}`}>
                                  {q}
                                </button>
                              ))}
                            </div>
                            <input dir="ltr" inputMode="decimal" aria-label="amount" className="w-full rounded bg-zinc-800 px-2 py-1" value={fAmount} onChange={(e) => setFAmount(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="500" />
                          </>
                        )}
                        {formErr && <div className="text-red-300">{formErr}</div>}
                        <div className="flex gap-1">
                          <button onClick={() => setSvc(null)} className="rounded px-2 py-1 underline opacity-70">{t(locale, "mm.back")}</button>
                          <button onClick={confirmService} className="rounded bg-emerald-700 px-3 py-1 font-bold">{t(locale, "mm.send")}</button>
                        </div>
                      </div>
                    )}
                    {stage === "pin" && (
                      <div className="mt-1 space-y-1.5 rounded-xl bg-black/70 p-2">
                        <div>{t(locale, "mm.enterPin")}</div>
                        <OtpBoxes value={pin} onChange={setPin} length={4} label="PIN" />
                        {pinErr && <div className="text-red-300">{pinErr}</div>}
                        <button onClick={submitPin} className="w-full rounded bg-emerald-700 py-1.5 font-bold">{t(locale, "mm.send")}</button>
                      </div>
                    )}
                    {(stage === "done" || stage === "terminal") && (
                      <div className="mt-1 space-y-1.5 rounded-xl bg-black/70 p-2">
                        <div className="font-bold">{lastMeaningful?.type.replace(/_/g, " ")}</div>
                        {typeof lastMeaningful?.payload.amountMinor === "number" && <div>{formatMoney(lastMeaningful.payload.amountMinor as number, CCY, locale)}</div>}
                        {typeof lastMeaningful?.payload.balanceMinor === "number" && <div>{t(locale, "pp.balance")}: {formatMoney(lastMeaningful.payload.balanceMinor as number, CCY, locale)}</div>}
                        <div className="opacity-70">{t(locale, "mm.walletBal")}: {formatMoney(flow ? mmBalance(flow) : wallet, CCY, locale)}</div>
                        <button onClick={() => { flowRef.current = null; setSvc(null); setBalShown(null); }} className="w-full rounded bg-zinc-700 py-1.5 font-bold">{t(locale, "mm.newSession")}</button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </>
      </PhoneMock>
      {storedPin && (
        <div className="text-center font-mono text-[12px] text-zinc-500">
          {t(locale, "mm.walletBal")}: {formatMoney(flow && sessionLive ? mmBalance(flow) : wallet, CCY, locale)}
        </div>
      )}
    </div>
  );
}
