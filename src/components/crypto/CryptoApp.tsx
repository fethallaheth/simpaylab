/**
 * Crypto wallet app v2 — a persistent test wallet, not a one-shot form.
 *
 * First visit: create wallet -> back up the FAKE seed -> visit the testnet
 * faucet. Then it behaves like a real self-custody app: home with balances,
 * send wizard (address -> amount with fiat toggle -> fee choice -> press-and-
 * hold review sheet), receive with QR, a merchant sell side with rate-locked
 * invoices, and an activity feed. A guided tour narrates the first payment
 * for learners who have never touched crypto.
 */
"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import {
  FAKE_WORD_LIST,
  createCryptoFlow,
  createRunBase,
  cryptoAdvance,
  cryptoResult,
  type CryptoFlow,
  type FailureId,
  type RunResult
} from "@sim/engine";
import { t } from "@/i18n/dict";
import { formatMoney, listSessions, saveSession, type StoredSession } from "@/lib/sim";
import { usePrefs } from "../providers";
import { Badge, Btn, Card } from "../ui";
import { EmptyNote, OtpBoxes, StepHead, Time, inpCls, useSpecReset } from "../flows/kit";
import { HotWallet } from "../hotwallet/HotWallet";

type Tab = "home" | "send" | "receive" | "sell" | "transfer" | "activity";
type Chain = "btc-like" | "evm" | "stablecoin";
type SendStep = "addr" | "amount" | "fee" | "review" | "pending";

const SATS = 100_000_000;
const BTC_USD = 97_000;
const WKEY = "simpay.crypto.wallet.v2";
const WKEY_B = "simpay.crypto.walletB.v1";

function normWallet(w: CWallet | null): CWallet | null {
  if (!w) return w;
  return { ...w, history: w.history ?? [] };
}
const ADDR_RE = /^(sim1[0-9a-f]{6,}|0x[0-9a-fA-F]{6,})$/;

interface TxRec {
  txId: string;
  dir: "in" | "out";
  amount: number;
  asset: string;
  addr: string;
  at: number;
  ref: string;
}

interface CWallet {
  seed: string[];
  backedUp: boolean;
  addrBtc: string;
  addrEvm: string;
  balBtc: number;
  balUsdt: number;
  book: { name: string; addr: string }[];
  credits: { at: number; asset: string; amount: number; kind: string }[];
  history: TxRec[];
}

function randHex(n: number): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => "0123456789abcdef"[x % 16]).join("");
}

function shortAddr(a: string): string {
  return a.length > 16 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a;
}

function loadWallet(): CWallet | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(WKEY);
    return raw ? (JSON.parse(raw) as CWallet) : null;
  } catch {
    return null;
  }
}

const TOUR: { tab: Tab; title: string; body: string }[] = [
  { tab: "home", title: "cr.tour.0t", body: "cr.tour.0b" },
  { tab: "home", title: "cr.tour.1t", body: "cr.tour.1b" },
  { tab: "receive", title: "cr.tour.2t", body: "cr.tour.2b" },
  { tab: "sell", title: "cr.tour.3t", body: "cr.tour.3b" },
  { tab: "send", title: "cr.tour.4t", body: "cr.tour.4b" },
  { tab: "send", title: "cr.tour.5t", body: "cr.tour.5b" },
  { tab: "send", title: "cr.tour.6t", body: "cr.tour.6b" },
  { tab: "activity", title: "cr.tour.7t", body: "cr.tour.7b" },
  { tab: "home", title: "cr.tour.8t", body: "cr.tour.8b" },
  { tab: "home", title: "cr.tour.9t", body: "cr.tour.9b" },
  { tab: "activity", title: "cr.tour.10t", body: "cr.tour.10b" }
];

