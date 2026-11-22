/**
 * Ember — a simulated self-custody browser wallet (original branding).
 * Extension-popup frame (360–420px, expandable), onboarding with backup
 * ceremony, lock/unlock, accounts, networks, tokens, send wizard, receive,
 * swaps, dApps, signing, activity, notifications and security settings.
 * Every screen reads one deterministic engine state; nothing is real.
 */
"use client";
import { useRef, useState } from "react";
import QRCode from "react-qr-code";
import {
  hwAddAccount,
  hwAddContact,
  hwAddNetwork,
  hwAddToken,
  hwApprove,
  hwBalance,
  hwCancel,
  hwConfirm,
  hwConfirmReceive,
  hwConnect,
  hwDisconnect,
  hwEstimateFee,
  hwFail,
  hwFaucet,
  hwImport,
  hwLock,
  hwMarkRead,
  hwOnboardCreate,
  hwQuoteSwap,
  hwReceive,
  hwRemoveAccount,
  hwRemoveNetwork,
  hwRemoveToken,
  hwRenameAccount,
  hwRevealSeed,
  hwRevoke,
  hwSelectNetwork,
  hwSend,
  hwSetPassword,
  hwSign,
  hwStake,
  hwSwap,
  hwSwitchAccount,
  hwUnlock,
  hwUnstake,
  DEMO_PHRASE_A,
  type HWTx
} from "@sim/engine";
import { t } from "@/i18n/dict";
import { usePrefs } from "../providers";
import { Btn, Card } from "../ui";
import { EmptyNote, OtpBoxes, StepHead, inpCls } from "../flows/kit";
import { fmtUnits, shortAddr, useHotWallet, type PayIntent } from "./wstate";

type Screen =
  | "onboard" | "import" | "seed" | "verify" | "lock" | "home" | "accounts" | "networks" | "tokens"
  | "send" | "receive" | "swap" | "dapps" | "activity" | "notifs" | "settings" | "buy";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

function Learn({ title, body, tech }: { title: string; body: string; tech?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl bg-sky-50 p-2.5 text-[13px] dark:bg-sky-950">
      <button className="font-semibold text-sky-900 dark:text-sky-200" onClick={() => setOpen(!open)}>
        {title} {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="mt-1 space-y-1 text-zinc-600 dark:text-zinc-300">
          <div>{body}</div>
          {tech && <div className="rounded-lg bg-white/60 p-1.5 font-mono text-[12px] dark:bg-zinc-900">{tech}</div>}
        </div>
      )}
    </div>
  );
}

