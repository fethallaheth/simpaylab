/**
 * Module 10 — BNPL end to end (Klarna / Afterpay / Tabby-inspired, generic).
 * Shop with a real cart -> checkout info -> plan comparison -> fictional
 * application -> approval / verification / decline -> agreement review with
 * explicit consent -> purchase -> a living repayment dashboard in the same
 * experience (pay, miss, retry, return), plus the money mechanism explained.
 * Nothing prefilled; every total computed; fictional data only.
 */
"use client";
import { useEffect, useRef, useState } from "react";
import {
  bnplAdvance,
  bnplOwed,
  bnplResult,
  createBnplFlow,
  createRunBase,
  type BnplFlow,
  type FailureId,
  type RunResult
} from "@sim/engine";
import { t } from "@/i18n/dict";
import { clearSessionsForModule, formatMoney, listSessions, saveSession, updateSession, type StoredSession } from "@/lib/sim";
import { usePrefs } from "../providers";
import { Badge, Btn, Card } from "../ui";
import { EmptyNote, MockSms, OtpBoxes, ProcessingLadder, StepHead, Time, inpCls, useSpecReset } from "../flows/kit";
import { EMPTY_INFO, validateInfo, type InfoFields } from "../checkout/validation";
import { STORE, totals, type CartLine } from "../wallet/store";

type Tab = "shop" | "plan" | "history";
type Screen = "shop" | "cart" | "info" | "plans" | "apply" | "processing" | "verify" | "agree" | "confirm" | "receipt";
const CCY = "EUR";

const INCOME_BANDS = [
  { id: "low", minor: 75000 },
  { id: "mid", minor: 175000 },
  { id: "high", minor: 350000 }
];
const EMPLOYMENT = ["employed", "self", "freelance", "student", "other"];
const PAY_METHODS = ["card", "bank"];

function dueDate(dayOffset: number): string {
  return new Date(Date.now() + dayOffset * 86_400_000).toLocaleDateString();
}

/** Identical split math to the engine: floor per leg, remainder on the last. */
export function previewLegs(totalMinor: number, n: number): { n: number; amountMinor: number; dueDay: number }[] {
  const per = Math.floor(totalMinor / n);
  return Array.from({ length: n }, (_, i) => ({
    n: i + 1,
    amountMinor: i === n - 1 ? totalMinor - per * (n - 1) : per,
    dueDay: 30 * (i + 1)
  }));
}

