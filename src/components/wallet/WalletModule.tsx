/**
 * Module 1 — Mobile Wallet Payments: a complete shopping + checkout experience.
 *
 * Shop (empty cart, real totals) -> checkout info (typed, validated) ->
 * one of three distinct wallet workflows (device sheet / in-app wallet /
 * postal-provider redirect) -> receipt + order history. Tokens persist;
 * PANs and CVCs never do. Timeline/inspector below follow every gesture.
 */
"use client";
import { useEffect, useRef, useState } from "react";
import {
  type FailureId,
  type RunResult,
  type SimEvent,
  type WalletFlow
} from "@sim/engine";
import { t } from "@/i18n/dict";
import { clearSessionsForModule, formatMoney, listSessions, saveSession, type StoredSession } from "@/lib/sim";
import { usePrefs } from "../providers";
import { Badge, Btn, Card } from "../ui";
import { EmptyNote, StepHead, Time, inpCls, useSpecReset } from "../flows/kit";
import { EMPTY_INFO, validateInfo, type InfoFields } from "../checkout/validation";
import { STORE, totals, type CartLine, type Totals } from "./store";
import { AppleSheet, BaridiFlow, GoogleSheet, type BaridiAcct, type Order, type TokenRef } from "./sheets";
import { AddCardFlow } from "./AddCard";
import { SetupWizard, UnlockScreen, clearProfile, loadProfile, saveProfile, type WalletProfile } from "./setup";

type Tab = "shop" | "checkout" | "wallet" | "orders";
type Method = "apple" | "google" | "baridi";

