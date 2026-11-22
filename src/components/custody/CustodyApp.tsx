/**
 * Custody app: hot wallet vs air-gapped cold wallet, side by side.
 * Hot signs online. Cold ferries unsigned/signed payloads by mock QR and —
 * the core lesson — the student verifies the address on the device screen.
 * Their own comparison catches the swap or loses the funds. Seed drill
 * included. All keys FAKE, all chains fake.
 */
"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import {
  FAKE_WORD_LIST,
  createCustodyFlow,
  createRunBase,
  custodyAdvance,
  custodyResult,
  type CustodyFlow,
  type FailureId,
  type RunResult
} from "@sim/engine";
import { t } from "@/i18n/dict";
import { formatMoney, listSessions, saveSession, type StoredSession } from "@/lib/sim";
import { usePrefs } from "../providers";
import { HotWallet } from "../hotwallet/HotWallet";
import { ColdWallet } from "./ColdWallet";
import { Badge, Btn, Card } from "../ui";
import { EmptyNote, StepHead, Time, inpCls, useSpecReset } from "../flows/kit";

type Tab = "hot" | "cold" | "device" | "recover" | "activity";
const SATS = 100_000_000;
const PICK_POS = [1, 6, 10];

export function CustodyApp({ seed, params, failures, onLive }: {
  seed: number;
  params: Record<string, unknown>;
  failures: FailureId[];
  onLive: (r: RunResult) => void;
}) {
  const { locale } = usePrefs();
  const [tab, setTab] = useState<Tab>("hot");
  const [amount, setAmount] = useState("");
  const [multisig, setMultisig] = useState(false);
  const [dest, setDest] = useState("");
  const [written, setWritten] = useState(false);
  const [picks, setPicks] = useState<string[]>(["", "", ""]);
  const [orders, setOrders] = useState<StoredSession[]>([]);
  const [fullWallet, setFullWallet] = useState(false);

  const flowRef = useRef<CustodyFlow | null>(null);
  const savedRef = useRef(false);
  const CCY = "BTC";

  useSpecReset(JSON.stringify({ seed, params, failures }), () => {
    flowRef.current = null;
    savedRef.current = false;
    setWritten(false);
    setPicks(["", "", ""]);
  });
  useEffect(() => {
    if (tab === "activity") setOrders(listSessions().filter((s) => s.spec.moduleId === "custody"));
  }, [tab]);

  const push = (): RunResult => {
    const r = custodyResult(flowRef.current!);
    onLive(r);
    return r;
  };
  const maybeSave = () => {
    const flow = flowRef.current;
    if (!flow || savedRef.current) return;
    if (flow.stage !== "done" && flow.stage !== "terminal") return;
    savedRef.current = true;
    saveSession({ moduleId: "custody", seed, params: { ...params, amountMinor: flow.ctx.amountMinor, multisig: multisig ? "2-of-3" : "off" }, failures }, custodyResult(flow));
  };

  const generate = () => {
    const minor = Math.round(Number(amount.replace(",", ".")) * SATS);
    if (!(minor > 0)) return;
    const base = createRunBase("custody", { seed, params: { ...params, amountMinor: minor }, failures });
    const flow = createCustodyFlow(base);
    flowRef.current = flow;
    savedRef.current = false;
    custodyAdvance(flow, { type: "gen_seed" });
    push();
    setWritten(false);
    setPicks(["", "", ""]);
  };

  const choose = (path: "hot" | "cold") => {
    const flow = flowRef.current;
    if (!flow || dest.trim().length < 6) return;
    try {
      custodyAdvance(flow, { type: "choose", path, dest: dest.trim() });
      push();
    } catch { /* validation message stays inline */ }
  };

  const confirm = (kind: "hot_confirm" | "cold_send") => {
    const flow = flowRef.current;
    if (!flow) return;
    custodyAdvance(flow, { type: kind });
    push();
    maybeSave();
  };

  const check = (match: boolean) => {
    const flow = flowRef.current;
    if (!flow) return;
    custodyAdvance(flow, { type: "device_check", match });
    push();
    maybeSave();
  };

  const verifyBackup = () => {
    const flow = flowRef.current;
    if (!flow) return;
    custodyAdvance(flow, { type: "recover", checks: PICK_POS.map((pos, i) => ({ pos, word: picks[i] })) });
    push();
    maybeSave();
  };

  const flow = flowRef.current;
  const words = flow?.words ?? [];
  const deviceAddr = flow?.swapTo ?? flow?.dest ?? "";
  const compromised = flow?.ctx.events.some((e) => e.type === "HOT_COMPROMISED") ?? false;
  const lastType = flow ? flow.ctx.events[flow.ctx.events.length - 1]?.type : null;

  const distractors = (pos: number): string[] => {
    const correct = words[pos] ?? "";
    const pool = FAKE_WORD_LIST.filter((w) => w !== correct);
    const picks3: string[] = [];
    let h = seed + pos * 97;
    while (picks3.length < 3 && pool.length > 0) {
      h = (h * 1103515245 + 12345) & 0x7fffffff;
      const w = pool[h % pool.length];
      if (!picks3.includes(w)) picks3.push(w);
    }
    return [correct, ...picks3].sort();
  };

  return (
    <div className="space-y-2">
      {fullWallet && (
        <HotWallet seed={seed} onExit={() => setFullWallet(false)} />
      )}
      {!fullWallet && (
        <>
      <div className="flex flex-wrap gap-1">
        {(["hot", "cold", "device", "recover", "activity"] as const).map((x) => (
          <button key={x} onClick={() => setTab(x)} className={`rounded-lg px-3 py-1 text-sm ${tab === x ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}>
            {t(locale, `cu.tab.${x}`)}
          </button>
        ))}
      </div>

      {tab === "device" && (
        <ColdWallet seed={seed} failures={failures} />
      )}

      {(tab === "hot" || tab === "cold") && (!flow || flow.stage === "fresh") && (
        <Card className="space-y-2 p-3">
          <StepHead title={t(locale, "cu.showSeed")} sub={t(locale, "cu.seedSub")} />
          <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "cu.amount")} (BTC)</span>
            <input dir="ltr" inputMode="decimal" className={`${inpCls} font-mono`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="0.001" autoComplete="off" /></label>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={multisig} onChange={(e) => setMultisig(e.target.checked)} />
            {t(locale, "cu.multisig")}
          </label>
          <div><Btn small onClick={generate}>{t(locale, "cu.showSeed")}</Btn></div>
        </Card>
      )}

      {flow && flow.stage !== "fresh" && flow.stage !== "terminal" && flow.stage !== "done" && tab !== "recover" && tab !== "activity" && (
        <Card className="p-3">
          <div className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">{t(locale, "cu.seedTitle")}</div>
          <div className="mt-1 grid grid-cols-3 gap-1 font-mono text-[13px]">
            {words.map((w, i) => <span key={i} className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{i + 1}. {w}</span>)}
          </div>
        </Card>
      )}

      {tab === "hot" && flow && (flow.stage === "seeded" || flow.stage === "hotconfirm") && (
        <Card className="space-y-2 p-3">
          <div className="rounded-lg bg-amber-50 p-2 text-[13px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">{t(locale, "cu.hotWarn")}</div>
          {flow.stage === "seeded" && (
            <>
              <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "cu.dest")}</span>
                <input dir="ltr" className={`${inpCls} font-mono text-[12px]`} value={dest} onChange={(e) => setDest(e.target.value.trim())} placeholder="sim1…" autoComplete="off" /></label>
              <Btn small onClick={() => choose("hot")}>{t(locale, "cu.review")}</Btn>
            </>
          )}
          {flow.stage === "hotconfirm" && (
            <>
              <div className="text-sm">{t(locale, "cu.dest")}: <span className="break-all font-mono text-[12px]">{flow.dest}</span></div>
              <div className="font-mono font-bold">{formatMoney(flow.ctx.amountMinor, CCY, locale)}</div>
              {compromised && <div className="rounded-lg bg-red-50 p-2 text-[13px] text-red-700 dark:bg-red-950 dark:text-red-300">HOT_COMPROMISED — {t(locale, "cu.hotWarn")}</div>}
              <Btn small onClick={() => confirm("hot_confirm")}>{t(locale, "cu.signSend")}</Btn>
            </>
          )}
        </Card>
      )}

      {tab === "cold" && flow && (flow.stage === "seeded" || flow.stage === "verify" || flow.stage === "coldconfirm") && (
        <div className="space-y-2">
          {flow.stage === "seeded" && (
            <Card className="space-y-2 p-3">
              <StepHead title={t(locale, "cu.watchTitle")} sub={t(locale, "cu.coldSub")} />
              <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "cu.dest")}</span>
                <input dir="ltr" className={`${inpCls} font-mono text-[12px]`} value={dest} onChange={(e) => setDest(e.target.value.trim())} placeholder="sim1…" autoComplete="off" /></label>
              <div><Btn small onClick={() => choose("cold")}>{t(locale, "cu.buildUnsigned")}</Btn></div>
              <div className="font-mono font-bold">{formatMoney(flow.ctx.amountMinor, CCY, locale)}</div>
            </Card>
          )}
          {(flow.stage === "verify" || flow.stage === "coldconfirm") && (
            <>
              <div className="mx-auto max-w-[300px] rounded-2xl border border-zinc-300 bg-zinc-50 p-3 text-center dark:border-zinc-700 dark:bg-zinc-900">
                <div className="text-[11px] uppercase tracking-widest text-zinc-500">{t(locale, "cu.deviceTitle")}</div>
                <div className="mt-1 break-all font-mono text-[13px]">{deviceAddr}</div>
                <div className="mt-1 font-mono font-bold">{formatMoney(flow.ctx.amountMinor, CCY, locale)}</div>
                {flow.stage === "verify" && (
                  <>
                    <div className="mt-1 text-[12px] text-zinc-500">{t(locale, "cu.verifyAsk")}</div>
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      <button onClick={() => check(true)} className="rounded-xl bg-zinc-900 py-2 text-[13px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">{t(locale, "cu.match")}</button>
                      <button onClick={() => check(false)} className="rounded-xl border border-red-400 py-2 text-[13px] font-bold text-red-700 dark:text-red-300">{t(locale, "cu.mismatch")}</button>
                    </div>
                  </>
                )}
                {flow.stage === "coldconfirm" && (
                  <div className="mt-2 space-y-1.5">
                    <div className="text-[13px] text-emerald-700 dark:text-emerald-300">{t(locale, "cu.signedBack")}</div>
                    <div className="mx-auto w-fit bg-white p-2"><QRCode value={`signed:${flow.dest}`} size={110} /></div>
                    <button onClick={() => confirm("cold_send")} className="w-full rounded-xl bg-zinc-900 py-2 text-[13px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">{t(locale, "cu.broadcast")}</button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {flow && flow.stage === "done" && (
        <Card className="space-y-1 p-3">
          <div className="font-semibold text-emerald-700 dark:text-emerald-300">✓ {t(locale, "cu.confirmed")}</div>
          <div className="font-mono text-[12px] text-zinc-500">{flow.ctx.events.length} events · {flow.ctx.txId}</div>
          <div><Btn small variant="outline" onClick={() => { flowRef.current = null; setDest(""); setTab("hot"); }}>{t(locale, "cu.newWallet")}</Btn></div>
        </Card>
      )}
      {flow && flow.stage === "terminal" && (
        <Card className="space-y-1 p-3">
          <div className="font-semibold text-red-700 dark:text-red-400">✕ {lastType === "FUNDS_LOST" ? t(locale, "cu.lostT") : lastType === "SWAP_STOPPED" ? t(locale, "cu.stoppedT") : t(locale, "co.no.title")}</div>
          <div className="text-[13px] text-zinc-600 dark:text-zinc-400">
            {lastType === "FUNDS_LOST" ? t(locale, "cu.lostB") : lastType === "SWAP_STOPPED" ? t(locale, "cu.stoppedB") : t(locale, "cu.seedLostB")}
          </div>
          <div><Btn small variant="outline" onClick={() => { flowRef.current = null; setDest(""); setTab("hot"); }}>{t(locale, "cu.newWallet")}</Btn></div>
        </Card>
      )}

      {tab === "recover" && (
        <Card className="space-y-2 p-3">
          <StepHead title={t(locale, "cu.tab.recover")} sub={t(locale, "cu.seedSub")} />
          {words.length === 0 && <EmptyNote>{t(locale, "cu.showSeed")}</EmptyNote>}
          {words.length > 0 && !written && (
            <>
              <div className="grid grid-cols-3 gap-1 font-mono text-[13px]">
                {words.map((w, i) => <span key={i} className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{i + 1}. {w}</span>)}
              </div>
              <Btn small onClick={() => setWritten(true)}>{t(locale, "cu.wrote")}</Btn>
            </>
          )}
          {words.length > 0 && written && flow && flow.stage === "seeded" && (
            <div className="space-y-2">
              <div className="text-sm font-medium">{t(locale, "cu.pickW")}</div>
              {PICK_POS.map((pos, i) => (
                <label key={pos} className="block text-[13px]">#{pos + 1}
                  <select className={inpCls} value={picks[i]} onChange={(e) => setPicks(picks.map((p, j) => (j === i ? e.target.value : p)))}>
                    <option value="">—</option>
                    {(distractors(pos)).map((w) => <option key={w} value={w}>{w}</option>)}
                  </select>
                </label>
              ))}
              <Btn small onClick={verifyBackup}>{t(locale, "cu.verify")}</Btn>
            </div>
          )}
          {flow?.ctx.events.some((e) => e.type === "RECOVERED") && (
            <div className="font-semibold text-emerald-700 dark:text-emerald-300">✓ {t(locale, "cu.recovered")}</div>
          )}
        </Card>
      )}

      {tab === "activity" && (
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
        </Card>
      )}
      {tab === "hot" && !fullWallet && (
        <div><Btn small variant="outline" onClick={() => setFullWallet(true)}>{t(locale, "cu.openWallet")}</Btn></div>
      )}
        </>
      )}
    </div>
  );
}
