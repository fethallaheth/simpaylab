/**
 * Standalone Add-a-card workflow: live preview -> review -> mock issuer
 * verification -> provisioned token. Full PAN/CVC exist only in this screen's
 * state and are wiped the moment the token is stored. Only last4/expiry/
 * name/DPAN ever persist.
 */
"use client";
import { useRef, useState } from "react";
import {
  createRunBase,
  createWalletFlow,
  validateDemoCard,
  walletAdvance,
  walletResult,
  type FailureId,
  type RunResult,
  type WalletFlow
} from "@sim/engine";
import { t } from "@/i18n/dict";
import { usePrefs } from "../providers";
import { Btn, Card } from "../ui";
import { MockSms, OtpBoxes, ProcessingLadder, inpCls } from "../flows/kit";
import { formatExp, formatPan } from "../checkout/validation";
import { DEMO_CARDS } from "@sim/engine";
import { deviceCode } from "./setup";
import type { TokenRef } from "./sheets";

const COUNTRIES = ["Algeria", "France", "Spain", "Italy", "Germany", "Morocco", "Tunisia", "Other"];

function brandOf(pan: string): string {
  const d = pan.replace(/\D/g, "");
  if (d.startsWith("555555")) return "Credit";
  if (d.startsWith("353011")) return "Prepaid";
  return "Debit";
}