export function CryptoApp({ seed, params, failures, onLive }: {
  seed: number;
  params: Record<string, unknown>;
  failures: FailureId[];
  onLive: (r: RunResult) => void;
}) {
  const { locale } = usePrefs();
  const [wallet, setWallet] = useState<CWallet | null>(null);
  const [walletB, setWalletB] = useState<CWallet | null>(null);
  const [showSeedB, setShowSeedB] = useState(false);
  const [ackSeedB, setAckSeedB] = useState(false);
  const [onboard, setOnboard] = useState<"none" | "seed" | "verify" | "done">("none");
  const [showSeed, setShowSeed] = useState<string[]>([]);
  const [picks, setPicks] = useState<string[]>(["", "", ""]);
  const [tab, setTab] = useState<Tab>("home");
  const [chain, setChain] = useState<Chain>("btc-like");
  const [sendStep, setSendStep] = useState<SendStep>("addr");
  const [dest, setDest] = useState("");
  const [addrErr, setAddrErr] = useState(false);
  const [amtMajor, setAmtMajor] = useState("");
  const [amtFiat, setAmtFiat] = useState(true);
  const [feeTier, setFeeTier] = useState<"low" | "medium" | "high">("medium");
  const [hold, setHold] = useState(0);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [invFiat, setInvFiat] = useState("");
  const [lockLeft, setLockLeft] = useState(15 * 60);
  const [tour, setTour] = useState<number | null>(null);
  useEffect(() => {
    // First-run tour: auto-open once (localStorage marker survives SPA navigation).
    if (window.localStorage.getItem("cr.tour.done")) return;
    setTour(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [orders, setOrders] = useState<StoredSession[]>([]);
  const [contactName, setContactName] = useState("");
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletApproval, setWalletApproval] = useState<string | null>(null);
  const [tFrom, setTFrom] = useState<"A" | "B">("A");
  const [tTo, setTTo] = useState<"A" | "B" | "ext">("B");
  const [tAsset, setTAsset] = useState<"BTC" | "USDT">("BTC");
  const [tAmt, setTAmt] = useState("");
  const [tDest, setTDest] = useState("");
  const [tStep, setTStep] = useState<"form" | "review" | "pending" | "done">("form");
  const [tErr, setTErr] = useState<string | null>(null);
  const [tSnap, setTSnap] = useState<null | {
    txId: string; from: "A" | "B"; toAddr: string; toLabel: string;
    amount: number; asset: "BTC" | "USDT"; fee: number;
    fromBefore: number; fromAfter: number; toBefore: number; toAfter: number;
  }>(null);

  const flowRef = useRef<CryptoFlow | null>(null);
  const savedRef = useRef(false);
  const flowT = useRef<CryptoFlow | null>(null);
  const savedT = useRef(false);
  const tPre = useRef<{ fromBefore: number; toBefore: number } | null>(null);
  const holdTimer = useRef<number | null>(null);

  const ccy = chain === "btc-like" ? "BTC" : "USDT";
  const rate = chain === "btc-like" ? BTC_USD : 1;
  const bal = wallet ? (chain === "btc-like" ? wallet.balBtc : wallet.balUsdt) : 0;

  useEffect(() => {
    const w = loadWallet();
    setWallet(normWallet(w));
    setOnboard(w ? "done" : "none");
    try {
      if (typeof window !== "undefined") {
        const raw = localStorage.getItem(WKEY_B);
        setWalletB(raw ? normWallet(JSON.parse(raw) as CWallet) : null);
      }
    } catch { /* noop */ }
  }, []);
  useSpecReset(JSON.stringify({ seed, params, failures }), () => {
    flowRef.current = null;
    savedRef.current = false;
    setSendStep("addr");
    flowT.current = null;
    savedT.current = false;
    tPre.current = null;
    setTSnap(null);
    setTErr(null);
    setTStep("form");
  });
  useEffect(() => {
    if (tab === "activity") setOrders(listSessions().filter((s) => s.spec.moduleId === "crypto"));
  }, [tab]);
  useEffect(() => () => {
    if (holdTimer.current) window.clearInterval(holdTimer.current);
  }, []);

  const persist = (w: CWallet) => {
    setWallet(w);
    try { localStorage.setItem(WKEY, JSON.stringify(w)); } catch { /* noop */ }
  };
  const persistB = (w: CWallet) => {
    setWalletB(w);
    try { localStorage.setItem(WKEY_B, JSON.stringify(w)); } catch { /* noop */ }
  };
  const record = (w: CWallet, e: TxRec): CWallet => ({ ...w, history: [...w.history, e] });
  const push = (): RunResult => {
    const r = cryptoResult(flowRef.current!);
    onLive(r);
    return r;
  };
  const maybeSave = () => {
    const flow = flowRef.current;
    if (!flow || savedRef.current) return;
    if (flow.stage !== "done" && flow.stage !== "terminal") return;
    savedRef.current = true;
    saveSession({ moduleId: "crypto", seed, params: { ...params, chain, amountMinor: flow.ctx.amountMinor, currency: ccy }, failures }, cryptoResult(flow));
  };

  // ---------- onboarding ----------
  const createWallet = () => {
    const words = Array.from({ length: 12 }, () => FAKE_WORD_LIST[Math.floor(Math.random() * FAKE_WORD_LIST.length)]);
    setShowSeed(words);
    setOnboard("seed");
  };
  const finishSeed = (backedUp: boolean, words: string[]) => {
    persist({
      seed: words, backedUp,
      addrBtc: `sim1${randHex(20)}`, addrEvm: `0x${randHex(20)}`,
      balBtc: 0, balUsdt: 0, book: [], credits: [], history: []
    });
    setOnboard("done");
  };
  const openSecondWallet = () => {
    const words = Array.from({ length: 12 }, () => FAKE_WORD_LIST[Math.floor(Math.random() * FAKE_WORD_LIST.length)]);
    persistB({
      seed: words, backedUp: false,
      addrBtc: `sim1${randHex(20)}`, addrEvm: `0x${randHex(20)}`,
      balBtc: 0, balUsdt: 0, book: [], credits: [], history: []
    });
    setShowSeedB(true);
    setAckSeedB(false);
  };
  const faucet = (w: CWallet) => {
    persist(record({
      ...w,
      balBtc: w.balBtc + 5_000_000,
      balUsdt: w.balUsdt + 10_000_000_000,
      credits: [...w.credits,
        { at: Date.now(), asset: "BTC", amount: 5_000_000, kind: "faucet" },
        { at: Date.now(), asset: "USDT", amount: 10_000_000_000, kind: "faucet" }]
    }, { txId: `faucet-${Date.now()}`, dir: "in", amount: 5_000_000, asset: "BTC", addr: "faucet (sim)", at: Date.now(), ref: "test-faucet" }));
  };
  const faucetB = () => {
    if (!walletB) return;
    persistB(record({
      ...walletB,
      balBtc: walletB.balBtc + 5_000_000,
      balUsdt: walletB.balUsdt + 10_000_000_000,
      credits: [...walletB.credits,
        { at: Date.now(), asset: "BTC", amount: 5_000_000, kind: "faucet" },
        { at: Date.now(), asset: "USDT", amount: 10_000_000_000, kind: "faucet" }]
    }, { txId: `faucet-${Date.now()}`, dir: "in", amount: 5_000_000, asset: "BTC", addr: "faucet (sim)", at: Date.now(), ref: "test-faucet" }));
  };

  // ---------- send ----------
  const sats = amtFiat
    ? Math.round((Number(amtMajor.replace(",", ".")) / rate) * SATS)
    : Math.round(Number(amtMajor.replace(",", ".")) * SATS);
  const feeSats = { low: 3, medium: 15, high: 42 }[feeTier] * 250;
  const debit = (w: CWallet, asset: "BTC" | "USDT", minor: number): CWallet =>
    asset === "BTC" ? { ...w, balBtc: w.balBtc - minor } : { ...w, balUsdt: w.balUsdt - minor };

  const startSendSession = () => {
    const base = createRunBase("crypto", { seed, params: { ...params, chain, amountMinor: sats, currency: ccy }, failures });
    const flow = createCryptoFlow(base);
    flowRef.current = flow;
    savedRef.current = false;
    cryptoAdvance(flow, { type: "make_invoice" });
    push();
    return flow;
  };

  const confirmSend = () => {
    if (!wallet) return;
    setSendErr(null);
    try {
      const flow = flowRef.current?.stage === "built" ? flowRef.current : startSendSession();
      cryptoAdvance(flow, { type: "build_tx", feeTier, dest: dest.trim(), amountMinor: sats });
      push();
      if (flow.stage === "mining") {
        setSendStep("pending");
      } else {
        maybeSave();
        setSendStep("pending");
      }
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : String(e));
    }
  };

  const mine = () => {
    const flow = flowRef.current;
    if (!flow) return;
    cryptoAdvance(flow, { type: "mine" });
    const r = push();
    if (flow.stage === "done") {
      if (wallet) persist(record(debit(wallet, ccy as "BTC" | "USDT", sats + r.receipt.totalFeesMinor),
        { txId: flow.ctx.txId, dir: "out", amount: sats, asset: ccy, addr: dest.trim(), at: Date.now(), ref: String(txHash ?? flow.ctx.txId) }));
      maybeSave();
    }
  };

  const rbf = () => {
    const flow = flowRef.current;
    if (!flow) return;
    cryptoAdvance(flow, { type: "rbf" });
    push();
  };

  // ---------- wallet-to-wallet transfer ----------
  const [tBusy, setTBusy] = useState(false);
  const tW = (w: "A" | "B") => (w === "A" ? wallet : walletB);
  const tSetW = (w: "A" | "B", v: CWallet) => (w === "A" ? persist(v) : persistB(v));
  const tBal = (w: "A" | "B", asset: "BTC" | "USDT") => {
    const x = tW(w);
    if (!x) return 0;
    return asset === "BTC" ? x.balBtc : x.balUsdt;
  };
  const tAddr = (w: "A" | "B", asset: "BTC" | "USDT") => {
    const x = tW(w);
    if (!x) return "";
    return asset === "BTC" ? x.addrBtc : x.addrEvm;
  };
  const tChain = tAsset === "BTC" ? "btc-like" as const : "evm" as const;
  const tSats = Math.round(Number(tAmt.replace(",", ".")) * SATS);
  const tFee = 15 * 250;
  const pushT = (): RunResult => {
    const r = cryptoResult(flowT.current!);
    onLive(r);
    return r;
  };
  const maybeSaveT = () => {
    const flow = flowT.current;
    if (!flow || savedT.current) return;
    if (flow.stage !== "done" && flow.stage !== "terminal") return;
    savedT.current = true;
    saveSession({ moduleId: "crypto", seed, params: { ...params, chain: tChain, amountMinor: flow.ctx.amountMinor, currency: tAsset, transfer: `${tFrom}>${tTo}` }, failures }, cryptoResult(flow));
  };
  const confirmTransfer = () => {
    setTErr(null);
    if (tBusy) return;
    const fromW = tW(tFrom);
    if (!fromW) return;
    const toAddr = tTo === "ext" ? tDest.trim() : tAddr(tTo, tAsset);
    if (tTo !== "ext" && !tW(tTo)) { setTErr(t(locale, "cr.tr.needSecond")); return; }
    if (tTo === "ext" && !ADDR_RE.test(toAddr)) { setTErr(t(locale, "cr.wrongAddrB")); return; }
    if (tTo !== "ext" && tTo === tFrom) { setTErr(t(locale, "cr.tr.sameWallet")); return; }
    if (!(tSats > 0)) { setTErr(t(locale, "cr.tr.amountBad")); return; }
    if (tBal(tFrom, tAsset) < tSats + tFee) { setTErr(t(locale, "cr.s.nofunds")); return; }
    setTBusy(true);
    try {
      const base = createRunBase("crypto", { seed, params: { ...params, chain: tChain, amountMinor: tSats, currency: tAsset }, failures });
      const flow = createCryptoFlow(base);
      flowT.current = flow;
      savedT.current = false;
      tPre.current = { fromBefore: tBal(tFrom, tAsset), toBefore: tTo === "ext" ? 0 : tBal(tTo, tAsset) };
      cryptoAdvance(flow, { type: "make_invoice" });
      cryptoAdvance(flow, { type: "build_tx", feeTier: "medium", dest: toAddr, amountMinor: tSats });
      pushT();
      setTStep("pending");
    } catch (e) {
      setTErr(e instanceof Error ? e.message : String(e));
    } finally {
      setTBusy(false);
    }
  };
  const mineT = () => {
    const flow = flowT.current;
    if (!flow) return;
    cryptoAdvance(flow, { type: "mine" });
    const r = pushT();
    if (flow.stage === "done") {
      const fromW = tW(tFrom)!;
      const debited = tAsset === "BTC"
        ? { ...fromW, balBtc: fromW.balBtc - tSats - r.receipt.totalFeesMinor }
        : { ...fromW, balUsdt: fromW.balUsdt - tSats - r.receipt.totalFeesMinor };
      const ref = String([...flow.ctx.events].reverse().find((e) => e.type === "BROADCAST")?.payload.txHash ?? flow.ctx.txId);
      const outEntry: TxRec = { txId: flow.ctx.txId, dir: "out", amount: tSats, asset: tAsset, addr: toAddrOf(), at: Date.now(), ref };
      tSetW(tFrom, { ...debited, history: [...debited.history, outEntry] });
      if (tTo !== "ext") {
        const toW = tW(tTo)!;
        const credited = tAsset === "BTC"
          ? { ...toW, balBtc: toW.balBtc + tSats }
          : { ...toW, balUsdt: toW.balUsdt + tSats };
        tSetW(tTo, { ...credited, history: [...credited.history, { ...outEntry, dir: "in" as const, addr: fromAddrOf() }] });
      }
      setTSnap({
        txId: flow.ctx.txId, from: tFrom, toAddr: toAddrOf(),
        toLabel: tTo === "ext" ? shortAddr(toAddrOf()) : `Wallet ${tTo}`,
        amount: tSats, asset: tAsset, fee: r.receipt.totalFeesMinor,
        fromBefore: tPre.current?.fromBefore ?? tBal(tFrom, tAsset) + tSats + r.receipt.totalFeesMinor,
        fromAfter: (tPre.current?.fromBefore ?? 0) - tSats - r.receipt.totalFeesMinor,
        toBefore: tPre.current?.toBefore ?? 0,
        toAfter: (tPre.current?.toBefore ?? 0) + (tTo === "ext" ? 0 : tSats)
      });
      maybeSaveT();
      setTStep("done");
    }
  };
  const toAddrOf = () => (tTo === "ext" ? tDest.trim() : tAddr(tTo, tAsset));
  const fromAddrOf = () => tAddr(tFrom, tAsset);
  const rbfT = () => {
    const flow = flowT.current;
    if (!flow) return;
    cryptoAdvance(flow, { type: "rbf" });
    pushT();
  };
  const maxT = () => {
    const spendable = Math.max(0, tBal(tFrom, tAsset) - tFee);
    setTAmt(String(spendable / SATS));
  };
  const resetT = () => {
    flowT.current = null;
    savedT.current = false;
    tPre.current = null;
    setTSnap(null);
    setTErr(null);
    setTAmt("");
    setTDest("");
    setTStep("form");
  };

  const startHold = () => {
    const t0 = Date.now();
    holdTimer.current = window.setInterval(() => {
      const p = (Date.now() - t0) / 1200;
      setHold(Math.min(1, p));
      if (p >= 1) {
        if (holdTimer.current) window.clearInterval(holdTimer.current);
        holdTimer.current = null;
        confirmSend();
      }
    }, 50);
  };
  const endHold = () => {
    if (holdTimer.current) window.clearInterval(holdTimer.current);
    holdTimer.current = null;
    setHold(0);
  };

  const saveContact = () => {
    if (!wallet || contactName.trim().length < 2 || !ADDR_RE.test(dest.trim())) return;
    persist({ ...wallet, book: [...wallet.book, { name: contactName.trim(), addr: dest.trim() }] });
    setContactName("");
  };

  // ---------- sell (merchant invoice) ----------
  const makeInvoice = () => {
    const fiat = Number(invFiat.replace(",", "."));
    if (!(fiat > 0)) return;
    const minor = Math.round((fiat / rate) * SATS);
    const base = createRunBase("crypto", { seed, params: { ...params, chain, amountMinor: minor, currency: ccy }, failures });
    const flow = createCryptoFlow(base);
    flowRef.current = flow;
    savedRef.current = false;
    cryptoAdvance(flow, { type: "make_invoice" });
    push();
    setDest(flow.address);
    setAmtMajor(String(fiat));
    setAmtFiat(true);
    setSendStep("addr");
    setLockLeft(15 * 60);
  };

  const flow = flowRef.current;
  const invoice = flow?.ctx.events.find((e) => e.type === "INVOICE_CREATED");
  const mempool = [...(flow?.ctx.events ?? [])].reverse().find((e) => e.type === "MEMPOOL_QUEUED");
  const txHash = [...(flow?.ctx.events ?? [])].reverse().find((e) => e.type === "BROADCAST")?.payload.txHash;
  const lastType = flow ? flow.ctx.events[flow.ctx.events.length - 1]?.type : null;
  const flowTr = flowT.current;
  const mempoolT = [...(flowTr?.ctx.events ?? [])].reverse().find((e) => e.type === "MEMPOOL_QUEUED");
  const txHashT = [...(flowTr?.ctx.events ?? [])].reverse().find((e) => e.type === "BROADCAST")?.payload.txHash;
  const fiatOf = (minor: number) => (minor / SATS) * rate;

  useEffect(() => {
    if (!invoice || tab !== "sell") return;
    if (lockLeft <= 0) return;
    const id = setInterval(() => setLockLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, lockLeft, flowRef.current]);

  return (
    <div className="space-y-2">
      {tour !== null && (
        <div className="rounded-xl border-2 border-sky-500 bg-sky-50 p-3 text-sm dark:bg-sky-950">
          <div className="font-bold">{t(locale, TOUR[tour].title)}</div>
          <div className="mt-0.5 text-zinc-600 dark:text-zinc-300">{t(locale, TOUR[tour].body)}</div>
          <div className="mt-2 flex items-center gap-1.5">
            <Btn small variant="outline" onClick={() => { window.localStorage.setItem("cr.tour.done", "1"); setTour(null); }}>{t(locale, "cr.tour.exit")}</Btn>
            <span className="ms-auto text-[12px] text-zinc-500">{tour + 1}/{TOUR.length}</span>
            {tour > 0 && <Btn small variant="outline" onClick={() => { const n = tour - 1; setTour(n); setTab(TOUR[n].tab); }}>←</Btn>}
            {tour < TOUR.length - 1 && <Btn small onClick={() => { const n = tour + 1; setTour(n); setTab(TOUR[n].tab); }}>→</Btn>}
          </div>
        </div>
      )}

      {onboard === "none" ? (
        <Card className="mx-auto max-w-[380px] space-y-2 p-4 text-center">
          <div className="font-bold">{t(locale, "cr.w.createT")}</div>
          <div className="text-[13px] text-zinc-500">{t(locale, "cr.w.createB")}</div>
          <Btn onClick={createWallet}>{t(locale, "cr.w.create")}</Btn>
        </Card>
      ) : onboard === "seed" ? (
        <Card className="mx-auto max-w-[380px] space-y-2 p-4">
          <div className="font-bold text-red-700 dark:text-red-300">{t(locale, "cu.seedTitle")}</div>
          <div className="grid grid-cols-3 gap-1 font-mono text-[13px]">
            {showSeed.map((w, i) => <span key={i} className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{i + 1}. {w}</span>)}
          </div>
          <div className="text-[12px] text-zinc-500">{t(locale, "cu.seedSub")}</div>
          <div className="flex gap-1.5">
            <Btn small onClick={() => setOnboard("verify")}>{t(locale, "cu.wrote")}</Btn>
            <Btn small variant="outline" onClick={() => finishSeed(false, showSeed)}>{t(locale, "cr.w.skip")}</Btn>
          </div>
        </Card>
      ) : onboard === "verify" ? (
        <VerifySeed words={showSeed} onDone={(ok) => { if (ok) finishSeed(true, showSeed); }} />
      ) : wallet ? (
        <>
          <div className="flex flex-wrap items-center gap-1">
            {(["home", "send", "transfer", "receive", "sell", "activity"] as const).map((x) => (
              <button key={x} onClick={() => setTab(x)} className={`rounded-lg px-3 py-1 text-sm ${tab === x ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}>
                {t(locale, `cr.tab.${x}`)}
              </button>
            ))}
            <button onClick={() => { setTour(0); setTab("home"); }} className="ms-auto rounded-lg border border-dashed border-sky-500 px-2.5 py-1 text-[13px] text-sky-700 dark:text-sky-300">{t(locale, "cr.tour.start")}</button>
          </div>

          {tab === "home" && (
            <div className="space-y-2">
              {!wallet.backedUp && <div className="rounded-lg bg-amber-50 p-2 text-[13px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">{t(locale, "cr.w.nobackup")}</div>}
              <Card className="p-3">
                <div className="text-[11px] uppercase tracking-widest text-zinc-500">{t(locale, "cr.w.portfolio")}</div>
                <div className="font-mono text-2xl font-bold">${(fiatOf(wallet.balBtc) + fiatOf(wallet.balUsdt)).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                <div className="mt-2 space-y-1.5">
                  {(["BTC", "USDT"] as const).map((a) => (
                    <div key={a} className="flex items-center gap-2 text-sm">
                      <span className={`flex h-8 w-8 items-center justify-center rounded-full font-bold text-white ${a === "BTC" ? "bg-orange-500" : "bg-teal-600"}`}>{a[0]}</span>
                      <div className="flex-1">
                        <div className="font-semibold">{a}</div>
                        <div className="font-mono text-[13px]">{((a === "BTC" ? wallet.balBtc : wallet.balUsdt) / SATS).toLocaleString(undefined, { maximumFractionDigits: 8 })} {a}</div>
                      </div>
                      <div className="font-mono text-zinc-500">${fiatOf(a === "BTC" ? wallet.balBtc : wallet.balUsdt).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                    </div>
                  ))}
                </div>
              </Card>
              <div className="flex gap-1.5">
                <div className="flex overflow-hidden rounded-lg border border-zinc-300 text-[13px] dark:border-zinc-700" role="group" aria-label="chain">
                  {(["btc-like", "evm", "stablecoin"] as const).map((c) => (
                    <button key={c} onClick={() => setChain(c)} className={`px-2 py-1.5 ${chain === c ? "bg-zinc-900 font-bold text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500"}`}>
                      {t(locale, c === "btc-like" ? "cr.chainBtc" : c === "evm" ? "cr.chainEvm" : "cr.chainStb")}
                    </button>
                  ))}
                </div>
                <Btn small variant="outline" onClick={() => faucet(wallet)}>{t(locale, "cr.w.faucet")}</Btn>
              </div>
              {walletB && showSeedB ? (
                <Card className="space-y-2 p-3">
                  <div className="text-sm font-semibold">{t(locale, "cr.tr.walletB")} — {t(locale, "cr.w.createT")}</div>
                  <div className="grid grid-cols-3 gap-1 font-mono text-[13px]">
                    {walletB.seed.map((w, i) => <span key={i} className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{i + 1}. {w}</span>)}
                  </div>
                  <label className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" checked={ackSeedB} onChange={(e) => setAckSeedB(e.target.checked)} />
                    {t(locale, "cr.tr.ackSeed")}
                  </label>
                  <div className="flex gap-1.5">
                    <Btn small variant="outline" onClick={() => faucetB()}>{t(locale, "cr.w.faucet")}</Btn>
                    <Btn small onClick={() => ackSeedB && setShowSeedB(false)} disabled={!ackSeedB}>{t(locale, "cr.tr.start")}</Btn>
                  </div>
                </Card>
              ) : walletB ? (
                <Card className="p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 font-bold text-white">B</span>
                    <div className="flex-1">
                      <div className="text-sm font-semibold">{t(locale, "cr.tr.walletB")}</div>
                      <div className="font-mono text-[13px]">{(walletB.balBtc / SATS).toFixed(8)} BTC · {(walletB.balUsdt / SATS).toFixed(2)} USDT</div>
                    </div>
                    <Btn small variant="outline" onClick={() => setTab("transfer")}>{t(locale, "cr.tr.openTransfer")}</Btn>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-zinc-500">{walletB.addrBtc.slice(0, 18)}…</div>
                </Card>
              ) : (
                <Card className="space-y-2 p-3">
                  <div className="text-sm font-semibold">{t(locale, "cr.tr.secondT")}</div>
                  <div className="text-[13px] text-zinc-500">{t(locale, "cr.tr.secondB")}</div>
                  <Btn small variant="outline" onClick={openSecondWallet}>{t(locale, "cr.tr.openSecond")}</Btn>
                </Card>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                <Btn onClick={() => setTab("send")}>{t(locale, "cr.w.send")}</Btn>
                <Btn variant="outline" onClick={() => setTab("receive")}>{t(locale, "cr.w.receive")}</Btn>
              </div>
              <div className="text-[12px] text-zinc-500">{t(locale, "cr.w.faucetNote")}</div>
            </div>
          )}

          {tab === "send" && (
            <div className="mx-auto max-w-[380px] space-y-2">
              {sendStep === "addr" && (
                <Card className="space-y-2 p-3">
                  <StepHead title={t(locale, "cr.s.addrT")} sub={t(locale, "cr.s.addrB")} />
                  <input dir="ltr" className={`${inpCls} font-mono text-[12px]`} value={dest} onChange={(e) => { setDest(e.target.value.trim()); setAddrErr(false); }} placeholder="sim1… / 0x…" autoComplete="off" />
                  {addrErr && <div className="text-[13px] text-red-700 dark:text-red-400">{t(locale, "cr.wrongAddrB")}</div>}
                  {wallet.book.length > 0 && (
                    <div className="space-y-1">
                      {wallet.book.map((b, i) => (
                        <button key={i} onClick={() => setDest(b.addr)} className="w-full rounded-lg bg-zinc-50 p-1.5 text-left text-[13px] dark:bg-zinc-900">
                          <b>{b.name}</b> <span className="font-mono text-[11px] text-zinc-500">{b.addr.slice(0, 14)}…</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-1.5">
                    <input className="flex-1 rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder={t(locale, "cr.s.saveName")} />
                    <Btn small variant="outline" onClick={saveContact}>{t(locale, "cr.s.save")}</Btn>
                  </div>
                  <Btn onClick={() => { if (ADDR_RE.test(dest)) setSendStep("amount"); else setAddrErr(true); }}>{t(locale, "cr.s.next")}</Btn>
                </Card>
              )}
              {sendStep === "amount" && (
                <Card className="space-y-2 p-3 text-center">
                  <div className="text-[13px] text-zinc-500">{t(locale, "cr.s.amountT")}</div>
                  <input dir="ltr" inputMode="decimal" aria-label="amount" className="w-full bg-transparent text-center font-mono text-4xl font-bold outline-none" value={amtMajor} onChange={(e) => setAmtMajor(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="0.00" autoComplete="off" />
                  <div className="flex items-center justify-center gap-2 text-sm">
                    <button onClick={() => setAmtFiat(!amtFiat)} className="rounded-full border border-zinc-300 px-3 py-0.5 dark:border-zinc-700">
                      {amtFiat ? `$ → ${ccy}` : `${ccy} → $`}
                    </button>
                    <span className="font-mono text-zinc-500">≈ {amtFiat ? `${(sats / SATS).toFixed(8)} ${ccy}` : `$${fiatOf(sats).toFixed(2)}`}</span>
                  </div>
                  {sats > bal && <div className="text-[13px] text-red-700 dark:text-red-400">{t(locale, "cr.s.nofunds")}</div>}
                  <div className="flex gap-1.5">
                    <Btn small variant="outline" onClick={() => setSendStep("addr")}>←</Btn>
                    <Btn small onClick={() => sats > 0 && sats <= bal && setSendStep("fee")} disabled={!(sats > 0 && sats <= bal)}>{t(locale, "cr.s.next")}</Btn>
                  </div>
                </Card>
              )}
              {sendStep === "fee" && (
                <Card className="space-y-2 p-3">
                  <StepHead title={t(locale, "cr.feeTier")} sub={t(locale, "cr.s.feeB")} />
                  {(["low", "medium", "high"] as const).map((f) => (
                    <button key={f} onClick={() => setFeeTier(f)} className={`w-full rounded-xl border p-2.5 text-left ${feeTier === f ? "border-sky-500 bg-sky-50 dark:bg-sky-950" : "border-zinc-200 dark:border-zinc-800"}`}>
                      <div className="flex justify-between text-sm font-semibold"><span>{t(locale, `cr.fee.${f}`)}</span><span className="font-mono">~{f === "low" ? 60 : f === "medium" ? 20 : 10} sec</span></div>
                      <div className="font-mono text-[12px] text-zinc-500">{({ low: 3, medium: 15, high: 42 })[f]} sat/vB ≈ {((({ low: 3, medium: 15, high: 42 })[f] * 250) / SATS).toFixed(8)} {ccy === "BTC" ? "BTC" : "USDT"}</div>
                    </button>
                  ))}
                  <div className="flex gap-1.5">
                    <Btn small variant="outline" onClick={() => setSendStep("amount")}>←</Btn>
                    <Btn small onClick={() => setSendStep("review")}>{t(locale, "cr.s.review")}</Btn>
                  </div>
                </Card>
              )}
              {sendStep === "review" && (
                <Card className="space-y-2 p-3">
                  <StepHead title={t(locale, "cr.s.reviewT")} sub={t(locale, "cr.s.reviewB")} />
                  <div className="space-y-1 rounded-xl bg-zinc-50 p-3 font-mono text-[13px] dark:bg-zinc-900">
                    <div className="flex justify-between"><span className="font-sans text-zinc-500">To</span><span className="break-all text-right">{dest.slice(0, 20)}…</span></div>
                    <div className="flex justify-between"><span className="font-sans text-zinc-500">Amount</span><span>{(sats / SATS).toFixed(8)} {ccy} (${fiatOf(sats).toFixed(2)})</span></div>
                    <div className="flex justify-between"><span className="font-sans text-zinc-500">Network fee</span><span>{(feeSats / SATS).toFixed(8)}</span></div>
                    <div className="flex justify-between border-t border-zinc-200 pt-1 font-bold dark:border-zinc-800"><span className="font-sans font-medium text-zinc-500">Total</span><span>{((sats + feeSats) / SATS).toFixed(8)}</span></div>
                  </div>
                  {sendErr && <div className="rounded-lg bg-red-50 p-2 text-[13px] text-red-700 dark:bg-red-950 dark:text-red-300">{sendErr}</div>}
                  <button
                    onMouseDown={startHold} onMouseUp={endHold} onMouseLeave={endHold}
                    onTouchStart={startHold} onTouchEnd={endHold}
                    className="relative w-full overflow-hidden rounded-xl bg-zinc-900 py-3 text-sm font-bold text-white dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    <span className="absolute inset-y-0 left-0 bg-emerald-600/60" style={{ width: `${Math.round(hold * 100)}%` }} />
                    <span className="relative">{t(locale, "cr.s.hold")}</span>
                  </button>
                  <button onClick={() => { setWalletApproval(null); setWalletOpen(true); }} className="w-full rounded-xl border border-sky-500 py-2.5 text-sm font-bold text-sky-700 dark:text-sky-300">{t(locale, "cr.s.walletPay")}</button>
                  {walletApproval && <div className="rounded-lg bg-emerald-50 p-2 text-[13px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{t(locale, "cr.s.walletApproved")}: <span className="font-mono">{walletApproval}</span></div>}
                  <Btn small variant="outline" onClick={() => setSendStep("fee")}>←</Btn>
                </Card>
              )}
              {walletOpen && (
                <div className="fixed inset-0 z-30 overflow-auto bg-black/50 p-3" onClick={() => setWalletOpen(false)}>
                  <div onClick={(e) => e.stopPropagation()}>
                    <HotWallet
                      seed={seed}
                      intent={{ to: dest.trim(), amountMinor: sats, asset: ccy, note: "crypto-lab invoice" }}
                      onIntentDone={(r) => {
                        if (r) setWalletApproval(r.hash.slice(0, 18));
                        setWalletOpen(false);
                      }}
                      onExit={() => setWalletOpen(false)}
                    />
                  </div>
                </div>
              )}
              {sendStep === "pending" && flow && (
                <Card className="space-y-2 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{flow.stage === "done" ? `✓ ${t(locale, "cr.paid")}` : t(locale, "cr.mempool")}</span>
                    <span className="font-mono">{flow.depth}/{flow.confRequired}</span>
                  </div>
                  {mempool && <div className="text-[13px] text-zinc-500">queue #{String(mempool.payload.position)} · {String(mempool.payload.feeRateSatVb)} sat/vB</div>}
                  <div className="flex gap-1">
                    {[...Array(flow.confRequired)].map((_, i) => (
                      <span key={i} className={`h-2 flex-1 rounded ${i < flow.depth ? "bg-emerald-600" : "bg-zinc-200 dark:bg-zinc-800"}`} />
                    ))}
                  </div>
                  {typeof txHash === "string" && <div className="break-all font-mono text-[12px] text-zinc-500">{txHash}</div>}
                  {flow.stage === "mining" && <div className="text-[12px] text-zinc-500">{t(locale, "cr.s.minerNote")}</div>}
                  <div className="flex gap-1.5">
                    {flow.stage === "mining" && <Btn small onClick={mine}>{t(locale, "cr.mine")}</Btn>}
                    {flow.stage === "stuck" && <Btn small onClick={rbf}>{t(locale, "cr.rbf")}</Btn>}
                    {(flow.stage === "done" || flow.stage === "terminal") && (
                      <Btn small variant="outline" onClick={() => { flowRef.current = null; setSendStep("addr"); setDest(""); setAmtMajor(""); }}>{t(locale, "cr.s.again")}</Btn>
                    )}
                  </div>
                  {flow.stage === "terminal" && (
                    <div className="rounded-lg bg-red-50 p-2 text-[13px] text-red-800 dark:bg-red-950 dark:text-red-200">
                      {t(locale, lastType === "UNDERPAID" ? "cr.underpaidT" : lastType === "WRONG_ADDRESS" ? "cr.wrongAddrT" : "cr.expiredT")}
                    </div>
                  )}
                </Card>
              )}
            </div>
          )}

          {tab === "transfer" && wallet && (
            <div className="mx-auto max-w-[380px] space-y-2">
              <div className="grid grid-cols-2 gap-1.5">
                {(["A", "B"] as const).map((w) => {
                  const x = tW(w);
                  return (
                    <Card key={w} className="space-y-1 p-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold text-white ${w === "A" ? "bg-sky-600" : "bg-teal-600"}`}>{w}</span>
                        <b className="text-[13px]">{t(locale, w === "A" ? "cr.tr.walletA" : "cr.tr.walletB")}</b>
                      </div>
                      {x ? (
                        <>
                          <div className="font-mono text-[12px]">{(x.balBtc / SATS).toFixed(8)} BTC</div>
                          <div className="font-mono text-[12px]">{(x.balUsdt / SATS).toFixed(2)} USDT</div>
                          <div className="font-mono text-[10px] text-zinc-500">{shortAddr(tAddr(w, tAsset))}</div>
                        </>
                      ) : (
                        <div className="text-[12px] text-zinc-500">{t(locale, w === "A" ? "cr.w.createT" : "cr.tr.secondT")}</div>
                      )}
                    </Card>
                  );
                })}
              </div>
              {tStep === "form" && (
                <Card className="space-y-2 p-3">
                  <StepHead title={t(locale, "cr.tr.title")} sub={t(locale, "cr.tr.sub")} />
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "cr.tr.from")}</span>
                      <select className={inpCls} value={tFrom} onChange={(e) => setTFrom(e.target.value as "A" | "B")}>
                        <option value="A">{t(locale, "cr.tr.walletA")}</option>
                        <option value="B">{t(locale, "cr.tr.walletB")}</option>
                      </select></label>
                    <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "cr.tr.to")}</span>
                      <select className={inpCls} value={tTo} onChange={(e) => setTTo(e.target.value as "A" | "B" | "ext")}>
                        <option value="A">{t(locale, "cr.tr.walletA")}</option>
                        <option value="B">{t(locale, "cr.tr.walletB")}</option>
                        <option value="ext">{t(locale, "cr.tr.extAddr")}</option>
                      </select></label>
                  </div>
                  <div className="flex gap-1.5" role="group" aria-label="asset">
                    {(["BTC", "USDT"] as const).map((a) => (
                      <button key={a} onClick={() => setTAsset(a)} className={`flex-1 rounded-lg border py-1.5 font-mono text-sm font-bold ${tAsset === a ? "border-sky-500 bg-sky-50 dark:bg-sky-950" : "border-zinc-200 dark:border-zinc-800"}`}>{a}</button>
                    ))}
                  </div>
                  <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "cr.tr.amount")} ({tAsset})</span>
                    <div className="flex gap-1.5">
                      <input dir="ltr" inputMode="decimal" className={`${inpCls} flex-1 font-mono`} value={tAmt} onChange={(e) => setTAmt(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="0.00" autoComplete="off" />
                      <Btn small variant="outline" onClick={maxT}>{t(locale, "cr.tr.max")}</Btn>
                    </div></label>
                  {tTo === "ext" && (
                    <input dir="ltr" className={`${inpCls} font-mono text-[12px]`} value={tDest} onChange={(e) => setTDest(e.target.value.trim())} placeholder={t(locale, "cr.tr.extPh")} autoComplete="off" />
                  )}
                  <div className="font-mono text-[12px] text-zinc-500">{t(locale, "cr.tr.feeNote")}: {(tFee / SATS).toFixed(8)} {tAsset}</div>
                  {tErr && <div className="rounded-lg bg-red-50 p-2 text-[13px] text-red-700 dark:bg-red-950 dark:text-red-300">{tErr}</div>}
                  <Btn onClick={confirmTransfer} disabled={tBusy}>{t(locale, "cr.tr.confirm")}</Btn>
                </Card>
              )}
              {tStep === "pending" && flowTr && (
                <Card className="space-y-2 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{t(locale, "cr.tr.pendingT")}</span>
                    <span className="font-mono">{flowTr.depth}/{flowTr.confRequired}</span>
                  </div>
                  {mempoolT && <div className="text-[13px] text-zinc-500">queue #{String(mempoolT.payload.position)} · {String(mempoolT.payload.feeRateSatVb)} sat/vB</div>}
                  <div className="flex gap-1">
                    {[...Array(flowTr.confRequired)].map((_, i) => (
                      <span key={i} className={`h-2 flex-1 rounded ${i < flowTr.depth ? "bg-emerald-600" : "bg-zinc-200 dark:bg-zinc-800"}`} />
                    ))}
                  </div>
                  {typeof txHashT === "string" && <div className="break-all font-mono text-[12px] text-zinc-500">{txHashT}</div>}
                  <div className="text-[12px] text-zinc-500">{t(locale, "cr.s.minerNote")}</div>
                  <div className="flex gap-1.5">
                    <Btn small variant="outline" onClick={resetT}>←</Btn>
                    {flowTr.stage === "mining" && <Btn small onClick={mineT}>{t(locale, "cr.mine")}</Btn>}
                    {flowTr.stage === "stuck" && <Btn small onClick={rbfT}>{t(locale, "cr.rbf")}</Btn>}
                  </div>
                </Card>
              )}
              {tStep === "done" && tSnap && (
                <Card className="space-y-1.5 p-3 text-sm">
                  <div className="font-semibold">✓ {t(locale, "cr.tr.doneT")}</div>
                  <div className="space-y-1 rounded-xl bg-zinc-50 p-3 font-mono text-[13px] dark:bg-zinc-900">
                    <div className="flex justify-between gap-2"><span className="font-sans text-zinc-500">{t(locale, "cr.tr.from")} {tSnap.from}</span><span className="break-all text-right">{shortAddr(tAddr(tSnap.from, tSnap.asset))}</span></div>
                    <div className="flex justify-between gap-2"><span className="font-sans text-zinc-500">{t(locale, "cr.tr.to")}</span><span className="break-all text-right">{tSnap.toLabel}</span></div>
                    <div className="flex justify-between"><span className="font-sans text-zinc-500">{t(locale, "cr.tr.amount")}</span><span>{(tSnap.amount / SATS).toFixed(8)} {tSnap.asset}</span></div>
                    <div className="flex justify-between"><span className="font-sans text-zinc-500">{t(locale, "cr.feeTier")}</span><span>{(tSnap.fee / SATS).toFixed(8)}</span></div>
                    <div className="flex justify-between border-t border-zinc-200 pt-1 dark:border-zinc-800"><span className="font-sans font-medium text-zinc-500">{t(locale, "cr.tr.fromBal")}</span><span>{(tSnap.fromBefore / SATS).toFixed(8)} → {(tSnap.fromAfter / SATS).toFixed(8)}</span></div>
                    {tTo === "ext"
                      ? <div className="text-[12px] text-zinc-500">{t(locale, "cr.tr.extNote")}</div>
                      : <div className="flex justify-between border-t border-zinc-200 pt-1 dark:border-zinc-800"><span className="font-sans font-medium text-zinc-500">{t(locale, "cr.tr.toBal")}</span><span>{(tSnap.toBefore / SATS).toFixed(8)} → {(tSnap.toAfter / SATS).toFixed(8)}</span></div>}
                  </div>
                  <div className="break-all font-mono text-[11px] text-zinc-500">{tSnap.txId}</div>
                  <div className="flex gap-1.5">
                    <Btn small variant="outline" onClick={resetT}>{t(locale, "cr.tr.again")}</Btn>
                    <Btn small onClick={() => setTab("activity")}>{t(locale, "cr.tr.viewAct")}</Btn>
                  </div>
                </Card>
              )}
            </div>
          )}

          {tab === "receive" && wallet && (
            <Card className="space-y-2 p-3 text-center">
              <StepHead title={t(locale, "cr.r.title")} sub={t(locale, "cr.r.sub")} />
              <div className="mx-auto w-fit bg-white p-3"><QRCode value={chain === "btc-like" ? wallet.addrBtc : wallet.addrEvm} size={160} /></div>
              <div className="break-all font-mono text-[13px]">{chain === "btc-like" ? wallet.addrBtc : wallet.addrEvm}</div>
              <div className="flex justify-center gap-1.5">
                <Btn small variant="outline" onClick={() => { try { void navigator.clipboard.writeText(chain === "btc-like" ? wallet.addrBtc : wallet.addrEvm); } catch { /* noop */ } }}>{t(locale, "cr.r.copy")}</Btn>
              </div>
              <div className="text-[12px] text-zinc-500">{t(locale, "cr.r.warn")}</div>
            </Card>
          )}

          {tab === "sell" && (
            <div className="space-y-2">
              <Card className="space-y-2 p-3">
                <StepHead title={t(locale, "cr.invTitle")} sub={t(locale, "cr.invSub")} />
                <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "cr.amount")} ($)</span>
                  <input dir="ltr" inputMode="decimal" className={`${inpCls} font-mono`} value={invFiat} onChange={(e) => setInvFiat(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="50.00" autoComplete="off" /></label>
                <div><Btn small onClick={makeInvoice}>{t(locale, "cr.create")}</Btn></div>
              </Card>
              {invoice && flow && (
                <Card className="space-y-1.5 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{t(locale, "cr.invoiceDue")}</span>
                    <span className="font-mono">{lockLeft > 0 ? `${Math.floor(lockLeft / 60)}:${String(lockLeft % 60).padStart(2, "0")}` : t(locale, "cr.lockOut")}</span>
                  </div>
                  <div className="break-all font-mono text-[12px]">{invoice.payload.address as string}</div>
                  <div className="font-mono font-bold">{(flow.ctx.amountMinor / SATS).toLocaleString(undefined, { maximumFractionDigits: 8 })} {ccy} (≈${(flow.ctx.amountMinor / SATS * rate).toFixed(2)})</div>
                  <div className="mx-auto w-fit bg-white p-2"><QRCode value={String(invoice.payload.address ?? "")} size={120} /></div>
                  <div><Btn small onClick={() => { setDest(flow.address); setAmtMajor(String((flow.ctx.amountMinor / SATS * rate).toFixed(2))); setAmtFiat(true); setSendStep("addr"); setTab("send"); }}>{t(locale, "cr.s.openWallet")}</Btn></div>
                </Card>
              )}
            </div>
          )}

          {tab === "activity" && (
            <Card className="space-y-2 p-3">
              <div className="font-semibold">{t(locale, "co.orders.title")}</div>
              {wallet.credits.map((c, i) => (
                <div key={`c${i}`} className="flex items-center gap-2 rounded-lg bg-zinc-50 p-2 text-[13px] dark:bg-zinc-900">
                  <div className="flex-1">
                    <div className="font-mono font-bold text-emerald-700 dark:text-emerald-300">+{c.amount / SATS} {c.asset}</div>
                    <div className="text-zinc-500"><Time at={c.at} /> · {t(locale, "cr.w.faucet")}</div>
                  </div>
                </div>
              ))}
              {[...wallet.history].reverse().map((h, i) => (
                <div key={`h${i}`} className="flex items-center gap-2 rounded-lg bg-zinc-50 p-2 text-[13px] dark:bg-zinc-900">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-600 text-[10px] font-bold text-white">A</span>
                  <div className="flex-1">
                    <div className={`font-mono font-bold ${h.dir === "in" ? "text-emerald-700 dark:text-emerald-300" : ""}`}>{h.dir === "in" ? "+" : "−"}{formatMoney(h.amount, h.asset, locale)}</div>
                    <div className="break-all text-zinc-500"><Time at={h.at} /> · <span className="font-mono text-[11px]">{shortAddr(h.addr)}</span></div>
                  </div>
                </div>
              ))}
              {walletB && walletB.credits.map((c, i) => (
                <div key={`bc${i}`} className="flex items-center gap-2 rounded-lg bg-zinc-50 p-2 text-[13px] dark:bg-zinc-900">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-600 text-[10px] font-bold text-white">B</span>
                  <div className="flex-1">
                    <div className="font-mono font-bold text-emerald-700 dark:text-emerald-300">+{c.amount / SATS} {c.asset}</div>
                    <div className="text-zinc-500"><Time at={c.at} /> · {t(locale, "cr.w.faucet")}</div>
                  </div>
                </div>
              ))}
              {walletB && [...walletB.history].reverse().map((h, i) => (
                <div key={`bh${i}`} className="flex items-center gap-2 rounded-lg bg-zinc-50 p-2 text-[13px] dark:bg-zinc-900">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-600 text-[10px] font-bold text-white">B</span>
                  <div className="flex-1">
                    <div className={`font-mono font-bold ${h.dir === "in" ? "text-emerald-700 dark:text-emerald-300" : ""}`}>{h.dir === "in" ? "+" : "−"}{formatMoney(h.amount, h.asset, locale)}</div>
                    <div className="break-all text-zinc-500"><Time at={h.at} /> · <span className="font-mono text-[11px]">{shortAddr(h.addr)}</span></div>
                  </div>
                </div>
              ))}
              {orders.length === 0 && wallet.credits.length === 0 && wallet.history.length === 0 && (!walletB || (walletB.credits.length === 0 && walletB.history.length === 0)) && <EmptyNote>{t(locale, "co.orders.empty")}</EmptyNote>}
              {orders.map((o) => (
                <div key={o.id} className="flex items-center gap-2 rounded-lg bg-zinc-50 p-2 text-[13px] dark:bg-zinc-900">
                  <div className="flex-1">
                    <div className="font-mono font-bold">−{formatMoney(o.result.receipt.amountMinor, o.result.receipt.currency, locale)}</div>
                    <div className="text-zinc-500"><Time at={o.at} /> · {o.result.events.length} events</div>
                  </div>
                  <Badge tone={o.result.finalState === "SETTLED" ? "green" : "red"}>{o.result.finalState}</Badge>
                </div>
              ))}
            </Card>
          )}
        </>
      ) : (
        <Card className="mx-auto max-w-[380px] space-y-2 p-4 text-center">
          <div className="font-bold">{t(locale, "cr.w.createT")}</div>
          <div className="text-[13px] text-zinc-500">{t(locale, "cr.w.createB")}</div>
          <Btn onClick={createWallet}>{t(locale, "cr.w.create")}</Btn>
        </Card>
      )}
    </div>
  );
}