export function BnplApp({ seed, params, failures, onLive }: {
  seed: number;
  params: Record<string, unknown>;
  failures: FailureId[];
  onLive: (r: RunResult) => void;
}) {
  const { locale } = usePrefs();
  const [tab, setTab] = useState<Tab>("shop");
  const [screen, setScreen] = useState<Screen>("shop");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [info, setInfo] = useState<InfoFields>(EMPTY_INFO);
  const [infoErrors, setInfoErrors] = useState<Record<string, string>>({});
  const [planSel, setPlanSel] = useState<4 | 12>(4);
  const [employment, setEmployment] = useState("");
  const [band, setBand] = useState("");
  const [oblig, setOblig] = useState("");
  const [payMethod, setPayMethod] = useState("");
  const [formErr, setFormErr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [procKind, setProcKind] = useState<"apply" | "activate" | "leg">("apply");
  const [procLeg, setProcLeg] = useState(0);
  const [orders, setOrders] = useState<StoredSession[]>([]);

  const flowRef = useRef<BnplFlow | null>(null);
  const savedId = useRef<string | null>(null);
  const pendingApply = useRef<{ incomeMinor: number; obligationsMinor: number } | null>(null);
  const totalRef = useRef(0);

  useSpecReset(JSON.stringify({ seed, params, failures }), () => {
    flowRef.current = null;
    savedId.current = null;
    setScreen("shop");
    setCart([]);
    setInfo(EMPTY_INFO);
    setAgreed(false);
    setFatal(null);
  });
  useEffect(() => {
    if (tab === "history") setOrders(listSessions().filter((s) => s.spec.moduleId === "bnpl"));
  }, [tab]);

  const tt = totals(cart);
  const major = (v: string) => Math.round(Number(v.replace(",", ".")) * 100);

  const push = (): RunResult => {
    const r = bnplResult(flowRef.current!);
    onLive(r);
    return r;
  };
  const persist = () => {
    const flow = flowRef.current;
    if (!flow) return;
    const r = bnplResult(flow);
    if (savedId.current) updateSession(savedId.current, r);
    else {
      const s = saveSession({ moduleId: "bnpl", seed, params: { ...params, amountMinor: totalRef.current }, failures }, r);
      savedId.current = s.id;
    }
  };

  const add = (id: string) => setCart((c) => (c.find((l) => l.id === id) ? c.map((l) => (l.id === id ? { ...l, qty: l.qty + 1 } : l)) : [...c, { id, qty: 1 }]));
  const dec = (id: string) => setCart((c) => c.flatMap((l) => (l.id === id ? (l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : []) : [l])));

  const submitInfo = () => {
    const errs = validateInfo(info);
    const shown: Record<string, string> = {};
    for (const [k, v] of Object.entries(errs)) {
      if (["email", "firstName", "lastName", "street", "city", "postcode"].includes(k)) shown[k] = v;
    }
    setInfoErrors(shown);
    if (Object.keys(shown).length === 0) setScreen("plans");
  };

  const startApply = () => {
    setFormErr(null);
    if (!employment || !band || !payMethod) { setFormErr(t(locale, "bx.formBad")); return; }
    const bandMinor = INCOME_BANDS.find((b) => b.id === band)?.minor ?? 0;
    const obligMinor = major(oblig) || 0;
    const flow = createBnplFlow(createRunBase("bnpl", { seed, params: { ...params, amountMinor: tt.total }, failures }));
    flowRef.current = flow;
    totalRef.current = tt.total;
    savedId.current = null;
    pendingApply.current = { incomeMinor: bandMinor, obligationsMinor: obligMinor };
    setProcKind("apply");
    setScreen("processing");
  };

  const applyNow = () => {
    const flow = flowRef.current;
    const pending = pendingApply.current;
    if (!flow || !pending) return;
    try {
      bnplAdvance(flow, { type: "apply", incomeMinor: pending.incomeMinor, obligationsMinor: pending.obligationsMinor, plan: planSel });
      push();
    } catch (e) {
      setFatal(e instanceof Error ? e.message : String(e));
      setScreen("apply");
      return;
    }
    if (flow.stage === "verify") {
      setCode("");
      setCodeErr(null);
      setScreen("verify");
    } else if (flow.stage === "offer") {
      setAgreed(false);
      setScreen("agree");
    } else {
      persist();
      setScreen("apply");
    }
  };

  const submitCode = () => {
    const flow = flowRef.current;
    if (!flow) return;
    try {
      bnplAdvance(flow, { type: "submit_verification", code: code.trim() });
      push();
    } catch (e) {
      setFatal(e instanceof Error ? e.message : String(e));
      return;
    }
    if (flow.stage === "verify") {
      setCodeErr(t(locale, "co.ch.wrong"));
      return;
    }
    setCodeErr(null);
    if (flow.stage === "offer") {
      setAgreed(false);
      setScreen("agree");
    } else {
      persist();
      setScreen("receipt");
    }
  };

  const confirmAgreement = () => {
    const flow = flowRef.current;
    if (!flow || !agreed) return;
    setProcKind("activate");
    setScreen("processing");
  };

  const activateNow = () => {
    const flow = flowRef.current;
    if (!flow) return;
    try {
      bnplAdvance(flow, { type: "activate" });
      push();
      persist();
    } catch (e) {
      setFatal(e instanceof Error ? e.message : String(e));
      return;
    }
    setScreen("confirm");
    setTab("shop");
  };

  const payLeg = (n: number) => {
    const flow = flowRef.current;
    if (!flow) return;
    setProcKind("leg");
    setProcLeg(n);
    setScreen("processing");
    setTab("shop");
  };

  const payLegNow = (n: number) => {
    const flow = flowRef.current;
    if (!flow) return;
    try {
      bnplAdvance(flow, { type: "pay_leg", n });
      push();
      persist();
    } catch (e) {
      setFatal(e instanceof Error ? e.message : String(e));
    }
  };

  const missLeg = (n: number) => {
    const flow = flowRef.current;
    if (!flow) return;
    try {
      bnplAdvance(flow, { type: "miss_leg", n });
      push();
      persist();
    } catch (e) {
      setFatal(e instanceof Error ? e.message : String(e));
    }
  };

  const ret = () => {
    const flow = flowRef.current;
    if (!flow) return;
    try {
      bnplAdvance(flow, { type: "return_goods" });
      push();
      persist();
    } catch (e) {
      setFatal(e instanceof Error ? e.message : String(e));
    }
  };

  const resetAll = () => {
    flowRef.current = null;
    savedId.current = null;
    pendingApply.current = null;
    savedId.current = null;
    setCart([]);
    setInfo(EMPTY_INFO);
    setScreen("shop");
    setTab("shop");
    setAgreed(false);
    setFatal(null);
    clearSessionsForModule("bnpl");
    setOrders([]);
  };

  const flow = flowRef.current;
  const denied = flow?.ctx.events.find((e) => e.type === "BNPL_DENIED");
  const elig = flow?.ctx.events.find((e) => e.type === "ELIGIBILITY_CHECKED");
  const activated = flow?.ctx.events.find((e) => e.type === "PLAN_ACTIVATED");
  const verifyEv = [...(flow?.ctx.events ?? [])].reverse().find((e) => e.type === "VERIFICATION_REQUIRED");
  const legs = flow?.legs ?? [];
  const next = legs.find((l) => !l.paid);
  const lateFee = typeof params.lateFeeMinor === "number" ? (params.lateFeeMinor as number) : 800;

  const procSteps =
    procKind === "apply" ? [t(locale, "bx.p1"), t(locale, "bx.p2"), t(locale, "bx.p3")] :
    procKind === "activate" ? [t(locale, "bx.q1"), t(locale, "bx.q2"), t(locale, "bx.q3")] :
    [t(locale, "bx.r1"), t(locale, "bx.r2"), t(locale, "bx.r3")];
  const procDone = () => {
    if (procKind === "apply") applyNow();
    else if (procKind === "activate") activateNow();
    else if (procKind === "leg") { payLegNow(procLeg); setTab("plan"); }
  };

  const schedule = (n: 4 | 12) => previewLegs(tt.total, n);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {(["shop", "plan", "history"] as const).map((x) => (
          <button key={x} onClick={() => setTab(x)} className={`rounded-lg px-3 py-1 text-sm ${tab === x ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}>
            {t(locale, `bx.tab.${x}`)}
          </button>
        ))}
      </div>

      {fatal && (
        <Card className="space-y-2 border-red-400 p-3">
          <div className="font-semibold text-red-700 dark:text-red-400">{t(locale, "bx.unableT")}</div>
          <div className="font-mono text-[12px] text-zinc-500">{fatal}</div>
          <div className="flex gap-1.5">
            <Btn small variant="outline" onClick={() => { setFatal(null); setScreen("shop"); }}>{t(locale, "bx.tryOther")}</Btn>
            <Btn small variant="outline" onClick={() => { setFatal(null); if (flow) { if (flow.stage === "active") { setScreen("confirm"); setTab("shop"); } } }}>{t(locale, "bx.retry")}</Btn>
          </div>
        </Card>
      )}

      {tab === "shop" && screen === "shop" && (
        <div className="space-y-2">
          <StepHead title={t(locale, "bx.shopT")} sub={t(locale, "bx.shopB")} />
          <div className="grid gap-2 sm:grid-cols-2">
            {STORE.map((p) => (
              <Card key={p.id} className="flex gap-2.5 p-3">
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl font-bold text-white ${p.hue}`}>{p.glyph}</span>
                <div className="flex-1">
                  <div className="text-sm font-semibold">{p.name}</div>
                  <div className="text-[12px] text-zinc-500">{p.blurb}</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-mono font-bold">{formatMoney(p.priceMinor, CCY, locale)}</span>
                    <Btn small onClick={() => add(p.id)}>{t(locale, "co.shop.add")}</Btn>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <ShopCart cart={cart} onDec={dec} onAdd={add} onCheckout={() => setScreen("cart")} />
        </div>
      )}

      {tab === "shop" && screen === "cart" && (
        <div className="space-y-2">
          <ShopCart cart={cart} onDec={dec} onAdd={add} />
          <div className="flex gap-1.5">
            <Btn small variant="outline" onClick={() => setScreen("shop")}>{t(locale, "co.cart.back")}</Btn>
            <Btn small onClick={() => setScreen("info")} disabled={cart.length === 0}>{t(locale, "bx.toCheckout")}</Btn>
          </div>
        </div>
      )}

      {tab === "shop" && screen === "info" && (
        <Card className="space-y-2 p-3">
          <div className="font-semibold">{t(locale, "bx.infoT")}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "co.info.email")}</span>
              <input dir="ltr" className={inpCls} value={info.email} onChange={(e) => setInfo({ ...info, email: e.target.value })} placeholder="amina@example.dz" autoComplete="off" /></label></div>
            <div><label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "co.info.first")}</span>
              <input className={inpCls} value={info.firstName} onChange={(e) => setInfo({ ...info, firstName: e.target.value })} autoComplete="off" /></label></div>
            <div><label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "co.info.last")}</span>
              <input className={inpCls} value={info.lastName} onChange={(e) => setInfo({ ...info, lastName: e.target.value })} autoComplete="off" /></label></div>
            <div className="sm:col-span-2"><label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "co.info.street")}</span>
              <input className={inpCls} value={info.street} onChange={(e) => setInfo({ ...info, street: e.target.value })} autoComplete="off" /></label></div>
            <div><label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "co.info.city")}</span>
              <input className={inpCls} value={info.city} onChange={(e) => setInfo({ ...info, city: e.target.value })} autoComplete="off" /></label></div>
            <div><label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "co.info.post")}</span>
              <input className={inpCls} value={info.postcode} onChange={(e) => setInfo({ ...info, postcode: e.target.value })} autoComplete="off" /></label></div>
          </div>
          {Object.keys(infoErrors).length > 0 && <div className="text-[13px] text-red-700 dark:text-red-400">{t(locale, "bx.infoBad")}</div>}
          {Object.keys(infoErrors).length > 0 && <div className="text-[13px] text-red-700 dark:text-red-400">{t(locale, "bx.infoBad")}</div>}
          <div className="flex gap-1.5">
            <Btn small variant="outline" onClick={() => setScreen("cart")}>{t(locale, "co.cart.back")}</Btn>
            <Btn small onClick={submitInfo}>{t(locale, "bx.toPlans")}</Btn>
          </div>
        </Card>
      )}

      {tab === "shop" && screen === "plans" && (
        <div className="space-y-2">
          <Card className="space-y-1 p-3 text-sm">
            <div className="flex justify-between"><span>{t(locale, "bx.basket")}</span><b className="font-mono">{formatMoney(tt.total, CCY, locale)}</b></div>
            <div className="text-[12px] text-zinc-500">{t(locale, "bx.compareSub")}</div>
          </Card>
          {([4, 12] as const).map((n) => {
            const legs = schedule(n);
            return (
              <Card key={n} className={`space-y-1.5 p-3 ${planSel === n ? "border-sky-500" : ""}`}>
                <button className="w-full text-left" onClick={() => setPlanSel(n)}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold">{t(locale, "bn.payIn").replace("{n}", String(n))}</span>
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${planSel === n ? "border-sky-500 bg-sky-500 text-white" : "border-zinc-300 dark:border-zinc-700"}`}>{planSel === n ? "✓" : ""}</span>
                  </div>
                </button>
                <div className="grid grid-cols-3 gap-2 text-center text-[13px]">
                  <div className="rounded-lg bg-zinc-50 p-1.5 dark:bg-zinc-900"><div className="font-mono font-bold">{formatMoney(0, CCY, locale)}</div><div className="text-zinc-500">{t(locale, "bx.dueToday")}</div></div>
                  <div className="rounded-lg bg-zinc-50 p-1.5 dark:bg-zinc-900"><div className="font-mono font-bold">{formatMoney(legs[0]?.amountMinor ?? 0, CCY, locale)}</div><div className="text-zinc-500">{t(locale, "bx.perSlice")}</div></div>
                  <div className="rounded-lg bg-zinc-50 p-1.5 dark:bg-zinc-900"><div className="font-mono font-bold">{formatMoney(tt.total, CCY, locale)}</div><div className="text-zinc-500">{t(locale, "bx.totalPay")}</div></div>
                </div>
                <div className="text-[12px] text-zinc-500">{t(locale, "bx.firstDue")}: {dueDate(30)} · {t(locale, "bx.interest")}: 0% · {t(locale, "bx.latePol")}: {formatMoney(lateFee, CCY, locale)}</div>
                <div className="space-y-0.5">
                  {legs.map((l) => (
                    <div key={l.n} className="flex justify-between font-mono text-[12px] text-zinc-500">
                      <span>#{l.n} · +{l.dueDay}d ({dueDate(l.dueDay)})</span><span>{formatMoney(l.amountMinor, CCY, locale)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
          <div className="text-[12px] text-zinc-500">{t(locale, "bx.providerNote")}</div>
          <div className="flex gap-1.5">
            <Btn small variant="outline" onClick={() => setScreen("info")}>{t(locale, "co.cart.back")}</Btn>
            <Btn small onClick={() => setScreen("apply")}>{t(locale, "bx.continueApply")}</Btn>
          </div>
        </div>
      )}

      {tab === "shop" && screen === "apply" && (
        <Card className="space-y-2 p-3">
          <StepHead title={t(locale, "bx.applyT")} sub={t(locale, "bx.applySub")} />
          <div className="rounded-lg bg-sky-50 p-2 text-[13px] text-sky-900 dark:bg-sky-950 dark:text-sky-200">{t(locale, "bx.fictional")}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "bx.employment")}</span>
              <select className={inpCls} value={employment} onChange={(e) => setEmployment(e.target.value)}>
                <option value="">—</option>
                {EMPLOYMENT.map((x) => <option key={x} value={x}>{t(locale, `bx.emp.${x}`)}</option>)}
              </select></label>
            <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "bx.income")}</span>
              <select className={inpCls} value={band} onChange={(e) => setBand(e.target.value)}>
                <option value="">—</option>
                {INCOME_BANDS.map((x) => <option key={x.id} value={x.id}>{t(locale, `bx.band.${x.id}`)}</option>)}
              </select></label>
            <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "bx.oblig2")}</span>
              <input dir="ltr" inputMode="decimal" className={`${inpCls} font-mono`} value={oblig} onChange={(e) => setOblig(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="200.00" autoComplete="off" /></label>
            <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "bx.payMethod")}</span>
              <select className={inpCls} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                <option value="">—</option>
                {PAY_METHODS.map((x) => <option key={x} value={x}>{t(locale, `bx.pm.${x}`)}</option>)}
              </select></label>
          </div>
          {formErr && <div className="text-[13px] text-red-700 dark:text-red-400">{formErr}</div>}
          <div className="flex gap-1.5">
            <Btn small variant="outline" onClick={() => setScreen("plans")}>{t(locale, "co.cart.back")}</Btn>
            <Btn small onClick={startApply}>{t(locale, "bx.submitApply")}</Btn>
          </div>
        </Card>
      )}

      {tab === "shop" && screen === "processing" && (
        <ProcessingLadder steps={procSteps} onDone={procDone} />
      )}

      {tab === "shop" && screen === "verify" && (
        <div className="mx-auto max-w-[340px] space-y-2">
          <Card className="space-y-2 p-4 text-center">
            <div className="font-semibold">{t(locale, "bx.verifyT")}</div>
            <div className="text-[13px] text-zinc-500">{t(locale, "bx.verifyB")}</div>
            <MockSms title={t(locale, "co.ch.sms")}>
              <span>{t(locale, "co.ch.smsB")} <b className="font-mono text-base">{String((verifyEv?.payload as Record<string, unknown> | undefined)?.code ?? "…")}</b></span>
            </MockSms>
            <OtpBoxes value={code} onChange={setCode} label="code" />
            {codeErr && <div className="text-[13px] text-red-700 dark:text-red-400">{codeErr}</div>}
            <Btn onClick={submitCode}>{t(locale, "bx.verifyGo")}</Btn>
          </Card>
        </div>
      )}

      {tab === "shop" && screen === "agree" && flow && (
        <Card className="space-y-2 p-3">
          <div className="font-bold">{t(locale, "bx.agreeT")}</div>
          <div className="space-y-1 rounded-xl bg-zinc-50 p-3 font-mono text-[13px] dark:bg-zinc-900">
            <AgreeRow k={t(locale, "bx.ag.purchase")} v={formatMoney(flow.ctx.amountMinor, CCY, locale)} />
            <AgreeRow k={t(locale, "bx.dueToday")} v={formatMoney(0, CCY, locale)} />
            <AgreeRow k={t(locale, "bx.remaining")} v={formatMoney(flow.ctx.amountMinor, CCY, locale)} />
            <AgreeRow k={t(locale, "bx.interest")} v="0%" />
            <AgreeRow k={t(locale, "bx.latePol")} v={formatMoney(lateFee, CCY, locale)} />
            <AgreeRow k={t(locale, "bx.totalPay")} v={formatMoney(flow.ctx.amountMinor, CCY, locale)} />
          </div>
          <div className="space-y-0.5">
            {flow.legs.map((l) => (
              <div key={l.n} className="flex justify-between text-[13px]">
                <span>#{l.n} · {t(locale, "bx.due")} {dueDate(l.dueDay)}</span>
                <b className="font-mono">{formatMoney(l.amountMinor, CCY, locale)}</b>
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-amber-50 p-2 text-[13px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">{t(locale, "bx.missWarn")}</div>
          <label className="flex items-start gap-2 text-[13px]">
            <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            {t(locale, "bx.consent")}
          </label>
          <div className="flex flex-wrap gap-1.5">
            <Btn small variant="outline" onClick={() => { flowRef.current = null; setScreen("plans"); }}>{t(locale, "co.cart.back")}</Btn>
            <Btn small variant="outline" onClick={() => { flowRef.current = null; setScreen("shop"); }}>{t(locale, "bx.cancelPlan")}</Btn>
            <Btn small disabled={!agreed} onClick={confirmAgreement}>{t(locale, "bx.confirmPlan")}</Btn>
          </div>
        </Card>
      )}

      {tab === "shop" && screen === "confirm" && flow && (
        <ReceiptCard flow={flow} onDashboard={() => setTab("plan")} onShop={() => { setScreen("shop"); setCart([]); }} />
      )}

      {tab === "plan" && (
        <PlanDashboard
          flow={flow} onPay={payLeg} onMiss={missLeg} onReturn={ret}
          onReset={() => { flowRef.current = null; savedId.current = null; setScreen("shop"); setTab("shop"); }}
        />
      )}

      {tab === "history" && (
        <Card className="space-y-2 p-3">
          <div className="font-semibold">{t(locale, "co.orders.title")}</div>
          {orders.length === 0 && <EmptyNote>{t(locale, "co.orders.empty")}</EmptyNote>}
          {orders.map((o) => (
            <div key={o.id} className="flex items-center gap-2 rounded-lg bg-zinc-50 p-2 text-[13px] dark:bg-zinc-900">
              <div className="flex-1">
                <div className="font-mono font-bold">{formatMoney(o.result.receipt.amountMinor, o.result.receipt.currency, locale)}</div>
                <div className="text-zinc-500"><Time at={o.at} /> · {o.result.events.length} events</div>
              </div>
              <Badge tone={o.result.finalState === "SETTLED" ? "green" : "red"}>{o.result.finalState}</Badge>
            </div>
          ))}
          <div><Btn small variant="outline" onClick={() => { clearSessionsForModule("bnpl"); setOrders([]); }}>{t(locale, "bx.clearHist")}</Btn></div>
        </Card>
      )}

      {flow && (flow.stage === "terminal" || (flow.stage !== "fresh" && denied)) && screen !== "confirm" && tab === "shop" && (
        <Card className="space-y-2 border-red-300 p-3">
          <div className="font-semibold text-red-700 dark:text-red-400">✕ {t(locale, "bn.denied")}</div>
          <DeniedNote flow={flow} />
          <div className="flex flex-wrap gap-1.5">
            <Btn small variant="outline" onClick={() => { flowRef.current = null; setScreen("apply"); }}>{t(locale, "bx.retryApply")}</Btn>
            <Btn small variant="outline" onClick={() => { flowRef.current = null; setScreen("shop"); }}>{t(locale, "bx.tryOther")}</Btn>
          </div>
        </Card>
      )}
    </div>
  );
}

function AgreeRow({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-2"><span className="font-sans text-zinc-500">{k}</span><span>{v}</span></div>;
}

function ShopCart({ cart, onDec, onAdd, onCheckout }: { cart: CartLine[]; onDec: (id: string) => void; onAdd: (id: string) => void; onCheckout?: () => void }) {
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
              <div className="font-mono text-[13px] text-zinc-500">{formatMoney(p.priceMinor, CCY, locale)}</div>
            </div>
            <button aria-label="decrease" className="rounded border border-zinc-300 px-2 dark:border-zinc-700" onClick={() => onDec(l.id)}>−</button>
            <span className="font-mono">{l.qty}</span>
            <button aria-label="increase" className="rounded border border-zinc-300 px-2 dark:border-zinc-700" onClick={() => onAdd(l.id)}>+</button>
          </div>
        );
      })}
      {cart.length > 0 && (
        <div className="space-y-0.5 border-t border-zinc-200 pt-2 font-mono text-[13px] dark:border-zinc-800">
          <div className="flex justify-between"><span>{t(locale, "wm.sub")}</span><span>{formatMoney(tt.sub, CCY, locale)}</span></div>
          <div className="flex justify-between"><span>{t(locale, "wm.ship")}</span><span>{tt.sub >= 5000 ? t(locale, "wm.free") : formatMoney(tt.ship, CCY, locale)}</span></div>
          <div className="flex justify-between"><span>{t(locale, "wm.tax")}</span><span>{formatMoney(tt.tax, CCY, locale)}</span></div>
          <div className="flex justify-between border-t border-zinc-200 pt-1 text-sm font-bold dark:border-zinc-800"><span>{t(locale, "co.cart.total")}</span><span>{formatMoney(tt.total, CCY, locale)}</span></div>
        </div>
      )}
      {onCheckout && cart.length > 0 && <Btn small onClick={onCheckout}>{t(locale, "bx.toCheckout")}</Btn>}
    </Card>
  );
}

function ReceiptCard({ flow, onDashboard, onShop }: { flow: BnplFlow; onDashboard: () => void; onShop: () => void }) {
  const { locale } = usePrefs();
  const r = bnplResult(flow);
  const activated = flow.ctx.events.find((e) => e.type === "PLAN_ACTIVATED");
  return (
    <div className="space-y-2">
      <Card className="space-y-2 p-3">
        <div className="font-semibold text-emerald-700 dark:text-emerald-300">✓ {t(locale, "bx.orderOk")}</div>
        <div className="space-y-1 rounded-xl bg-zinc-50 p-3 font-mono text-[13px] dark:bg-zinc-900">
          <AgreeRow k={t(locale, "bx.ag.purchase")} v={formatMoney(r.receipt.amountMinor, CCY, locale)} />
          <AgreeRow k={t(locale, "bx.dueToday")} v={formatMoney(0, CCY, locale)} />
          <AgreeRow k={t(locale, "bx.remaining")} v={formatMoney(r.receipt.amountMinor, CCY, locale)} />
          <AgreeRow k={t(locale, "bn.planTitle")} v={t(locale, "bn.payIn").replace("{n}", String(flow.legs.length))} />
          <AgreeRow k={t(locale, "wm.rcpt.ref")} v={r.txId} />
          {typeof activated?.payload.merchantNetMinor === "number" && (
            <AgreeRow k={t(locale, "bx.merchantGot")} v={formatMoney(activated.payload.merchantNetMinor as number, CCY, locale)} />
          )}
        </div>
        <div className="flex gap-1.5">
          <Btn small onClick={onDashboard}>{t(locale, "bx.openDash")}</Btn>
          <Btn small variant="outline" onClick={onShop}>{t(locale, "bx.newShop")}</Btn>
        </div>
      </Card>
    </div>
  );
}

function PlanDashboard({ flow, onPay, onMiss, onReturn, onReset }: {
  flow: BnplFlow | null;
  onPay: (n: number) => void;
  onMiss: (n: number) => void;
  onReturn: () => void;
  onReset: () => void;
}) {
  const { locale } = usePrefs();
  const [showTeach, setShowTeach] = useState(false);
  if (!flow || flow.legs.length === 0) {
    return <EmptyNote>{t(locale, "bn.noPlan")}</EmptyNote>;
  }
  const r = bnplResult(flow);
  const next = flow.legs.find((l) => !l.paid);
  const elig = flow.ctx.events.find((e) => e.type === "ELIGIBILITY_CHECKED")?.payload as Record<string, unknown> | undefined;
  const legStatus = (l: { paid: boolean; missed: boolean }): string =>
    l.paid ? t(locale, "bx.st.paid") : l.missed ? t(locale, "bx.st.overdue") : t(locale, "bx.st.sched");
  return (
    <div className="space-y-2">
      <Card className="space-y-2 p-3">
        <div className="grid grid-cols-3 gap-2 text-center text-[13px]">
          <div className="rounded-lg bg-zinc-50 p-1.5 dark:bg-zinc-900"><div className="font-mono font-bold">{formatMoney(flow.ctx.amountMinor, CCY, locale)}</div><div className="text-zinc-500">{t(locale, "bx.financed")}</div></div>
          <div className="rounded-lg bg-zinc-50 p-1.5 dark:bg-zinc-900"><div className="font-mono font-bold">{formatMoney(flow.paidTotal, CCY, locale)}</div><div className="text-zinc-500">{t(locale, "bx.repaid")}</div></div>
          <div className="rounded-lg bg-sky-50 p-1.5 dark:bg-sky-950"><div className="font-mono font-bold">{formatMoney(bnplOwed(flow), CCY, locale)}</div><div className="text-zinc-500">{t(locale, "bn.owed")}</div></div>
        </div>
        <div className="h-2 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
          <div className="h-full bg-emerald-600" style={{ width: `${Math.round((flow.paidTotal / Math.max(1, flow.ctx.amountMinor)) * 100)}%` }} />
        </div>
        {next && flow.stage === "active" && (
          <div className="rounded-lg bg-sky-50 p-2 text-[13px] dark:bg-sky-950">
            {t(locale, "bx.nextDue")}: <b className="font-mono">#{next.n} · {formatMoney(next.amountMinor, CCY, locale)} · {dueDate(next.dueDay)}</b>
          </div>
        )}
        {flow.legs.map((l) => (
          <details key={l.n} className="rounded-lg bg-zinc-50 p-2 text-[13px] dark:bg-zinc-900">
            <summary className="flex cursor-pointer items-center gap-2">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${l.paid ? "bg-emerald-600 text-white" : l.missed ? "bg-red-600 text-white" : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800"}`}>{l.paid ? "✓" : l.n}</span>
              <span>+{l.dueDay}d ({dueDate(l.dueDay)})</span>
              <b className="ms-auto font-mono">{formatMoney(l.amountMinor, CCY, locale)}</b>
              <span className="text-zinc-500">{legStatus(l)}</span>
            </summary>
            <div className="mt-1.5 space-y-1 ps-7">
              <div className="font-mono text-[12px] text-zinc-500">{t(locale, "bx.legDetail")}: #{l.n}/{flow.legs.length} · {dueDate(l.dueDay)} · {legStatus(l)}</div>
              {!l.paid && flow.stage === "active" && next?.n === l.n && (
                <div className="flex gap-1.5">
                  <Btn small onClick={() => onPay(l.n)}>{t(locale, "bn.payLeg")}</Btn>
                  <Btn small variant="outline" onClick={() => onMiss(l.n)}>{t(locale, "bn.missLeg")}</Btn>
                </div>
              )}
            </div>
          </details>
        ))}
        {flow.lateTotal > 0 && <div className="text-[13px] text-red-700 dark:text-red-300">{t(locale, "bn.lateTotal")}: {formatMoney(flow.lateTotal, CCY, locale)}</div>}
        {flow.stage === "active" && (
          <div className="flex flex-wrap gap-1.5">
            <Btn small variant="outline" onClick={onReturn}>{t(locale, "bn.return")}</Btn>
          </div>
        )}
        {flow.stage === "done" && <div className="font-semibold text-emerald-700 dark:text-emerald-300">✓ {t(locale, "bn.complete")}</div>}
      </Card>

      <Card className="space-y-1.5 p-3 text-[13px]">
        <button className="font-semibold" onClick={() => setShowTeach(!showTeach)}>{t(locale, "bx.teachT")} {showTeach ? "▾" : "▸"}</button>
        {!showTeach && <div className="text-zinc-500">{t(locale, "bx.teachSub")}</div>}
        {showTeach && (
          <div className="space-y-1 text-zinc-600 dark:text-zinc-400">
            <div>{t(locale, "bx.teachSplit")}</div>
            <div>{t(locale, "bx.teachRoles")}</div>
            <div>{t(locale, "bx.teachElig")}{elig ? ` ${t(locale, "bx.teachScore").replace("{s}", String(elig.score ?? "?")).replace("{d}", String(elig.debtRatio ?? "?"))}` : ""}</div>
            <div>{t(locale, "bx.teachPaid")}</div>
            <div>{t(locale, "bx.teachRisk")}</div>
            <details className="rounded-lg bg-zinc-50 p-2 font-mono text-[12px] dark:bg-zinc-900">
              <summary className="cursor-pointer font-sans font-semibold">{t(locale, "bx.teachTech")}</summary>
              <div className="mt-1">MDR {r.receipt.feeLines.map((l) => `${l.ruleId}`).join(",")} · {t(locale, "bx.teachLedger")}: {r.ledgerEntries.length} · score ≥ 50 approve · 40–49 verify · &lt;40 decline</div>
            </details>
          </div>
        )}
      </Card>

      <div><Btn small variant="outline" onClick={onReset}>{t(locale, "bx.resetDemo")}</Btn></div>
    </div>
  );
}

function DeniedNote({ flow }: { flow: BnplFlow }) {
  const { locale } = usePrefs();
  const d = [...flow.ctx.events].reverse().find((e) => e.type === "BNPL_DENIED");
  const reasons = Array.isArray((d?.payload as Record<string, unknown> | undefined)?.reasons)
    ? ((d!.payload as Record<string, unknown>).reasons as string[]) : [];
  const txt = (r: string) => r === "debt-ratio" ? t(locale, "bx.why.debt")
    : r === "thin-file" ? t(locale, "bx.why.thin")
    : r === "long-plan" ? t(locale, "bx.why.plan")
    : r === "provider-policy" ? t(locale, "bx.why.policy")
    : t(locale, "bx.why.verify");
  return (
    <div className="rounded-lg bg-red-50 p-2 text-[13px] text-red-800 dark:bg-red-950 dark:text-red-200">
      {reasons.length > 0 ? reasons.map(txt).join(" · ") : t(locale, "bn.denied")}
    </div>
  );
}
