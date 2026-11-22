/**
 * The three wallet payment sheets. Same cart, same engine — three different
 * experiences: a device payment sheet with Face ID, an in-app wallet flow
 * with card + billing management, and a postal-provider redirect flow with
 * enrollment, visible balance, expiring OTP and daily caps (BaridiMob-style).
 */
"use client";
import { useEffect, useRef, useState } from "react";
import {
  createRunBase,
  createWalletFlow,
  walletAdvance,
  walletResult,
  type FailureId,
  type RunResult,
  type WalletFlow
} from "@sim/engine";
import { t } from "@/i18n/dict";
import { formatMoney } from "@/lib/sim";
import { usePrefs } from "../providers";
import { Btn, Card } from "../ui";
import { MockSms, OtpBoxes, ProcessingLadder, inpCls } from "../flows/kit";
import { type InfoFields } from "../checkout/validation";
import { DAILY_CAP, FAUCET_DZD, OTP_WINDOW_SEC, eurToDzd } from "./store";

export interface Order {
  items: { name: string; qty: number; priceMinor: number }[];
  buyer: InfoFields;
  totalMinor: number;
}

export interface TokenRef {
  id: string;
  last4: string;
  exp: string;
  name: string;
  dpan: string;
  brand: string;
  isDefault: boolean;
}

export interface BaridiAcct {
  phone: string;
  username: string;
  ribLast4: string;
  balanceMinor: number;
  daySpent: { date: string; total: number };
  history: { ref: string; merchant: string; totalMinor: number; at: number; status: string }[];
}

