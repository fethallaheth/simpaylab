/**
 * NFC contactless scene. A mock smartphone is dragged (pointer + touch) onto
 * a mock terminal; real on-screen proximity triggers the tap. Phone, terminal
 * and receipt all render from the staged engine log: detected ->
 * authenticate -> processing -> approved/declined -> push notification.
 */
"use client";
import { useEffect, useRef, useState } from "react";
import {
  createNfcFlow,
  createRunBase,
  nfcAdvance,
  nfcResult,
  type FailureId,
  type NfcFlow,
  type RunResult
} from "@sim/engine";
import { t } from "@/i18n/dict";
import { formatMoney, listSessions, saveSession, type StoredSession } from "@/lib/sim";
import { usePrefs } from "../providers";
import { Badge, Btn, Card } from "../ui";
import { EmptyNote, StepHead, Time, inpCls, useSpecReset } from "../flows/kit";

type Phase = "drag" | "fly" | "detected" | "auth" | "processing" | "result";
const NEAR_PX = 90;

export function NfcApp({ seed, params, failures, onLive }: {
  seed: number;
  params: Record<string, unknown>;
  failures: FailureId[];
  onLive: (r: RunResult) => void;
}) {
  const { locale } = usePrefs();
  const [merchant, setMerchant] = useState("");
  const [item, setItem] = useState("");
  const [till, setTill] = useState("");
  const [online, setOnline] = useState(true);
  const [screen, setScreen] = useState<"till" | "scene">("till");
  const [phase, setPhase] = useState<Phase>("drag");
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [near, setNear] = useState(false);
  const [snapping, setSnapping] = useState(false);
  const [leds, setLeds] = useState(0);
  const [notifIn, setNotifIn] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [orders, setOrders] = useState<StoredSession[]>([]);
  const [showHist, setShowHist] = useState(false);

  const flowRef = useRef<NfcFlow | null>(null);
  const savedRef = useRef(false);
  const timers = useRef<number[]>([]);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const phoneRef = useRef<HTMLDivElement | null>(null);
  const phoneNfcRef = useRef<HTMLDivElement | null>(null);
  const termNfcRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const locked = useRef(false);
  const CCY = "EUR";

  const say = (key: string) => setAnnounce(t(locale, key));

  useEffect(() => () => { timers.current.forEach((id) => window.clearTimeout(id)); }, []);
  useSpecReset(JSON.stringify({ seed, params, failures, online }), () => {
    flowRef.current = null;
    savedRef.current = false;
    locked.current = false;
    setScreen("till");
    setPhase("drag");
    setPos(null);
    setNear(false);
    setNotifIn(false);
  });

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const push = (): RunResult => {
    const r = nfcResult(flowRef.current!);
    onLive(r);
    return r;
  };
  const maybeSave = () => {
    const flow = flowRef.current;
    if (!flow || savedRef.current) return;
    if (flow.stage !== "done" && flow.stage !== "terminal") return;
    savedRef.current = true;
    saveSession({ moduleId: "nfc", seed, params: { ...params, amountMinor: flow.ctx.amountMinor, linkOnline: online ? "online" : "offline" }, failures }, nfcResult(flow));
  };

  const pending = useRef<{ amount: number } | null>(null);
  const setup = () => {
    const minor = Math.round(Number(till.replace(",", ".")) * 100);
    if (!(minor > 0) || merchant.trim().length < 2) return;
    pending.current = { amount: minor };
    setScreen("scene");
    setPhase("drag");
    setPos(null);
    setNotifIn(false);
  };

  const startSession = () => {
    const amount = pending.current?.amount ?? 0;
    const base = createRunBase("nfc", { seed, params: { ...params, amountMinor: amount, linkOnline: online ? "online" : "offline" }, failures });
    const flow = createNfcFlow(base);
    flowRef.current = flow;
    savedRef.current = false;
    nfcAdvance(flow, { type: "setup", amountMinor: amount });
    push();
    return flow;
  };

  const measureNear = (): boolean => {
    const a = phoneNfcRef.current?.getBoundingClientRect();
    const b = termNfcRef.current?.getBoundingClientRect();
    if (!a || !b) return false;
    const dx = a.left + a.width / 2 - (b.left + b.width / 2);
    const dy = a.top + a.height / 2 - (b.top + b.height / 2);
    return Math.hypot(dx, dy) < NEAR_PX;
  };

  const dockPos = (): { x: number; y: number } | null => {
    const scene = sceneRef.current?.getBoundingClientRect();
    const term = termNfcRef.current?.getBoundingClientRect();
    const phone = phoneRef.current?.getBoundingClientRect();
    if (!scene || !term || !phone) return null;
    // place the phone's NFC dot onto the terminal's NFC dot
    const dot = phoneNfcRef.current?.getBoundingClientRect();
    const ox = dot ? dot.left - phone.left : phone.width / 2;
    const oy = dot ? dot.top - phone.top : 8;
    return {
      x: term.left + term.width / 2 - ox - scene.left,
      y: term.top + term.height / 2 - oy - scene.top
    };
  };

  const triggerTap = () => {
    const flow = flowRef.current ?? startSession();
    if (flow.stage !== "ready" || locked.current) return;
    locked.current = true;
    try {
      nfcAdvance(flow, { type: "tap", method: "phone" });
      push();
    } catch {
      locked.current = false;
      return;
    }
    setPhase("detected");
    say("nf.scene.detected");
    later(650, () => {
      if (flow.stage === "cvm") {
        setPhase("auth");
      } else {
        runProcessing(flow);
      }
    });
  };

  const runProcessing = (flow: NfcFlow) => {
    setPhase("processing");
    let i = 0;
    setLeds(0);
    const tick = window.setInterval(() => {
      i += 1;
      setLeds(i);
      if (i >= 4) {
        window.clearInterval(tick);
        setPhase("result");
        say(flow.stage === "done" ? "nf.approved" : "co.no.title");
        if (flow.stage === "done") later(350, () => setNotifIn(true));
        maybeSave();
      }
    }, 320);
    timers.current.push(tick);
  };

  const snapAndTap = () => {
    const d = dockPos();
    if (d) {
      setSnapping(true);
      setPos(d);
      later(380, () => {
        setSnapping(false);
        triggerTap();
      });
    } else {
      triggerTap();
    }
  };

  // ---- drag handlers (pointer events cover mouse + touch) ----
  const onDown = (e: React.PointerEvent) => {
    if (locked.current || phase !== "drag" || !sceneRef.current || !phoneRef.current) return;
    const scene = sceneRef.current.getBoundingClientRect();
    const phone = phoneRef.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - phone.left, dy: e.clientY - phone.top };
    if (pos === null) {
      setPos({ x: phone.left - scene.left, y: phone.top - scene.top });
    }
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !sceneRef.current || locked.current || phase !== "drag") return;
    const scene = sceneRef.current.getBoundingClientRect();
    setPos({
      x: e.clientX - scene.left - drag.current.dx,
      y: e.clientY - scene.top - drag.current.dy
    });
    // measure after paint
    requestAnimationFrame(() => setNear(measureNear()));
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (locked.current || phase !== "drag") return;
    if (measureNear()) snapAndTap();
    else setNear(false);
  };

  const keyboardTap = () => {
    if (locked.current || phase !== "drag") return;
    snapAndTap();
  };

  const bio = (ok: boolean) => {
    const flow = flowRef.current;
    if (!flow) return;
    nfcAdvance(flow, { type: "unlock", ok });
    push();
    if (flow.stage === "cvm") return;
    runProcessing(flow);
  };

  const cancelTap = () => {
    // abandoned before approval: nothing charged, log keeps the partial tap
    flowRef.current = null;
    locked.current = false;
    setPhase("drag");
    setPos(null);
    setNear(false);
    setSnapping(false);
    say("nf.scene.unpaid");
  };

  const retry = () => {
    flowRef.current = null;
    locked.current = false;
    setPhase("drag");
    setPos(null);
    setNear(false);
    setSnapping(false);
    setNotifIn(false);
  };

  const flow = flowRef.current;
  const result = flow && phase === "result" ? nfcResult(flow) : null;
  const approved = result?.finalState === "SETTLED";
  const declineOf = (): string | null => {
    const evs = [...(flow?.ctx.events ?? [])].reverse();
    const d = evs.find((e) => /DECLINED/.test(e.type));
    if (!d) return null;
    const r = String((d.payload as Record<string, unknown>).reason ?? "");
    if (r === "over-floor") return t(locale, "nf.overFloor");
    if (r === "pin-locked") return t(locale, "wa.pinLocked");
    if (r === "insufficient-funds") return t(locale, "co.decline.insufficient-funds");
    return t(locale, "co.decline.issuer-decline");
  };
  const itemName = item.trim() || t(locale, "nf.scene.general");
  const techAid = [...(flow?.ctx.events ?? [])].find((e) => e.type === "APP_SELECTED")?.payload.aid;
  const techLimit = [...(flow?.ctx.events ?? [])].find((e) => e.type === "TERMINAL_READY")?.payload.limit;

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        <Btn small variant={showHist ? "primary" : "outline"} onClick={() => { setShowHist(!showHist); if (!showHist) setOrders(listSessions().filter((s) => s.spec.moduleId === "nfc")); }}>{t(locale, "co.ok.orders")}</Btn>
      </div>
      <div aria-live="polite" className="sr-only">{announce}</div>

      {showHist ? (
        <Card className="space-y-2 p-3">
          <div className="font-semibold">{t(locale, "co.orders.title")}</div>
          {orders.length === 0 && <EmptyNote>{t(locale, "co.orders.empty")}</EmptyNote>}
          {orders.map((o) => (
            <div key={o.id} className="flex items-center gap-2 rounded-lg bg-zinc-50 p-2 text-[13px] dark:bg-zinc-900">
              <div className="flex-1">
                <div className="font-mono font-bold">{formatMoney(o.result.receipt.amountMinor, o.result.receipt.currency, locale)}</div>
                <div className="text-zinc-500"><Time at={o.at} /></div>
              </div>
              <Badge tone={o.result.finalState === "SETTLED" ? "green" : "red"}>{o.result.finalState}</Badge>
            </div>
          ))}
        </Card>
      ) : screen === "till" ? (
        <Card className="space-y-2 p-3">
          <StepHead title={t(locale, "nf.tillTitle")} sub={t(locale, "nf.tillSub")} />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "nf.scene.merchant")}</span>
              <input className={inpCls} value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder={t(locale, "nf.scene.merchantPh")} autoComplete="off" /></label>
            <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "nf.scene.item")}</span>
              <input className={inpCls} value={item} onChange={(e) => setItem(e.target.value)} placeholder={t(locale, "nf.scene.itemPh")} autoComplete="off" /></label>
          </div>
          <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "nf.amount")} (EUR)</span>
            <input dir="ltr" inputMode="decimal" className={`${inpCls} font-mono`} value={till} onChange={(e) => setTill(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="8.50" autoComplete="off" /></label>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} />
            {t(locale, "nf.online")} <span className="text-zinc-500">({t(locale, "nf.limits")}: 50.00 / 25.00)</span>
          </label>
          <div><Btn small onClick={setup}>{t(locale, "nf.setTill")}</Btn></div>
        </Card>
      ) : (
        <div className="space-y-2">
          <Card className="flex flex-wrap items-center gap-2 p-3 text-sm">
            <div>
              <span className="font-bold">{merchant}</span>
              <span className="text-zinc-500"> · {itemName}</span>
            </div>
            <span className="ms-auto font-mono text-lg font-bold">{formatMoney(pending.current?.amount ?? 0, CCY, locale)}</span>
          </Card>

          <div ref={sceneRef} className="relative min-h-[430px] overflow-hidden rounded-2xl border border-zinc-200 bg-gradient-to-b from-zinc-50 to-zinc-100 p-3 dark:border-zinc-800 dark:from-zinc-900 dark:to-zinc-950 sm:min-h-[380px]">
            <div className="pointer-events-none absolute left-3 top-2 text-[12px] text-zinc-500">{phase === "drag" && !locked.current ? t(locale, "nf.scene.hold") : ""}</div>

            {/* terminal */}
            <div className="absolute right-3 top-1/2 w-40 -translate-y-1/2 sm:right-6 sm:w-48">
              <div className={`rounded-2xl border-2 bg-zinc-900 p-3 text-white shadow-xl transition-colors dark:bg-black ${near && phase === "drag" ? "border-sky-400" : "border-zinc-700"}`}>
                <div className="text-center text-[10px] uppercase tracking-widest opacity-60">{t(locale, "nf.terminal")}{flow && !flow.online ? ` · ${t(locale, "nf.offlineTag")}` : ""}</div>
                <div className="mt-1 min-h-[2.2rem] rounded-lg bg-zinc-800 p-1.5 text-center font-mono text-sm">
                  {phase === "result" && result ? (
                    approved ? <span className="font-bold text-emerald-400">✓ {t(locale, "nf.approved")}</span>
                      : <span className="font-bold text-red-400">✕</span>
                  ) : phase === "processing" ? (
                    <span className="animate-pulse">…</span>
                  ) : (
                    <span>{formatMoney(pending.current?.amount ?? 0, CCY, locale)}</span>
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div ref={termNfcRef} className="relative flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800">
                    <span className="text-lg text-zinc-300">)))</span>
                    {near && phase === "drag" && <span className="absolute inset-0 animate-ping rounded-full bg-sky-400/40" />}
                  </div>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map((i) => (
                      <span key={i} className={`h-2 w-2 rounded-full ${phase === "result" && approved ? "bg-emerald-400" : phase === "result" ? "bg-red-400" : i <= leds ? "bg-emerald-400" : "bg-zinc-700"}`} />
                    ))}
                  </div>
                </div>
                {phase === "processing" && (
                  <div className="mt-2 h-1 overflow-hidden rounded bg-zinc-800">
                    <div className="h-full w-1/2 animate-pulse rounded bg-sky-400" />
                  </div>
                )}
              </div>
            </div>

            {/* phone */}
            <div
              ref={phoneRef}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              role="button"
              tabIndex={phase === "drag" && !locked.current ? 0 : -1}
              aria-label={t(locale, "nf.scene.hold")}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); keyboardTap(); } }}
              className={`z-10 w-36 select-none sm:w-40 ${pos ? "absolute" : "absolute bottom-3 left-3 sm:bottom-4 sm:left-4"} ${snapping ? "transition-all duration-300" : ""}`}
              style={pos ? { left: pos.x, top: pos.y, touchAction: "none", cursor: locked.current ? "default" : "grab" } : { touchAction: "none", cursor: locked.current ? "default" : "grab" }}
            >
              <div className={`rounded-[1.6rem] border-2 bg-zinc-950 p-1.5 shadow-2xl transition-colors ${near && phase === "drag" ? "border-sky-400" : "border-zinc-700"}`}>
                <div ref={phoneNfcRef} className="mx-auto mt-0.5 flex h-5 w-12 items-center justify-center rounded-full bg-zinc-800">
                  <span className="text-[10px] text-zinc-300">)))</span>
                </div>
                <div className="mt-1 min-h-[190px] rounded-[1.1rem] bg-zinc-100 p-2 text-center text-zinc-900 dark:bg-zinc-100">
                  {phase === "auth" ? (
                    <div className="space-y-1.5 pt-2">
                      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-zinc-200 text-xl">◉</div>
                      <div className="font-mono text-sm font-bold">{formatMoney(pending.current?.amount ?? 0, CCY, locale)}</div>
                      <div className="text-[11px] text-zinc-500">{merchant}</div>
                      <button onClick={(e) => { e.stopPropagation(); bio(true); }} className="w-full rounded-xl bg-zinc-900 py-1.5 text-[12px] font-bold text-white">{t(locale, "wa.approveBio")}</button>
                      <button onClick={(e) => { e.stopPropagation(); bio(false); }} className="w-full text-[11px] underline opacity-60">{t(locale, "wa.failBio")}</button>
                      <button onClick={(e) => { e.stopPropagation(); cancelTap(); }} className="w-full text-[11px] underline opacity-60">{t(locale, "nf.scene.cancelTap")}</button>
                    </div>
                  ) : phase === "processing" ? (
                    <div className="space-y-1.5 pt-8">
                      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-900" />
                      <div className="text-[12px] text-zinc-500">{t(locale, "nf.scene.processing")}</div>
                    </div>
                  ) : phase === "result" && result ? (
                    approved ? (
                      <div className="space-y-1 pt-3">
                        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-lg font-bold text-white">✓</div>
                        <div className="font-mono text-sm font-bold">{formatMoney(result.receipt.amountMinor, CCY, locale)}</div>
                        <div className="text-[11px] text-zinc-500">{t(locale, "nf.approved")}</div>
                      </div>
                    ) : (
                      <div className="space-y-1 pt-3">
                        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-red-600 text-lg font-bold text-white">✕</div>
                        <div className="px-1 text-[11px] text-red-700">{declineOf() ?? result.finalState}</div>
                      </div>
                    )
                  ) : (
                    <div className="space-y-1 pt-4">
                      <div className="font-mono text-lg font-bold"><Time timeOnly /></div>
                      <div className="text-[11px] text-zinc-500">{t(locale, "nf.scene.lockHint")}</div>
                      <div className={`mx-auto mt-2 w-fit rounded-full px-2 py-0.5 text-[10px] font-bold ${near ? "bg-sky-600 text-white" : "bg-zinc-200 text-zinc-500"}`}>))) NFC</div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* push notification */}
            {notifIn && result && approved && (
              <div className="absolute left-1/2 top-2 z-20 w-[92%] max-w-[330px] -translate-x-1/2 transition-all duration-500">
                <div className="rounded-2xl bg-white/95 p-3 shadow-2xl ring-1 ring-zinc-200 dark:bg-zinc-900/95 dark:ring-zinc-700">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">✓</span>
                    <div className="flex-1">
                      <div className="text-[13px] font-bold">{t(locale, "nf.scene.notifT")}</div>
                      <div className="text-[12px]">{merchant}</div>
                    </div>
                    <span className="text-[11px] text-zinc-400"><Time timeOnly /></span>
                  </div>
                  <div className="mt-1 text-[13px]">{t(locale, "nf.scene.youPaid")} <b className="font-mono">{formatMoney(result.receipt.amountMinor, CCY, locale)}</b></div>
                  <div className="text-[12px] text-zinc-500">{t(locale, "nf.scene.notifSub")} · <span className="font-mono">{result.txId}</span></div>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {phase === "drag" && !locked.current && (
              <Btn small variant="outline" onClick={keyboardTap}>{t(locale, "nf.scene.kbd")}</Btn>
            )}
            {(phase === "result") && (
              <>
                <Btn small variant="outline" onClick={retry}>{t(locale, "nf.scene.retry")}</Btn>
                <Btn small variant="outline" onClick={() => { flowRef.current = null; locked.current = false; setPhase("drag"); setPos(null); setNotifIn(false); setScreen("till"); }}>{t(locale, "nf.nextCustomer")}</Btn>
              </>
            )}
            {phase !== "drag" && phase !== "result" && (
              <span className="text-[12px] text-zinc-500">{t(locale, "nf.scene.working")}</span>
            )}
          </div>

          {phase === "result" && result && (
            <Card className="space-y-2 p-3">
              <div className="font-semibold">{t(locale, "nf.scene.learnT")}</div>
              <ul className="list-disc space-y-0.5 ps-5 text-[13px] text-zinc-600 dark:text-zinc-400">
                <li>{t(locale, "nf.scene.learn1")}</li>
                <li>{t(locale, "nf.scene.learn2")}</li>
                <li>{t(locale, "nf.scene.learn3")}</li>
                <li>{t(locale, "nf.scene.learn4")}</li>
              </ul>
              <details className="rounded-lg bg-zinc-50 p-2 text-[13px] dark:bg-zinc-900">
                <summary className="cursor-pointer font-semibold">{t(locale, "nf.scene.techT")}</summary>
                <div className="mt-1 space-y-0.5 font-mono text-[12px] text-zinc-600 dark:text-zinc-400">
                  <div>application: {String(techAid ?? "—")}</div>
                  <div>limit: {techLimit != null ? formatMoney(Number(techLimit), CCY, locale) : "—"} · floor: {formatMoney(flow?.floor ?? 0, CCY, locale)}</div>
                  <div>hold ≠ settle · tx {result.txId}</div>
                </div>
              </details>
              <div className="font-mono text-[12px] text-zinc-500">{result.events.length} events</div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
