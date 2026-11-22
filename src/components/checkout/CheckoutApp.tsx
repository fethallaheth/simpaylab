/**
 * High-fidelity online-checkout buyer flow (C2a).
 *
 * Empty by default: no prefilled products in the cart, no prefilled customer
 * data, no prefilled card. The student shops, types fictional details, passes
 * a mock 3-D Secure challenge and watches the engine settle — every screen is
 * driven by the staged engine (`checkoutAdvance`), so the timeline, inspector,
 * receipts and ledger below always reflect what just happened.
 */
"use client";
import { useEffect, useRef, useState } from "react";
import {
  DEMO_CARDS,
  checkoutAdvance,
  checkoutResult,
  createCheckoutFlow,
  createRunBase,
  type CheckoutFlow,
  type FailureId,
  type RunResult,
  type SimEvent
} from "@sim/engine";
import { t } from "@/i18n/dict";
import { formatMoney, listSessions, saveSession, type StoredSession } from "@/lib/sim";
import { usePrefs } from "../providers";
import { Badge, Btn, Card } from "../ui";
import { PRODUCTS, priceFor, productById } from "./catalog";
import {
  EMPTY_CARD,
  EMPTY_INFO,
  formatExp,
  formatPan,
  validateCardFormat,
  validateInfo,
  type CardFields,
  type ErrorCode,
  type InfoFields
} from "./validation";
import { Time } from "../flows/kit";

type Screen = "shop" | "cart" | "info" | "pay" | "challenge" | "processing" | "result" | "orders";

interface CartLine {
  id: string;
  qty: number;
}

const COUNTRIES = ["Algeria", "France", "Spain", "Italy", "Germany", "Morocco", "Tunisia", "Other"];

function errText(locale: Parameters<typeof t>[0], code: ErrorCode): string {
  switch (code) {
    case "email": return t(locale, "co.err.email");
    case "postcode": return t(locale, "co.err.post");
    case "pan-format": return t(locale, "co.err.pan");
    case "exp-format": return t(locale, "co.err.exp");
    case "exp-past": return t(locale, "co.err.exppast");
    case "cvc-format": return t(locale, "co.err.cvc");
    default: return t(locale, "co.err.required");
  }
}

function declineKey(reason: unknown): string {
  switch (String(reason ?? "")) {
    case "insufficient-funds": return "co.decline.insufficient-funds";
    case "expired-card": return "co.decline.expired-card";
    case "wrong-cvc": return "co.decline.wrong-cvc";
    case "suspected-fraud": return "co.decline.suspected-fraud";
    case "wrong-otp": return "co.decline.wrong-otp";
    case "abandoned": return "co.decline.abandoned";
    default: return "co.decline.issuer-decline";
  }
}

