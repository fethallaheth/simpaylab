/**
 * PolarVault cold-wallet experience: computer companion interface + physical
 * hardware-device simulator, side by side. Full lifecycle: setup ceremony
 * with backup drill, PIN lock, address verification, simulated receives,
 * USB + air-gapped sends with on-device review/approve/reject, broadcast
 * with classroom stepping, recovery drills, scenarios, and a hot-vs-cold
 * comparison. All demo data, persisted locally, resettable.
 */
"use client";
import { useState } from "react";
import QRCode from "react-qr-code";
import {
  COLD_ASSETS,
  COLD_DEMO_WORDS,
  COLD_MODELS,
  COLD_NETWORKS,
  coldAccount,
  coldAdvance,
  coldBroadcast,
  coldCancel,
  coldChooseModel,
  coldConnect,
  coldComputerView,
  coldDeviceApprove,
  coldDeviceReject,
  coldDeviceView,
  coldDisconnect,
  coldDisplayAddress,
  coldEstimateFee,
  coldExportUnsigned,
  coldFinishSetup,
  coldImportSigned,
  coldImportUnsigned,
  coldInitNew,
  coldLock,
  coldPowerOn,
  coldPrepare,
  coldResetDevice,
  coldRestore,
  coldSetMaxAttempts,
  coldSetPin,
  coldRevealSeed,
  coldSetScenario,
  coldSimIncoming,
  coldSwitchAccount,
  coldTick,
  coldUnlock,
  coldVerifyAddress,
  coldVerifyBackup,
  type ColdProposal,
  type ColdState,
  type FailureId
} from "@sim/engine";
import { t, type Locale } from "@/i18n/dict";
import { usePrefs } from "../providers";
import { Badge, Btn, Card } from "../ui";
import { EmptyNote, StepHead, Time, inpCls, useSpecReset } from "../flows/kit";
import { HwDevice, type DevScreen } from "./HwDevice";
import { fmtAsset, shortAddr, toMinor, useColdWallet } from "./coldstate";

type CompTab = "overview" | "receive" | "send" | "activity" | "recovery" | "compare" | "scenarios";
const VERIFY_POS = [1, 6, 10];

const STATUS_TONE: Record<ColdProposal["status"], "zinc" | "green" | "red" | "amber" | "blue"> = {
  draft: "zinc", awaiting: "amber", signed: "blue", rejected: "red",
  ready: "blue", pending: "amber", confirmed: "green", failed: "red", cancelled: "zinc"
};

function StatusBadge({ s, locale }: { s: ColdProposal["status"]; locale: Locale }) {
  return <Badge tone={STATUS_TONE[s]}>{t(locale, `cw.status.${s}`)}</Badge>;
}