export function HotWallet({ seed = 7, intent = null, onIntentDone, onExit }: {
  seed?: number;
  intent?: PayIntent | null;
  onIntentDone?: (r: { txId: string; hash: string } | null) => void;
  onExit?: () => void;
}) {
  const { locale } = usePrefs();
  const { s, err, setErr, run, resetAll } = useHotWallet(seed);
  const [screen, setScreen] = useState<Screen>("home");
  const [expanded, setExpanded] = useState(false);
  // onboarding
  const [obName, setObName] = useState("");
  const [obPw, setObPw] = useState("");
  const [obPw2, setObPw2] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [picks, setPicks] = useState<string[]>(["", "", ""]);
  const [impPhrase, setImpPhrase] = useState("");
  const [impPw, setImpPw] = useState("");
  // lock
  const [pw, setPw] = useState("");
  // accounts / networks / tokens
  const [q, setQ] = useState("");
  const [newAcct, setNewAcct] = useState("");
  const [rename, setRename] = useState("");
  const [netForm, setNetForm] = useState({ label: "", native: "", chainId: "", gas: "" });
  const [tokForm, setTokForm] = useState({ symbol: "", name: "", address: "", decimals: "18" });
  const [tokQuery, setTokQuery] = useState("");
  const [asset, setAsset] = useState("");
  // send wizard
  const [sendStep, setSendStep] = useState(0);
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState("");
  const [fiat, setFiat] = useState(true);
  const [units, setUnits] = useState("21000");
  const [prio, setPrio] = useState("1");
  const [contactName, setContactName] = useState("");
  const [lastTx, setLastTx] = useState<string | null>(null);
  // receive / faucet
  const [inAsset, setInAsset] = useState("");
  const [inAmt, setInAmt] = useState("");
  const [faucetAmt, setFaucetAmt] = useState("0.05");
  // swap
  const [swFrom, setSwFrom] = useState("");
  const [swTo, setSwTo] = useState("");
  const [swAmt, setSwAmt] = useState("");
  const [slip, setSlip] = useState("50");
  // dapps
  const [dapp, setDapp] = useState<string | null>(null);
  const [stakeAmt, setStakeAmt] = useState("");
  const [allowAmt, setAllowAmt] = useState("");
  const [allowUnlimited, setAllowUnlimited] = useState(false);
  // activity
  const [flt, setFlt] = useState("all");
  const [txDetail, setTxDetail] = useState<string | null>(null);
  // settings
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [lockSecs, setLockSecs] = useState("300");
  const [showSeed, setShowSeed] = useState(false);
  const [seedPw, setSeedPw] = useState("");
  const [seedWords, setSeedWords] = useState<string[] | null>(null);
  const [resetArm, setResetArm] = useState(false);

  const net = s.networks.find((n) => n.id === s.activeNetwork)!;
  const acct = s.accounts.find((a) => a.id === s.activeAccount) ?? null;
  const toks = s.tokens[s.activeNetwork] ?? [];
  const cur = asset || net.native;
  const unread = s.notifs.filter((n) => !n.read).length;

  const go = (x: Screen) => {
    setErr(null);
    setScreen(x);
  };

  // ---------- onboarding ----------
  if (!s.seedWords) {
    return (
      <Frame expanded={expanded} onExpand={() => setExpanded(!expanded)} title={t(locale, "hw.brand")} onExit={onExit} bare>
        {screen === "import" ? (
          <div className="space-y-2 p-4">
            <StepHead title={t(locale, "hw.importT")} sub={t(locale, "hw.importB")} />
            <div className="rounded-xl bg-amber-50 p-2 font-mono text-[12px] dark:bg-amber-950">{t(locale, "hw.demoProfile")}: {DEMO_PHRASE_A}</div>
            <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "hw.phrase")}</span>
              <textarea rows={3} className={`${inpCls} font-mono`} value={impPhrase} onChange={(e) => setImpPhrase(e.target.value)} autoComplete="off" /></label>
            <input aria-label="password" type="password" className={`${inpCls} font-mono`} value={impPw} onChange={(e) => setImpPw(e.target.value)} placeholder={t(locale, "hw.password")} autoComplete="off" />
            {err && <div className="text-[13px] text-red-700 dark:text-red-400">{err}</div>}
            <div className="flex gap-1.5">
              <Btn small variant="outline" onClick={() => setScreen("onboard")}>{t(locale, "wsh.back")}</Btn>
              <Btn small onClick={() => {
                const r = run((st) => hwImport(st, impPhrase, impPw));
                if (r) setScreen("home");
              }}>{t(locale, "hw.importGo")}</Btn>
            </div>
          </div>
        ) : screen === "seed" ? (
          <div className="space-y-2 p-4">
            <StepHead title={t(locale, "hw.seedT")} sub={t(locale, "hw.seedB")} />
            {!revealed ? (
              <Btn onClick={() => setRevealed(true)}>{t(locale, "hw.reveal")}</Btn>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-1 font-mono text-[13px]">
                  {(s.seedWords ?? []).map((w, i) => <span key={i} className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{i + 1}. {w}</span>)}
                </div>
                <Btn small onClick={() => { setPicks(["", "", ""]); setScreen("verify"); }}>{t(locale, "hw.wroteDown")}</Btn>
              </>
            )}
          </div>
        ) : screen === "verify" ? (
          <div className="space-y-2 p-4">
            <StepHead title={t(locale, "hw.verifyT")} sub={t(locale, "hw.verifyB")} />
            {[1, 6, 10].map((pos, i) => (
              <label key={pos} className="block text-[13px]">#{pos + 1}
                <select className={inpCls} value={picks[i]} onChange={(e) => setPicks(picks.map((p, j) => (j === i ? e.target.value : p)))}>
                  <option value="">—</option>
                  {verifyOptions(pos).map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </label>
            ))}
            {err && <div className="text-[13px] text-red-700 dark:text-red-400">{err}</div>}
            <div className="flex gap-1.5">
              <Btn small variant="outline" onClick={() => setScreen("seed")}>{t(locale, "wsh.back")}</Btn>
              <Btn small onClick={() => {
                const words = s.seedWords ?? [];
                const ok = [1, 6, 10].every((pos, i) => picks[i] === words[pos]);
                if (!ok) { setErr(t(locale, "hw.verifyBad")); return; }
                run((st) => { st.backedUp = true; return true; });
                setScreen("home");
              }}>{t(locale, "hw.verifyGo")}</Btn>
            </div>
          </div>
        ) : (
          <div className="space-y-2 p-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500 text-2xl font-bold text-white">E</div>
            <div className="text-lg font-bold">{t(locale, "hw.welcomeT")}</div>
            <div className="text-[13px] text-zinc-500">{t(locale, "hw.welcomeB")}</div>
            <label className="block text-left text-[13px]"><span className="mb-1 block font-medium">{t(locale, "hw.walletName")}</span>
              <input className={inpCls} value={obName} onChange={(e) => setObName(e.target.value)} placeholder="Vault" autoComplete="off" /></label>
            <div className="grid grid-cols-2 gap-1.5">
              <input aria-label="password" type="password" className={`${inpCls} font-mono`} value={obPw} onChange={(e) => setObPw(e.target.value)} placeholder={t(locale, "hw.password")} autoComplete="off" />
              <input aria-label="confirm" type="password" className={`${inpCls} font-mono`} value={obPw2} onChange={(e) => setObPw2(e.target.value)} placeholder={t(locale, "hw.confirm")} autoComplete="off" />
            </div>
            {err && <div className="text-[13px] text-red-700 dark:text-red-400">{err}</div>}
            <div className="flex gap-1.5">
              <Btn small variant="outline" onClick={() => setScreen("import")}>{t(locale, "hw.importCta")}</Btn>
              <Btn small onClick={() => {
                if (obPw !== obPw2) { setErr(t(locale, "hw.pwMismatch")); return; }
                const w = run((st) => hwOnboardCreate(st, obName, obPw));
                if (w) setScreen("seed");
              }}>{t(locale, "hw.createCta")}</Btn>
            </div>
          </div>
        )}
      </Frame>
    );
  }

  function verifyOptions(pos: number): string[] {
    const words = s.seedWords ?? [];
    const correct = words[pos] ?? "";
    const pool = ["river", "candle", "orbit", "meadow", "cipher", "harbor", "lantern", "prairie", "quartz", "signal", "tundra", "velvet", "willow", "yonder", "zephyr", "anchor"].filter((w) => w !== correct);
    const out = [correct];
    let h = seed + pos * 131;
    while (out.length < 4) {
      h = (h * 1103515245 + 12345) & 0x7fffffff;
      const w = pool[h % pool.length];
      if (!out.includes(w)) out.push(w);
    }
    return out.sort();
  }

  const intentConsumed = useRef(false);
  const [msg, setMsg] = useState("");
  const [lastSig, setLastSig] = useState<HWTx | null>(null);

  const portfolio = toks.reduce((sum, tk) => sum + (hwBalance(s, acct?.id ?? "", net.id, tk.symbol) / 10 ** tk.decimals) * tk.priceUsd, 0);
  const mineTxs = s.txs.filter((x) => x.from === acct?.id || x.to === acct?.id || x.to === acct?.address);

  const MERCHANT_ADDR = "0x1111111111111111111111111111111111111111";
  const POOL_ADDR = "0x2222222222222222222222222222222222222222";

  // ---------- locked gate ----------
  if (!s.unlocked) {
    return (
      <Frame expanded={expanded} onExpand={() => setExpanded(!expanded)} title={t(locale, "hw.brand")} onExit={onExit} bare>
        <div className="space-y-2 p-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500 text-2xl font-bold text-white">E</div>
          <div className="font-bold">{t(locale, "hw.lockedT")}</div>
          <div className="text-[13px] text-zinc-500">{t(locale, "hw.lockedB")}</div>
          <OtpBoxes value={pw} onChange={setPw} length={4} label="password" />
          {err && <div className="text-[13px] text-red-700 dark:text-red-400">{err}</div>}
          <Btn onClick={() => { const r = run((st) => { hwUnlock(st, pw); return true; }); if (r) setPw(""); }}>{t(locale, "hw.unlock")}</Btn>
        </div>
      </Frame>
    );
  }

  const native = net.native;
  const curTok = toks.find((x) => x.symbol === cur) ?? toks[0];

  return (
    <Frame expanded={expanded} onExpand={() => setExpanded(!expanded)} title={t(locale, "hw.brand")} onExit={onExit}>
      {/* top bar */}
      <div className="flex items-center gap-1.5 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
        <select aria-label="network" className="max-w-[110px] rounded bg-zinc-100 px-1 py-0.5 text-[12px] font-bold dark:bg-zinc-800" value={s.activeNetwork} onChange={(e) => { run((st) => hwSelectNetwork(st, e.target.value)); }}>
          {s.networks.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
        <select aria-label="account" className="max-w-[110px] flex-1 rounded bg-zinc-100 px-1 py-0.5 text-[12px] dark:bg-zinc-800" value={s.activeAccount ?? ""} onChange={(e) => { run((st) => hwSwitchAccount(st, e.target.value)); }}>
          {s.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button aria-label="notifications" onClick={() => go("notifs")} className="relative rounded px-1.5 text-zinc-500">●
          {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-0.5 text-[10px] font-bold text-white">{unread}</span>}
        </button>
        <button aria-label="settings" onClick={() => go("settings")} className="rounded px-1.5 text-zinc-500">⚙</button>
      </div>

      {screen === "home" && acct && (
        <div className="space-y-2 p-3">
          <div className="text-center">
            <button className="text-sm font-bold" onClick={() => go("accounts")}>{acct.name} ▾</button>
            <div className="mt-0.5 flex items-center justify-center gap-1 font-mono text-[12px] text-zinc-500">
              {shortAddr(acct.address)}
              <button className="underline" onClick={() => { try { void navigator.clipboard.writeText(acct.address); } catch { /* noop */ } }}>{t(locale, "hw.copy")}</button>
            </div>
            <div className="mt-1 font-mono text-2xl font-bold">${portfolio.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            <div className="text-[11px] text-zinc-500">{t(locale, "hw.illustrative")}</div>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            <Btn small onClick={() => go("buy")}>{t(locale, "hw.buy")}</Btn>
            <Btn small onClick={() => { prepSend(); go("send"); }}>{t(locale, "hw.send")}</Btn>
            <Btn small onClick={() => go("swap")}>{t(locale, "hw.swap")}</Btn>
            <Btn small onClick={() => go("receive")}>{t(locale, "hw.receive")}</Btn>
          </div>
          <div className="space-y-1">
            {toks.map((tk) => (
              <button key={tk.symbol} onClick={() => { setAsset(tk.symbol); go("tokens"); }} className="flex w-full items-center gap-2 rounded-xl p-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-sm font-bold dark:bg-zinc-800">{tk.symbol[0]}</span>
                <span className="flex-1">
                  <span className="block text-sm font-bold">{tk.symbol}</span>
                  <span className="block text-[12px] text-zinc-500">{tk.name}</span>
                </span>
                <span className="text-right">
                  <span className="block font-mono text-sm">{fmtUnits(hwBalance(s, acct.id, net.id, tk.symbol), tk.decimals)} {tk.symbol}</span>
                  <span className="block font-mono text-[12px] text-zinc-500">${((hwBalance(s, acct.id, net.id, tk.symbol) / 10 ** tk.decimals) * tk.priceUsd).toFixed(2)}</span>
                </span>
              </button>
            ))}
          </div>
          <div>
            <div className="mb-1 text-[12px] font-bold uppercase tracking-widest text-zinc-500">{t(locale, "hw.recent")}</div>
            {mineTxs.slice(-3).reverse().map((x) => (
              <button key={x.id} onClick={() => { setTxDetail(x.id); go("activity"); }} className="w-full rounded-lg p-1.5 text-left text-[13px] hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <span className="font-mono font-bold">{x.kind}</span> · {x.status} · <span className="font-mono">{shortAddr(x.to || x.from)}</span>
              </button>
            ))}
            {mineTxs.length === 0 && <div className="text-[13px] text-zinc-500">{t(locale, "hw.noActivity")}</div>}
          </div>
          <Learn title={t(locale, "hw.learnHomeT")} body={t(locale, "hw.learnHomeB")} tech={t(locale, "hw.learnHomeX")} />
        </div>
      )}

      {screen === "accounts" && (
        <div className="space-y-2 p-3">
          <StepHead title={t(locale, "hw.accountsT")} />
          <input className={inpCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(locale, "hw.search")} aria-label="search" />
          {s.accounts.filter((a) => a.name.toLowerCase().includes(q.toLowerCase())).map((a) => (
            <div key={a.id} className={`rounded-xl border p-2 ${a.id === s.activeAccount ? "border-sky-500" : "border-zinc-200 dark:border-zinc-800"}`}>
              <div className="flex items-center gap-2">
                <button className="flex-1 text-left text-sm font-bold" onClick={() => { run((st) => hwSwitchAccount(st, a.id)); go("home"); }}>{a.name}</button>
              </div>
              <div className="font-mono text-[12px] text-zinc-500">{shortAddr(a.address)}</div>
              {rename !== "" && (
                <div className="mt-1 flex gap-1">
                  <input className={`${inpCls} !mt-0`} value={rename} onChange={(e) => setRename(e.target.value)} aria-label="rename" />
                  <Btn small onClick={() => { const r = run((st) => hwRenameAccount(st, a.id, rename)); if (r !== null) setRename(""); }}>{t(locale, "hw.save")}</Btn>
                  <Btn small variant="outline" onClick={() => { run((st) => hwRemoveAccount(st, a.id)); }}>{t(locale, "hw.remove")}</Btn>
                </div>
              )}
              {rename === "" && (
                <div className="mt-1 flex gap-1">
                  <Btn small variant="outline" onClick={() => setRename(a.name)}>{t(locale, "hw.rename")}</Btn>
                </div>
              )}
            </div>
          ))}
          <div className="flex gap-1.5">
            <input className={`${inpCls} !mt-0 flex-1`} value={newAcct} onChange={(e) => setNewAcct(e.target.value)} placeholder={t(locale, "hw.newAcctPh")} aria-label="new account" />
            <Btn small onClick={() => { const r = run((st) => hwAddAccount(st, newAcct)); if (r) { setNewAcct(""); go("home"); } }}>{t(locale, "hw.addAcct")}</Btn>
          </div>
          {err && <div className="text-[13px] text-red-700 dark:text-red-400">{err}</div>}
          <Btn small variant="outline" onClick={() => go("home")}>{t(locale, "wsh.back")}</Btn>
          <Learn title={t(locale, "hw.learnAcctT")} body={t(locale, "hw.learnAcctB")} tech={t(locale, "hw.learnAcctX")} />
        </div>
      )}

      {screen === "networks" && (
        <div className="space-y-2 p-3">
          <StepHead title={t(locale, "hw.networksT")} sub={t(locale, "hw.networksB")} />
          {s.networks.map((n) => (
            <div key={n.id} className={`rounded-xl border p-2.5 ${n.id === s.activeNetwork ? "border-sky-500" : "border-zinc-200 dark:border-zinc-800"}`}>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <div className="text-sm font-bold">{n.label} {n.testnet && <span className="text-[11px] text-zinc-500">SIMULATED</span>}</div>
                  <div className="font-mono text-[12px] text-zinc-500">{n.native} · chain {n.chainId} · {n.gasPriceGwei} gwei</div>
                </div>
                {n.id !== s.activeNetwork && <Btn small variant="outline" onClick={() => { run((st) => hwSelectNetwork(st, n.id)); go("home"); }}>{t(locale, "hw.switch")}</Btn>}
                {n.custom && <button className="text-[12px] underline opacity-70" onClick={() => { run((st) => hwRemoveNetwork(st, n.id)); }}>{t(locale, "hw.remove")}</button>}
              </div>
            </div>
          ))}
          <div className="rounded-xl border border-dashed border-zinc-300 p-2.5 dark:border-zinc-700">
            <div className="mb-1 text-[13px] font-bold">{t(locale, "hw.addNetT")}</div>
            <div className="grid grid-cols-2 gap-1.5">
              <input className={inpCls} value={netForm.label} onChange={(e) => setNetForm({ ...netForm, label: e.target.value })} placeholder={t(locale, "hw.netLabel")} aria-label="label" />
              <input className={`${inpCls} font-mono`} value={netForm.native} onChange={(e) => setNetForm({ ...netForm, native: e.target.value.toUpperCase() })} placeholder="XYZ" aria-label="currency" />
              <input dir="ltr" inputMode="numeric" className={`${inpCls} font-mono`} value={netForm.chainId} onChange={(e) => setNetForm({ ...netForm, chainId: e.target.value.replace(/\D/g, "") })} placeholder="12345" aria-label="chain id" />
              <input dir="ltr" inputMode="numeric" className={`${inpCls} font-mono`} value={netForm.gas} onChange={(e) => setNetForm({ ...netForm, gas: e.target.value.replace(/[^0-9.,]/g, "") })} placeholder="1 gwei" aria-label="gas" />
            </div>
            {err && <div className="mt-1 text-[13px] text-red-700 dark:text-red-400">{err}</div>}
            <div className="mt-1.5"><Btn small onClick={() => {
              const r = run((st) => hwAddNetwork(st, { label: netForm.label, native: netForm.native, chainId: Number(netForm.chainId), gasPriceGwei: Number(netForm.gas.replace(",", ".")) || 0 }));
              if (r) setNetForm({ label: "", native: "", chainId: "", gas: "" });
            }}>{t(locale, "hw.addNet")}</Btn></div>
          </div>
          <Btn small variant="outline" onClick={() => go("home")}>{t(locale, "wsh.back")}</Btn>
        </div>
      )}

      {screen === "tokens" && (
        <TokenScreen
          goSend={(sym) => { setAsset(sym); prepSend(); go("send"); }}
          goReceive={() => go("receive")}
          goHome={() => go("home")}
        />
      )}

      {screen === "buy" && (
        <div className="space-y-2 p-3">
          <StepHead title={t(locale, "hw.buyT")} sub={t(locale, "hw.buyB")} />
          <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "hw.buyAmt")} ({net.native})</span>
            <input dir="ltr" inputMode="decimal" className={`${inpCls} font-mono`} value={faucetAmt} onChange={(e) => setFaucetAmt(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="0.05" autoComplete="off" /></label>
          {err && <div className="text-[13px] text-red-700 dark:text-red-400">{err}</div>}
          <div className="flex gap-1.5">
            <Btn small variant="outline" onClick={() => go("home")}>{t(locale, "wsh.back")}</Btn>
            <Btn small onClick={() => {
              const v = Number(faucetAmt.replace(",", "."));
              if (!(v > 0)) return;
              const tk = toks.find((x) => x.symbol === net.native)!;
              const r = run((st) => hwFaucet(st, net.native, Math.round(v * 10 ** tk.decimals)));
              if (r) go("home");
            }}>{t(locale, "hw.faucetGo")}</Btn>
          </div>
          <Learn title={t(locale, "hw.learnFaucetT")} body={t(locale, "hw.learnFaucetB")} />
        </div>
      )}

      {screen === "send" && <SendScreen />}
      {screen === "receive" && <ReceiveScreen />}
      {screen === "swap" && <SwapScreen />}
      {screen === "dapps" && <DappsScreen />}
      {screen === "activity" && <ActivityScreen />}
      {screen === "notifs" && <NotifsScreen />}
      {screen === "settings" && <SettingsScreen />}

      <div className="flex gap-1 border-t border-zinc-200 p-1.5 dark:border-zinc-800">
        {[["home", "hw.tabHome"], ["swap", "hw.tabSwap"], ["dapps", "hw.tabApps"], ["activity", "hw.tabActivity"]].map(([id, k]) => (
          <button key={id} onClick={() => go(id as Screen)} className={`flex-1 rounded-lg py-1 text-[12px] font-bold ${screen === id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500"}`}>
            {t(locale, k)}
          </button>
        ))}
      </div>
      {err && screen !== "buy" && screen !== "accounts" && screen !== "networks" && (
        <div className="px-3 pb-2 text-[13px] text-red-700 dark:text-red-400">{err}</div>
      )}
    </Frame>
  );

  function TokenScreen({ goSend, goReceive, goHome }: { goSend: (sym: string) => void; goReceive: () => void; goHome: () => void }) {
    const tk = toks.find((x) => x.symbol === cur);
    return (
      <div className="space-y-2 p-3">
        {tk ? (
          <>
            <div className="text-center">
              <div className="text-sm font-bold">{tk.name} ({tk.symbol})</div>
              <div className="font-mono text-xl font-bold">{fmtUnits(hwBalance(s, acct?.id ?? "", net.id, tk.symbol), tk.decimals)} {tk.symbol}</div>
              <div className="font-mono text-[12px] text-zinc-500">${((hwBalance(s, acct?.id ?? "", net.id, tk.symbol) / 10 ** tk.decimals) * tk.priceUsd).toFixed(2)} · {t(locale, "hw.illustrative")}</div>
              {tk.address && <div className="mt-1 break-all font-mono text-[11px] text-zinc-500">{tk.address}</div>}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Btn small onClick={() => goSend(tk.symbol)}>{t(locale, "hw.send")}</Btn>
              <Btn small variant="outline" onClick={goReceive}>{t(locale, "hw.receive")}</Btn>
            </div>
            <div>
              <div className="mb-1 text-[12px] font-bold uppercase tracking-widest text-zinc-500">{t(locale, "hw.tokHist")}</div>
              {s.txs.filter((x) => x.asset === tk.symbol && (x.from === acct?.id || x.to === acct?.id || x.to === acct?.address)).slice(-5).reverse().map((x) => (
                <div key={x.id} className="rounded-lg p-1.5 text-[13px] hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  <span className="font-mono font-bold">{x.kind}</span> · {x.status}
                </div>
              ))}
            </div>
            {tk.custom && <Btn small variant="outline" onClick={() => { run((st) => hwRemoveToken(st, tk.symbol)); goHome(); }}>{t(locale, "hw.removeToken")}</Btn>}
            <Learn title={t(locale, "hw.learnTokT")} body={t(locale, "hw.learnTokB")} />
          </>
        ) : (
          <div className="text-[13px] text-zinc-500">{t(locale, "hw.noAsset")}</div>
        )}
        <div className="rounded-xl border border-dashed border-zinc-300 p-2 dark:border-zinc-700">
          <div className="mb-1 text-[13px] font-bold">{t(locale, "hw.addTokenT")}</div>
          <div className="grid grid-cols-2 gap-1.5">
            <input className={inpCls} value={tokForm.symbol} onChange={(e) => setTokForm({ ...tokForm, symbol: e.target.value.toUpperCase() })} placeholder="SYM" aria-label="symbol" />
            <input className={inpCls} value={tokForm.name} onChange={(e) => setTokForm({ ...tokForm, name: e.target.value })} placeholder="Name" aria-label="name" />
            <input dir="ltr" className={`${inpCls} col-span-2 font-mono`} value={tokForm.address} onChange={(e) => setTokForm({ ...tokForm, address: e.target.value.trim() })} placeholder="0x…" aria-label="address" />
            <input dir="ltr" inputMode="numeric" className={`${inpCls} font-mono`} value={tokForm.decimals} onChange={(e) => setTokForm({ ...tokForm, decimals: e.target.value.replace(/\D/g, "").slice(0, 2) })} placeholder="18" aria-label="decimals" />
          </div>
          <div className="mt-1.5"><Btn small onClick={() => {
            const r = run((st) => hwAddToken(st, { symbol: tokForm.symbol, name: tokForm.name, address: tokForm.address, decimals: Number(tokForm.decimals) || 0 }));
            if (r) { setAsset(tokForm.symbol); setTokForm({ symbol: "", name: "", address: "", decimals: "18" }); }
          }}>{t(locale, "hw.addToken")}</Btn></div>
        </div>
        <div>
          <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "hw.search")}</span>
            <input className={inpCls} value={tokQuery} onChange={(e) => setTokQuery(e.target.value)} /></label>
        </div>
        {tokQuery && toks.filter((x) => x.symbol.toLowerCase().includes(tokQuery.toLowerCase())).map((x) => (
          <button key={x.symbol} onClick={() => setAsset(x.symbol)} className="w-full rounded-lg p-1.5 text-left font-mono text-[13px] hover:bg-zinc-50 dark:hover:bg-zinc-900">{x.symbol} · {x.name}</button>
        ))}
        <Btn small variant="outline" onClick={goHome}>{t(locale, "wsh.back")}</Btn>
      </div>
    );
  }

  function SendScreen() {
    const tk = toks.find((x) => x.symbol === cur) ?? toks[0];
    if (!tk || !acct) return null;
    const dec = tk.decimals;
    const num = Number(amt.replace(",", "."));
    const sendMinor = fiat ? Math.round((num / Math.max(tk.priceUsd, 1e-9)) * 10 ** dec) : Math.round(num * 10 ** dec);
    const bal = hwBalance(s, acct.id, net.id, tk.symbol);
    const fee = hwEstimateFee(s, Number(units) || 21000, Number(prio.replace(",", ".")) || 0);
    const gwei = fee.units * (fee.baseGwei + fee.priorityGwei);
    const maxMinor = tk.address === null ? Math.max(0, bal - fee.totalMinor) : bal;
    const review = sendStep === 4;
    return (
      <div className="space-y-2 p-3">
        <StepHead title={t(locale, "hw.sendT")} sub={`${t(locale, "hw.step")} ${Math.min(sendStep, 4)}/4`} />
        {intent && !intentConsumed.current && (
          <div className="rounded-xl bg-sky-50 p-2 text-[13px] dark:bg-sky-950">{t(locale, "hw.intentB")}</div>
        )}
        {sendStep === 1 && (
          <div className="space-y-1.5">
            {toks.map((x) => (
              <button key={x.symbol} onClick={() => { setAsset(x.symbol); setSendStep(2); }} className="flex w-full items-center gap-2 rounded-xl border border-zinc-200 p-2 text-left dark:border-zinc-800">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-sm font-bold dark:bg-zinc-800">{x.symbol[0]}</span>
                <span className="flex-1 text-sm font-bold">{x.symbol}<span className="block font-mono text-[12px] font-normal text-zinc-500">{fmtUnits(hwBalance(s, acct.id, net.id, x.symbol), x.decimals)}</span></span>
              </button>
            ))}
          </div>
        )}
        {sendStep === 2 && (
          <div className="space-y-1.5">
            <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "hw.to")}</span>
              <input dir="ltr" className={`${inpCls} font-mono`} value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="0x…" autoComplete="off" /></label>
            {s.contacts.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {s.contacts.map((c) => (
                  <button key={c.address} onClick={() => { setTo(c.address); setContactName(c.name); }} className="rounded-full border border-zinc-300 px-2 py-0.5 font-mono text-[12px] dark:border-zinc-700">{c.name}</button>
                ))}
              </div>
            )}
            {contactName === "" && (
              <div className="flex gap-1.5">
                <input className={`${inpCls} !mt-0 flex-1`} value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder={t(locale, "hw.saveContactPh")} aria-label="contact name" />
                <Btn small variant="outline" onClick={() => {
                  const r = run((st) => hwAddContact(st, contactName || to.slice(0, 10), to));
                  if (r !== null) setContactName("");
                }}>{t(locale, "hw.saveContact")}</Btn>
              </div>
            )}
            <div className="flex gap-1.5">
              <Btn small variant="outline" onClick={() => setSendStep(1)}>{t(locale, "wsh.back")}</Btn>
              <Btn small onClick={() => setSendStep(3)}>{t(locale, "cr.s.next")}</Btn>
            </div>
          </div>
        )}
        {sendStep === 3 && (
          <div className="space-y-1.5">
            <div className="text-center font-mono text-4xl font-bold">
              <input dir="ltr" inputMode="decimal" aria-label="amount" className="w-full bg-transparent text-center outline-none" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="0.00" autoComplete="off" />
            </div>
            <div className="text-center text-[13px] text-zinc-500">
              ≈ {fiat ? `${(sendMinor / 10 ** dec).toFixed(6)} ${tk.symbol}` : `$${(sendMinor / 10 ** dec * tk.priceUsd).toFixed(2)}`} · {t(locale, "hw.avail")}: {fmtUnits(bal, dec)} {tk.symbol}
            </div>
            <div className="flex justify-center gap-1.5">
              <Btn small variant="outline" onClick={() => setFiat(!fiat)}>{fiat ? tk.symbol : "USD"}</Btn>
              <Btn small variant="outline" onClick={() => setAmt(String(maxMinor / 10 ** dec))}>{t(locale, "hw.max")}</Btn>
            </div>
            <div className="rounded-xl bg-zinc-50 p-2 text-[13px] dark:bg-zinc-900">
              <div className="mb-1 font-bold">{t(locale, "hw.feeT")}</div>
              <div className="grid grid-cols-2 gap-1.5">
                <label className="block">Gas units
                  <input dir="ltr" inputMode="numeric" className={`${inpCls} font-mono`} value={units} onChange={(e) => setUnits(e.target.value.replace(/\D/g, ""))} /></label>
                <label className="block">Priority (gwei)
                  <input dir="ltr" inputMode="numeric" className={`${inpCls} font-mono`} value={prio} onChange={(e) => setPrio(e.target.value.replace(/[^0-9.,]/g, ""))} /></label>
              </div>
              <div className="mt-1 font-mono text-[12px] text-zinc-500">
                {fee.units} × {fee.baseGwei + fee.priorityGwei} gwei ≈ {gwei.toLocaleString()} gwei ({t(locale, "hw.illustrative")})
              </div>
            </div>
            <div className="flex gap-1.5">
              <Btn small variant="outline" onClick={() => setSendStep(2)}>{t(locale, "wsh.back")}</Btn>
              <Btn small onClick={() => setSendStep(4)}>{t(locale, "pv.review")}</Btn>
            </div>
          </div>
        )}
        {review && (
          <div className="space-y-2">
            <div className="space-y-1 rounded-xl bg-zinc-50 p-3 font-mono text-[13px] dark:bg-zinc-900">
              <div className="flex justify-between"><span className="font-sans text-zinc-500">From</span><span>{acct.name}</span></div>
              <div className="flex justify-between gap-2"><span className="font-sans text-zinc-500">To</span><span className="break-all text-right">{to}</span></div>
              <div className="flex justify-between"><span className="font-sans text-zinc-500">Asset</span><span>{(sendMinor / 10 ** dec).toFixed(6)} {tk.symbol} (≈${(sendMinor / 10 ** dec * tk.priceUsd).toFixed(2)})</span></div>
              <div className="flex justify-between"><span className="font-sans text-zinc-500">Network</span><span>{net.label}</span></div>
              <div className="flex justify-between"><span className="font-sans text-zinc-500">Fee</span><span>{gwei.toLocaleString()} gwei</span></div>
              <div className="flex justify-between border-t border-zinc-200 pt-1 font-bold dark:border-zinc-800"><span className="font-sans font-medium text-zinc-500">Total debit</span><span>{fmtUnits(sendMinor + (tk.address === null ? fee.totalMinor : 0), dec)} {tk.symbol}{tk.address === null ? "" : ` + ${gwei.toLocaleString()} gwei`}</span></div>
            </div>
            {sendMinor > maxMinor && <div className="text-[13px] text-red-700 dark:text-red-400">{t(locale, "hw.nofunds")}</div>}
            <div className="flex gap-1.5">
              <Btn small variant="outline" onClick={() => setSendStep(3)}>{t(locale, "wsh.back")}</Btn>
              <Btn small variant="outline" onClick={() => { setSendStep(1); }}>{t(locale, "wsh.cancel")}</Btn>
              <Btn small disabled={sendMinor <= 0 || sendMinor > maxMinor} onClick={() => {
                const tx = run((st) => hwSend(st, { to, asset: tk.symbol, amountMinor: sendMinor, units: Number(units) || 21000, priorityGwei: Number(prio.replace(",", ".")) || 0 }));
                if (tx) {
                  setLastTx(tx.id);
                  if (intent && !intentConsumed.current) {
                    intentConsumed.current = true;
                    onIntentDone?.({ txId: tx.id, hash: tx.hash });
                  }
                }
              }}>{t(locale, "hw.confirmSend")}</Btn>
            </div>
            {lastTx && <SendStatus txId={lastTx} />}
          </div>
        )}
        <Learn title={t(locale, "hw.learnSendT")} body={t(locale, "hw.learnSendB")} tech={t(locale, "hw.learnSendX")} />
      </div>
    );
  }

  function SendStatus({ txId }: { txId: string }) {
    const tx = s.txs.find((x) => x.id === txId);
    if (!tx) return null;
    return (
      <div className="space-y-1.5 rounded-xl border border-zinc-200 p-2.5 text-[13px] dark:border-zinc-800">
        <div className="font-mono">tx {tx.hash.slice(0, 18)}… · {tx.status}{tx.block ? ` · block ${tx.block}` : ""}</div>
        {tx.status === "pending" && (
          <div className="flex flex-wrap gap-1.5">
            <Btn small onClick={() => { run((st) => hwConfirm(st, tx.id)); }}>{t(locale, "hw.mineTx")}</Btn>
            <Btn small variant="outline" onClick={() => { run((st) => hwCancel(st, tx.id)); }}>{t(locale, "wsh.cancel")}</Btn>
            <Btn small variant="outline" onClick={() => { run((st) => hwFail(st, tx.id, "simulated timeout")); }}>{t(locale, "hw.simTimeout")}</Btn>
          </div>
        )}
        {tx.status === "failed" && <div className="text-red-700 dark:text-red-400">{tx.failReason}</div>}
        {intent && onIntentDone && tx.status === "confirmed" && (
          <Btn small variant="outline" onClick={() => onIntentDone({ txId: tx.id, hash: tx.hash })}>{t(locale, "hw.backToCrypto")}</Btn>
        )}
      </div>
    );
  }

  function ReceiveScreen() {
    if (!acct) return null;
    return (
      <div className="space-y-2 p-3 text-center">
        <StepHead title={t(locale, "hw.receiveT")} sub={t(locale, "hw.receiveB")} />
        <div className="mx-auto w-fit bg-white p-3"><QRCode value={acct.address} size={150} /></div>
        <div className="break-all font-mono text-[13px]">{acct.address}</div>
        <div className="flex justify-center gap-1.5">
          <Btn small variant="outline" onClick={() => { try { void navigator.clipboard.writeText(acct.address); } catch { /* noop */ } }}>{t(locale, "cr.r.copy")}</Btn>
        </div>
        <div className="rounded-xl bg-amber-50 p-2 text-[13px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">{t(locale, "hw.receiveWarn")}</div>
        <div className="rounded-xl border border-dashed border-zinc-300 p-2.5 text-left dark:border-zinc-700">
          <div className="mb-1 text-[13px] font-bold">{t(locale, "hw.simIncomingT")}</div>
          <div className="grid grid-cols-2 gap-1.5">
            <select aria-label="asset" className={inpCls} value={inAsset || net.native} onChange={(e) => setInAsset(e.target.value)}>
              {toks.map((x) => <option key={x.symbol} value={x.symbol}>{x.symbol}</option>)}
            </select>
            <input dir="ltr" inputMode="decimal" aria-label="amount" className={`${inpCls} font-mono`} value={inAmt} onChange={(e) => setInAmt(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="0.10" />
          </div>
          <div className="mt-1.5"><Btn small onClick={() => {
            const tk = toks.find((x) => x.symbol === (inAsset || net.native))!;
            const tx = run((st) => hwReceive(st, tk.symbol, Math.round(Number(inAmt.replace(",", ".")) * 10 ** tk.decimals)));
            if (tx) setLastTx(tx.id);
          }}>{t(locale, "hw.simIncoming")}</Btn></div>
          {(() => {
            const pend = s.txs.filter((x) => x.kind === "receive" && x.status === "pending");
            return pend.length > 0 ? (
              <div className="mt-1.5 space-y-1">
                {pend.map((x) => (
                  <div key={x.id} className="flex items-center gap-2 rounded-lg bg-zinc-50 p-1.5 text-[13px] dark:bg-zinc-900">
                    <span className="flex-1 font-mono">+{fmtUnits(x.amountMinor, toks.find((tk) => tk.symbol === x.asset)?.decimals ?? 18)} {x.asset}</span>
                    <Btn small onClick={() => { run((st) => hwConfirmReceive(st, x.id)); }}>{t(locale, "hw.confirmRx")}</Btn>
                  </div>
                ))}
              </div>
            ) : null;
          })()}
        </div>
        <Learn title={t(locale, "hw.learnRxT")} body={t(locale, "hw.learnRxB")} />
      </div>
    );
  }

  function SwapScreen() {
    const fromTk = toks.find((x) => x.symbol === (swFrom || toks[0]?.symbol)) ?? toks[0];
    const toTk = toks.find((x) => x.symbol === (swTo || toks[1]?.symbol)) ?? toks[1];
    if (!fromTk || !toTk || !acct) return null;
    const amtMinor = Math.round(Number(swAmt.replace(",", ".")) * 10 ** fromTk.decimals);
    let quote: ReturnType<typeof hwQuoteSwap> | null = null;
    let quoteErr: string | null = null;
    try {
      if (amtMinor > 0) quote = hwQuoteSwap(s, fromTk.symbol, toTk.symbol, amtMinor, Number(slip) * 100);
    } catch (e) {
      quoteErr = e instanceof Error ? e.message : String(e);
    }
    return (
      <div className="space-y-2 p-3">
        <StepHead title={t(locale, "hw.swapT")} sub={t(locale, "hw.swapB")} />
        <div className="grid grid-cols-2 gap-1.5">
          <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "hw.swapFrom")}</span>
            <select className={inpCls} value={fromTk.symbol} onChange={(e) => setSwFrom(e.target.value)}>
              {toks.map((x) => <option key={x.symbol} value={x.symbol}>{x.symbol}</option>)}
            </select></label>
          <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "hw.swapTo")}</span>
            <select className={inpCls} value={toTk.symbol} onChange={(e) => setSwTo(e.target.value)}>
              {toks.map((x) => <option key={x.symbol} value={x.symbol}>{x.symbol}</option>)}
            </select></label>
        </div>
        <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "wa.amount")} · {t(locale, "hw.availShort")}: {fmtUnits(hwBalance(s, acct.id, net.id, fromTk.symbol), fromTk.decimals)}</span>
          <input dir="ltr" inputMode="decimal" className={`${inpCls} font-mono`} value={swAmt} onChange={(e) => setSwAmt(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="0.10" autoComplete="off" /></label>
        <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "hw.slippage")}</span>
          <select className={inpCls} value={slip} onChange={(e) => setSlip(e.target.value)}>
            <option value="50">0.5%</option>
            <option value="100">1%</option>
            <option value="300">3%</option>
          </select></label>
        {quote && (
          <div className="space-y-0.5 rounded-xl bg-zinc-50 p-2.5 font-mono text-[13px] dark:bg-zinc-900">
            <div className="flex justify-between"><span>rate</span><span>1 {fromTk.symbol} ≈ {quote.rate.toFixed(6)} {toTk.symbol}</span></div>
            <div className="flex justify-between"><span>{t(locale, "hw.estOut")}</span><span>{fmtUnits(quote.outMinor, toTk.decimals)} {toTk.symbol}</span></div>
            <div className="flex justify-between"><span>{t(locale, "hw.impact")}</span><span>{(quote.impactBps / 100).toFixed(2)}%</span></div>
            <div className="flex justify-between"><span>{t(locale, "hw.minOut")}</span><span>{fmtUnits(quote.minOutMinor, toTk.decimals)} {toTk.symbol}</span></div>
            <div className="flex justify-between"><span>{t(locale, "rm.fee")}</span><span>{fmtUnits(quote.feeMinor, toTk.decimals)} {toTk.symbol}</span></div>
          </div>
        )}
        {quoteErr && <div className="text-[13px] text-red-700 dark:text-red-400">{quoteErr}</div>}
        <div className="flex gap-1.5">
          <Btn small variant="outline" onClick={() => go("home")}>{t(locale, "wsh.cancel")}</Btn>
          <Btn small disabled={!quote} onClick={() => {
            if (!quote) return;
            const tx = run((st) => hwSwap(st, fromTk.symbol, toTk.symbol, amtMinor, quote.minOutMinor));
            if (tx) { setLastTx(tx.id); setSwAmt(""); }
          }}>{t(locale, "hw.swapGo")}</Btn>
        </div>
        {lastTx && <SendStatus txId={lastTx} />}
        <Learn title={t(locale, "hw.learnSwapT")} body={t(locale, "hw.learnSwapB")} tech={t(locale, "hw.learnSwapX")} />
      </div>
    );
  }

  function DappsScreen() {
    const conns = s.conns;
    return (
      <div className="space-y-2 p-3">
        <StepHead title={t(locale, "hw.dappsT")} sub={t(locale, "hw.dappsB")} />
        <DappCard
          name="SimPay Merchant"
          desc={t(locale, "hw.dappPayD")}
          connected={conns.some((c) => c.dapp === "SimPay Merchant")}
          onToggle={() => {
            if (!acct) return;
            if (conns.some((c) => c.dapp === "SimPay Merchant")) run((st) => hwDisconnect(st, "SimPay Merchant"));
            else { run((st) => hwConnect(st, "SimPay Merchant", acct.id, net.id)); setDapp("SimPay Merchant"); }
          }}
          detail={dapp === "SimPay Merchant" && acct ? (
            <div className="mt-1.5 space-y-1.5 rounded-xl bg-zinc-50 p-2 dark:bg-zinc-900">
              <div className="text-[13px]">{t(locale, "hw.dappInvoice")}</div>
              <div className="flex gap-1.5">
                <Btn small onClick={() => {
                  const tx = run((st) => hwSend(st, { to: MERCHANT_ADDR, asset: net.native, amountMinor: Math.round(0.02 * 10 ** toks.find((x) => x.symbol === net.native)!.decimals) }));
                  if (tx) setLastTx(tx.id);
                }}>{t(locale, "hw.payInvoice").replace("{a}", "0.02 " + net.native)}</Btn>
                <Btn small variant="outline" onClick={() => {
                  run((st) => hwSign(st, "SimPay Merchant", `Log in to SimPay Merchant as ${acct.name} (${acct.address}) at step ${s.counters.time}.`, true));
                }}>{t(locale, "hw.signLogin")}</Btn>
              </div>
              {lastTx && <SendStatus txId={lastTx} />}
            </div>
          ) : undefined}
        />
        <DappCard
          name="SimStake DeFi"
          desc={t(locale, "hw.dappStakeD")}
          connected={conns.some((c) => c.dapp === "SimStake")}
          onToggle={() => {
            if (!acct) return;
            if (conns.some((c) => c.dapp === "SimStake")) run((st) => hwDisconnect(st, "SimStake"));
            else { run((st) => hwConnect(st, "SimStake", acct.id, net.id)); setDapp("SimStake"); }
          }}
          detail={dapp === "SimStake" && acct ? (
            <div className="mt-1.5 space-y-1.5 rounded-xl bg-zinc-50 p-2 dark:bg-zinc-900">
              <div className="grid grid-cols-2 gap-1.5">
                <input dir="ltr" inputMode="decimal" aria-label="stake amount" className={`${inpCls} font-mono`} value={stakeAmt} onChange={(e) => setStakeAmt(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="10 sUSD" />
                <input dir="ltr" inputMode="decimal" aria-label="allowance" className={`${inpCls} font-mono`} value={allowAmt} onChange={(e) => setAllowAmt(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="allow" />
              </div>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={allowUnlimited} onChange={(e) => setAllowUnlimited(e.target.checked)} />
                {t(locale, "hw.unlimited")}
              </label>
              <div className="flex flex-wrap gap-1.5">
                <Btn small variant="outline" onClick={() => {
                  const tk = toks.find((x) => x.symbol === "sUSD") ?? toks[1];
                  if (!tk) return;
                  run((st) => hwApprove(st, "SimStake", tk.symbol, POOL_ADDR, allowUnlimited ? null : Math.round(Number(allowAmt.replace(",", ".")) * 10 ** tk.decimals)));
                }}>{t(locale, "hw.approve")}</Btn>
                <Btn small onClick={() => {
                  const tk = toks.find((x) => x.symbol === "sUSD") ?? toks[1];
                  if (!tk) return;
                  const tx = run((st) => hwStake(st, tk.symbol, Math.round(Number(stakeAmt.replace(",", ".")) * 10 ** tk.decimals), POOL_ADDR));
                  if (tx) setLastTx(tx.id);
                }}>{t(locale, "hw.stakeGo")}</Btn>
                <Btn small variant="outline" onClick={() => {
                  const tk = toks.find((x) => x.symbol === "sUSD") ?? toks[1];
                  if (!tk) return;
                  run((st) => hwUnstake(st, tk.symbol, Math.round(Number(stakeAmt.replace(",", ".")) * 10 ** tk.decimals), POOL_ADDR));
                }}>{t(locale, "hw.unstake")}</Btn>
              </div>
              {lastTx && <SendStatus txId={lastTx} />}
              <div className="font-mono text-[12px] text-zinc-500">
                staked sUSD: {fmtUnits(s.stakes[`${acct.id}|${net.id}|sUSD`] ?? 0, 6)}
              </div>
            </div>
          ) : undefined}
        />
        <div className="rounded-xl border border-zinc-200 p-2.5 dark:border-zinc-800">
          <div className="mb-1 text-[13px] font-bold">{t(locale, "hw.signT")}</div>
          <textarea rows={2} className={`${inpCls} font-mono`} value={msg} onChange={(e) => setMsg(e.target.value)} />
          <div className="mt-1.5 flex gap-1.5">
            <Btn small variant="outline" onClick={() => {
              const tx = run((st) => hwSign(st, dapp ?? "SimPay Merchant", msg, false));
              if (tx) setLastTx(tx.id);
            }}>{t(locale, "hw.reject")}</Btn>
            <Btn small onClick={() => {
              const tx = run((st) => {
                if (!s.conns.some((c) => c.dapp === (dapp ?? "SimPay Merchant"))) {
                  hwConnect(st, dapp ?? "SimPay Merchant", acct?.id ?? "", net.id);
                }
                return hwSign(st, dapp ?? "SimPay Merchant", msg, true);
              });
              if (tx) setLastTx(tx.id);
            }}>{t(locale, "hw.signGo")}</Btn>
          </div>
          {lastTx && <div className="mt-1"><SendStatus txId={lastTx} /></div>}
        </div>
        <Learn title={t(locale, "hw.learnDappT")} body={t(locale, "hw.learnDappB")} tech={t(locale, "hw.learnDappX")} />
      </div>
    );
  }

  function DappCard({ name, desc, connected, onToggle, detail }: {
    name: string; desc: string; connected: boolean; onToggle: () => void; detail?: React.ReactNode;
  }) {
    return (
      <div className="rounded-xl border border-zinc-200 p-2.5 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-zinc-900 text-sm font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">{name[0]}</span>
          <div className="flex-1">
            <div className="text-sm font-bold">{name} {connected && <span className="text-[11px] text-emerald-600">●</span>}</div>
            <div className="text-[12px] text-zinc-500">{desc}</div>
          </div>
          <Btn small variant={connected ? "outline" : "primary"} onClick={onToggle}>{connected ? t(locale, "hw.disconnect") : t(locale, "hw.connect")}</Btn>
        </div>
        {detail}
      </div>
    );
  }

  function ActivityScreen() {
    const kinds = ["all", "send", "receive", "swap", "approve", "failed", "pending"] as const;
    const list = s.txs.filter((x) => {
      if (flt === "all") return true;
      if (flt === "failed") return x.status === "failed";
      if (flt === "pending") return x.status === "pending";
      if (flt === "approve") return x.kind === "approve" || x.kind === "sign";
      return x.kind === flt;
    }).slice().reverse();
    const open = s.txs.find((x) => x.id === txDetail) ?? null;
    return (
      <div className="space-y-2 p-3">
        <div className="flex flex-wrap gap-1">
          {kinds.map((k) => (
            <button key={k} onClick={() => setFlt(k)} className={`rounded-lg px-2 py-0.5 text-[12px] ${flt === k ? "bg-zinc-900 font-bold text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}>
              {t(locale, `hw.flt.${k}`)}
            </button>
          ))}
        </div>
        {list.length === 0 && <EmptyNote>{t(locale, "hw.noActivityF")}</EmptyNote>}
        {list.map((x) => (
          <button key={x.id} onClick={() => setTxDetail(x.id)} className="w-full rounded-xl border border-zinc-200 p-2 text-left text-[13px] dark:border-zinc-800">
            <span className="font-mono font-bold">{x.kind}</span> · {x.status} · <span className="font-mono">{shortAddr(x.to || x.from)}</span>
          </button>
        ))}
        {open && (
          <div className="space-y-1 rounded-xl bg-zinc-50 p-3 font-mono text-[12px] dark:bg-zinc-900">
            <div className="flex justify-between"><span>hash</span><span className="break-all text-right">{open.hash}</span></div>
            <div className="flex justify-between"><span>from</span><span className="break-all text-right">{open.from}</span></div>
            <div className="flex justify-between"><span>to</span><span className="break-all text-right">{open.to}</span></div>
            <div className="flex justify-between"><span>asset</span><span>{open.amountMinor} {open.asset}</span></div>
            <div className="flex justify-between"><span>fee</span><span>{open.feeMinor}</span></div>
            <div className="flex justify-between"><span>network</span><span>{open.network}</span></div>
            <div className="flex justify-between"><span>submitted</span><span>step {open.submittedAt}</span></div>
            <div className="flex justify-between"><span>confirmed</span><span>{open.confirmedAt != null ? `step ${open.confirmedAt}` : "—"}</span></div>
            <div className="flex justify-between"><span>block</span><span>{open.block ?? "—"}</span></div>
            <div className="flex justify-between"><span>status</span><span>{open.status}{open.failReason ? ` (${open.failReason})` : ""}</span></div>
            {open.note && <div className="break-all">{open.note}</div>}
            <div><Btn small variant="outline" onClick={() => setTxDetail(null)}>{t(locale, "pv.close")}</Btn></div>
          </div>
        )}
        <Learn title={t(locale, "hw.learnActT")} body={t(locale, "hw.learnActB")} />
      </div>
    );
  }

  function NotifsScreen() {
    return (
      <div className="space-y-1.5 p-3">
        <div className="flex items-center justify-between">
          <div className="font-bold">{t(locale, "pv.notifs")}</div>
          <Btn small variant="outline" onClick={() => { run((st) => { hwMarkRead(st); return true; }); }}>{t(locale, "hw.markRead")}</Btn>
        </div>
        {[...s.notifs].reverse().map((n) => (
          <div key={n.id} className={`rounded-xl p-2 text-[13px] ${n.read ? "bg-zinc-50 dark:bg-zinc-900" : "bg-sky-50 font-semibold dark:bg-sky-950"}`}>
            <span className="font-mono text-[11px] text-zinc-500">[{n.kind}] </span>{n.text}
          </div>
        ))}
        {s.notifs.length === 0 && <EmptyNote>{t(locale, "pv.noNotifs")}</EmptyNote>}
      </div>
    );
  }

  function SettingsScreen() {
    return (
      <div className="space-y-2 p-3">
        <div className="rounded-xl border border-zinc-200 p-2.5 dark:border-zinc-800">
          <div className="mb-1 text-[13px] font-bold">{t(locale, "hw.lockNow")}</div>
          <Btn small variant="outline" onClick={() => { run((st) => { hwLock(st); return true; }); go("home"); }}>{t(locale, "hw.lock")}</Btn>
        </div>
        <div className="rounded-xl border border-zinc-200 p-2.5 dark:border-zinc-800">
          <div className="mb-1 text-[13px] font-bold">{t(locale, "hw.changePw")}</div>
          <div className="grid grid-cols-2 gap-1.5">
            <input type="password" aria-label="old" className={`${inpCls} font-mono`} value={oldPw} onChange={(e) => setOldPw(e.target.value)} placeholder={t(locale, "hw.oldPw")} />
            <input type="password" aria-label="new" className={`${inpCls} font-mono`} value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder={t(locale, "hw.newPw")} />
          </div>
          <div className="mt-1.5"><Btn small variant="outline" onClick={() => { const r = run((st) => hwSetPassword(st, oldPw, newPw)); if (r) { setOldPw(""); setNewPw(""); } }}>{t(locale, "hw.save")}</Btn></div>
          <label className="mt-2 block text-[13px]">{t(locale, "hw.autoLock")}
            <select className={inpCls} value={lockSecs} onChange={(e) => { setLockSecs(e.target.value); run((st) => { st.autoLockSec = Number(e.target.value); return true; }); }}>
              <option value="60">1 min</option>
              <option value="300">5 min</option>
              <option value="900">15 min</option>
            </select></label>
          <div className="mt-1 text-[11px] text-zinc-500">{t(locale, "hw.autoLockB")}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 p-2.5 dark:border-zinc-800">
          <div className="mb-1 text-[13px] font-bold">{t(locale, "hw.connsT")}</div>
          {s.conns.length === 0 && <div className="text-[13px] text-zinc-500">{t(locale, "hw.noConns")}</div>}
          {s.conns.map((c) => (
            <div key={c.dapp} className="flex items-center gap-2 py-0.5 text-[13px]">
              <span className="flex-1">{c.dapp} · <span className="font-mono">{c.account}</span></span>
              <button className="text-[12px] underline opacity-70" onClick={() => { run((st) => hwDisconnect(st, c.dapp)); }}>{t(locale, "hw.disconnect")}</button>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-zinc-200 p-2.5 dark:border-zinc-800">
          <div className="mb-1 text-[13px] font-bold">{t(locale, "hw.allowsT")}</div>
          {s.allows.length === 0 && <div className="text-[13px] text-zinc-500">{t(locale, "hw.noAllows")}</div>}
          {s.allows.map((a, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5 font-mono text-[12px]">
              <span className="flex-1">{a.token} → {shortAddr(a.spender)} · {a.amountMinor === null ? t(locale, "hw.unlimited") : a.amountMinor}</span>
              <button className="font-sans text-[12px] underline opacity-70" onClick={() => { run((st) => hwRevoke(st, a.token, a.spender)); }}>{t(locale, "hw.revoke")}</button>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-zinc-200 p-2.5 dark:border-zinc-800">
          <div className="mb-1 text-[13px] font-bold">{t(locale, "hw.seedTitle")}</div>
          {!showSeed ? (
            <div className="flex gap-1.5">
              <input type="password" aria-label="password" className={`${inpCls} !mt-0 flex-1 font-mono`} value={seedPw} onChange={(e) => setSeedPw(e.target.value)} placeholder={t(locale, "hw.password")} />
              <Btn small variant="outline" onClick={() => {
                const w = run((st) => hwRevealSeed(st, seedPw));
                if (w) { setSeedWords(w); setShowSeed(true); }
              }}>{t(locale, "hw.reveal")}</Btn>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-1 font-mono text-[13px]">
                {(seedWords ?? []).map((w, i) => <span key={i} className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{i + 1}. {w}</span>)}
              </div>
              <div className="mt-1.5"><Btn small variant="outline" onClick={() => { setShowSeed(false); setSeedWords(null); setSeedPw(""); }}>{t(locale, "hw.hideSeed")}</Btn></div>
            </>
          )}
        </div>
        <Learn title={t(locale, "hw.learnSecT")} body={t(locale, "hw.learnSecB")} />
        <div className="rounded-xl border border-red-300 p-2.5 dark:border-red-800">
          <div className="mb-1 text-[13px] font-bold">{t(locale, "hw.resetT")}</div>
          <Btn small variant="outline" onClick={() => {
            if (!resetArm) { setResetArm(true); return; }
            setResetArm(false);
            resetAll();
            go("home");
          }}>{resetArm ? t(locale, "wm.resetConfirm") : t(locale, "wm.reset")}</Btn>
        </div>
      </div>
    );
  }

  // ---------- screen-local helpers (no hooks inside) ----------
  function prepSend() {
    if (intent && !intentConsumed.current) {
      setTo(intent.to);
      const tk = toks.find((x) => x.symbol === intent.asset) ?? toks[0];
      setAsset(tk?.symbol ?? net.native);
      setAmt(String(intent.amountMinor / 10 ** (tk?.decimals ?? 18)));
    }
    setSendStep(1);
    setLastTx(null);
  }

  return <div />;
}

function await0(): never {
  throw new Error("unreachable");
}

function Frame({ expanded, onExpand, title, onExit, bare, children }: {
  expanded: boolean;
  onExpand: () => void;
  title: string;
  onExit?: () => void;
  bare?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`mx-auto ${expanded ? "max-w-3xl" : "max-w-[400px]"}`}>
      <div className="overflow-hidden rounded-2xl border border-zinc-300 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-950">
        <div className="flex items-center gap-1.5 border-b border-zinc-200 px-2.5 py-1.5 dark:border-zinc-800">
          {!bare && <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-orange-500 text-[13px] font-bold text-white">E</span>}
          <span className="text-[13px] font-bold">{title}</span>
          <span className="ms-auto" />
          {onExit && <button aria-label="back" onClick={onExit} className="rounded px-1.5 text-zinc-500">←</button>}
          <button aria-label="expand" onClick={onExpand} className="rounded px-1.5 text-zinc-500">{expanded ? "−" : "+"}</button>
        </div>
        {children}
      </div>
    </div>
  );
}