export function CheckoutApp({ seed, params, failures, onLive }: {
  seed: number;
  params: Record<string, unknown>;
  failures: FailureId[];
  onLive: (r: RunResult) => void;
}) {
  const { locale } = usePrefs();
  const [screen, setScreen] = useState<Screen>("shop");
  const [region, setRegion] = useState<"eu" | "dz">("eu");
  const ccy = region === "dz" ? "DZD" : "EUR";
  const [cart, setCart] = useState<CartLine[]>([]);
  const [info, setInfo] = useState<InfoFields>(EMPTY_INFO);
  const [infoErrors, setInfoErrors] = useState<Partial<Record<keyof InfoFields, ErrorCode>>>({});
  const [card, setCard] = useState<CardFields>(EMPTY_CARD);
  const [cardErrors, setCardErrors] = useState<Partial<Record<keyof CardFields, ErrorCode>>>({});
  const [engineCardError, setEngineCardError] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [procPlan, setProcPlan] = useState<"challenge" | "result">("result");
  const [orders, setOrders] = useState<StoredSession[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const flowRef = useRef<CheckoutFlow | null>(null);
  const savedRef = useRef(false);
  const totalRef = useRef(0);

  const total = cart.reduce((s, l) => s + priceFor(productById(l.id)!, ccy) * l.qty, 0);
  const count = cart.reduce((s, l) => s + l.qty, 0);

  // A spec change (scenario / seed / params / failures) starts a fresh run.
  const specKey = JSON.stringify({ seed, params, failures, region });
  useEffect(() => {
    flowRef.current = null;
    savedRef.current = false;
    setCart([]);
    setInfo(EMPTY_INFO);
    setCard(EMPTY_CARD);
    setScreen("shop");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  useEffect(() => {
    if (screen === "orders") {
      setOrders(listSessions().filter((s) => s.spec.moduleId === "checkout"));
    }
  }, [screen]);

  const push = (): RunResult => {
    const r = checkoutResult(flowRef.current!);
    onLive(r);
    return r;
  };
  const otpCode = (): string | null => {
    const evs = [...(flowRef.current?.ctx.events ?? [])].reverse();
    const sent = evs.find((e) => e.type === "OTP_SENT");
    return typeof sent?.payload.code === "string" ? sent.payload.code : null;
  };
  const attemptsLeft = (): number => flowRef.current?.otp?.attemptsLeft ?? 0;

  const startSession = (): CheckoutFlow => {
    totalRef.current = total;
    const base = createRunBase("checkout", { seed, params: { ...params, amountMinor: total, currency: ccy }, failures });
    const flow = createCheckoutFlow(base);
    flowRef.current = flow;
    savedRef.current = false;
    return flow;
  };

  // ---- cart ----
  const add = (id: string) => setCart((c) => {
    const line = c.find((l) => l.id === id);
    return line ? c.map((l) => (l.id === id ? { ...l, qty: l.qty + 1 } : l)) : [...c, { id, qty: 1 }];
  });
  const dec = (id: string) => setCart((c) => c.flatMap((l) => (l.id === id ? (l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : []) : [l])));

  // ---- info ----
  const submitInfo = () => {
    const errs = validateInfo(info);
    setInfoErrors(errs);
    if (Object.keys(errs).length === 0) setScreen("pay");
  };

  // ---- payment ----
  const pay = () => {
    const errs = validateCardFormat(card);
    setCardErrors(errs);
    setEngineCardError(null);
    if (Object.keys(errs).length > 0) return;
    let flow = flowRef.current;
    if (!flow || (flow.stage !== "cart" && flow.stage !== "card")) flow = startSession();
    if (flow.stage === "cart") {
      checkoutAdvance(flow, {
        type: "submit_cart",
        items: cart.map((l) => {
          const p = productById(l.id)!;
          return { name: p.name, qty: l.qty, priceMinor: priceFor(p, ccy) };
        }),
        buyer: { email: info.email.trim(), name: `${info.firstName.trim()} ${info.lastName.trim()}` }
      });
      push();
    }
    const { events } = checkoutAdvance(flow, { type: "submit_card", pan: card.pan, name: card.name, exp: card.exp, cvc: card.cvc });
    push();
    const last = events[events.length - 1];
    if (last?.type === "CARD_REJECTED") {
      setEngineCardError(typeof last.payload.reason === "string" ? last.payload.reason : "card.badFormat");
      return;
    }
    setOtp("");
    setOtpError(null);
    setCooldown(0);
    setProcPlan(flow.stage === "tds" ? "challenge" : "result");
    setScreen("processing");
  };

  // ---- 3DS challenge ----
  const submitOtp = () => {
    const flow = flowRef.current;
    if (!flow) return;
    const { events } = checkoutAdvance(flow, { type: "submit_otp", code: otp.trim() });
    push();
    const last = events[events.length - 1];
    if (flow.stage === "tds") {
      const left = flow.otp?.attemptsLeft ?? 0;
      setOtpError(t(locale, "co.ch.wrong") + ` (${left} ${t(locale, "co.ch.attempts")})`);
      void last;
    } else {
      setOtpError(null);
      setProcPlan("result");
      setScreen("processing");
    }
  };
  const resend = () => {
    const flow = flowRef.current;
    if (!flow || cooldown > 0) return;
    checkoutAdvance(flow, { type: "resend_otp" });
    push();
    setOtp("");
    setOtpError(null);
    setCooldown(30);
  };
  const abandon = () => {
    const flow = flowRef.current;
    if (!flow) return;
    checkoutAdvance(flow, { type: "abandon_tds" });
    push();
    setScreen("result");
  };

  // ---- result ----
  const flow = flowRef.current;
  const result = flow ? checkoutResult(flow) : null;
  useEffect(() => {
    if (screen === "result" && flow && !savedRef.current) {
      savedRef.current = true;
      saveSession(
        { moduleId: "checkout", seed, params: { ...params, amountMinor: totalRef.current, currency: flow.ctx.currency }, failures },
        checkoutResult(flow),
        flow.transcript
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);
  const authCode = (): string | null => {
    const ev = flow?.ctx.events.find((e) => e.type === "ORDER_CONFIRMED");
    return typeof ev?.payload.authCode === "string" ? ev.payload.authCode : null;
  };
  const declineReason = (): string | null => {
    const evs = [...(flow?.ctx.events ?? [])].reverse();
    const d = evs.find((e) => e.type === "ISSUER_DECLINED" || e.type === "TDS_FAILED");
    return d ? String(d.payload.reason ?? "") : null;
  };

  const resetShop = () => {
    flowRef.current = null;
    savedRef.current = false;
    setCart([]);
    setInfo(EMPTY_INFO);
    setCard(EMPTY_CARD);
    setScreen("shop");
  };

  const field = (label: string, error: ErrorCode | undefined, input: React.ReactNode) => (
    <label className="block text-[13px]">
      <span className="mb-1 block font-medium">{label}</span>
      {input}
      {error && <span className="mt-0.5 block text-red-700 dark:text-red-400">{errText(locale, error)}</span>}
    </label>
  );
  const inp = "mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <div className="space-y-2">
      {screen === "shop" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">{t(locale, "co.shop.title")}</div>
              <div className="text-[13px] text-zinc-500">{t(locale, "co.shop.sub")}</div>
            </div>
            <div className="flex gap-1.5">
              <div className="flex overflow-hidden rounded-lg border border-zinc-300 text-[12px] dark:border-zinc-700" role="group" aria-label="region">
                {(["eu", "dz"] as const).map((r) => (
                  <button key={r} onClick={() => setRegion(r)} className={`px-2 py-1 ${region === r ? "bg-zinc-900 font-bold text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500"}`}>
                    {t(locale, r === "eu" ? "co.region.eu" : "co.region.dz")}
                  </button>
                ))}
              </div>
              <Btn small variant="outline" onClick={() => setScreen("orders")}>{t(locale, "co.ok.orders")}</Btn>
              <Btn small onClick={() => setScreen("cart")} disabled={count === 0}>{t(locale, "co.shop.cart")} ({count})</Btn>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {PRODUCTS.map((p) => (
              <Card key={p.id} className="p-3">
                <div className="font-semibold text-sm">{p.name}</div>
                <div className="text-[13px] text-zinc-500">{p.blurb}</div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="font-mono font-bold">{formatMoney(priceFor(p, ccy), ccy, locale)}</span>
                  <Btn small onClick={() => add(p.id)}>{t(locale, "co.shop.add")}</Btn>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {screen === "cart" && (
        <Card className="space-y-2 p-3">
          <div className="font-semibold">{t(locale, "co.cart.title")}</div>
          {cart.length === 0 && <div className="text-sm text-zinc-500">{t(locale, "co.shop.empty")}</div>}
          {cart.map((l) => {
            const p = productById(l.id)!;
            return (
              <div key={l.id} className="flex items-center gap-2 rounded-lg bg-zinc-50 p-2 text-sm dark:bg-zinc-900">
                <div className="flex-1">
                  <div className="font-medium">{p.name}</div>
                  <div className="font-mono text-[13px] text-zinc-500">{formatMoney(priceFor(p, ccy), ccy, locale)}</div>
                </div>
                <button aria-label="decrease" className="rounded border border-zinc-300 px-2 dark:border-zinc-700" onClick={() => dec(l.id)}>−</button>
                <span className="font-mono">{l.qty}</span>
                <button aria-label="increase" className="rounded border border-zinc-300 px-2 dark:border-zinc-700" onClick={() => add(l.id)}>+</button>
              </div>
            );
          })}
          {cart.length > 0 && (
            <div className="flex items-center justify-between border-t border-zinc-200 pt-2 text-sm dark:border-zinc-800">
              <span className="font-semibold">{t(locale, "co.cart.total")}</span>
              <span className="font-mono font-bold">{formatMoney(total, ccy, locale)}</span>
            </div>
          )}
          <div className="flex gap-1.5">
            <Btn small variant="outline" onClick={() => setScreen("shop")}>{t(locale, "co.cart.back")}</Btn>
            <Btn small onClick={() => setScreen("info")} disabled={cart.length === 0}>{t(locale, "co.cart.continue")}</Btn>
          </div>
        </Card>
      )}

      {screen === "info" && (
        <Card className="space-y-2 p-3">
          <div className="font-semibold">{t(locale, "co.info.title")}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="sm:col-span-2">{field(t(locale, "co.info.email"), infoErrors.email, <input dir="ltr" className={inp} value={info.email} onChange={(e) => setInfo({ ...info, email: e.target.value })} placeholder="amina@example.dz" autoComplete="off" />)}</div>
            {field(t(locale, "co.info.first"), infoErrors.firstName, <input className={inp} value={info.firstName} onChange={(e) => setInfo({ ...info, firstName: e.target.value })} autoComplete="off" />)}
            {field(t(locale, "co.info.last"), infoErrors.lastName, <input className={inp} value={info.lastName} onChange={(e) => setInfo({ ...info, lastName: e.target.value })} autoComplete="off" />)}
            <div className="sm:col-span-2">{field(t(locale, "co.info.street"), infoErrors.street, <input className={inp} value={info.street} onChange={(e) => setInfo({ ...info, street: e.target.value })} autoComplete="off" />)}</div>
            {field(t(locale, "co.info.city"), infoErrors.city, <input className={inp} value={info.city} onChange={(e) => setInfo({ ...info, city: e.target.value })} autoComplete="off" />)}
            {field(t(locale, "co.info.post"), infoErrors.postcode, <input className={inp} value={info.postcode} onChange={(e) => setInfo({ ...info, postcode: e.target.value })} autoComplete="off" />)}
            <div className="sm:col-span-2">{field(t(locale, "co.info.country"), infoErrors.country, (
              <select className={inp} value={info.country} onChange={(e) => setInfo({ ...info, country: e.target.value })}>
                <option value="">—</option>
                {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            ))}</div>
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={!info.shipDifferent} onChange={(e) => setInfo({ ...info, shipDifferent: !e.target.checked })} />
            {t(locale, "co.info.ship")}
          </label>
          {info.shipDifferent && (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="sm:col-span-2">{field(t(locale, "co.info.street"), infoErrors.shipStreet, <input className={inp} value={info.shipStreet} onChange={(e) => setInfo({ ...info, shipStreet: e.target.value })} autoComplete="off" />)}</div>
              {field(t(locale, "co.info.city"), infoErrors.shipCity, <input className={inp} value={info.shipCity} onChange={(e) => setInfo({ ...info, shipCity: e.target.value })} autoComplete="off" />)}
              {field(t(locale, "co.info.post"), infoErrors.shipPostcode, <input className={inp} value={info.shipPostcode} onChange={(e) => setInfo({ ...info, shipPostcode: e.target.value })} autoComplete="off" />)}
              <div className="sm:col-span-2">{field(t(locale, "co.info.country"), infoErrors.shipCountry, (
                <select className={inp} value={info.shipCountry} onChange={(e) => setInfo({ ...info, shipCountry: e.target.value })}>
                  <option value="">—</option>
                  {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              ))}</div>
            </div>
          )}
          <div className="flex gap-1.5">
            <Btn small variant="outline" onClick={() => setScreen("cart")}>{t(locale, "co.cart.back")}</Btn>
            <Btn small onClick={submitInfo}>{t(locale, "co.info.continue")}</Btn>
          </div>
        </Card>
      )}

      {screen === "pay" && (
        <Card className="space-y-2 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">{t(locale, "co.pay.title")}</span>
            <span className="font-mono font-bold">{formatMoney(total, ccy, locale)}</span>
          </div>
          <div className="space-y-2">
            {field(t(locale, "co.pay.pan"), cardErrors.pan, <input dir="ltr" inputMode="numeric" className={`${inp} font-mono`} value={card.pan} onChange={(e) => setCard({ ...card, pan: formatPan(e.target.value) })} placeholder="4000 0000 0000 0000" autoComplete="off" />)}
            {field(t(locale, "co.pay.name"), cardErrors.name, <input className={`${inp} uppercase`} value={card.name} onChange={(e) => setCard({ ...card, name: e.target.value })} autoComplete="off" />)}
            <div className="grid grid-cols-2 gap-2">
              {field(t(locale, "co.pay.exp"), cardErrors.exp, <input dir="ltr" inputMode="numeric" className={`${inp} font-mono`} value={card.exp} onChange={(e) => setCard({ ...card, exp: formatExp(e.target.value) })} placeholder="MM/YY" autoComplete="off" />)}
              {field(t(locale, "co.pay.cvc"), cardErrors.cvc, <input dir="ltr" inputMode="numeric" className={`${inp} font-mono`} value={card.cvc} onChange={(e) => setCard({ ...card, cvc: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="123" autoComplete="off" />)}
            </div>
          </div>
          {engineCardError && <div className="rounded-lg bg-red-50 p-2 text-[13px] text-red-700 dark:bg-red-950 dark:text-red-300">{t(locale, engineCardError)}</div>}
          <details className="rounded-lg bg-zinc-50 p-2 text-[13px] dark:bg-zinc-900">
            <summary className="cursor-pointer font-medium">{t(locale, "co.pay.hintT")}</summary>
            <div className="mt-1 text-zinc-600 dark:text-zinc-400">{t(locale, "co.pay.hintB")}</div>
            <div className="mt-1 space-y-1">
              {DEMO_CARDS.map((c) => (
                <div key={c.id} className="flex items-center gap-2 font-mono text-[12px]">
                  <span className="flex-1">{c.label} · {c.pan} · {c.exp} · {c.cvc}</span>
                  <button className="rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-700" onClick={() => setCard({ pan: formatPan(c.pan), name: card.name, exp: c.exp, cvc: c.cvc })}>{t(locale, "co.pay.fill")}</button>
                </div>
              ))}
            </div>
          </details>
          <div className="flex gap-1.5">
            <Btn small variant="outline" onClick={() => setScreen("info")}>{t(locale, "co.pay.back")}</Btn>
            <Btn small onClick={pay}>{t(locale, "co.pay.submit")} {formatMoney(total, ccy, locale)}</Btn>
          </div>
          <div className="text-[12px] text-zinc-500">{t(locale, "co.pay.note")}</div>
        </Card>
      )}

      {screen === "challenge" && flow && (
        <div className="mx-auto max-w-[340px] space-y-2">
          <div className="rounded-2xl bg-zinc-900 p-4 text-white dark:bg-zinc-100 dark:text-zinc-900">
            <div className="text-[11px] uppercase tracking-widest opacity-70">{t(locale, region === "dz" ? "co.ch.titleDz" : "co.ch.title")}</div>
            <div className="mt-1 font-mono text-xl font-bold">{formatMoney(totalRef.current, ccy, locale)}</div>
            <div className="text-[12px] opacity-70">{t(locale, region === "dz" ? "co.ch.bodyDz" : "co.ch.body")}</div>
            <div className="mt-2">
              <input dir="ltr" inputMode="numeric" aria-label={t(locale, "co.ch.otp")} className="w-full rounded-xl border border-zinc-500 bg-transparent p-2 text-center font-mono text-lg tracking-[0.4em]" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="••••••" autoComplete="off" />
            </div>
            {otpError && <div className="mt-1 text-[13px] text-red-300 dark:text-red-700">{otpError}</div>}
            <div className="mt-1 text-[12px] opacity-70">{attemptsLeft()} {t(locale, "co.ch.attempts")}</div>
            <button onClick={submitOtp} className="mt-2 w-full rounded-xl bg-white py-2 text-sm font-bold text-zinc-900 dark:bg-zinc-900 dark:text-white">{t(locale, "co.ch.approve")}</button>
            <button onClick={resend} disabled={cooldown > 0} className="mt-1 w-full text-[12px] underline opacity-70 disabled:no-underline disabled:opacity-40">
              {cooldown > 0 ? `${t(locale, "co.ch.resend")} (${cooldown}s)` : t(locale, "co.ch.resend")}
            </button>
            <button onClick={abandon} className="mt-1 w-full text-[12px] underline opacity-70">{t(locale, "co.ch.abandon")}</button>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3 text-[13px] dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">{t(locale, region === "dz" ? "co.ch.smsDz" : "co.ch.sms")}</div>
            {otpCode() ? (
              <div className="mt-1">{t(locale, region === "dz" ? "co.ch.senderDz" : "co.ch.sender")}: {t(locale, "co.ch.smsB")} <b className="font-mono text-base">{otpCode()}</b></div>
            ) : (
              <div className="mt-1 text-zinc-500">…</div>
            )}
          </div>
        </div>
      )}

      {screen === "processing" && (
        <ProcessingScreen plan={procPlan} onDone={() => setScreen(flowRef.current?.stage === "tds" ? "challenge" : "result")} />
      )}

      {screen === "result" && result && (
        <Card className="space-y-2 p-3">
          {result.finalState === "SETTLED" && (
            <>
              <div className="font-semibold text-emerald-700 dark:text-emerald-300">✓ {t(locale, "co.ok.title")}</div>
              <div className="grid grid-cols-2 gap-2 text-center text-[13px]">
                <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900"><div className="font-mono font-bold">{formatMoney(result.receipt.amountMinor, result.receipt.currency, locale)}</div><div className="text-zinc-500">{t(locale, "co.cart.total")}</div></div>
                <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900"><div className="font-mono font-bold">{authCode() ?? "—"}</div><div className="text-zinc-500">{t(locale, "co.ok.auth")}</div></div>
              </div>
              <div className="text-[13px] text-zinc-600 dark:text-zinc-400">{t(locale, "co.ok.note")}</div>
            </>
          )}
          {result.finalState === "AUTHORIZED" && (
            <>
              <div className="font-semibold text-sky-700 dark:text-sky-300">{t(locale, "co.pend.title")}</div>
              <div className="text-[13px] text-zinc-600 dark:text-zinc-400">{t(locale, "co.pend.body")}</div>
              <div className="font-mono text-sm">{t(locale, "co.ok.auth")}: {authCode() ?? "—"}</div>
            </>
          )}
          {(result.finalState === "DECLINED" || result.finalState === "CANCELLED") && (
            <>
              <div className="font-semibold text-red-700 dark:text-red-400">✕ {t(locale, "co.no.title")}</div>
              <div className="rounded-lg bg-red-50 p-2 text-[13px] text-red-800 dark:bg-red-950 dark:text-red-200">{t(locale, declineKey(declineReason()))}</div>
              <div className="flex gap-1.5">
                <Btn small onClick={() => { flowRef.current = null; setCard(EMPTY_CARD); setCardErrors({}); setScreen("pay"); }}>{t(locale, "co.no.retry")}</Btn>
              </div>
            </>
          )}
          <div className="font-mono text-[12px] text-zinc-500">{result.txId} · {result.events.length} events · seed {result.seed}</div>
          <div className="flex gap-1.5">
            <Btn small variant="outline" onClick={() => setScreen("orders")}>{t(locale, "co.ok.orders")}</Btn>
            <Btn small variant="outline" onClick={resetShop}>{t(locale, "co.ok.shop")}</Btn>
          </div>
        </Card>
      )}

      {screen === "orders" && (
        <Card className="space-y-2 p-3">
          <div className="font-semibold">{t(locale, "co.orders.title")}</div>
          {orders.length === 0 && <div className="text-sm text-zinc-500">{t(locale, "co.orders.empty")}</div>}
          {orders.map((o) => {
            const cartEv = o.result.events.find((e) => e.type === "CART_CREATED");
            const items = typeof cartEv?.payload.itemCount === "number" ? cartEv.payload.itemCount : 0;
            const open = expanded === o.id;
            return (
              <div key={o.id} className="rounded-lg bg-zinc-50 p-2 text-[13px] dark:bg-zinc-900">
                <button className="flex w-full items-center gap-2 text-left" onClick={() => setExpanded(open ? null : o.id)}>
                  <div className="flex-1">
                    <div className="font-mono">{o.result.txId}</div>
                    <div className="text-zinc-500"><Time at={o.at} /> · {items} {t(locale, "co.orders.items")} · <span className="font-mono">{formatMoney(o.result.receipt.amountMinor, o.result.receipt.currency, locale)}</span></div>
                  </div>
                  <Badge tone={o.result.finalState === "SETTLED" ? "green" : o.result.finalState === "AUTHORIZED" ? "blue" : "red"}>{o.result.finalState}</Badge>
                  <span className="text-zinc-400">{open ? "▾" : "▸"}</span>
                </button>
                {open && <OrderDetail order={o} />}
              </div>
            );
          })}
          <div><Btn small variant="outline" onClick={() => setScreen(cart.length ? "cart" : "shop")}>{t(locale, "co.orders.back")}</Btn></div>
        </Card>
      )}
    </div>
  );
}

function ProcessingScreen({ plan, onDone }: { plan: "challenge" | "result"; onDone: () => void }) {
  const { locale } = usePrefs();
  const [idx, setIdx] = useState(0);
  const steps = ["co.proc.s1", "co.proc.s2", "co.proc.s3", "co.proc.s4", "co.proc.s5", "co.proc.s6"];
  useEffect(() => {
    if (idx >= steps.length) {
      const id = setTimeout(onDone, 350);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setIdx((i) => i + 1), 480);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);
  void plan;
  return (
    <Card className="mx-auto max-w-[340px] space-y-1.5 p-4">
      <div className="text-center font-semibold">{t(locale, "co.proc.title")}</div>
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-2 text-sm">
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${i < idx ? "bg-emerald-600 text-white" : i === idx ? "bg-sky-600 text-white" : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800"}`}>
            {i < idx ? "✓" : i + 1}
          </span>
          <span className={i <= idx ? "" : "text-zinc-400"}>{t(locale, s)}</span>
          {i === idx && <span className="ms-auto animate-pulse text-[12px] text-sky-600">…</span>}
        </div>
      ))}
    </Card>
  );
}

/** Buyer-facing notifications, derived from the event log (mock channel labels). */
function notificationsFor(events: SimEvent[]): { channel: string; key: string }[] {
  const out: { channel: string; key: string }[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    switch (e.type) {
      case "OTP_SENT":
        if (!seen.has("otp")) { seen.add("otp"); out.push({ channel: "sms", key: "co.nt.otp" }); }
        break;
      case "ORDER_CONFIRMED": out.push({ channel: "email", key: "co.nt.order" }); break;
      case "CAPTURE_DEFERRED": out.push({ channel: "email", key: "co.nt.deferred" }); break;
      case "SETTLED": out.push({ channel: "email", key: "co.nt.settled" }); break;
      case "REFUND_PARTIAL": out.push({ channel: "email", key: "co.nt.refundPart" }); break;
      case "REFUND_ISSUED": out.push({ channel: "email", key: "co.nt.refund" }); break;
      case "CHARGEBACK_OPENED": out.push({ channel: "sms", key: "co.nt.dispute" }); break;
      case "REPRESENTMENT_WON": out.push({ channel: "email", key: "co.nt.cbWon" }); break;
      case "REPRESENTMENT_LOST": out.push({ channel: "email", key: "co.nt.cbLost" }); break;
    }
  }
  return out;
}

function OrderDetail({ order }: { order: StoredSession }) {
  const { locale } = usePrefs();
  const r = order.result;
  const cartEv = r.events.find((e) => e.type === "CART_CREATED");
  const rawItems = cartEv?.payload.items;
  const items: { name: string; qty: number; priceMinor: number }[] = Array.isArray(rawItems)
    ? rawItems.filter((x): x is { name: string; qty: number; priceMinor: number } =>
      typeof x === "object" && x !== null && typeof (x as { name?: unknown }).name === "string")
    : [];
  const authEv = r.events.find((e) => e.type === "ORDER_CONFIRMED");
  const notes = notificationsFor(r.events);
  return (
    <div className="mt-2 space-y-1.5 border-t border-zinc-200 pt-2 dark:border-zinc-800">
      {items.map((it, i) => (
        <div key={i} className="flex justify-between gap-2">
          <span>{it.name} × {it.qty}</span>
          <span className="font-mono">{formatMoney(it.priceMinor * it.qty, r.receipt.currency, locale)}</span>
        </div>
      ))}
      <div className="flex justify-between gap-2 text-zinc-500">
        <span>{t(locale, "co.m.fees")}</span>
        <span className="font-mono">{formatMoney(r.receipt.totalFeesMinor, r.receipt.currency, locale)}</span>
      </div>
      {typeof authEv?.payload.authCode === "string" && (
        <div className="flex justify-between gap-2 text-zinc-500">
          <span>{t(locale, "co.ok.auth")}</span>
          <span className="font-mono">{authEv.payload.authCode}</span>
        </div>
      )}
      <div className="pt-1 text-[11px] font-bold uppercase tracking-widest text-zinc-500">{t(locale, "co.nt.title")}</div>
      {notes.length === 0 && <div className="text-zinc-500">—</div>}
      {notes.map((n, i) => (
        <div key={i} className="flex gap-2">
          <Badge tone={n.channel === "sms" ? "blue" : "zinc"}>{n.channel}</Badge>
          <span>{t(locale, n.key)}</span>
        </div>
      ))}
    </div>
  );
}
