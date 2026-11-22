/**
 * Wallet setup + unlock. First run is a ceremony: intro -> fictional profile
 * -> device passcode (created + confirmed) -> mock device verification.
 * The profile (name + demo PIN) persists locally, clearly demo-only; every
 * visit starts locked and asks for the passcode again. No biometrics, no OS
 * wallet, no real credentials anywhere.
 */
"use client";
import { useState } from "react";
import { t } from "@/i18n/dict";
import { usePrefs } from "../providers";
import { Btn, Card } from "../ui";
import { MockSms, OtpBoxes, StepHead, inpCls } from "../flows/kit";

export interface WalletProfile {
  name: string;
  /** fictional demo passcode, local only — never a real PIN/password */
  pin: string;
}

const PROFILE_KEY = "simpay.wallet.profile.v1";

export function loadProfile(): WalletProfile | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<WalletProfile>;
    return typeof p.name === "string" && /^\d{4}$/.test(p.pin ?? "") ? { name: p.name, pin: p.pin as string } : null;
  } catch {
    return null;
  }
}

export function saveProfile(p: WalletProfile): void {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* noop */ }
}

export function clearProfile(): void {
  try { localStorage.removeItem(PROFILE_KEY); } catch { /* noop */ }
}

/** Deterministic mock device code (no randomness, no network). */
export function deviceCode(seed: number, salt: number): string {
  return String((seed * 7919 + salt * 131071) % 1_000_000).padStart(6, "0");
}

export function SetupWizard({ seed, onDone }: { seed: number; onDone: (p: WalletProfile) => void }) {
  const { locale } = usePrefs();
  const [step, setStep] = useState<"intro" | "profile" | "passcode" | "verify">("intro");
  const [name, setName] = useState("");
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(3);

  const nextProfile = () => {
    if (name.trim().length < 2) { setErr(t(locale, "co.err.required")); return; }
    setErr(null);
    setStep("passcode");
  };
  const nextPasscode = () => {
    if (!/^\d{4}$/.test(pin1) || pin1 !== pin2) { setErr(t(locale, "wsu.pinBad")); return; }
    setErr(null);
    setCode("");
    setAttempts(3);
    setStep("verify");
  };
  const verify = () => {
    if (code.trim() === deviceCode(seed, 7)) {
      onDone({ name: name.trim(), pin: pin1 });
    } else {
      const left = attempts - 1;
      setAttempts(left);
      if (left <= 0) {
        setErr(t(locale, "wsu.verifyDead"));
      } else {
        setErr(`${t(locale, "co.ch.wrong")} (${left})`);
      }
    }
  };

  return (
    <Card className="mx-auto max-w-[420px] space-y-2 p-4">
      {step === "intro" && (
        <>
          <StepHead title={t(locale, "wsu.introT")} sub={t(locale, "wsu.introB")} />
          <ul className="list-disc space-y-0.5 ps-5 text-[13px] text-zinc-600 dark:text-zinc-400">
            <li>{t(locale, "wsu.intro1")}</li>
            <li>{t(locale, "wsu.intro2")}</li>
            <li>{t(locale, "wsu.intro3")}</li>
          </ul>
          <Btn onClick={() => setStep("profile")}>{t(locale, "wsu.start")}</Btn>
        </>
      )}
      {step === "profile" && (
        <>
          <StepHead title={t(locale, "wsu.profileT")} sub={t(locale, "wsu.profileB")} />
          <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "wsu.name")}</span>
            <input className={inpCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={t(locale, "wsu.name")} autoComplete="off" /></label>
          {err && <div className="text-[13px] text-red-700 dark:text-red-400">{err}</div>}
          <div className="flex gap-1.5">
            <Btn small variant="outline" onClick={() => setStep("intro")}>{t(locale, "wsh.back")}</Btn>
            <Btn small onClick={nextProfile}>{t(locale, "cr.s.next")}</Btn>
          </div>
        </>
      )}
      {step === "passcode" && (
        <>
          <StepHead title={t(locale, "wsu.pinT")} sub={t(locale, "wsu.pinB")} />
          <OtpBoxes value={pin1} onChange={setPin1} length={4} label="passcode" />
          <OtpBoxes value={pin2} onChange={setPin2} length={4} label="passcode" />
          {err && <div className="text-center text-[13px] text-red-700 dark:text-red-400">{err}</div>}
          <div className="flex gap-1.5">
            <Btn small variant="outline" onClick={() => setStep("profile")}>{t(locale, "wsh.back")}</Btn>
            <Btn small onClick={nextPasscode}>{t(locale, "cr.s.next")}</Btn>
          </div>
        </>
      )}
      {step === "verify" && (
        <>
          <StepHead title={t(locale, "wsu.verifyT")} sub={t(locale, "wsu.verifyB")} />
          <MockSms title={t(locale, "co.ch.sms")}>
            <span>{t(locale, "co.ch.smsB")} <b className="font-mono text-base">{deviceCode(seed, 7)}</b></span>
          </MockSms>
          <OtpBoxes value={code} onChange={setCode} length={6} label="code" />
          {err && <div className="text-center text-[13px] text-red-700 dark:text-red-400">{err}</div>}
          <div className="flex gap-1.5">
            <Btn small variant="outline" onClick={() => setStep("passcode")}>{t(locale, "wsh.back")}</Btn>
            <Btn small onClick={verify} disabled={attempts <= 0}>{t(locale, "wba.verify")}</Btn>
          </div>
        </>
      )}
    </Card>
  );
}

export function UnlockScreen({ name, hintPin, onUnlock }: { name: string; hintPin: string; onUnlock: (pin: string) => boolean }) {
  const { locale } = usePrefs();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-1.5">
    <Card className="mx-auto max-w-[340px] space-y-2 p-4 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 text-2xl dark:bg-zinc-800">◉</div>
      <div className="font-semibold">{t(locale, "wlock.title")}</div>
      <div className="text-[13px] text-zinc-500">{t(locale, "wlock.sub").replace("{n}", name)}</div>
      <OtpBoxes value={pin} onChange={setPin} length={4} label="passcode" />
      {err && <div className="text-[13px] text-red-700 dark:text-red-400">{err}</div>}
      <button
        onClick={() => {
          if (onUnlock(pin)) { setErr(null); }
          else { setErr(t(locale, "wlock.wrong")); setPin(""); }
        }}
        className="w-full rounded-xl bg-zinc-900 py-2.5 text-sm font-bold text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        {t(locale, "wlock.open")}
      </button>
    </Card>
    <div className="mx-auto max-w-[340px] text-center font-mono text-[12px] text-zinc-500">
      Demo passcode: <span dir="ltr">{hintPin}</span> (fictional, kept in this browser only)
    </div>
    </div>
  );
}