interface SheetProps {
  seed: number;
  params: Record<string, unknown>;
  failures: FailureId[];
  onLive: (r: RunResult) => void;
  order: Order;
  onBuyer: (b: InfoFields) => void;
  tokens: TokenRef[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDone: (flow: WalletFlow, result: RunResult) => void;
  goBack: () => void;
  onNeedCard: () => void;
}

function beginSession(seed: number, params: Record<string, unknown>, failures: FailureId[], kind: "card" | "account", amountMinor: number, currency: string): WalletFlow {
  const base = createRunBase("wallet", { seed, params: { ...params, walletKind: kind, amountMinor, currency }, failures });
  return createWalletFlow(base);
}

function pushLive(onLive: (r: RunResult) => void, flow: WalletFlow): RunResult {
  const r = walletResult(flow);
  onLive(r);
  return r;
}

/* ================= Apple-style device sheet ================= */

export function AppleSheet(p: SheetProps) {
  const { locale } = usePrefs();
  const [screen, setScreen] = useState<"sheet" | "faceid" | "passcode" | "processing">("sheet");
  const [err, setErr] = useState<string | null>(null);
  const [editShip, setEditShip] = useState(false);
  const [fails, setFails] = useState(0);
  const [busy, setBusy] = useState(false);
  const flowRef = useRef<WalletFlow | null>(null);

  const token = p.tokens.find((x) => x.id === p.selectedId) ?? p.tokens.find((x) => x.isDefault) ?? p.tokens[0] ?? null;

  const pay = () => {
    if (busy || !token) return;
    setErr(null);
    const flow = beginSession(p.seed, p.params, p.failures, "card", p.order.totalMinor, "EUR");
    flowRef.current = flow;
    try {
      walletAdvance(flow, { type: "present_token", last4: token.last4, dpan: token.dpan });
      walletAdvance(flow, { type: "start_pay", merchant: "Demo store" });
      pushLive(p.onLive, flow);
      const last = flow.ctx.events[flow.ctx.events.length - 1].type;
      if (last === "CARD_REJECTED" || last === "TOKEN_SUSPENDED") {
        setErr(t(locale, last === "CARD_REJECTED" ? "wa.cardBad" : "wa.tokenBad"));
        return;
      }
      setFails(0);
      setScreen("faceid");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const face = (pass: boolean) => {
    const flow = flowRef.current;
    if (!flow || busy) return;
    setBusy(true);
    walletAdvance(flow, { type: "unlock_bio", pass });
    pushLive(p.onLive, flow);
    setBusy(false);
    if (flow.stage === "bio") {
      setFails((f) => {
        const n = f + 1;
        if (n >= 2) setScreen("passcode");
        return n;
      });
      return;
    }
    if (flow.stage === "pin") { setScreen("passcode"); return; }
    setScreen("processing");
  };

  const submitPinCode = (code: string) => {
    const flow = flowRef.current;
    if (!flow) return;
    walletAdvance(flow, { type: "unlock_pin", pin: code });
    pushLive(p.onLive, flow);
    if (flow.stage === "pin") { setErr(t(locale, "wa.pinWrong")); return; }
    setScreen("processing");
  };

  const steps = [t(locale, "wa.s1"), t(locale, "wa.s2"), t(locale, "wa.s3"), t(locale, "wa.s4")];
  const b = p.order.buyer;

  if (screen === "processing" && flowRef.current) {
    return <ProcessingLadder steps={steps} onDone={() => { const f = flowRef.current!; p.onDone(f, walletResult(f)); }} />;
  }

  return (
    <div className="mx-auto max-w-[380px] space-y-2">
      <div className="rounded-3xl bg-zinc-950 p-4 text-white dark:bg-black dark:ring-1 dark:ring-zinc-800">
        <div className="text-center text-[11px] uppercase tracking-widest opacity-60">{t(locale, "wsh.appleT")}</div>
        {screen === "sheet" && (
          <div className="mt-2 space-y-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-sm opacity-70">Demo store</span>
              <span className="font-mono text-xl font-bold">{formatMoney(p.order.totalMinor, "EUR", locale)}</span>
            </div>
            <div className="rounded-2xl bg-zinc-900 p-2.5 text-left dark:bg-zinc-900">
              {token ? (
                <><div className="text-[11px] opacity-60">{token.brand} ···· {token.last4}</div><div className="text-sm font-semibold">{token.name}</div></>
              ) : (
                <button onClick={p.onNeedCard} className="w-full text-left text-sm font-semibold text-sky-300">+ {t(locale, "wsh.addCard")}</button>
              )}
            </div>
            <div className="rounded-2xl bg-zinc-900 p-2.5 text-[13px] dark:bg-zinc-900">
              <div className="flex justify-between"><span className="opacity-60">{t(locale, "wsh.shipTo")}</span>
                <button className="underline" onClick={() => setEditShip(!editShip)}>{editShip ? t(locale, "wsh.done") : t(locale, "wsh.edit")}</button></div>
              {editShip ? (
                <div className="mt-1 grid grid-cols-2 gap-1">
                  <input aria-label="street" className="rounded bg-zinc-800 px-1.5 py-1" value={b.street} onChange={(e) => p.onBuyer({ ...b, street: e.target.value })} />
                  <input aria-label="city" className="rounded bg-zinc-800 px-1.5 py-1" value={b.city} onChange={(e) => p.onBuyer({ ...b, city: e.target.value })} />
                </div>
              ) : (
                <div>{b.firstName} {b.lastName} · {b.street}, {b.city}</div>
              )}
            </div>
            {err && <div className="text-[13px] text-red-300">{err}</div>}
            <button disabled={busy || !token} onClick={() => pay()} className="w-full rounded-2xl bg-white py-3 text-sm font-bold text-black disabled:opacity-50">{t(locale, "wsh.payWith")} {formatMoney(p.order.totalMinor, "EUR", locale)}</button>
            <button onClick={p.goBack} className="w-full text-center text-[12px] underline opacity-60">{t(locale, "wsh.cancel")}</button>
          </div>
        )}
        {screen === "faceid" && (
          <div className="mt-2 space-y-2 p-2 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-900 text-2xl">◎</div>
            <div className="font-mono font-bold">{formatMoney(p.order.totalMinor, "EUR", locale)}</div>
            <div className="text-[12px] opacity-60">{t(locale, "wsh.faceHint")}</div>
            <button disabled={busy} onClick={() => face(true)} className="w-full rounded-2xl bg-white py-2.5 text-sm font-bold text-black disabled:opacity-50">{t(locale, "wsh.authenticate")}</button>
            <div className="flex justify-between text-[12px]">
              <button onClick={() => face(false)} className="underline opacity-60">{t(locale, "wsh.simFail")}</button>
              <button onClick={p.goBack} className="underline opacity-60">{t(locale, "wsh.cancel")}</button>
            </div>
          </div>
        )}
        {screen === "passcode" && (
          <PasscodeScreen onSubmit={submitPinCode} err={err} />
        )}
      </div>
      <div className="text-center text-[11px] text-zinc-500">{t(locale, "wsh.sheetNote")}</div>
    </div>
  );
}

export function PasscodeScreen({ onSubmit, err }: { onSubmit: (code: string) => void; err: string | null }) {
  const { locale } = usePrefs();
  const [code, setCode] = useState("");
  return (
    <div className="mt-2 space-y-2 p-2">
      <OtpBoxes value={code} onChange={setCode} length={4} label="passcode" />
      {err && <div className="text-center text-[13px] text-red-300">{err}</div>}
      <div className="text-center text-[11px] opacity-60">{t(locale, "wa.pinHint")}</div>
      <button onClick={() => onSubmit(code)} className="w-full rounded-2xl bg-white py-2.5 text-sm font-bold text-black">{t(locale, "wa.unlock")}</button>
    </div>
  );
}

function GooglePin({ onSubmit }: { onSubmit: (code: string) => void }) {
  const { locale } = usePrefs();
  const [code, setCode] = useState("");
  return (
    <div className="space-y-2">
      <div className="text-[13px] text-zinc-500">{t(locale, "wsh.pinFallback")}</div>
      <OtpBoxes value={code} onChange={setCode} length={4} label="passcode" />
      <div className="text-[12px] text-zinc-500">{t(locale, "wa.pinHint")}</div>
      <button onClick={() => onSubmit(code)} className="w-full rounded-2xl bg-zinc-900 py-2.5 text-sm font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">{t(locale, "wa.unlock")}</button>
    </div>
  );
}

/* ================= Google-style in-app wallet ================= */

export function GoogleSheet(p: SheetProps) {
  const { locale } = usePrefs();
  const [screen, setScreen] = useState<"home" | "auth" | "processing">("home");
  const [err, setErr] = useState<string | null>(null);
  const [editBill, setEditBill] = useState(false);
  const [busy, setBusy] = useState(false);
  const flowRef = useRef<WalletFlow | null>(null);

  const token = p.tokens.find((x) => x.id === p.selectedId) ?? p.tokens.find((x) => x.isDefault) ?? p.tokens[0] ?? null;
  const b = p.order.buyer;

  const confirm = () => {
    if (busy || !token) return;
    setErr(null);
    const flow = beginSession(p.seed, p.params, p.failures, "card", p.order.totalMinor, "EUR");
    flowRef.current = flow;
    try {
      walletAdvance(flow, { type: "present_token", last4: token.last4, dpan: token.dpan });
      walletAdvance(flow, { type: "start_pay", merchant: "Demo store" });
      pushLive(p.onLive, flow);
      const last = flow.ctx.events[flow.ctx.events.length - 1].type;
      if (last === "CARD_REJECTED" || last === "TOKEN_SUSPENDED") {
        setErr(t(locale, last === "CARD_REJECTED" ? "wa.cardBad" : "wa.tokenBad"));
        return;
      }
      setScreen("auth");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const auth = (pass: boolean) => {
    const flow = flowRef.current;
    if (!flow || busy) return;
    setBusy(true);
    walletAdvance(flow, { type: "unlock_bio", pass });
    pushLive(p.onLive, flow);
    setBusy(false);
    if (flow.stage === "bio" || flow.stage === "pin") { setErr(t(locale, "wsh.authFail")); return; }
    setScreen("processing");
  };

  const steps = [t(locale, "wa.s2"), t(locale, "wa.s3"), t(locale, "wa.s4")];

  if (screen === "processing" && flowRef.current) {
    return <ProcessingLadder steps={steps} onDone={() => { const f = flowRef.current!; p.onDone(f, walletResult(f)); }} />;
  }

  return (
    <div className="mx-auto max-w-[420px] space-y-2">
      <div className="rounded-3xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-600 font-bold text-white">W</span>
          <span className="text-[13px] font-semibold">{t(locale, "wsh.googleT")}</span>
          <span className="ms-auto font-mono font-bold">{formatMoney(p.order.totalMinor, "EUR", locale)}</span>
        </div>
        {screen === "home" && (
          <div className="mt-3 space-y-2.5">
            <div>
              <div className="mb-1 text-[12px] font-bold uppercase tracking-widest text-zinc-500">{t(locale, "wsh.payMethod")}</div>
              {token ? (
                <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 p-2.5 dark:border-zinc-800">
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{token.brand} ···· {token.last4}</div>
                    <div className="text-[12px] text-zinc-500">{token.name} · {token.exp}</div>
                  </div>
                  <button className="text-[12px] underline opacity-70" onClick={p.onNeedCard}>{t(locale, "wsh.change")}</button>
                </div>
              ) : (
                <button onClick={p.onNeedCard} className="w-full rounded-2xl border border-dashed border-zinc-300 p-2.5 text-sm font-semibold dark:border-zinc-700">+ {t(locale, "wsh.addCard")}</button>
              )}
            </div>
            <div className="rounded-2xl bg-zinc-50 p-2.5 text-[13px] dark:bg-zinc-900">
              <div className="flex justify-between"><span className="font-semibold">{t(locale, "wsh.billTo")}</span>
                <button className="underline opacity-70" onClick={() => setEditBill(!editBill)}>{editBill ? t(locale, "wsh.done") : t(locale, "wsh.edit")}</button></div>
              {editBill ? (
                <div className="mt-1 grid grid-cols-2 gap-1">
                  <input aria-label="email" className="rounded border border-zinc-300 px-1.5 py-1 dark:border-zinc-700 dark:bg-zinc-950" value={b.email} onChange={(e) => p.onBuyer({ ...b, email: e.target.value })} />
                  <input aria-label="city" className="rounded border border-zinc-300 px-1.5 py-1 dark:border-zinc-700 dark:bg-zinc-950" value={b.city} onChange={(e) => p.onBuyer({ ...b, city: e.target.value })} />
                </div>
              ) : (
                <div className="text-zinc-600 dark:text-zinc-400">{b.email} · {b.street}, {b.city} {b.postcode}</div>
              )}
            </div>
            {err && <div className="text-[13px] text-red-700 dark:text-red-400">{err}</div>}
            <button disabled={busy || !token} onClick={confirm} className="w-full rounded-2xl bg-sky-700 py-3 text-sm font-bold text-white disabled:opacity-50">{t(locale, "wsh.confirmPay")}</button>
            <button onClick={p.goBack} className="w-full text-center text-[12px] underline opacity-60">{t(locale, "wsh.cancel")}</button>
          </div>
        )}
        {screen === "auth" && (
          <div className="mt-3 space-y-2 p-2 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 text-2xl dark:bg-zinc-800">◉</div>
            <div className="font-mono font-bold">{formatMoney(p.order.totalMinor, "EUR", locale)}</div>
            <div className="text-[12px] text-zinc-500">{t(locale, "wsh.deviceAuth")}</div>
            {err && <div className="text-[13px] text-red-700 dark:text-red-400">{err}</div>}
            {flowRef.current?.stage === "pin" ? (
              <GooglePin onSubmit={(code) => {
                const flow = flowRef.current;
                if (!flow) return;
                walletAdvance(flow, { type: "unlock_pin", pin: code });
                pushLive(p.onLive, flow);
                if (flow.stage === "pin") setErr(t(locale, "wa.pinWrong"));
                else { setErr(null); setScreen("processing"); }
              }} />
            ) : (
              <>
                <button disabled={busy} onClick={() => auth(true)} className="w-full rounded-2xl bg-zinc-900 py-2.5 text-sm font-bold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">{t(locale, "wsh.verifyMe")}</button>
                <div className="flex justify-between text-[12px]">
                  <button onClick={() => auth(false)} className="underline opacity-60">{t(locale, "wsh.simFail")}</button>
                  <button onClick={p.goBack} className="underline opacity-60">{t(locale, "wsh.cancel")}</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <div className="text-center text-[11px] text-zinc-500">{t(locale, "wsh.appNote")}</div>
    </div>
  );
}

/* ================= BaridiMob-style provider flow ================= */

export interface BaridiDraft {
  phone: string;
  card: string;
  exp: string;
}

export function BaridiFlow(p: SheetProps & {
  acct: BaridiAcct | null;
  onEnroll: (phone: string, ribLast4: string) => void;
  onBalance: (delta: number, entry?: { ref: string; merchant: string; totalMinor: number; at: number; status: string }) => void;
  daySpentToday: () => number;
}) {
  const { locale } = usePrefs();
  const [screen, setScreen] = useState<"leaving" | "enroll" | "enrollOtp" | "credentials" | "login" | "home" | "otp" | "processing">("leaving");
  const [draft, setDraft] = useState<BaridiDraft>({ phone: "", card: "", exp: "" });
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [otpErr, setOtpErr] = useState<string | null>(null);
  const [enrollCode, setEnrollCode] = useState("");
  const [cooldown, setCooldown] = useState(OTP_WINDOW_SEC);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const flowRef = useRef<WalletFlow | null>(null);

  const quote = eurToDzd(p.order.totalMinor);
  const enrolled = p.acct !== null;

  useEffect(() => {
    if ((screen !== "otp" && screen !== "enrollOtp") || cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [screen, cooldown]);

  const detCode = (salt: number) => String((p.seed * 7919 + salt * 131071) % 1_000_000).padStart(6, "0");

  const startPaymentSession = () => {
    const flow = beginSession(p.seed, p.params, p.failures, "account", quote.total, "EUR");
    flowRef.current = flow;
    walletAdvance(flow, { type: "link_account", rib: `0000000000000000${p.acct!.ribLast4}`, phone: p.acct!.phone });
    walletAdvance(flow, { type: "start_pay", merchant: "Demo store" });
    pushLive(p.onLive, flow);
    return flow;
  };

  const pay = () => {
    if (busy || !p.acct) return;
    if (p.acct.balanceMinor < quote.total) return;
    if (p.daySpentToday() + quote.total > DAILY_CAP) return;
    setBusy(true);
    try {
      startPaymentSession();
      setCode("");
      setOtpErr(null);
      setCooldown(OTP_WINDOW_SEC);
      setScreen("otp");
    } finally {
      setBusy(false);
    }
  };

  const submitOtp = () => {
    const flow = flowRef.current;
    if (!flow) return;
    walletAdvance(flow, { type: "submit_otp", code: code.trim() });
    pushLive(p.onLive, flow);
    if (flow.stage === "otp") {
      setOtpErr(t(locale, "co.ch.wrong") + ` (${flow.otp?.attemptsLeft ?? 0} ${t(locale, "co.ch.attempts")})`);
      return;
    }
    setOtpErr(null);
    setScreen("processing");
  };

  const resend = () => {
    const flow = flowRef.current;
    if (!flow || cooldown > 0) return;
    walletAdvance(flow, { type: "resend_otp" });
    pushLive(p.onLive, flow);
    setCode("");
    setOtpErr(null);
    setCooldown(OTP_WINDOW_SEC);
  };

  const finishOk = () => {
    const flow = flowRef.current;
    if (!flow || !p.acct) return;
    const r = walletResult(flow);
    // only successful payments move money or touch history
    if (r.finalState === "SETTLED") {
      const ref = `BM-${p.seed}-${p.acct.history.length + 1}`;
      p.onBalance(-quote.total, { ref, merchant: "Demo store", totalMinor: quote.total, at: Date.now(), status: r.finalState });
    }
    p.onDone(flow, r);
  };

  const enrollNext = () => {
    setErr(null);
    if (!/^\d{9,12}$/.test(draft.phone.replace(/\D/g, ""))) { setErr(t(locale, "wba.phoneBad")); return; }
    if (!/^\d{12,19}$/.test(draft.card.replace(/\D/g, ""))) { setErr(t(locale, "wba.cardBad")); return; }
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(draft.exp)) { setErr(t(locale, "co.err.exp")); return; }
    setEnrollCode(detCode(1));
    setCode("");
    setCooldown(OTP_WINDOW_SEC);
    setScreen("enrollOtp");
  };

  const enrollVerify = () => {
    if (cooldown <= 0) { setErr(t(locale, "wba.otpExpired")); return; }
    if (code.trim() !== enrollCode) { setErr(t(locale, "co.ch.wrong")); return; }
    setCode("");
    setErr(null);
    setScreen("credentials");
  };

  const enrollDone = () => {
    if (username.trim().length < 3 || password.length < 4) { setErr(t(locale, "co.err.required")); return; }
    const digits = draft.card.replace(/\D/g, "");
    // password lives in this screen only — never persisted
    p.onEnroll(draft.phone.replace(/\D/g, ""), digits.slice(-4));
    setPassword("");
    setDraft({ phone: "", card: "", exp: "" });
    setErr(null);
  };

  const login = () => {
    if (!p.acct || password.length < 1) { setErr(t(locale, "co.err.required")); return; }
    setPassword("");
    setErr(null);
    setScreen("home");
  };

  const steps = [t(locale, "wa.t2"), t(locale, "wa.t3")];
  const shortRef = `BM-${p.seed}-${(p.acct?.history.length ?? 0) + 1}`;

  if (screen === "processing" && flowRef.current) {
    return <ProcessingLadder steps={steps} onDone={finishOk} />;
  }

  return (
    <div className="mx-auto max-w-[420px] space-y-2">
      <div className="rounded-3xl border-2 border-emerald-700 bg-emerald-50/40 p-4 dark:bg-emerald-950/20">
        <div className="text-center text-[11px] font-bold uppercase tracking-widest text-emerald-800 dark:text-emerald-300">{t(locale, "wba.title")}</div>

        {screen === "leaving" && (
          <div className="mt-2 space-y-2 text-center text-sm">
            <p className="text-zinc-600 dark:text-zinc-300">{t(locale, "wba.leaving")}</p>
            <div className="rounded-2xl bg-white p-3 dark:bg-zinc-950">
              <div className="flex justify-between"><span>Demo store</span><b className="font-mono">{formatMoney(quote.total, "EUR", locale)}</b></div>
              <div className="mt-0.5 text-[12px] text-zinc-500">{t(locale, "wba.ref")}: {shortRef} · {t(locale, "wba.feeNote")}: {formatMoney(quote.fee + quote.spread, "EUR", locale)}</div>
            </div>
            <div className="flex gap-1.5">
              <button onClick={p.goBack} className="flex-1 rounded-2xl border border-zinc-300 py-2.5 text-sm dark:border-zinc-700">{t(locale, "wsh.back")}</button>
              <button onClick={() => setScreen(enrolled ? "login" : "enroll")} className="flex-1 rounded-2xl bg-emerald-700 py-2.5 text-sm font-bold text-white">{t(locale, "wba.continue")}</button>
            </div>
          </div>
        )}

        {screen === "enroll" && (
          <div className="mt-2 space-y-1.5">
            <div className="text-sm font-semibold">{t(locale, "wba.enrollT")}</div>
            <div className="text-[12px] text-zinc-500">{t(locale, "wba.enrollB")}</div>
            <input dir="ltr" inputMode="numeric" aria-label="phone" className="w-full rounded-xl border border-zinc-300 bg-white p-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value.replace(/\D/g, "").slice(0, 12) })} placeholder="0550 12 34 56" autoComplete="off" />
            <input dir="ltr" inputMode="numeric" aria-label="card" className="w-full rounded-xl border border-zinc-300 bg-white p-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950" value={draft.card} onChange={(e) => setDraft({ ...draft, card: e.target.value.replace(/\D/g, "").slice(0, 19) })} placeholder="6070 4400 0000 0000" autoComplete="off" />
            <input dir="ltr" inputMode="numeric" aria-label="exp" className="w-full rounded-xl border border-zinc-300 bg-white p-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950" value={draft.exp} onChange={(e) => setDraft({ ...draft, exp: e.target.value.replace(/\D/g, "").slice(0, 4).replace(/(\d{2})(?=\d)/, "$1/") })} placeholder="MM/YY" autoComplete="off" />
            {err && <div className="text-[13px] text-red-700 dark:text-red-400">{err}</div>}
            <button onClick={enrollNext} className="w-full rounded-2xl bg-emerald-700 py-2.5 text-sm font-bold text-white">{t(locale, "wba.next")}</button>
          </div>
        )}

        {screen === "enrollOtp" && (
          <div className="mt-2 space-y-2">
            <MockSms title={t(locale, "co.ch.sms")}>
              <span>{t(locale, "wba.smsB")} <b className="font-mono text-base">{enrollCode}</b> ({cooldown}s)</span>
            </MockSms>
            <OtpBoxes value={code} onChange={setCode} label="otp" />
            {err && <div className="text-center text-[13px] text-red-700 dark:text-red-400">{err}</div>}
            <button onClick={enrollVerify} className="w-full rounded-2xl bg-emerald-700 py-2.5 text-sm font-bold text-white">{t(locale, "wba.verify")}</button>
            <button disabled={cooldown > 0} onClick={() => { setEnrollCode(detCode(Date.now() % 1000)); setCooldown(OTP_WINDOW_SEC); }} className="w-full text-[12px] underline opacity-70 disabled:no-underline disabled:opacity-40">
              {cooldown > 0 ? `${t(locale, "co.ch.resend")} (${cooldown}s)` : t(locale, "co.ch.resend")}
            </button>
          </div>
        )}

        {screen === "credentials" && (
          <div className="mt-2 space-y-1.5">
            <div className="text-sm font-semibold">{t(locale, "wba.credT")}</div>
            <div className="text-[12px] text-zinc-500">{t(locale, "wba.credB")}</div>
            <input aria-label="username" className="w-full rounded-xl border border-zinc-300 bg-white p-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" autoComplete="off" />
            <input aria-label="password" type="password" className="w-full rounded-xl border border-zinc-300 bg-white p-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••" autoComplete="off" />
            {err && <div className="text-[13px] text-red-700 dark:text-red-400">{err}</div>}
            <button onClick={enrollDone} className="w-full rounded-2xl bg-emerald-700 py-2.5 text-sm font-bold text-white">{t(locale, "wba.finish")}</button>
          </div>
        )}

        {screen === "login" && p.acct && (
          <div className="mt-2 space-y-1.5">
            <div className="text-sm font-semibold">{t(locale, "wba.loginT").replace("{p}", p.acct.phone)}</div>
            <input aria-label="password" type="password" className="w-full rounded-xl border border-zinc-300 bg-white p-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••" autoComplete="off" />
            {err && <div className="text-[13px] text-red-700 dark:text-red-400">{err}</div>}
            <button onClick={login} className="w-full rounded-2xl bg-emerald-700 py-2.5 text-sm font-bold text-white">{t(locale, "wba.login")}</button>
          </div>
        )}

        {screen === "home" && p.acct && (
          <div className="mt-2 space-y-2">
            <div className="rounded-2xl bg-emerald-700 p-3 text-white">
              <div className="text-[11px] uppercase tracking-widest opacity-70">{t(locale, "wba.ccp")}</div>
              <div className="font-mono text-2xl font-bold">{formatMoney(p.acct.balanceMinor, "EUR", locale)}</div>
              <div className="text-[12px] opacity-70">CCP ••{p.acct.ribLast4} · {p.acct.phone}</div>
            </div>
            {p.acct.balanceMinor < quote.total && (
              <div className="space-y-1.5">
                <div className="rounded-xl bg-red-50 p-2 text-[13px] text-red-800 dark:bg-red-950 dark:text-red-200">{t(locale, "wba.nofunds")}</div>
                <button onClick={() => p.onBalance(FAUCET_DZD)} className="w-full rounded-2xl border border-emerald-700 py-2 text-sm font-bold text-emerald-800 dark:text-emerald-200">{t(locale, "wba.faucet")} (+{formatMoney(FAUCET_DZD, "EUR", locale)})</button>
              </div>
            )}
            <div className="rounded-2xl bg-white p-3 text-sm dark:bg-zinc-950">
              <div className="flex justify-between font-semibold"><span>{t(locale, "wba.payTo")}: Demo store</span><span className="font-mono">{formatMoney(quote.total, "EUR", locale)}</span></div>
              <div className="mt-1 space-y-0.5 font-mono text-[12px] text-zinc-500">
                <div className="flex justify-between"><span>{t(locale, "wba.goods")}</span><span>{formatMoney(quote.gross, "EUR", locale)}</span></div>
                <div className="flex justify-between"><span>{t(locale, "rm.spread")} + {t(locale, "rm.fee")}</span><span>{formatMoney(quote.spread + quote.fee, "EUR", locale)}</span></div>
                <div className="flex justify-between"><span>{t(locale, "wba.ref")}</span><span>{shortRef}</span></div>
              </div>
              {p.daySpentToday() + quote.total > DAILY_CAP && (
                <div className="mt-1 rounded-xl bg-red-50 p-2 text-[13px] text-red-800 dark:bg-red-950 dark:text-red-200">{t(locale, "wba.capHit")}</div>
              )}
              <div className="mt-2 flex gap-1.5">
                <button onClick={p.goBack} className="flex-1 rounded-2xl border border-zinc-300 py-2.5 text-sm dark:border-zinc-700">{t(locale, "wsh.cancel")}</button>
                <button disabled={busy || p.acct.balanceMinor < quote.total || p.daySpentToday() + quote.total > DAILY_CAP} onClick={pay} className="flex-1 rounded-2xl bg-emerald-700 py-2.5 text-sm font-bold text-white disabled:opacity-40">{t(locale, "wba.pay")}</button>
              </div>
            </div>
            {p.acct.history.length > 0 && (
              <div className="space-y-1 text-[13px]">
                <div className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">{t(locale, "wba.mini")}</div>
                {p.acct.history.slice(-5).reverse().map((h, i) => (
                  <div key={i} className="flex justify-between rounded-lg bg-white px-2 py-1 dark:bg-zinc-950">
                    <span className="font-mono">{h.ref}</span>
                    <span className="font-mono font-bold">{formatMoney(h.totalMinor, "EUR", locale)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {screen === "otp" && (
          <div className="mt-2 space-y-2">
            <MockSms title={t(locale, "co.ch.sms")}>
              <OtpCodeText flowRef={flowRef} />
            </MockSms>
            <OtpBoxes value={code} onChange={setCode} label="otp" />
            {otpErr && <div className="text-center text-[13px] text-red-700 dark:text-red-400">{otpErr}</div>}
            <div className="text-center font-mono text-[12px] text-zinc-500">{cooldown}s</div>
            <button onClick={submitOtp} className="w-full rounded-2xl bg-emerald-700 py-2.5 text-sm font-bold text-white">{t(locale, "wba.confirmPay")}</button>
            <button disabled={cooldown > 0} onClick={resend} className="w-full text-[12px] underline opacity-70 disabled:no-underline disabled:opacity-40">
              {cooldown > 0 ? `${t(locale, "co.ch.resend")} (${cooldown}s)` : t(locale, "co.ch.resend")}
            </button>
            <button onClick={p.goBack} className="w-full text-[12px] underline opacity-60">{t(locale, "wsh.cancel")}</button>
          </div>
        )}
      </div>
      <div className="text-center text-[11px] text-zinc-500">{t(locale, "wba.providerNote")}</div>
    </div>
  );
}

function OtpCodeText({ flowRef }: { flowRef: React.RefObject<WalletFlow | null> }) {
  const { locale } = usePrefs();
  const evs = [...(flowRef.current?.ctx.events ?? [])].reverse();
  const sent = evs.find((e) => e.type === "OTP_SENT");
  const code = typeof sent?.payload.code === "string" ? sent.payload.code : "…";
  return <span>{t(locale, "wba.smsB")} <b className="font-mono text-base">{code}</b></span>;
}