export function ColdWallet({ seed, failures }: { seed: number; failures: FailureId[] }) {
  const { locale } = usePrefs();
  const { s, err, run, resetAll } = useColdWallet(seed, failures);
  const [compTab, setCompTab] = useState<CompTab>("overview");
  const [pinBuf, setPinBuf] = useState("");
  const [pinFocus, setPinFocus] = useState(5);
  const [pinLen, setPinLen] = useState(4);
  const [seedPage, setSeedPage] = useState(0);
  const [picks, setPicks] = useState<string[]>(["", "", ""]);
  const [revealAck, setRevealAck] = useState(false);
  const [menuSel, setMenuSel] = useState(0);
  const [devNote, setDevNote] = useState<{ title: string; body: string } | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewPage, setReviewPage] = useState(0);
  const [verifyId, setVerifyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // send form
  const [fromAcct, setFromAcct] = useState("");
  const [asset, setAsset] = useState("GLAC");
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState("");
  const [via, setVia] = useState<"usb" | "qr">("usb");
  const [activeTx, setActiveTx] = useState<string | null>(null);
  const [unsignedQr, setUnsignedQr] = useState<string | null>(null);
  const [signedQr, setSignedQr] = useState<string | null>(null);
  const [airIn, setAirIn] = useState("");
  // receive
  const [rxAsset, setRxAsset] = useState("GLAC");
  const [rxAmt, setRxAmt] = useState("");
  // recovery
  const [armReset, setArmReset] = useState(false);
  const [restorePin, setRestorePin] = useState("");
  const [drillPicks, setDrillPicks] = useState<string[]>(["", "", ""]);
  const [drillDone, setDrillDone] = useState<boolean | null>(null);
  // scenarios
  const [armFail, setArmFail] = useState(false);

  useSpecReset(JSON.stringify({ seed, failures }), () => {
    setPinBuf(""); setReviewId(null); setReviewPage(0); setVerifyId(null);
    setActiveTx(null); setUnsignedQr(null); setSignedQr(null); setAirIn("");
    setTo(""); setAmt(""); setRxAmt(""); setDevNote(null); setDrillDone(null);
  });

  const doFlash = (k: string) => {
    setFlash(k);
    window.setTimeout(() => setFlash((cur) => (cur === k ? null : cur)), 1300);
  };

  const model = COLD_MODELS.find((m) => m.id === s.device.model) ?? COLD_MODELS[0];
  const ready = s.setupStage === "ready" && s.device.initialized && !s.device.wiped;
  const activeAcctId = fromAcct || s.activeAccount || "";
  const activeAcct = ready && activeAcctId ? tryAcct(s, activeAcctId) : null;

  function tryAcct(st: ColdState, id: string) {
    try { return coldAccount(st, id); } catch { return null; }
  }

  // ---------- device screen derivation ----------
  const menuItems = [
    t(locale, "cw.dev.mVerify"),
    t(locale, "cw.dev.mBalances"),
    t(locale, "cw.dev.mSettings"),
    t(locale, "cw.dev.mLock")
  ];

  function reviewPages(p: ColdProposal): { label: string; value: string; warn?: boolean }[] {
    const net = COLD_NETWORKS.find((n) => n.id === p.network);
    const excess = p.feeMinor * 10 > p.amountMinor;
    return [
      { label: t(locale, "cw.dev.rTo"), value: p.to },
      { label: t(locale, "cw.dev.rAmt"), value: fmtAsset(p.amountMinor, p.asset) },
      { label: t(locale, "cw.dev.rFee"), value: fmtAsset(p.feeMinor, p.asset), warn: excess },
      { label: t(locale, "cw.dev.rTotal"), value: fmtAsset(p.amountMinor + p.feeMinor, p.asset), warn: excess },
      { label: t(locale, "cw.dev.rNet"), value: net?.label ?? p.network }
    ];
  }

  function deviceScreen(): DevScreen {
    if (!s.device.powered) return { kind: "off" };
    if (s.setupStage === "model") return { kind: "note", title: "PolarVault", body: t(locale, "cw.dev.pressPower") };
    if (s.setupStage === "power") return { kind: "note", title: "PolarVault", body: t(locale, "cw.dev.initOnPc") };
    if (s.setupStage === "init" || s.setupStage === "pin") {
      if (!s.device.pin) return { kind: "pin", mode: "create", len: pinLen };
      return { kind: "note", title: "PolarVault", body: t(locale, "cw.dev.pinSet") };
    }
    if (s.setupStage === "seed" || s.setupStage === "reveal" || s.setupStage === "verify") {
      if (s.seedRevealed && s.seedWords.length > 0) {
        return { kind: "seed", words: s.seedWords, page: Math.min(seedPage, 2), pages: 3 };
      }
      return { kind: "note", title: "PolarVault", body: t(locale, "cw.dev.revealOnPc") };
    }
    if (!ready) return { kind: "note", title: "PolarVault", body: t(locale, "cw.dev.noWallet") };
    if (s.device.locked) return { kind: "pin", mode: "unlock", len: s.device.pin?.length ?? 4 };
    if (devNote) return { kind: "note", title: devNote.title, body: devNote.body };
    if (verifyId) {
      const a = tryAcct(s, verifyId);
      if (a) return { kind: "address", addr: a.address, verified: !!s.addrVerified[verifyId] };
    }
    if (reviewId) {
      try {
        const p = coldDeviceView(s, reviewId);
        if (p.dir === "out" && p.status === "awaiting") {
          const pages = reviewPages(p);
          return { kind: "review", pages, page: Math.min(reviewPage, pages.length - 1), last: reviewPage >= pages.length - 1 };
        }
      } catch { /* proposal gone — fall through to menu */ }
    }
    return { kind: "menu", items: menuItems, sel: menuSel % menuItems.length };
  }

  const screen = deviceScreen();

  // ---------- device button handlers ----------
  const devPower = () => {
    if (s.setupStage === "model" && !s.device.powered) {
      if (run((st) => coldPowerOn(st))) doFlash("power");
      return;
    }
    if (ready && !s.device.locked) {
      if (run((st) => coldLock(st))) doFlash("power");
    }
  };
  const devUp = () => {
    if (devNote) { setDevNote(null); return; }
    if (screen.kind === "pin" && model.controls === "two-button") setPinFocus((f) => (f + 1) % 10);
    else if (screen.kind === "menu") setMenuSel((x) => (x + menuItems.length - 1) % menuItems.length);
    else if (screen.kind === "review") setReviewPage((p) => Math.max(0, p - 1));
    else if (screen.kind === "seed") setSeedPage((p) => Math.max(0, p - 1));
  };
  const devDown = () => {
    if (devNote) { setDevNote(null); return; }
    if (screen.kind === "pin" && model.controls === "two-button") setPinFocus((f) => (f + 9) % 10);
    else if (screen.kind === "menu") setMenuSel((x) => (x + 1) % menuItems.length);
    else if (screen.kind === "review") setReviewPage((p) => Math.min(screen.pages.length - 1, p + 1));
    else if (screen.kind === "seed") setSeedPage((p) => Math.min(2, p + 1));
  };
  const devDigit = (dig: string) => {
    if (screen.kind !== "pin") return;
    if (pinBuf.length < screen.len) setPinBuf(pinBuf + dig);
  };
  const devConfirm = () => {
    if (devNote) { setDevNote(null); return; }
    if (screen.kind === "pin") {
      if (model.controls === "two-button") {
        if (pinBuf.length < screen.len) { setPinBuf(pinBuf + String(pinFocus)); return; }
      }
      if (pinBuf.length !== screen.len) return;
      if (screen.mode === "create") {
        if (run((st) => coldSetPin(st, pinBuf))) { setPinBuf(""); doFlash("unlock"); }
        else doFlash("error");
      } else {
        const left = run((st) => coldUnlock(st, pinBuf));
        setPinBuf("");
        if (left !== null) doFlash(left > 0 ? "unlock" : "error");
        else doFlash("error");
      }
      return;
    }
    if (screen.kind === "menu") {
      const item = menuSel % menuItems.length;
      if (item === 0) {
        if (s.activeAccount) { setVerifyId(s.activeAccount); doFlash("review"); }
      } else if (item === 1) {
        setDevNote({
          title: t(locale, "cw.dev.balT"),
          body: s.accounts.map((a) => `${a.name}: ${Object.entries(a.balances).map(([k, v]) => fmtAsset(v, k)).join(" · ") || "—"}`).join("\n")
        });
      } else if (item === 2) {
        setDevNote({
          title: t(locale, "cw.dev.setT"),
          body: `Model: ${model.name}\nLockout: ${s.device.maxAttempts} attempts\nQR TTL: ${Math.round(s.scenarios.qrTtlMs / 1000)}s\nPIN: demo only, browser storage`
        });
      } else {
        if (run((st) => coldLock(st))) doFlash("power");
      }
      return;
    }
    if (screen.kind === "address" && verifyId) {
      if (run((st) => coldVerifyAddress(st, verifyId))) doFlash("approve");
      else doFlash("error");
      return;
    }
    if (screen.kind === "review" && reviewId) {
      if (!screen.last) { setReviewPage((p) => Math.min(screen.pages.length - 1, p + 1)); return; }
      const raw = run((st) => coldDeviceApprove(st, reviewId));
      if (raw !== null) {
        doFlash("approve");
        setReviewPage(0);
        try {
          const p = coldDeviceView(s, reviewId);
          if (p.via === "qr") setSignedQr(typeof raw === "string" ? raw : p.signedPayload);
        } catch { /* noop */ }
      } else doFlash("error");
    }
  };
  const devReject = () => {
    if (devNote) { setDevNote(null); return; }
    if (screen.kind === "pin") { setPinBuf(pinBuf.slice(0, -1)); return; }
    if (screen.kind === "address") { setVerifyId(null); return; }
    if (screen.kind === "review" && reviewId) {
      if (run((st) => coldDeviceReject(st, reviewId))) { doFlash("reject"); setReviewPage(0); }
      else doFlash("error");
    }
  };

  // ---------- send helpers ----------
  const sendNet = activeAcct?.network ?? "glacier";
  const sendAssets = COLD_ASSETS.filter((a) => a.network === sendNet).map((a) => a.symbol);
  const sendMinor = toMinor(amt, asset);
  let sendFee: number | null = null;
  try { sendFee = sendMinor ? coldEstimateFee(s, sendNet, sendMinor) : coldEstimateFee(s, sendNet, 1); } catch { sendFee = null; }
  const sendBal = activeAcct ? (activeAcct.balances[asset] ?? 0) : 0;
  const excessFee = sendFee !== null && sendMinor !== null && sendFee * 10 > sendMinor;

  let activeView: (ColdProposal & { displayTo: string; spoofed: boolean }) | null = null;
  if (activeTx) {
    try { activeView = coldComputerView(s, activeTx); }
    catch { activeView = null; }
  }

  const createProposal = () => {
    if (!activeAcct || sendMinor === null) return;
    const id = run((st) => coldPrepare(st, { fromAcct: activeAcct.id, to: to.trim(), asset, amountMinor: sendMinor as number, via }));
    if (id) {
      setActiveTx(id);
      setReviewId(id);
      setReviewPage(0);
      setUnsignedQr(null);
      setSignedQr(null);
      setAirIn("");
      doFlash("review");
    } else doFlash("error");
  };

  const exportQr = () => {
    if (!activeTx) return;
    const raw = run((st) => coldExportUnsigned(st, activeTx));
    if (raw) setUnsignedQr(raw);
  };

  // ---------- receive helpers ----------
  const rxAcct = ready && s.activeAccount ? tryAcct(s, s.activeAccount) : null;

  // ---------- setup helpers ----------
  const distractors = (pos: number): string[] => {
    const { seedWords } = s;
    const correct = seedWords[pos] ?? "";
    const pool = COLD_DEMO_WORDS.filter((w) => w !== correct);
    const out = [correct];
    let h = seed + pos * 131;
    while (out.length < 4) {
      h = (h * 1103515245 + 12345) & 0x7fffffff;
      const w = pool[h % pool.length];
      if (!out.includes(w)) out.push(w);
    }
    return out.sort();
  };

  const fullReset = () => {
    resetAll();
    setPinBuf(""); setReviewId(null); setReviewPage(0); setVerifyId(null);
    setActiveTx(null); setUnsignedQr(null); setSignedQr(null); setAirIn("");
    setTo(""); setAmt(""); setRxAmt(""); setDevNote(null); setDrillDone(null);
    setArmReset(false); setCompTab("overview"); setFromAcct("");
  };

  const pendingIn = s.proposals.filter((p) => p.dir === "in" && p.status === "pending");

  return (
    <div className="space-y-2">
      {/* header */}
      <Card className="flex flex-wrap items-center gap-1.5 p-3">
        <div className="me-auto">
          <div className="font-bold">{t(locale, "cw.title")}</div>
          <div className="text-[12px] text-zinc-500">{t(locale, "cw.sub")}</div>
        </div>
        {ready && <>
          <Badge tone={s.device.powered ? "green" : "zinc"}>{s.device.powered ? t(locale, "cw.st.on") : t(locale, "cw.st.off")}</Badge>
          <Badge tone={s.device.connected ? "green" : "zinc"}>USB {s.device.connected ? "●" : "○"}</Badge>
          <Badge tone={s.device.locked ? "red" : "green"}>{s.device.locked ? t(locale, "cw.st.locked") : t(locale, "cw.st.open")}</Badge>
          <Btn small variant="outline" onClick={() => run((st) => {
            if (st.device.connected) coldDisconnect(st);
            else coldConnect(st);
            doFlash("connect");
          })}>
            {s.device.connected ? t(locale, "cw.disconnect") : t(locale, "cw.connect")}
          </Btn>
        </>}
      </Card>

      {err && <div className="rounded-lg bg-red-50 p-2 text-[13px] text-red-700 dark:bg-red-950 dark:text-red-300" role="alert">{err}</div>}

      {/* ---------- setup wizard ---------- */}
      {!ready && s.setupStage !== "ready" && (
        <div className="grid gap-2 lg:grid-cols-[1fr_280px]">
          <Card className="space-y-2 p-3">
            <StepHead title={t(locale, "cw.setup.title")} sub={t(locale, "cw.setup.sub")} />
            <div className="rounded-lg bg-amber-50 p-2 text-[13px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">{t(locale, "cw.demoWarn")}</div>
            {s.setupStage === "none" && (
              <div className="space-y-2">
                <div className="text-sm font-medium">{t(locale, "cw.setup.models")}</div>
                {COLD_MODELS.map((m) => (
                  <button key={m.id} onClick={() => run((st) => coldChooseModel(st, m.id))} className="w-full rounded-xl border border-zinc-200 p-2.5 text-left dark:border-zinc-800">
                    <div className="font-semibold">{m.brand} {m.name.replace(`${m.brand} `, "")}</div>
                    <div className="text-[13px] text-zinc-500">{m.blurb}</div>
                  </button>
                ))}
              </div>
            )}
            {s.setupStage === "model" && <div className="text-sm">{t(locale, "cw.setup.powerT")}</div>}
            {s.setupStage === "power" && (
              <div className="space-y-2">
                <div className="text-sm">{t(locale, "cw.setup.initB")}</div>
                <div><Btn small onClick={() => run((st) => coldInitNew(st))}>{t(locale, "cw.setup.initBtn")}</Btn></div>
              </div>
            )}
            {(s.setupStage === "init" || s.setupStage === "pin") && !s.device.pin && (
              <div className="space-y-2">
                <div className="text-sm font-medium">{t(locale, "cw.setup.pinT")}</div>
                <div className="text-[13px] text-zinc-500">{t(locale, "cw.setup.pinB")}</div>
                <div className="flex items-center gap-2 text-[13px]">
                  <span>{t(locale, "cw.setup.pinLen")}</span>
                  <button aria-label="shorter pin" className="rounded border border-zinc-300 px-2 dark:border-zinc-700" onClick={() => setPinLen((l) => Math.max(4, l - 1))}>−</button>
                  <b className="font-mono">{pinLen}</b>
                  <button aria-label="longer pin" className="rounded border border-zinc-300 px-2 dark:border-zinc-700" onClick={() => setPinLen((l) => Math.min(8, l + 1))}>+</button>
                </div>
              </div>
            )}
            {(s.setupStage === "pin") && s.device.pin && (
              <div className="space-y-2">
                <div className="text-sm font-medium">{t(locale, "cw.setup.seedT")}</div>
                <div className="text-[13px] text-zinc-500">{t(locale, "cw.setup.seedB")}</div>
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={revealAck} onChange={(e) => setRevealAck(e.target.checked)} />
                  {t(locale, "cw.setup.revealGate")}
                </label>
                <div><Btn small disabled={!revealAck} onClick={() => run((st) => coldRevealSeed(st))}>{t(locale, "cw.setup.revealBtn")}</Btn></div>
              </div>
            )}
            {(s.setupStage === "seed" || s.setupStage === "reveal") && s.seedRevealed && (
              <div className="space-y-2">
                <div className="text-sm font-medium">{t(locale, "cw.setup.verifyT")}</div>
                <div className="text-[13px] text-zinc-500">{t(locale, "cw.setup.verifyB")}</div>
                {VERIFY_POS.map((pos, i) => (
                  <label key={pos} className="block text-[13px]">#{pos + 1}
                    <select className={inpCls} value={picks[i]} onChange={(e) => setPicks(picks.map((p, j) => (j === i ? e.target.value : p)))}>
                      <option value="">—</option>
                      {distractors(pos).map((w) => <option key={w} value={w}>{w}</option>)}
                    </select>
                  </label>
                ))}
                <div><Btn small onClick={() => run((st) => coldVerifyBackup(st, VERIFY_POS.map((pos, i) => ({ pos, word: picks[i] }))))}>{t(locale, "cw.setup.verifyBtn")}</Btn></div>
              </div>
            )}
            {s.setupStage === "verify" && (
              <div className="space-y-2">
                <div className="text-sm font-medium">{t(locale, "cw.setup.finishT")}</div>
                <div className="text-[13px] text-zinc-500">{t(locale, "cw.setup.finishB")}</div>
                <div><Btn small onClick={() => { if (run((st) => coldFinishSetup(st))) { setPicks(["", "", ""]); setRevealAck(false); doFlash("power"); } }}>{t(locale, "cw.setup.finishBtn")}</Btn></div>
              </div>
            )}
          </Card>
          <div className="space-y-1.5">
            <HwDevice s={s} model={model.controls} screen={screen} pinBuf={pinBuf} pinFocus={pinFocus} flash={flash}
              onPower={devPower} onUp={devUp} onDown={devDown} onConfirm={devConfirm} onReject={devReject} onDigit={devDigit} />
            <div className="text-center text-[12px] text-zinc-500">{t(locale, "cw.dev.hint")}</div>
          </div>
        </div>
      )}

      {/* ---------- wiped device → restore path ---------- */}
      {s.setupStage === "ready" && !ready && (
        <Card className="mx-auto max-w-[520px] space-y-2 p-4 text-center">
          <div className="font-bold">{t(locale, "cw.wipedT")}</div>
          <div className="text-[13px] text-zinc-500">{t(locale, "cw.wipedB")}</div>
          <div className="flex justify-center gap-1.5">
            <Btn small variant="outline" onClick={() => setCompTab("recovery")}>{t(locale, "cw.goRecovery")}</Btn>
            <Btn small variant="danger" onClick={fullReset}>{t(locale, "cw.reset")}</Btn>
          </div>
        </Card>
      )}

      {/* ---------- main experience ---------- */}
      {ready && (
        <div className="grid items-start gap-2 lg:grid-cols-[1fr_280px]">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap gap-1">
              {(["overview", "receive", "send", "activity", "recovery", "compare", "scenarios"] as const).map((x) => (
                <button key={x} onClick={() => setCompTab(x)} className={`rounded-lg px-3 py-1 text-sm ${compTab === x ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}>
                  {t(locale, `cw.tab.${x}`)}
                </button>
              ))}
            </div>

            {compTab === "overview" && activeAcct && (
              <div className="space-y-2">
                <Card className="space-y-2 p-3">
                  <StepHead title={t(locale, "cw.ov.title")} sub={t(locale, "cw.ov.sub")} right={
                    <select aria-label="account" className="rounded border border-zinc-300 bg-transparent px-1.5 py-1 text-[13px] dark:border-zinc-700" value={activeAcct.id} onChange={(e) => { setFromAcct(e.target.value); run((st) => coldSwitchAccount(st, e.target.value)); const a = tryAcct(s, e.target.value); if (a) { const first = COLD_ASSETS.find((x) => x.network === a.network)?.symbol ?? "GLAC"; setAsset(first); } }}>
                      {s.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  } />
                  <div className="grid grid-cols-3 gap-1.5 text-center">
                    {Object.entries(activeAcct.balances).length === 0 && <div className="col-span-3 text-[13px] text-zinc-500">{t(locale, "cw.ov.empty")}</div>}
                    {Object.entries(activeAcct.balances).map(([k, v]) => (
                      <div key={k} className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900">
                        <div className="font-mono text-sm font-bold">{fmtAsset(v, k)}</div>
                        <div className="text-[11px] text-zinc-500">{COLD_NETWORKS.find((n) => n.id === activeAcct.network)?.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="break-all font-mono text-[12px]">{activeAcct.address}</div>
                  <div className="flex flex-wrap gap-1.5">
                    <Btn small variant="outline" onClick={() => { try { void navigator.clipboard.writeText(activeAcct.address); } catch { /* noop */ } }}>{t(locale, "cw.copy")}</Btn>
                    <Btn small variant="outline" onClick={() => { setVerifyId(activeAcct.id); doFlash("review"); }}>{t(locale, "cw.verifyOnDevice")}</Btn>
                    {s.addrVerified[activeAcct.id] && <Badge tone="green">✓ {t(locale, "cw.verified")}</Badge>}
                  </div>
                  {s.scenarios.tamperReceive && <div className="rounded-lg bg-red-50 p-2 text-[13px] text-red-700 dark:bg-red-950 dark:text-red-300">{t(locale, "cw.tamperRxLesson")}</div>}
                </Card>
                <Card className="space-y-1.5 p-3">
                  <div className="text-sm font-semibold">{t(locale, "cw.learnT")}</div>
                  <div className="flex flex-wrap items-center gap-1 text-[12px]">
                    {[t(locale, "cw.learnPrepare"), t(locale, "cw.learnSign"), t(locale, "cw.learnBroadcast"), t(locale, "cw.learnConfirm")].map((s2, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-semibold dark:bg-zinc-800">{i + 1}. {s2}</span>
                        {i < 3 && <span className="text-zinc-400">→</span>}
                      </span>
                    ))}
                  </div>
                  <div className="text-[12px] text-zinc-500">{t(locale, "cw.learnB")}</div>
                </Card>
              </div>
            )}

            {compTab === "receive" && rxAcct && (
              <div className="space-y-2">
                <Card className="space-y-2 p-3 text-center">
                  <StepHead title={t(locale, "cw.rx.title")} sub={t(locale, "cw.rx.sub")} />
                  <div className="flex justify-center gap-1.5" role="group" aria-label="asset">
                    {COLD_ASSETS.filter((a) => a.network === rxAcct.network).map((a) => (
                      <button key={a.symbol} onClick={() => setRxAsset(a.symbol)} className={`rounded-lg border px-3 py-1 font-mono text-sm font-bold ${rxAsset === a.symbol ? "border-sky-500 bg-sky-50 dark:bg-sky-950" : "border-zinc-200 dark:border-zinc-800"}`}>{a.symbol}</button>
                    ))}
                  </div>
                  <div className="mx-auto w-fit bg-white p-3"><QRCode value={coldDisplayAddress(s, rxAcct.id)} size={150} /></div>
                  <div className="break-all font-mono text-[13px]">{coldDisplayAddress(s, rxAcct.id)}</div>
                  <div className="flex justify-center gap-1.5">
                    <Btn small variant="outline" onClick={() => { setVerifyId(rxAcct.id); doFlash("review"); }}>{t(locale, "cw.verifyOnDevice")}</Btn>
                    {s.addrVerified[rxAcct.id] && <Badge tone="green">✓ {t(locale, "cw.verified")}</Badge>}
                  </div>
                  <div className="text-[12px] text-zinc-500">{t(locale, "cw.rx.offlineNote")}</div>
                </Card>
                <Card className="space-y-2 p-3">
                  <StepHead title={t(locale, "cw.rx.simT")} sub={t(locale, "cw.rx.simB")} />
                  <div className="flex gap-1.5">
                    <input dir="ltr" inputMode="decimal" aria-label="amount" className={`${inpCls} mt-0 flex-1 font-mono`} value={rxAmt} onChange={(e) => setRxAmt(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="0.00" autoComplete="off" />
                    <Btn small onClick={() => {
                      const m = toMinor(rxAmt, rxAsset);
                      if (m === null || !rxAcct) return;
                      const id = run((st) => coldSimIncoming(st, rxAcct.id, rxAsset, m));
                      if (id) setRxAmt("");
                    }}>{t(locale, "cw.rx.simBtn")}</Btn>
                  </div>
                  {pendingIn.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 rounded-lg bg-zinc-50 p-2 text-[13px] dark:bg-zinc-900">
                      <div className="flex-1">
                        <div className="font-mono font-bold text-emerald-700 dark:text-emerald-300">+{fmtAsset(p.amountMinor, p.asset)}</div>
                        <div className="text-zinc-500"><Time at={p.createdAt} /> · {p.confirms}/{p.confRequired}</div>
                      </div>
                      <Btn small onClick={() => run((st) => coldAdvance(st, p.id))}>{t(locale, "cw.advance")}</Btn>
                    </div>
                  ))}
                </Card>
              </div>
            )}

            {compTab === "send" && (
              <div className="space-y-2">
                {!activeView && activeAcct && (
                  <Card className="space-y-2 p-3">
                    <StepHead title={t(locale, "cw.tx.prepT")} sub={t(locale, "cw.tx.prepB")} />
                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "cw.tx.from")}</span>
                        <select className={inpCls} value={activeAcct.id} onChange={(e) => { setFromAcct(e.target.value); const a = tryAcct(s, e.target.value); if (a) setAsset(COLD_ASSETS.find((x) => x.network === a.network)?.symbol ?? "GLAC"); }}>
                          {s.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select></label>
                      <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "cw.tx.asset")}</span>
                        <select className={inpCls} value={asset} onChange={(e) => setAsset(e.target.value)}>
                          {sendAssets.map((a) => <option key={a} value={a}>{a}</option>)}
                        </select></label>
                    </div>
                    <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "cw.tx.to")}</span>
                      <input dir="ltr" className={`${inpCls} font-mono text-[12px]`} value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder={sendNet === "glacier" ? "glac1…" : "tide1…"} autoComplete="off" /></label>
                    <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "cw.tx.amount")} ({asset})</span>
                      <input dir="ltr" inputMode="decimal" className={`${inpCls} font-mono`} value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="0.00" autoComplete="off" /></label>
                    <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="transport">
                      {(["usb", "qr"] as const).map((v) => (
                        <button key={v} onClick={() => setVia(v)} className={`rounded-xl border p-2 text-left ${via === v ? "border-sky-500 bg-sky-50 dark:bg-sky-950" : "border-zinc-200 dark:border-zinc-800"}`}>
                          <div className="text-sm font-bold">{t(locale, v === "usb" ? "cw.tx.viaUsb" : "cw.tx.viaQr")}</div>
                          <div className="text-[12px] text-zinc-500">{t(locale, v === "usb" ? "cw.tx.viaUsbB" : "cw.tx.viaQrB")}</div>
                        </button>
                      ))}
                    </div>
                    <div className="space-y-1 rounded-xl bg-zinc-50 p-3 font-mono text-[13px] dark:bg-zinc-900">
                      <div className="flex justify-between"><span className="font-sans text-zinc-500">{t(locale, "cw.tx.balance")}</span><span>{fmtAsset(sendBal, asset)}</span></div>
                      <div className="flex justify-between"><span className="font-sans text-zinc-500">{t(locale, "cw.tx.fee")}</span><span>{sendFee !== null ? fmtAsset(sendFee, asset) : "—"}</span></div>
                      <div className="flex justify-between border-t border-zinc-200 pt-1 font-bold dark:border-zinc-800"><span className="font-sans font-medium text-zinc-500">{t(locale, "cw.tx.total")}</span><span>{sendMinor !== null && sendFee !== null ? fmtAsset(sendMinor + sendFee, asset) : "—"}</span></div>
                    </div>
                    {excessFee && <div className="rounded-lg bg-red-50 p-2 text-[13px] text-red-700 dark:bg-red-950 dark:text-red-300">{t(locale, "cw.tx.excessWarn")}</div>}
                    {via === "usb" && !s.device.connected && <div className="rounded-lg bg-amber-50 p-2 text-[13px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">{t(locale, "cw.tx.usbOff")}</div>}
                    <Btn onClick={createProposal} disabled={sendMinor === null || to.trim().length < 6}>{t(locale, "cw.tx.create")}</Btn>
                  </Card>
                )}

                {activeView && (
                  <Card className="space-y-2 p-3">
                    <StepHead title={`${t(locale, "cw.tx.propT")} ${activeView.id}`} right={<StatusBadge s={activeView.status} locale={locale} />} />
                    <div className="space-y-1 rounded-xl bg-zinc-50 p-3 font-mono text-[13px] dark:bg-zinc-900">
                      <div className="flex justify-between gap-2"><span className="font-sans text-zinc-500">{t(locale, "cw.tx.to")}</span><span className="break-all text-right">{shortAddr(activeView.displayTo)}</span></div>
                      <div className="flex justify-between"><span className="font-sans text-zinc-500">{t(locale, "cw.tx.amount")}</span><span>{fmtAsset(activeView.amountMinor, activeView.asset)}</span></div>
                      <div className="flex justify-between"><span className="font-sans text-zinc-500">{t(locale, "cw.tx.fee")}</span><span>{fmtAsset(activeView.feeMinor, activeView.asset)}</span></div>
                      <div className="flex justify-between"><span className="font-sans text-zinc-500">{t(locale, "cw.tx.via")}</span><span>{activeView.via === "usb" ? "USB" : "QR"}</span></div>
                    </div>
                    {activeView.spoofed && <div className="rounded-lg bg-red-50 p-2 text-[13px] text-red-700 dark:bg-red-950 dark:text-red-300">{t(locale, "cw.tx.spoofWarn")}</div>}
                    {activeView.status === "awaiting" && (
                      <div className="rounded-lg bg-amber-50 p-2 text-[13px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                        {activeView.via === "usb" ? t(locale, "cw.tx.awaitUsb") : t(locale, "cw.tx.awaitQr")}
                      </div>
                    )}
                    {activeView.status === "awaiting" && activeView.via === "qr" && (
                      <div className="space-y-2">
                        {!unsignedQr
                          ? <div><Btn small onClick={exportQr}>{t(locale, "cw.tx.exportQr")}</Btn></div>
                          : <>
                            <div className="mx-auto w-fit bg-white p-2"><QRCode value={unsignedQr} size={130} /></div>
                            <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "cw.tx.pasteUnsigned")}</span>
                              <textarea dir="ltr" rows={2} className={`${inpCls} font-mono text-[11px]`} value={airIn} onChange={(e) => setAirIn(e.target.value.trim())} placeholder='{"kind":"unsigned-tx",…}' /></label>
                            <div className="flex gap-1.5">
                              <Btn small variant="outline" onClick={() => setAirIn(unsignedQr)}>{t(locale, "cw.tx.useShown")}</Btn>
                              <Btn small onClick={() => { if (run((st) => coldImportUnsigned(st, airIn || unsignedQr))) { setAirIn(""); doFlash("review"); } }}>{t(locale, "cw.tx.scanToDevice")}</Btn>
                            </div>
                          </>}
                      </div>
                    )}
                    {activeView.status === "signed" && activeView.via === "qr" && (
                      <div className="space-y-2">
                        <div className="mx-auto w-fit bg-white p-2"><QRCode value={signedQr ?? activeView.signedPayload ?? ""} size={130} /></div>
                        <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "cw.tx.pasteSigned")}</span>
                          <textarea dir="ltr" rows={2} className={`${inpCls} font-mono text-[11px]`} value={airIn} onChange={(e) => setAirIn(e.target.value.trim())} placeholder='{"kind":"signed-tx",…}' /></label>
                        <div className="flex gap-1.5">
                          <Btn small variant="outline" onClick={() => setAirIn(signedQr ?? activeView.signedPayload ?? "")}>{t(locale, "cw.tx.useShown")}</Btn>
                          <Btn small onClick={() => { if (run((st) => coldImportSigned(st, airIn))) { setAirIn(""); } }}>{t(locale, "cw.tx.ferryBack")}</Btn>
                        </div>
                      </div>
                    )}
                    {activeView.status === "ready" && (
                      <div className="rounded-lg bg-sky-50 p-2 text-[13px] text-sky-800 dark:bg-sky-950 dark:text-sky-200">{t(locale, "cw.tx.readyNote")}</div>
                    )}
                    {activeView.failReason && <div className="rounded-lg bg-red-50 p-2 text-[13px] text-red-700 dark:bg-red-950 dark:text-red-300">{activeView.failReason}</div>}
                    {activeView.hash && <div className="break-all font-mono text-[12px] text-zinc-500">{activeView.hash}</div>}
                    {activeView.status === "pending" && (
                      <div className="flex items-center gap-2">
                        <div className="flex flex-1 gap-1">
                          {[...Array(activeView.confRequired)].map((_, i) => (
                            <span key={i} className={`h-2 flex-1 rounded ${i < activeView.confirms ? "bg-emerald-600" : "bg-zinc-200 dark:bg-zinc-800"}`} />
                          ))}
                        </div>
                        <span className="font-mono text-[12px]">{activeView.confirms}/{activeView.confRequired}</span>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {(activeView.status === "awaiting" || activeView.status === "draft") && (
                        <Btn small variant="outline" onClick={() => { if (run((st) => coldCancel(st, activeView.id))) { setActiveTx(null); setReviewId(null); } }}>{t(locale, "cw.tx.cancel")}</Btn>
                      )}
                      {activeView.status === "ready" && (
                        <Btn small onClick={() => { if (run((st) => coldBroadcast(st, activeView.id))) doFlash("connect"); else doFlash("error"); }}>{t(locale, "cw.tx.broadcast")}</Btn>
                      )}
                      {activeView.status === "pending" && (
                        <Btn small onClick={() => run((st) => coldAdvance(st, activeView.id))}>{t(locale, "cw.advance")}</Btn>
                      )}
                      {(["confirmed", "failed", "rejected", "cancelled"] as const).includes(activeView.status as never) && (
                        <Btn small variant="outline" onClick={() => { setActiveTx(null); setReviewId(null); setUnsignedQr(null); setSignedQr(null); setTo(""); setAmt(""); }}>{t(locale, "cw.tx.newProp")}</Btn>
                      )}
                    </div>
                    <div className="text-[12px] text-zinc-500">{t(locale, "cw.tx.stagesNote")}</div>
                  </Card>
                )}
              </div>
            )}

            {compTab === "activity" && (
              <Card className="space-y-2 p-3">
                <StepHead title={t(locale, "cw.act.title")} sub={t(locale, "cw.act.sub")} />
                {s.proposals.length === 0 && <EmptyNote>{t(locale, "cw.act.empty")}</EmptyNote>}
                {[...s.proposals].reverse().map((p) => (
                  <div key={p.id} className="space-y-1 rounded-lg bg-zinc-50 p-2 text-[13px] dark:bg-zinc-900">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 font-mono font-bold">
                        {p.dir === "in" ? "+" : "−"}{fmtAsset(p.amountMinor, p.asset)}
                      </div>
                      <StatusBadge s={p.status} locale={locale} />
                    </div>
                    <div className="break-all text-zinc-500">
                      {p.dir === "in" ? t(locale, "cw.act.from") : t(locale, "cw.act.to")}: <span className="font-mono text-[11px]">{shortAddr(p.dir === "in" ? p.fromAddr : p.to)}</span>
                      {" · "}{t(locale, "cw.act.fee")}: {p.dir === "in" ? "—" : fmtAsset(p.feeMinor, p.asset)}
                    </div>
                    <div className="text-zinc-500">
                      {p.id}{p.hash ? ` · ${shortAddr(p.hash)}` : ""} · {t(locale, "cw.act.device")}: {t(locale, `cw.verdict.${p.deviceVerdict}`)} · {t(locale, "cw.act.bcast")}: {p.broadcastAttempts}×
                    </div>
                    <details className="text-[12px] text-zinc-500">
                      <summary className="cursor-pointer">{t(locale, "cw.act.lifecycle")} ({p.stages.length})</summary>
                      <div className="mt-1 space-y-0.5 font-mono text-[11px]">
                        {p.stages.map((st, i) => <div key={i}>· {st.key}</div>)}
                      </div>
                    </details>
                    {p.dir === "out" && <div><Btn small variant="outline" onClick={() => { setActiveTx(p.id); setReviewId(p.id); setReviewPage(0); setCompTab("send"); }}>{t(locale, "cw.act.open")}</Btn></div>}
                  </div>
                ))}
                <div className="rounded-lg bg-zinc-50 p-2 text-[12px] text-zinc-500 dark:bg-zinc-900">{t(locale, "cw.act.legend")}</div>
              </Card>
            )}

            {compTab === "recovery" && (
              <div className="space-y-2">
                <Card className="space-y-2 p-3">
                  <StepHead title={t(locale, "cw.rec.purposeT")} sub={t(locale, "cw.rec.purposeB")} />
                  {s.seedWords.length > 0 && !s.device.locked ? (
                    <div className="space-y-2">
                      <div className="text-sm font-medium">{t(locale, "cw.rec.drillT")}</div>
                      {VERIFY_POS.map((pos, i) => (
                        <label key={pos} className="block text-[13px]">#{pos + 1}
                          <select className={inpCls} value={drillPicks[i]} onChange={(e) => setDrillPicks(drillPicks.map((p, j) => (j === i ? e.target.value : p)))}>
                            <option value="">—</option>
                            {distractors(pos).map((w) => <option key={w} value={w}>{w}</option>)}
                          </select>
                        </label>
                      ))}
                      <div><Btn small onClick={() => {
                        const ok = VERIFY_POS.every((pos, i) => s.seedWords[pos]?.toLowerCase() === drillPicks[i].trim().toLowerCase());
                        setDrillDone(ok && drillPicks.every(Boolean));
                      }}>{t(locale, "cw.setup.verifyBtn")}</Btn></div>
                      {drillDone === true && <div className="text-[13px] font-semibold text-emerald-700 dark:text-emerald-300">✓ {t(locale, "cw.rec.drillOk")}</div>}
                      {drillDone === false && <div className="text-[13px] text-red-700 dark:text-red-400">{t(locale, "cw.rec.drillBad")}</div>}
                    </div>
                  ) : (
                    <div className="text-[13px] text-zinc-500">{t(locale, "cw.rec.drillLocked")}</div>
                  )}
                </Card>
                <Card className="space-y-2 p-3">
                  <StepHead title={t(locale, "cw.rec.lostT")} sub={t(locale, "cw.rec.lostB")} />
                  <div className="text-[13px] text-zinc-500">{t(locale, "cw.rec.profile")}: {s.recoveryProfile ? t(locale, "cw.rec.profileYes") : t(locale, "cw.rec.profileNo")}</div>
                  {!armReset ? (
                    <div><Btn small variant="danger" onClick={() => setArmReset(true)}>{t(locale, "cw.rec.resetBtn")}</Btn></div>
                  ) : (
                    <div className="space-y-2 rounded-lg border border-red-300 p-2 dark:border-red-800">
                      <div className="text-[13px] font-semibold text-red-700 dark:text-red-300">{t(locale, "cw.rec.resetWarn")}</div>
                      <div className="flex gap-1.5">
                        <Btn small variant="outline" onClick={() => setArmReset(false)}>{t(locale, "cw.cancel")}</Btn>
                        <Btn small variant="danger" onClick={() => { if (run((st) => coldResetDevice(st, true))) { setArmReset(false); fullReset2(); } }}>{t(locale, "cw.rec.resetGo")}</Btn>
                      </div>
                    </div>
                  )}
                </Card>
                <Card className="space-y-2 p-3">
                  <StepHead title={t(locale, "cw.rec.restoreT")} sub={t(locale, "cw.rec.restoreB")} />
                  <div className="flex gap-1.5">
                    <input dir="ltr" inputMode="numeric" aria-label="new pin" className={`${inpCls} mt-0 max-w-[140px] font-mono`} value={restorePin} onChange={(e) => setRestorePin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="PIN" autoComplete="off" />
                    <Btn small onClick={() => { if (run((st) => coldRestore(st, restorePin))) { setRestorePin(""); setCompTab("overview"); } }}>{t(locale, "cw.rec.restoreBtn")}</Btn>
                  </div>
                </Card>
              </div>
            )}

            {compTab === "compare" && (
              <Card className="space-y-2 overflow-x-auto p-3">
                <StepHead title={t(locale, "cw.cmp.title")} sub={t(locale, "cw.cmp.sub")} />
                <table className="w-full min-w-[420px] text-[13px]">
                  <thead>
                    <tr className="text-left text-zinc-500">
                      <th className="py-1 pe-2"></th>
                      <th className="py-1 pe-2">{t(locale, "cw.cmp.hot")}</th>
                      <th className="py-1">{t(locale, "cw.cmp.cold")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(["keys", "net", "sign", "ease", "loss", "phish", "rec"] as const).map((r) => (
                      <tr key={r} className="border-t border-zinc-200 dark:border-zinc-800">
                        <td className="py-1.5 pe-2 font-semibold">{t(locale, `cw.cmp.r.${r}`)}</td>
                        <td className="py-1.5 pe-2 text-zinc-600 dark:text-zinc-400">{t(locale, `cw.cmp.r.${r}.hot`)}</td>
                        <td className="py-1.5 text-zinc-600 dark:text-zinc-400">{t(locale, `cw.cmp.r.${r}.cold`)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-[12px] text-zinc-500">{t(locale, "cw.cmp.caveat")}</div>
              </Card>
            )}

            {compTab === "scenarios" && (
              <Card className="space-y-2 p-3">
                <StepHead title={t(locale, "cw.scn.title")} sub={t(locale, "cw.scn.sub")} />
                {([
                  ["tamperSend", "cw.scn.tamperSend", "cw.scn.tamperSendB"],
                  ["tamperReceive", "cw.scn.tamperReceive", "cw.scn.tamperReceiveB"],
                  ["excessFee", "cw.scn.excessFee", "cw.scn.excessFeeB"]
                ] as const).map(([k, tk, bk]) => (
                  <label key={k} className="block rounded-xl border border-zinc-200 p-2 text-[13px] dark:border-zinc-800">
                    <span className="flex items-center gap-2 font-semibold">
                      <input type="checkbox" checked={!!s.scenarios[k]} onChange={(e) => run((st) => coldSetScenario(st, k, e.target.checked))} />
                      {t(locale, tk)}
                    </span>
                    <span className="mt-0.5 block text-zinc-500">{t(locale, bk)}</span>
                  </label>
                ))}
                <div className="rounded-xl border border-zinc-200 p-2 text-[13px] dark:border-zinc-800">
                  <div className="font-semibold">{t(locale, "cw.scn.failNext")}</div>
                  <div className="mt-0.5 text-zinc-500">{t(locale, "cw.scn.failNextB")}</div>
                  <div className="mt-1.5">
                    {!armFail
                      ? <Btn small variant="outline" onClick={() => { run((st) => coldSetScenario(st, "failNextBroadcast", true)); setArmFail(true); }}>{t(locale, "cw.scn.armFail")}</Btn>
                      : <Badge tone={s.scenarios.failNextBroadcast ? "amber" : "green"}>{s.scenarios.failNextBroadcast ? t(locale, "cw.scn.armed") : t(locale, "cw.scn.consumed")}</Badge>}
                  </div>
                </div>
                <div className="rounded-xl border border-zinc-200 p-2 text-[13px] dark:border-zinc-800">
                  <div className="font-semibold">{t(locale, "cw.scn.qrTtl")}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <select aria-label="qr ttl" className="rounded border border-zinc-300 bg-transparent px-1.5 py-1 dark:border-zinc-700" value={s.scenarios.qrTtlMs} onChange={(e) => run((st) => coldSetScenario(st, "qrTtlMs", Number(e.target.value)))}>
                      <option value={120000}>120s</option>
                      <option value={15000}>15s</option>
                      <option value={5000}>5s</option>
                    </select>
                    <Btn small variant="outline" onClick={() => run((st) => coldTick(st, 60_000))}>{t(locale, "cw.scn.tick")}</Btn>
                  </div>
                  <div className="mt-0.5 text-zinc-500">{t(locale, "cw.scn.qrTtlB")}</div>
                </div>
                <div className="rounded-xl border border-zinc-200 p-2 text-[13px] dark:border-zinc-800">
                  <div className="font-semibold">{t(locale, "cw.scn.maxAtt")}</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <select aria-label="max attempts" className="rounded border border-zinc-300 bg-transparent px-1.5 py-1 dark:border-zinc-700" value={s.device.maxAttempts} onChange={(e) => run((st) => coldSetMaxAttempts(st, Number(e.target.value)))}>
                      <option value={3}>3</option>
                      <option value={5}>5</option>
                      <option value={10}>10</option>
                    </select>
                  </div>
                  <div className="mt-0.5 text-zinc-500">{t(locale, "cw.scn.maxAttB")}</div>
                </div>
                <div className="flex gap-1.5">
                  {!armReset
                    ? <Btn small variant="danger" onClick={() => setArmReset(true)}>{t(locale, "cw.reset")}</Btn>
                    : <><Btn small variant="outline" onClick={() => setArmReset(false)}>{t(locale, "cw.cancel")}</Btn>
                      <Btn small variant="danger" onClick={fullReset}>{t(locale, "cw.resetGo")}</Btn></>}
                </div>
              </Card>
            )}
          </div>

          {/* device column */}
          <div className="space-y-1.5 lg:sticky lg:top-2">
            <HwDevice s={s} model={model.controls} screen={screen} pinBuf={pinBuf} pinFocus={pinFocus} flash={flash}
              onPower={devPower} onUp={devUp} onDown={devDown} onConfirm={devConfirm} onReject={devReject} onDigit={devDigit} />
            <div className="text-center text-[12px] text-zinc-500">{t(locale, "cw.dev.hint")}</div>
            {err && <div className="rounded-lg bg-red-50 p-2 text-center text-[12px] text-red-700 dark:bg-red-950 dark:text-red-300">{err}</div>}
          </div>
        </div>
      )}
    </div>
  );

  function fullReset2() {
    setPinBuf(""); setReviewId(null); setReviewPage(0); setVerifyId(null);
    setActiveTx(null); setCompTab("recovery");
  }
}