export function AddCardFlow({ seed, params, failures, onLive, onStored, onCancel }: {
  seed: number;
  params: Record<string, unknown>;
  failures: FailureId[];
  onLive: (r: RunResult) => void;
  onStored: (t: TokenRef) => void;
  onCancel: () => void;
}) {
  const { locale } = usePrefs();
  const [stage, setStage] = useState<"form" | "review" | "verify" | "provisioning" | "done" | "error">("form");
  const [pan, setPan] = useState("");
  const [name, setName] = useState("");
  const [exp, setExp] = useState("");
  const [cvc, setCvc] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [postcode, setPostcode] = useState("");
  const [country, setCountry] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [attempts, setAttempts] = useState(3);
  const [stored, setStored] = useState<TokenRef | null>(null);
  const flowRef = useRef<WalletFlow | null>(null);

  const digits = pan.replace(/\D/g, "");
  const formOk =
    validateDemoCard(pan).ok &&
    name.trim().length >= 2 &&
    /^(0[1-9]|1[0-2])\/\d{2}$/.test(exp) &&
    /^\d{3,4}$/.test(cvc) &&
    street.trim().length >= 3 && city.trim().length >= 2 && postcode.trim().length >= 3 && country !== "";

  const beginVerify = () => {
    const check = validateDemoCard(pan);
    if (!check.ok) { setErr(t(locale, check.reasonKey)); return; }
    if (!formOk) { setErr(t(locale, "co.err.required")); return; }
    setErr(null);
    setStage("review");
  };

  const startProvision = () => {
    setCode("");
    setAttempts(3);
    setErr(null);
    setStage("verify");
  };

  const submitCode = () => {
    if (code.trim() === deviceCode(seed, 11)) {
      setStage("provisioning");
      return;
    }
    const left = attempts - 1;
    setAttempts(left);
    if (left <= 0) setStage("error");
    else setErr(`${t(locale, "co.ch.wrong")} (${left})`);
  };

  const provision = () => {
    const base = createRunBase("wallet", { seed, params: { ...params, walletKind: "card", amountMinor: 100 }, failures });
    const flow = createWalletFlow(base);
    flowRef.current = flow;
    walletAdvance(flow, { type: "add_card", pan, name, exp, cvc });
    const r: RunResult = walletResult(flow);
    onLive(r);
    const last = flow.ctx.events[flow.ctx.events.length - 1].type;
    if (last === "CARD_REJECTED" || last === "TOKEN_SUSPENDED" || flow.stage === "terminal") {
      setErr(t(locale, last === "CARD_REJECTED" ? "wa.cardBad" : "wa.tokenBad"));
      setStage("error");
      return;
    }
    const prov = [...flow.ctx.events].reverse().find((e) => e.type === "CARD_PROVISIONED");
    const dpan = typeof prov?.payload.dpan === "string" ? prov.payload.dpan : `dpan_...${flow.ctx.txId.slice(-4)}`;
    const token: TokenRef = { id: `tok-${Date.now()}`, last4: digits.slice(-4), exp, name: name.trim(), dpan, brand: brandOf(pan), isDefault: false };
    // secrets die here: wipe the form before anything else runs
    setPan(""); setName(""); setExp(""); setCvc("");
    setStored(token);
    onStored(token);
    setStage("done");
  };

  return (
    <Card className="space-y-2 p-3">
      {stage === "form" && (
        <>
          <div className="font-semibold">{t(locale, "wadd.formT")}</div>
          <div className="rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-950 p-3 text-white">
            <div className="font-mono text-[15px] tracking-wider">{digits ? digits.replace(/(\d{4})(?=\d)/g, "$1 ") : "•••• •••• •••• ••••"}</div>
            <div className="mt-2 flex justify-between text-[12px] opacity-80">
              <span>{name.trim() || "NAME"}</span>
              <span className="font-mono">{exp || "MM/YY"}</span>
            </div>
          </div>
          <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "co.pay.pan")}</span>
            <input dir="ltr" inputMode="numeric" className={`${inpCls} font-mono`} value={pan} onChange={(e) => setPan(formatPan(e.target.value))} placeholder="4000 0000 0000 0000" autoComplete="off" /></label>
          <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "co.pay.name")}</span>
            <input className={`${inpCls} uppercase`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "co.pay.exp")}</span>
              <input dir="ltr" inputMode="numeric" className={`${inpCls} font-mono`} value={exp} onChange={(e) => setExp(formatExp(e.target.value))} placeholder="MM/YY" autoComplete="off" /></label>
            <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "co.pay.cvc")}</span>
              <input dir="ltr" inputMode="numeric" className={`${inpCls} font-mono`} value={cvc} onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="123" autoComplete="off" /></label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "co.info.street")}</span>
              <input className={inpCls} value={street} onChange={(e) => setStreet(e.target.value)} autoComplete="off" /></label>
            <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "co.info.city")}</span>
              <input className={inpCls} value={city} onChange={(e) => setCity(e.target.value)} autoComplete="off" /></label>
            <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "co.info.post")}</span>
              <input className={inpCls} value={postcode} onChange={(e) => setPostcode(e.target.value)} autoComplete="off" /></label>
            <label className="col-span-2 block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "co.info.country")}</span>
              <select className={inpCls} value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="">—</option>
                {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select></label>
          </div>
          {err && <div className="text-[13px] text-red-700 dark:text-red-400">{err}</div>}
          <details className="rounded-lg bg-zinc-50 p-2 text-[12px] dark:bg-zinc-900">
            <summary className="cursor-pointer font-medium">{t(locale, "co.pay.hintT")}</summary>
            <div className="mt-1 space-y-1 font-mono">
              {DEMO_CARDS.map((c) => (
                <div key={c.id} className="flex items-center gap-2">
                  <span className="flex-1">{c.pan} · {c.exp} · {c.cvc}</span>
                  <button className="rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-700" onClick={() => { setPan(formatPan(c.pan)); setExp(c.exp); setCvc(c.cvc); }}>{t(locale, "co.pay.fill")}</button>
                </div>
              ))}
            </div>
          </details>
          <div className="flex gap-1.5">
            <Btn small variant="outline" onClick={onCancel}>{t(locale, "wsh.back")}</Btn>
            <Btn small onClick={beginVerify}>{t(locale, "wadd.review")}</Btn>
          </div>
        </>
      )}

      {stage === "review" && (
        <>
          <div className="font-semibold">{t(locale, "wadd.reviewT")}</div>
          <div className="space-y-1 rounded-xl bg-zinc-50 p-3 font-mono text-[13px] dark:bg-zinc-900">
            <div className="flex justify-between"><span className="font-sans text-zinc-500">{t(locale, "co.pay.name")}</span><span>{name.trim()}</span></div>
            <div className="flex justify-between"><span className="font-sans text-zinc-500">{t(locale, "co.pay.pan")}</span><span>•••• •••• •••• {digits.slice(-4)}</span></div>
            <div className="flex justify-between"><span className="font-sans text-zinc-500">{t(locale, "co.info.street")}</span><span>{street}, {city}</span></div>
          </div>
          <div className="rounded-lg bg-sky-50 p-2 text-[13px] text-sky-900 dark:bg-sky-950 dark:text-sky-200">{t(locale, "wadd.tokenNote")}</div>
          <div className="flex gap-1.5">
            <Btn small variant="outline" onClick={() => setStage("form")}>{t(locale, "wsh.back")}</Btn>
            <Btn small variant="outline" onClick={onCancel}>{t(locale, "wsh.cancel")}</Btn>
            <Btn small onClick={startProvision}>{t(locale, "wadd.provision")}</Btn>
          </div>
        </>
      )}

      {stage === "verify" && (
        <>
          <div className="font-semibold">{t(locale, "wadd.verifyT")}</div>
          <MockSms title={t(locale, "co.ch.sms")}>
            <span>{t(locale, "co.ch.smsB")} <b className="font-mono text-base">{deviceCode(seed, 11)}</b></span>
          </MockSms>
          <OtpBoxes value={code} onChange={setCode} label="code" />
          {err && <div className="text-center text-[13px] text-red-700 dark:text-red-400">{err}</div>}
          <div className="flex gap-1.5">
            <Btn small variant="outline" onClick={() => setStage("review")}>{t(locale, "wsh.back")}</Btn>
            <Btn small onClick={submitCode}>{t(locale, "wba.verify")}</Btn>
          </div>
        </>
      )}

      {stage === "provisioning" && (
        <ProcessingLadder steps={[t(locale, "wadd.p1"), t(locale, "wadd.p2"), t(locale, "wadd.p3"), t(locale, "wadd.p4")]} onDone={provision} />
      )}

      {stage === "done" && stored && (
        <>
          <div className="font-semibold text-emerald-700 dark:text-emerald-300">✓ {t(locale, "wadd.doneT")}</div>
          <div className="font-mono text-sm">{stored.brand} ···· {stored.last4} · {stored.dpan}</div>
          <div className="text-[13px] text-zinc-500">{t(locale, "wadd.doneB")}</div>
          <div><Btn small onClick={onCancel}>{t(locale, "wadd.backWallet")}</Btn></div>
        </>
      )}

      {stage === "error" && (
        <>
          <div className="font-semibold text-red-700 dark:text-red-400">✕ {t(locale, "wadd.errorT")}</div>
          <div className="text-[13px] text-zinc-600 dark:text-zinc-400">{err ?? t(locale, "co.no.title")}</div>
          <div className="flex gap-1.5">
            <Btn small variant="outline" onClick={() => { setErr(null); setCode(""); setAttempts(3); setStage("review"); }}>{t(locale, "bx.retryApply")}</Btn>
            <Btn small variant="outline" onClick={onCancel}>{t(locale, "wsh.cancel")}</Btn>
          </div>
        </>
      )}
    </Card>
  );
}