function VerifySeed({ words, onDone }: { words: string[]; onDone: (ok: boolean) => void }) {
  const { locale } = usePrefs();
  const [picks, setPicks] = useState<string[]>(["", "", ""]);
  const [wrong, setWrong] = useState(false);
  const POS = [1, 6, 10];
  const options = (pos: number): string[] => {
    const correct = words[pos] ?? "";
    const pool = FAKE_WORD_LIST.filter((w) => w !== correct);
    const out = [correct];
    let h = 7 + pos * 131;
    while (out.length < 4) {
      h = (h * 1103515245 + 12345) & 0x7fffffff;
      const w = pool[h % pool.length];
      if (!out.includes(w)) out.push(w);
    }
    return out.sort();
  };
  return (
    <Card className="mx-auto max-w-[380px] space-y-2 p-4">
      <div className="font-bold">{t(locale, "cu.pickW")}</div>
      {POS.map((pos, i) => (
        <label key={pos} className="block text-[13px]">#{pos + 1}
          <select className={inpCls} value={picks[i]} onChange={(e) => setPicks(picks.map((p, j) => (j === i ? e.target.value : p)))}>
            <option value="">—</option>
            {options(pos).map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </label>
      ))}
      <Btn small onClick={() => {
        const ok = POS.every((pos, i) => picks[i] === words[pos]);
        setWrong(!ok);
        onDone(ok);
      }}>{t(locale, "cu.verify")}</Btn>
      {wrong && <div className="text-[13px] text-red-700 dark:text-red-400">{t(locale, "cr.w.verifyBad")}</div>}
    </Card>
  );
}