const CART_KEY = "simpay.wallet.cart.v1";
const TOKENS_KEY = "simpay.wallet.tokens.v2";
const BARIDI_KEY = "simpay.wallet.baridi.v1";

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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function WalletModule({ seed, params, failures, onLive }: {
  seed: number;
  params: Record<string, unknown>;
  failures: FailureId[];
  onLive: (r: RunResult) => void;
}) {
  const { locale } = usePrefs();
  const [tab, setTab] = useState<Tab>("shop");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [info, setInfo] = useState<InfoFields>(EMPTY_INFO);
  const [infoErrors, setInfoErrors] = useState<Partial<Record<keyof InfoFields, string>>>({});
  const [method, setMethod] = useState<Method | null>(null);
  const [order, setOrder] = useState<(Order & { nonce: number }) | null>(null);
  const [tokens, setTokens] = useState<TokenRef[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [baridi, setBaridi] = useState<BaridiAcct | null>(null);
  const [receipt, setReceipt] = useState<{ flow: WalletFlow; result: RunResult; method: Method } | null>(null);
  const [orders, setOrders] = useState<StoredSession[]>([]);
  const [resetArm, setResetArm] = useState(false);
  const [orderNote, setOrderNote] = useState<string | null>(null);
  const [profile, setProfile] = useState<WalletProfile | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    setCart(load<CartLine[]>(CART_KEY, []));
    setTokens(load<TokenRef[]>(TOKENS_KEY, []));
    setBaridi(load<BaridiAcct | null>(BARIDI_KEY, null));
    setProfile(loadProfile());
  }, []);
  useSpecReset(JSON.stringify({ seed, params, failures }), () => {
    setOrder(null);
    setReceipt(null);
    setMethod(null);
    setInfo(EMPTY_INFO);
  });
  useEffect(() => {
    if (tab === "orders") setOrders(listSessions().filter((s) => s.spec.moduleId === "wallet"));
  }, [tab]);

  const persistTokens = (ts: TokenRef[]) => {
    // tokens only: PAN/CVC are wiped at provisioning time and never reach here
    const clean = ts.map(({ id, last4, exp, name, dpan, brand, isDefault }) => ({ id, last4, exp, name, dpan, brand, isDefault }));
    setTokens(clean);
    store(TOKENS_KEY, clean);
    if (!selectedId && clean.length > 0) setSelectedId(clean.find((c) => c.isDefault)?.id ?? clean[0].id);
  };
  const persistBaridi = (b: BaridiAcct | null) => {
    setBaridi(b);
    if (b) store(BARIDI_KEY, b);
    else try { localStorage.removeItem(BARIDI_KEY); } catch { /* noop */ }
  };

  const tt = totals(cart);

  const add = (id: string) => setCart((c) => {
    const next = c.find((l) => l.id === id) ? c.map((l) => (l.id === id ? { ...l, qty: l.qty + 1 } : l)) : [...c, { id, qty: 1 }];
    store(CART_KEY, next);
    return next;
  });
  const dec = (id: string) => setCart((c) => {
    const next = c.flatMap((l) => (l.id === id ? (l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : []) : [l]));
    store(CART_KEY, next);
    return next;
  });

  const placeOrder = () => {
    const errs = validateInfo(info);
    setInfoErrors(errs as Partial<Record<keyof InfoFields, string>>);
    if (Object.keys(errs).length > 0 || !method) return;
    if ((method === "apple" || method === "google") && tokens.length === 0) {
      setOrderNote(t(locale, "wm.needCard"));
      setTab("wallet");
      setAdding(true);
      return;
    }
    if (method === "baridi" && !baridi) {
      setOrderNote(t(locale, "wm.needBaridi"));
      return;
    }
    setOrderNote(null);
    setOrder({
      items: cart.map((l) => {
        const p = STORE.find((x) => x.id === l.id)!;
        return { name: p.name, qty: l.qty, priceMinor: p.priceMinor };
      }),
      buyer: { ...info },
      totalMinor: tt.total,
      nonce: Date.now()
    });
    setReceipt(null);
  };

  const sheetDone = (flow: WalletFlow, result: RunResult) => {
    const m = method ?? "apple";
    saveSession(
      { moduleId: "wallet", seed, params: { ...params, sheet: m, amountMinor: flow.ctx.amountMinor, currency: flow.ctx.currency }, failures },
      result
    );
    if (m !== "baridi") {
      setCart([]);
      store(CART_KEY, []);
    }
    setReceipt({ flow, result, method: m });
  };

  const handleBalance = (delta: number, entry?: { ref: string; merchant: string; totalMinor: number; status: string }) => {
    setBaridi((b) => {
      if (!b) return b;
      const day = today();
      const spent = b.daySpent.date === day ? b.daySpent.total : 0;
      const next: BaridiAcct = {
        ...b,
        balanceMinor: b.balanceMinor + delta,
        daySpent: { date: day, total: delta < 0 ? spent + (-delta) : spent },
        history: entry ? [...b.history, { ...entry, at: Date.now() }] : b.history
      };
      store(BARIDI_KEY, next);
      return next;
    });
  };
  const daySpentToday = () => {
    if (!baridi) return 0;
    return baridi.daySpent.date === today() ? baridi.daySpent.total : 0;
  };

  const resetDemo = () => {
    if (!resetArm) { setResetArm(true); return; }
    setResetArm(false);
    persistTokens([]);
    persistBaridi(null);
    clearProfile();
    setProfile(null);
    setUnlocked(false);
    setAdding(false);
    setCart([]);
    store(CART_KEY, []);
    setInfo(EMPTY_INFO);
    setMethod(null);
    setOrder(null);
    setReceipt(null);
    setSelectedId(null);
    clearSessionsForModule("wallet");
    setOrders([]);
    setTab("shop");
  };

  const sheetProps = order ? {
    seed, params, failures, onLive,
    order: { items: order.items, buyer: order.buyer, totalMinor: order.totalMinor },
    onBuyer: (b: InfoFields) => setOrder((o) => (o ? { ...o, buyer: b } : o)),
    tokens,
    selectedId, onSelect: setSelectedId,
    onDone: sheetDone,
    goBack: () => setOrder(null),
    onNeedCard: () => { setAdding(true); setTab("wallet"); }
  } : null;

  if (!profile) {
    return (
      <div className="space-y-2">
        <SetupWizard seed={seed} onDone={(p) => { saveProfile(p); setProfile(p); setUnlocked(true); }} />
      </div>
    );
  }
  if (!unlocked) {
    return (
      <div className="space-y-2">
        <UnlockScreen
          name={profile.name}
          hintPin={profile.pin}
          onUnlock={(pin) => {
            const ok = pin === profile.pin;
            if (ok) setUnlocked(true);
            return ok;
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {(["shop", "checkout", "wallet", "orders"] as const).map((x) => (
          <button key={x} onClick={() => setTab(x)} className={`rounded-lg px-3 py-1 text-sm ${tab === x ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}>
            {t(locale, `wm.tab.${x}`)}{x === "shop" && cart.length > 0 ? ` (${cart.reduce((s, l) => s + l.qty, 0)})` : ""}
          </button>
        ))}
      </div>

      {tab === "shop" && (
        <div className="space-y-2">
          <StepHead title={t(locale, "wm.shopT")} sub={t(locale, "wm.shopB")} />
          <div className="grid gap-2 sm:grid-cols-2">
            {STORE.map((p) => (
              <Card key={p.id} className="flex gap-2.5 p-3">
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl font-bold text-white ${p.hue}`}>{p.glyph}</span>
                <div className="flex-1">
                  <div className="text-sm font-semibold">{p.name}</div>
                  <div className="text-[12px] text-zinc-500">{p.blurb}</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-mono font-bold">{formatMoney(p.priceMinor, "EUR", locale)}</span>
                    <Btn small onClick={() => add(p.id)}>{t(locale, "co.shop.add")}</Btn>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <CartCard cart={cart} onDec={dec} onAdd={add} onCheckout={() => setTab("checkout")} />
        </div>
      )}

      {tab === "checkout" && (
        <div className="space-y-2">
          {cart.length === 0 && !order ? (
            <EmptyNote>{t(locale, "co.shop.empty")}</EmptyNote>
          ) : !order ? (
            <>
              <CartCard cart={cart} onDec={dec} onAdd={add} />
              <Card className="space-y-2 p-3">
                <div className="font-semibold">{t(locale, "co.info.title")}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "co.info.email")}</span>
                      <input dir="ltr" className={inpCls} value={info.email} onChange={(e) => setInfo({ ...info, email: e.target.value })} placeholder={t(locale, "co.info.email")} autoComplete="off" /></label>
                    {infoErrors.email && <Err text={t(locale, "co.err.email")} />}
                  </div>
                  <div><label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "co.info.first")}</span>
                    <input className={inpCls} value={info.firstName} onChange={(e) => setInfo({ ...info, firstName: e.target.value })} autoComplete="off" /></label>
                    {infoErrors.firstName && <Err text={t(locale, "co.err.required")} />}</div>
                  <div><label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "co.info.last")}</span>
                    <input className={inpCls} value={info.lastName} onChange={(e) => setInfo({ ...info, lastName: e.target.value })} autoComplete="off" /></label>
                    {infoErrors.lastName && <Err text={t(locale, "co.err.required")} />}</div>
                  <div className="sm:col-span-2"><label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "co.info.street")}</span>
                    <input className={inpCls} value={info.street} onChange={(e) => setInfo({ ...info, street: e.target.value })} autoComplete="off" /></label>
                    {infoErrors.street && <Err text={t(locale, "co.err.required")} />}</div>
                  <div><label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "co.info.city")}</span>
                    <input className={inpCls} value={info.city} onChange={(e) => setInfo({ ...info, city: e.target.value })} autoComplete="off" /></label>
                    {infoErrors.city && <Err text={t(locale, "co.err.required")} />}</div>
                  <div><label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "co.info.post")}</span>
                    <input className={inpCls} value={info.postcode} onChange={(e) => setInfo({ ...info, postcode: e.target.value })} autoComplete="off" /></label>
                    {infoErrors.postcode && <Err text={t(locale, "co.err.post")} />}</div>
                </div>
              </Card>
              <Card className="space-y-2 p-3">
                <div className="font-semibold">{t(locale, "wm.methodT")}</div>
                <div className="grid gap-1.5">
                  {(["apple", "google", "baridi"] as const).map((m) => (
                    <button key={m} onClick={() => setMethod(m)} className={`rounded-2xl border p-3 text-left ${method === m ? "border-sky-500 bg-sky-50 dark:bg-sky-950" : "border-zinc-200 dark:border-zinc-800"}`}>
                      <div className="text-sm font-bold">{t(locale, `wm.method.${m}`)}</div>
                      <div className="text-[13px] text-zinc-500">{t(locale, `wm.method.${m}.d`)}</div>
                    </button>
                  ))}
                </div>
                {orderNote && <div className="rounded-lg bg-sky-50 p-2 text-[13px] text-sky-900 dark:bg-sky-950 dark:text-sky-200">{orderNote}</div>}
                <Btn onClick={placeOrder}>{t(locale, "wm.placeOrder")}</Btn>
              </Card>
            </>
          ) : receipt ? (
            <ReceiptCard receipt={receipt} onOrders={() => setTab("orders")} onShop={() => { setOrder(null); setReceipt(null); setMethod(null); setTab("shop"); }} />
          ) : sheetProps && method === "apple" ? (
            <AppleSheet {...sheetProps} />
          ) : sheetProps && method === "google" ? (
            <GoogleSheet {...sheetProps} />
          ) : sheetProps ? (
            <BaridiFlow
              {...sheetProps}
              acct={baridi}
              onEnroll={(phone, ribLast4) => persistBaridi({ phone, username: "", ribLast4, balanceMinor: 0, daySpent: { date: today(), total: 0 }, history: [] })}
              onBalance={handleBalance}
              daySpentToday={daySpentToday}
            />
          ) : null}
        </div>
      )}

      {tab === "wallet" && (
        <div className="space-y-2">
          <Card className="flex items-center gap-2 p-3 text-sm">
            <div className="flex-1">
              <div className="font-semibold">{profile.name}</div>
              <div className="text-[12px] text-zinc-500">{t(locale, "wm.unlocked")}</div>
            </div>
            <Btn small variant="outline" onClick={() => setUnlocked(false)}>{t(locale, "wlock.lock")}</Btn>
          </Card>
          <Card className="space-y-2 p-3">
            <div className="font-semibold">{t(locale, "wm.tokensT")}</div>
            <div className="text-[13px] text-zinc-500">{t(locale, "wm.tokensB")}</div>
            {adding ? (
              <AddCardFlow
                seed={seed} params={params} failures={failures} onLive={onLive}
                onStored={(tk) => {
                  persistTokens([...tokens, { ...tk, isDefault: tokens.length === 0 }]);
                  setAdding(false);
                }}
                onCancel={() => setAdding(false)}
              />
            ) : (
              <>
                {tokens.length === 0 && <EmptyNote>{t(locale, "wm.noTokens")}</EmptyNote>}
                {tokens.map((tk) => (
                  <div key={tk.id} className="rounded-lg bg-zinc-50 p-2 text-sm dark:bg-zinc-900">
                    <button className="flex w-full items-center gap-2 text-left" onClick={() => setDetail(detail === tk.id ? null : tk.id)}>
                      <div className="flex-1">
                        <div className="font-mono font-bold">{tk.brand} ···· {tk.last4}</div>
                        <div className="text-[12px] text-zinc-500">{tk.name} · {tk.exp}{tk.isDefault ? ` · ${t(locale, "wm.isDefault")}` : ""}</div>
                      </div>
                      <span className="text-zinc-400">{detail === tk.id ? "▾" : "▸"}</span>
                    </button>
                    {detail === tk.id && (
                      <div className="mt-1.5 space-y-0.5 border-t border-zinc-200 pt-1.5 font-mono text-[12px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                        <div className="flex justify-between"><span>token</span><span>{tk.dpan}</span></div>
                        <div className="flex justify-between"><span>exp</span><span>{tk.exp}</span></div>
                        <div className="text-zinc-500">{t(locale, "wm.linkedNote")}</div>
                        <div className="flex gap-3 pt-1 font-sans text-[12px]">
                          {!tk.isDefault && <button className="underline opacity-70" onClick={() => persistTokens(tokens.map((x) => ({ ...x, isDefault: x.id === tk.id })))}>{t(locale, "wm.setDefault")}</button>}
                          <button className="underline opacity-70" onClick={() => persistTokens(tokens.filter((x) => x.id !== tk.id))}>{t(locale, "wa.forget")}</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <div><Btn small onClick={() => setAdding(true)}>{t(locale, "wadd.open")}</Btn></div>
              </>
            )}
          </Card>
          <Card className="space-y-1.5 p-3 text-sm">
            <div className="font-semibold">{t(locale, "wba.title")}</div>
            {baridi ? (
              <>
                <div className="font-mono">CCP ••{baridi.ribLast4} · {baridi.phone}</div>
                <div className="font-mono font-bold">{formatMoney(baridi.balanceMinor, "DZD", locale)}</div>
                <div className="text-[12px] text-zinc-500">{t(locale, "wm.postalNote")}</div>
              </>
            ) : (
              <div className="text-zinc-500">{t(locale, "wm.noBaridi")}</div>
            )}
          </Card>
          <TeachPanel selectedDpan={tokens.find((x) => x.id === selectedId)?.dpan ?? tokens[0]?.dpan} />
          <Card className="p-3 text-sm">
            <div className="font-semibold">{t(locale, "wm.resetT")}</div>
            <div className="mt-0.5 text-[13px] text-zinc-500">{t(locale, "wm.resetB")}</div>
            <div className="mt-2"><Btn small variant="outline" onClick={resetDemo}>{resetArm ? t(locale, "wm.resetConfirm") : t(locale, "wm.reset")}</Btn></div>
          </Card>
        </div>
      )}

      {tab === "orders" && (
        <Card className="space-y-2 p-3">
          <div className="font-semibold">{t(locale, "co.orders.title")}</div>
          {orders.length === 0 && <EmptyNote>{t(locale, "co.orders.empty")}</EmptyNote>}
          {orders.map((o) => {
            const sheet = typeof o.spec.params.sheet === "string" ? o.spec.params.sheet : "card";
            const open = expanded === o.id;
            return (
              <div key={o.id} className="rounded-lg bg-zinc-50 p-2 text-[13px] dark:bg-zinc-900">
                <button className="flex w-full items-center gap-2 text-left" onClick={() => setExpanded(open ? null : o.id)}>
                  <div className="flex-1">
                    <div className="font-mono">{o.result.txId}</div>
                    <div className="text-zinc-500"><Time at={o.at} /> · {sheet} · <span className="font-mono">{formatMoney(o.result.receipt.amountMinor, o.result.receipt.currency, locale)}</span></div>
                  </div>
                  <Badge tone={o.result.finalState === "SETTLED" ? "green" : o.result.finalState === "AUTHORIZED" ? "blue" : "red"}>{o.result.finalState}</Badge>
                  <span className="text-zinc-400">{open ? "▾" : "▸"}</span>
                </button>
                {open && <OrderLifecycle order={o} />}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function Err({ text }: { text: string }) {
  return <span className="mt-0.5 block text-[13px] text-red-700 dark:text-red-400">{text}</span>;
}

export function CartCard({ cart, onDec, onAdd, onCheckout }: {
  cart: CartLine[];
  onDec: (id: string) => void;
  onAdd: (id: string) => void;
  onCheckout?: () => void;
}) {
  const { locale } = usePrefs();
  const tt = totals(cart);
  return (
    <Card className="space-y-2 p-3">
      <div className="font-semibold">{t(locale, "co.cart.title")} ({cart.reduce((s, l) => s + l.qty, 0)})</div>
      {cart.length === 0 && <div className="text-sm text-zinc-500">{t(locale, "co.shop.empty")}</div>}
      {cart.map((l) => {
        const p = STORE.find((x) => x.id === l.id)!;
        return (
          <div key={l.id} className="flex items-center gap-2 rounded-lg bg-zinc-50 p-2 text-sm dark:bg-zinc-900">
            <span className={`flex h-8 w-8 items-center justify-center rounded-lg font-bold text-white ${p.hue}`}>{p.glyph}</span>
            <div className="flex-1">
              <div className="font-medium">{p.name}</div>
              <div className="font-mono text-[13px] text-zinc-500">{formatMoney(p.priceMinor, "EUR", locale)}</div>
            </div>
            <button aria-label="decrease" className="rounded border border-zinc-300 px-2 dark:border-zinc-700" onClick={() => onDec(l.id)}>−</button>
            <span className="font-mono">{l.qty}</span>
            <button aria-label="increase" className="rounded border border-zinc-300 px-2 dark:border-zinc-700" onClick={() => onAdd(l.id)}>+</button>
          </div>
        );
      })}
      {cart.length > 0 && (
        <div className="space-y-0.5 border-t border-zinc-200 pt-2 font-mono text-[13px] dark:border-zinc-800">
          <div className="flex justify-between"><span>{t(locale, "wm.sub")}</span><span>{formatMoney(tt.sub, "EUR", locale)}</span></div>
          <div className="flex justify-between"><span>{t(locale, "wm.ship")}</span><span>{tt.sub >= 5000 || tt.sub === 0 ? t(locale, "wm.free") : formatMoney(tt.ship, "EUR", locale)}</span></div>
          <div className="flex justify-between"><span>{t(locale, "wm.tax")}</span><span>{formatMoney(tt.tax, "EUR", locale)}</span></div>
          <div className="flex justify-between border-t border-zinc-200 pt-1 text-sm font-bold dark:border-zinc-800"><span>{t(locale, "co.cart.total")}</span><span>{formatMoney(tt.total, "EUR", locale)}</span></div>
        </div>
      )}
      {onCheckout && cart.length > 0 && <Btn small onClick={onCheckout}>{t(locale, "co.cart.continue")}</Btn>}
    </Card>
  );
}

export function Lifecycle({ events }: { events: SimEvent[] }) {
  const { locale } = usePrefs();
  const types = new Set(events.map((e) => e.type));
  const has = (...xs: string[]) => xs.some((x) => types.has(x));
  const stages: { key: string; done: boolean; active: boolean }[] = [
    { key: "wm.life.checkout", done: events.length > 0, active: events.length > 0 && !has("BIOMETRIC_OK", "PIN_FALLBACK_OK", "OTP_VERIFIED", "AUTHORIZED_HOLD") },
    { key: "wm.life.auth", done: has("BIOMETRIC_OK", "PIN_FALLBACK_OK", "OTP_VERIFIED"), active: has("BIOMETRIC_PROMPT", "OTP_SENT") && !has("BIOMETRIC_OK", "PIN_FALLBACK_OK", "OTP_VERIFIED") },
    { key: "wm.life.authorize", done: has("AUTHORIZED_HOLD"), active: has("BIOMETRIC_OK", "PIN_FALLBACK_OK", "OTP_VERIFIED") && !has("AUTHORIZED_HOLD") },
    { key: "wm.life.settle", done: has("SETTLED"), active: has("AUTHORIZED_HOLD") && !has("SETTLED") }
  ];
  return (
    <div className="rounded-xl border border-zinc-200 p-2.5 dark:border-zinc-800">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-500">{t(locale, "wm.lifeT")}</div>
      <ol className="flex items-start">
        {stages.map((s, i) => (
          <li key={s.key} className="flex flex-1 items-start last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${s.done ? "bg-emerald-600 text-white" : s.active ? "border-2 border-sky-500 text-sky-700 dark:text-sky-300" : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800"}`}>
                {s.done ? "✓" : i + 1}
              </span>
              <span className="text-center text-[10px] leading-tight">{t(locale, s.key)}</span>
            </div>
            {i < stages.length - 1 && <span className={`mx-1 mt-2 h-0.5 flex-1 ${stages[i + 1].done || s.done ? "bg-emerald-400" : "bg-zinc-200 dark:bg-zinc-800"}`} />}
          </li>
        ))}
      </ol>
      <div className="mt-1.5 text-[11px] text-zinc-500">{t(locale, "wm.lifeNote")}</div>
    </div>
  );
}

function ReceiptCard({ receipt, onOrders, onShop }: {
  receipt: { flow: WalletFlow; result: RunResult; method: "apple" | "google" | "baridi" };
  onOrders: () => void;
  onShop: () => void;
}) {
  const { locale } = usePrefs();
  const { result } = receipt;
  const ok = result.finalState === "SETTLED";
  const pending = result.finalState === "AUTHORIZED";
  const idem = [...result.events].reverse().find((e) => typeof (e.payload as Record<string, unknown>).idempotencyKey === "string");
  return (
    <div className="space-y-2">
      <Lifecycle events={result.events} />
      <Card className="space-y-2 p-3">
        {ok ? (
          <div className="font-semibold text-emerald-700 dark:text-emerald-300">✓ {receipt.method === "google" ? t(locale, "wm.googleBack") : t(locale, "co.ok.title")}</div>
        ) : pending ? (
          <div className="font-semibold text-sky-700 dark:text-sky-300">{t(locale, "co.pend.title")}</div>
        ) : (
          <div className="font-semibold text-red-700 dark:text-red-400">✕ {t(locale, "co.no.title")}</div>
        )}
        {!ok && !pending && (
          <DeclineNote result={result} />
        )}
        <div className="space-y-0.5 rounded-xl bg-zinc-50 p-3 font-mono text-[13px] dark:bg-zinc-900">
          <div className="flex justify-between"><span className="font-sans text-zinc-500">{t(locale, "wm.rcpt.merchant")}</span><span>Demo store</span></div>
          <div className="flex justify-between"><span className="font-sans text-zinc-500">{t(locale, "co.cart.total")}</span><b>{formatMoney(result.receipt.amountMinor, result.receipt.currency, locale)}</b></div>
          <div className="flex justify-between"><span className="font-sans text-zinc-500">{t(locale, "wm.rcpt.method")}</span><span>{t(locale, `wm.method.${receipt.method}`)}</span></div>
          <div className="flex justify-between"><span className="font-sans text-zinc-500">{t(locale, "wm.rcpt.time")}</span><span><Time /></span></div>
          <div className="flex justify-between"><span className="font-sans text-zinc-500">{t(locale, "wm.rcpt.ref")}</span><span>{result.txId}</span></div>
          {idem && <div className="flex justify-between"><span className="font-sans text-zinc-500">{t(locale, "wm.rcpt.idem")}</span><span>{String((idem.payload as Record<string, unknown>).idempotencyKey)}</span></div>}
        </div>
        <div className="flex gap-1.5">
          <Btn small variant="outline" onClick={onOrders}>{t(locale, "co.ok.orders")}</Btn>
          <Btn small variant="outline" onClick={onShop}>{t(locale, "wm.newPurchase")}</Btn>
        </div>
      </Card>
    </div>
  );
}

function DeclineNote({ result }: { result: RunResult }) {
  const { locale } = usePrefs();
  const d = [...result.events].reverse().find((e) => e.type === "ISSUER_DECLINED" || e.type === "TDS_FAILED" || e.type === "WALLET_DECLINED");
  const reason = String((d?.payload as Record<string, unknown> | undefined)?.reason ?? "");
  const key = reason === "insufficient-funds" ? "co.decline.insufficient-funds"
    : reason === "expired-card" ? "co.decline.expired-card"
    : reason === "wrong-cvc" ? "co.decline.wrong-cvc"
    : reason === "suspected-fraud" ? "co.decline.suspected-fraud"
    : reason === "wrong-otp" ? "co.decline.wrong-otp"
    : reason === "abandoned" ? "co.decline.abandoned"
    : reason === "pin-locked" ? "wa.pinLocked"
    : "co.decline.issuer-decline";
  return <div className="rounded-lg bg-red-50 p-2 text-[13px] text-red-800 dark:bg-red-950 dark:text-red-200">{t(locale, key)}</div>;
}

function OrderLifecycle({ order }: { order: StoredSession }) {
  const { locale } = usePrefs();
  const evs = order.result.events;
  const pick = (...ts: string[]) => evs.find((e) => ts.includes(e.type));
  const confirmed = pick("ORDER_CONFIRMED", "TOKEN_PRESENTED", "CARD_PROVISIONED");
  const authed = pick("BIOMETRIC_OK", "PIN_FALLBACK_OK", "OTP_VERIFIED");
  const authzd = pick("AUTHORIZED_HOLD");
  const settled = pick("SETTLED");
  const rows: [string, string | undefined][] = [
    [t(locale, "wact.confirm"), confirmed ? `${confirmed.type} · ${confirmed.id}` : undefined],
    [t(locale, "wact.auth"), authed ? `${authed.type} · ${authed.id}` : undefined],
    [t(locale, "wact.authorize"), authzd ? `${authzd.type} · ${authzd.id}` : undefined],
    [t(locale, "wact.result"), `${order.result.finalState}${settled ? " · settled" : " · not settled"}`]
  ];
  return (
    <div className="mt-1.5 space-y-1 border-t border-zinc-200 pt-1.5 dark:border-zinc-800">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2">
          <span className="text-zinc-500">{k}</span>
          <span className="font-mono text-[12px]">{v ?? "—"}</span>
        </div>
      ))}
      <div className="text-[12px] text-zinc-500">{t(locale, "wact.settleNote")}</div>
    </div>
  );
}

function TeachPanel({ selectedDpan }: { selectedDpan?: string }) {
  const { locale } = usePrefs();
  const [open, setOpen] = useState(false);
  return (
    <Card className="space-y-1.5 p-3 text-[13px]">
      <button className="font-semibold" onClick={() => setOpen(!open)}>{t(locale, "wteach.t")} {open ? "▾" : "▸"}</button>
      {!open && <div className="text-zinc-500">{t(locale, "wteach.sub")}</div>}
      {open && (
        <div className="space-y-1 text-zinc-600 dark:text-zinc-400">
          <div>{t(locale, "wteach.stores")}</div>
          <div>{t(locale, "wteach.vs")}</div>
          <div>{t(locale, "wteach.authz")}</div>
          <div>{t(locale, "wteach.token")}{selectedDpan ? ` ${t(locale, "wteach.evidence")} ${selectedDpan}` : ""}</div>
          <div>{t(locale, "wteach.merchant")}</div>
          <div>{t(locale, "wteach.hide")}</div>
          <div>{t(locale, "wteach.others")}</div>
          <details className="rounded-lg bg-zinc-50 p-2 font-mono text-[12px] dark:bg-zinc-900">
            <summary className="cursor-pointer font-sans font-semibold">{t(locale, "wteach.tech")}</summary>
            <div className="mt-1 space-y-0.5">
              <div>CARD_PROVISIONED → TOKEN_PRESENTED → BIOMETRIC_OK → AUTHORIZED_HOLD → CAPTURED → SETTLED</div>
              <div>{t(locale, "wteach.idem")}</div>
            </div>
          </details>
        </div>
      )}
    </Card>
  );
}
