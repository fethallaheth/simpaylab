"use client";
/**
 * Shared Money Journey, replay controller and actor sequence view.
 * All three read the SAME event log slice; presentation is translated via
 * dict keys, never from raw event names.
 */
import type { ActorId, ModuleId, RunResult, SimEvent } from "@sim/engine";
import { commerceText } from "@sim/content";
import { usePrefs } from "./providers";
import { t, tx } from "@/i18n/dict";
import { FAIL_TYPES, formatMoney, formatT } from "@/lib/sim";

/* ---------------- per-module lifecycle definitions ---------------- */

export interface StepDef {
  id: string;
  labelKey: string;
  descKey: string;
  /** event types that complete this step (real engine events only) */
  match: string[];
  /** hide when unmatched and later steps matched (e.g. optional top-up) */
  optional?: boolean;
}

const D = (id: string, labelKey: string, descKey: string, match: string[], optional?: boolean): StepDef => ({ id, labelKey, descKey, match, optional });

export const JOURNEY_DEFS: Record<ModuleId, StepDef[]> = {
  checkout: [
    D("order", "jy.checkout.order", "jy.checkout.order.d", ["CART_CREATED", "ORDER_CONFIRMED"]),
    D("secure", "jy.checkout.secure", "jy.checkout.secure.d", ["TOKENIZED", "CARD_VALIDATED", "RISK_SCORED", "TDS_PASSED", "TDS_FRICTIONLESS"]),
    D("authorize", "jy.checkout.authorize", "jy.checkout.authorize.d", ["AUTHORIZED_HOLD"]),
    D("capture", "jy.checkout.capture", "jy.checkout.capture.d", ["CAPTURED", "CAPTURE_DEFERRED"]),
    D("settle", "jy.checkout.settle", "jy.checkout.settle.d", ["SETTLED"])
  ],
  wallet: [
    D("setup", "jy.wallet.setup", "jy.wallet.setup.d", ["CARD_PROVISIONED", "TOKEN_PRESENTED", "ACCOUNT_LINKED", "PROVISION_VERIFIED", "WALLET_OPENED"]),
    D("auth", "jy.wallet.auth", "jy.wallet.auth.d", ["BIOMETRIC_OK", "PIN_FALLBACK_OK", "OTP_VERIFIED"]),
    D("authorize", "jy.wallet.authorize", "jy.wallet.authorize.d", ["AUTHORIZED_HOLD", "MANDATE_CHARGED", "CRYPTOGRAM_BUILT"]),
    D("settle", "jy.wallet.settle", "jy.wallet.settle.d", ["SETTLED"])
  ],
  qr: [
    D("code", "jy.qr.code", "jy.qr.code.d", ["QR_GENERATED", "QR_SHOWN"]),
    D("scan", "jy.qr.scan", "jy.qr.scan.d", ["QR_SCANNED"]),
    D("validate", "jy.qr.validate", "jy.qr.validate.d", ["QR_VALIDATED"]),
    D("approve", "jy.qr.approve", "jy.qr.approve.d", ["PIN_CONFIRMED"]),
    D("move", "jy.qr.move", "jy.qr.move.d", ["WALLET_TO_WALLET"]),
    D("settle", "jy.qr.settle", "jy.qr.settle.d", ["SETTLED"])
  ],
  crypto: [
    D("invoice", "jy.crypto.invoice", "jy.crypto.invoice.d", ["INVOICE_CREATED"]),
    D("build", "jy.crypto.build", "jy.crypto.build.d", ["TX_BUILT", "FEE_CHOSEN"]),
    D("broadcast", "jy.crypto.broadcast", "jy.crypto.broadcast.d", ["BROADCAST", "MEMPOOL_QUEUED"]),
    D("confirm", "jy.crypto.confirm", "jy.crypto.confirm.d", ["BLOCK_MINED", "CONFIRMED", "RBF_REPLACED"]),
    D("paid", "jy.crypto.paid", "jy.crypto.paid.d", ["MARKED_PAID"])
  ],
  custody: [
    D("setup", "jy.custody.setup", "jy.custody.setup.d", ["SEED_GENERATED", "RECOVERED"]),
    D("approve", "jy.custody.approve", "jy.custody.approve.d", ["HOT_SIGNED", "SIGNED_OFFLINE", "DEVICE_VERIFIED", "MULTISIG_APPROVED"]),
    D("broadcast", "jy.custody.broadcast", "jy.custody.broadcast.d", ["BROADCAST", "QTRANSFER_BACK", "QTRANSFER_TO_OFFLINE"]),
    D("confirm", "jy.custody.confirm", "jy.custody.confirm.d", ["CONFIRMED"])
  ],
  nfc: [
    D("tap", "jy.nfc.tap", "jy.nfc.tap.d", ["TERMINAL_READY", "APP_SELECTED", "DATA_READ"]),
    D("verify", "jy.nfc.verify", "jy.nfc.verify.d", ["CVM_OK", "CRYPTOGRAM", "BIOMETRIC_OK", "OFFLINE_AUTH", "CVM_REQUIRED"]),
    D("authorize", "jy.nfc.authorize", "jy.nfc.authorize.d", ["AUTHORIZED_HOLD"]),
    D("settle", "jy.nfc.settle", "jy.nfc.settle.d", ["SETTLED"])
  ],
  p2p: [
    D("fund", "jy.p2p.fund", "jy.p2p.fund.d", ["TOPUP_FUNDED"], true),
    D("send", "jy.p2p.send", "jy.p2p.send.d", ["P2P_SENT", "REQUEST_SENT", "REQUEST_PAID", "LEG_PAID"]),
    D("settle", "jy.p2p.settle", "jy.p2p.settle.d", ["SETTLED"])
  ],
  mobilemoney: [
    D("session", "jy.mm.session", "jy.mm.session.d", ["USSD_OPENED", "PIN_SET", "USSD_MENU"]),
    D("service", "jy.mm.service", "jy.mm.service.d", ["MM_SENT", "CASHIN_DONE", "CASHOUT_DONE", "BILL_PAID", "AIRTIME_BOUGHT", "BALANCE_SHOWN"]),
    D("settle", "jy.mm.settle", "jy.mm.settle.d", ["SETTLED"])
  ],
  remit: [
    D("quote", "jy.remit.quote", "jy.remit.quote.d", ["FX_QUOTED", "QUOTE_MADE"]),
    D("compliance", "jy.remit.compliance", "jy.remit.compliance.d", ["COMPLIANCE_PASSED"]),
    D("fund", "jy.remit.fund", "jy.remit.fund.d", ["DEBITED"]),
    D("deliver", "jy.remit.deliver", "jy.remit.deliver.d", ["CORRIDOR_HOP", "DELIVERED"])
  ],
  bnpl: [
    D("apply", "jy.bnpl.apply", "jy.bnpl.apply.d", ["ELIGIBILITY_CHECKED"]),
    D("approve", "jy.bnpl.approve", "jy.bnpl.approve.d", ["BNPL_APPROVED"]),
    D("activate", "jy.bnpl.activate", "jy.bnpl.activate.d", ["PLAN_ACTIVATED"]),
    D("repay", "jy.bnpl.repay", "jy.bnpl.repay.d", ["INSTALLMENT_PAID", "PLAN_COMPLETE"])
  ],
  demo: [
    D("start", "jy.demo.start", "jy.demo.start.d", ["FLOW_STARTED", "DEMO_STARTED", "CART_CREATED"]),
    D("authorize", "jy.demo.authorize", "jy.demo.authorize.d", ["AUTHENTICATED", "AUTHORIZED_HOLD"]),
    D("capture", "jy.demo.capture", "jy.demo.capture.d", ["CAPTURED"]),
    D("clear", "jy.demo.clear", "jy.demo.clear.d", ["CLEARED"]),
    D("settle", "jy.demo.settle", "jy.demo.settle.d", ["SETTLED"])
  ]
};

export type ComputedStep = {
  def: StepDef;
  status: "done" | "now" | "todo" | "failed";
  /** simulated time of the event that completed (or failed) this step */
  at: number | null;
};

/**
 * Failure test for one event. ADDRESS_SWAP is only a failure when the swap
 * went through (caught:false) — a stopped swap is correct user behavior.
 */
export function isFailEvent(e: SimEvent): boolean {
  if (!(FAIL_TYPES as string[]).includes(e.type)) return false;
  if (e.type === "ADDRESS_SWAP") return (e.payload as Record<string, unknown> | undefined)?.caught === false;
  return true;
}

export function computeSteps(moduleId: ModuleId, events: SimEvent[]): { steps: ComputedStep[]; failed: boolean; settled: boolean } {
  return computeStepsFor(JOURNEY_DEFS[moduleId] ?? JOURNEY_DEFS.demo, events);
}

function computeStepsFor(defs: StepDef[], events: SimEvent[]): { steps: ComputedStep[]; failed: boolean; settled: boolean } {
  const matchedAt = new Map<string, number>();
  const matchedIdx = new Map<string, number>();
  events.forEach((e, i) => {
    for (const d of defs) {
      if (d.match.includes(e.type) && !matchedAt.has(d.id)) {
        matchedAt.set(d.id, e.t);
        matchedIdx.set(d.id, i);
      }
    }
  });
  const failIdx = events.findIndex(isFailEvent);
  const failed = failIdx >= 0;
  // Optional steps with no match and a later matched step are hidden (not invented).
  const laterMatched = (pos: number) => defs.slice(pos + 1).some((d) => matchedAt.has(d.id));
  const visible = defs.filter((d, i) => !(d.optional && !matchedAt.has(d.id) && laterMatched(i)));
  let nowPlaced = false;
  const steps: ComputedStep[] = visible.map((d) => {
    const done = matchedAt.has(d.id);
    if (done) {
      const idx = matchedIdx.get(d.id) ?? 0;
      // A post-completion dispute (e.g. chargeback after settlement) unwinds
      // the final step: the failure came after the step completed.
      const last = visible.indexOf(d) === visible.length - 1;
      const disputed = failed && last && failIdx > idx;
      return { def: d, status: disputed ? "failed" : "done", at: matchedAt.get(d.id) ?? null };
    }
    if (failed && !nowPlaced) {
      // Attribute the failure to the earliest step still open when it happened.
      const firstOpen = visible.find((v) => !matchedAt.has(v.id));
      if (firstOpen?.id === d.id) {
        nowPlaced = true;
        return { def: d, status: "failed", at: events[failIdx]?.t ?? null };
      }
      return { def: d, status: "todo", at: null };
    }
    if (!nowPlaced && events.length > 0) {
      nowPlaced = true;
      return { def: d, status: "now", at: null };
    }
    return { def: d, status: "todo", at: null };
  });
  const settled = steps.length > 0 && steps[steps.length - 1].status === "done";
  return { steps, failed, settled };
}

/* ---------------- Process explanation ---------------- */

/** Step-by-step plain-language walkthrough of the module's money path. */
export function ProcessView({ moduleId, result }: { moduleId: ModuleId; result: RunResult }) {
  const { locale } = usePrefs();
  const { steps } = computeSteps(moduleId, result.events);
  if (steps.length === 0) return null;
  return (
    <ol className="space-y-2" aria-label={t(locale, "sim.process")}>
      {steps.map((s) => (
        <li key={s.def.id} className="flex gap-2.5">
          <StepBadge status={s.status} />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">{t(locale, s.def.labelKey)}</span>
            <span className="mt-0.5 block max-w-[86ch] text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">{t(locale, s.def.descKey)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ---------------- Money Journey ---------------- */

export function StepBadge({ status }: { status: ComputedStep["status"] }) {
  const { locale } = usePrefs();
  const label = t(locale, `st.${status}`);
  const cls =
    status === "done" ? "bg-emerald-600 text-white"
    : status === "failed" ? "bg-red-600 text-white"
    : status === "now" ? "border-2 border-sky-500 text-sky-700 dark:text-sky-300"
    : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800";
  return (
    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${cls}`} role="img" aria-label={label}>
      {status === "done" ? "✓" : status === "failed" ? "✕" : status === "now" ? "●" : ""}
    </span>
  );
}

export function JourneyView({ moduleId, events, ccy }: { moduleId: ModuleId; events: SimEvent[]; ccy: string }) {
  const { locale } = usePrefs();
  const { steps, failed, settled } = computeSteps(moduleId, events);
  const empty = events.length === 0;
  return (
    <div className="space-y-3">
      {empty && (
        <div className="rounded-lg border border-dashed border-zinc-300 p-3 text-center text-[13px] text-zinc-500 dark:border-zinc-700">
          {t(locale, "jy.empty")}
        </div>
      )}
      {/* Desktop: horizontal stepper */}
      <ol className="hidden items-stretch md:flex" aria-label={t(locale, "journey.title")}>
        {steps.map((s, i) => (
          <li key={s.def.id} className="flex flex-1 items-start last:flex-none" aria-current={s.status === "now" ? "step" : undefined}>
            <div className="flex w-full flex-col items-center gap-1.5 px-1 text-center">
              <StepBadge status={s.status} />
              <span className={`text-[13px] leading-snug ${s.status === "now" ? "font-bold" : "font-medium"}`}>{t(locale, s.def.labelKey)}</span>
              <span className="text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">{t(locale, s.def.descKey)}</span>
              <span className="text-[11px] text-zinc-500">
                {s.at !== null ? <span className="font-mono" dir="ltr">t+{formatT(s.at)}</span> : t(locale, `st.${s.status}`)}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span className={`mx-1 mt-3.5 h-0.5 min-w-4 flex-1 ${steps[i + 1].status === "todo" && s.status !== "done" ? "bg-zinc-200 dark:bg-zinc-800" : s.status === "failed" ? "bg-red-300" : "bg-emerald-400"}`} aria-hidden />
            )}
          </li>
        ))}
      </ol>
      {/* Mobile/tablet: vertical timeline */}
      <ol className="space-y-0 md:hidden" aria-label={t(locale, "journey.title")}>
        {steps.map((s, i) => (
          <li key={s.def.id} className="relative flex gap-3 pb-4 last:pb-0" aria-current={s.status === "now" ? "step" : undefined}>
            {i < steps.length - 1 && (
              <span className={`absolute start-[13px] top-8 h-[calc(100%-2rem)] w-0.5 ${s.status === "done" ? "bg-emerald-400" : s.status === "failed" ? "bg-red-300" : "bg-zinc-200 dark:bg-zinc-800"}`} aria-hidden />
            )}
            <StepBadge status={s.status} />
            <div className="min-w-0 flex-1">
              <div className={`text-[13px] ${s.status === "now" ? "font-bold" : "font-medium"}`}>{t(locale, s.def.labelKey)}</div>
              <div className="text-[12px] text-zinc-500 dark:text-zinc-400">{t(locale, s.def.descKey)}</div>
              <div className="mt-0.5 text-[11px] text-zinc-500">
                {s.at !== null ? <span className="font-mono" dir="ltr">t+{formatT(s.at)}</span> : t(locale, `st.${s.status}`)}
              </div>
            </div>
          </li>
        ))}
      </ol>
      <MoneyWhereabouts events={events} failed={failed} settled={settled} ccy={ccy} />
    </div>
  );
}

/** Buyer/seller boxes derived from real run amounts — fully translated. */
function MoneyWhereabouts({ events, failed, settled, ccy }: { events: SimEvent[]; failed: boolean; settled: boolean; ccy: string }) {
  const { locale } = usePrefs();
  if (events.length === 0) return null;
  return (
    <div className="grid gap-2 text-[13px] sm:grid-cols-2">
      <div className="rounded-lg bg-sky-50 p-2.5 dark:bg-sky-950">
        <span className="font-semibold">{t(locale, "journey.buyer")}: </span>
        <BuyerLine failed={failed} settled={settled} events={events} ccy={ccy} />
      </div>
      <div className="rounded-lg bg-emerald-50 p-2.5 dark:bg-emerald-950">
        <span className="font-semibold">{t(locale, "journey.seller")}: </span>
        <SellerLine failed={failed} settled={settled} events={events} ccy={ccy} />
      </div>
    </div>
  );
}

function lastAmountOf(events: SimEvent[], types: string[]): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const v = events[i].payload?.amountMinor;
    if (types.includes(events[i].type) && typeof v === "number") return v;
  }
  return null;
}

function BuyerLine({ failed, settled, events, ccy }: { failed: boolean; settled: boolean; events: SimEvent[]; ccy: string }) {
  const { locale } = usePrefs();
  if (failed && !settled) return <>{t(locale, "jy.acc.buyerFail")}</>;
  if (settled) {
    const a = lastAmountOf(events, ["AUTHORIZED_HOLD", "CAPTURED", "SETTLED", "P2P_SENT", "WALLET_TO_WALLET", "DEBITED", "MM_SENT"]);
    return <>{a !== null ? tx(locale, "jy.acc.buyerPaid", { amt: formatMoney(a, ccy, locale) }) : t(locale, "jy.acc.buyerPaidNoAmt")}</>;
  }
  const types = new Set(events.map((e) => e.type));
  const has = (l: string[]) => l.some((x) => types.has(x));
  if (has(["CAPTURED", "CONFIRMED", "MARKED_PAID", "DELIVERED"])) return <>{t(locale, "jy.acc.buyerClaimed")}</>;
  if (has(["AUTHORIZED_HOLD", "P2P_PENDING", "BROADCAST", "PLAN_ACTIVATED"])) return <>{t(locale, "jy.acc.buyerFrozen")}</>;
  return <>{t(locale, "jy.acc.buyerAbout")}</>;
}

function SellerLine({ failed, settled, events, ccy }: { failed: boolean; settled: boolean; events: SimEvent[]; ccy: string }) {
  const { locale } = usePrefs();
  if (failed && !settled) return <>{t(locale, "jy.acc.sellerFail")}</>;
  if (settled) {
    const a = lastAmountOf(events, ["SETTLED", "MARKED_PAID", "DELIVERED", "MERCHANT_NOTIFIED"]);
    return <>{a !== null ? tx(locale, "jy.acc.sellerGot", { amt: formatMoney(a, ccy, locale) }) : t(locale, "jy.acc.sellerGotNoAmt")}</>;
  }
  const types = new Set(events.map((e) => e.type));
  const has = (l: string[]) => l.some((x) => types.has(x));
  if (has(["CAPTURED", "CONFIRMED", "WALLET_TO_WALLET"])) return <>{t(locale, "jy.acc.sellerReceivable")}</>;
  return <>{tx(locale, "jy.acc.sellerNothing", { amt: formatMoney(0, ccy, locale) })}</>;
}

/* ---------------- Replay controller ---------------- */

export const SPEEDS = [1200, 600, 250];

export function ReplayBar({ total, cursor, caption, playing, speed, onToggle, onPrev, onNext, onRestart, onScrub, onSpeed }: {
  total: number; cursor: number; caption?: SimEvent; playing: boolean; speed: number;
  onToggle: () => void; onPrev: () => void; onNext: () => void; onRestart: () => void;
  onScrub: (i: number) => void; onSpeed: (s: number) => void;
}) {
  const { locale } = usePrefs();
  const done = total > 0 && cursor >= total - 1;
  const btn = "rounded-lg border border-zinc-300 px-2.5 py-1.5 text-[13px] font-semibold hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800";
  return (
    <div className="space-y-2" role="group" aria-label={t(locale, "sim.replay")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <button className={btn} onClick={onRestart} disabled={total === 0} aria-label={t(locale, "sim.restart")} title={t(locale, "sim.restart")}>⏮</button>
        <button className={btn} onClick={onPrev} disabled={total === 0 || cursor <= 0} aria-label={t(locale, "sim.prev")} title={t(locale, "sim.prev")}>◀</button>
        <button className={`${btn} min-w-20 border-sky-500 text-sky-700 dark:text-sky-300`} onClick={onToggle} disabled={total === 0} aria-label={playing ? t(locale, "sim.pause") : t(locale, "sim.play")}>
          {playing ? `⏸ ${t(locale, "sim.pause")}` : `▶ ${t(locale, "sim.play")}`}
        </button>
        <button className={btn} onClick={onNext} disabled={total === 0 || cursor >= total - 1} aria-label={t(locale, "sim.next")} title={t(locale, "sim.next")}>▶|</button>
        <label className="ms-auto flex items-center gap-1 text-[12px] text-zinc-500">
          {t(locale, "sim.speed")}
          <select className="rounded border border-zinc-300 bg-transparent px-1 py-1 dark:border-zinc-700" value={speed} onChange={(e) => onSpeed(Number(e.target.value))} aria-label={t(locale, "sim.speed")}>
            {SPEEDS.map((s) => <option key={s} value={s}>{s >= 1000 ? `${s / 1000}×` : `${Math.round(1000 / s)}×`}</option>)}
          </select>
        </label>
      </div>
      {total === 0 ? (
        <div className="text-[13px] text-zinc-500">{t(locale, "sim.replay.empty")}</div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <input
              type="range" min={0} max={total - 1} step={1} value={Math.max(0, cursor)}
              onChange={(e) => onScrub(Number(e.target.value))}
              className="w-full accent-sky-600" aria-label={t(locale, "sim.scrub")}
              aria-valuetext={tx(locale, "sim.stepOf", { k: Math.max(0, cursor) + 1, n: total })}
            />
          </div>
          <div className="flex items-center justify-between text-[12px] text-zinc-500">
            <span>{tx(locale, "sim.stepOf", { k: total === 0 || cursor < 0 ? 0 : cursor + 1, n: total })}</span>
            {done && !playing && <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">{t(locale, "sim.replay.done")}</span>}
          </div>
          <ReplayCaption event={caption} />
        </>
      )}
    </div>
  );
}

/** One-line explanation of the event under the replay cursor. */
export function ReplayCaption({ event }: { event: SimEvent | undefined }) {
  const { locale } = usePrefs();
  if (!event) return null;
  const c = commerceText(event.type, locale);
  return (
    <div className="rounded-lg border border-zinc-200 p-2 text-[13px] dark:border-zinc-800">
      <span className="font-semibold">{t(locale, event.explain.titleKey)}: </span>
      <span className="text-zinc-600 dark:text-zinc-400">{c?.money ?? t(locale, event.explain.bodyKey)}</span>
    </div>
  );
}

/* ---------------- Actor sequence view ---------------- */

export function actorLabel(locale: Parameters<typeof t>[0], actor: ActorId): string {
  const s = t(locale, `actor.${actor}`);
  return s === `actor.${actor}` ? actor : s;
}

export function SequenceView({ result, cursor, selected, onSelect }: {
  result: RunResult; cursor: number; selected: string | null; onSelect: (id: string) => void;
}) {
  const { locale } = usePrefs();
  const evs = result.events.slice(0, cursor + 1);
  if (evs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-[13px] text-zinc-500 dark:border-zinc-700">
        <div className="font-semibold text-zinc-700 dark:text-zinc-300">{t(locale, "sim.seq.empty")}</div>
        <div className="mt-1">{t(locale, "sim.seq.emptyHint")}</div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" aria-label={t(locale, "sim.seq.actors")}>
        {result.actors.map((a) => (
          <span key={a} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[12px] font-medium dark:bg-zinc-800">{actorLabel(locale, a)}</span>
        ))}
      </div>
      <ol className="space-y-1" aria-label={t(locale, "sim.sequence")}>
        {evs.map((e, i) => {
          const from = i === 0 ? e.actor : evs[i - 1].actor;
          const self = from === e.actor;
          const sel = selected === e.id;
          const failed = isFailEvent(e);
          return (
            <li key={e.id}>
              <button
                onClick={() => onSelect(e.id)}
                aria-current={sel ? "true" : undefined}
                aria-label={tx(locale, "sim.seq.item", { n: i + 1, title: t(locale, e.explain.titleKey), actor: actorLabel(locale, e.actor) })}
                className={`w-full rounded-lg border px-2 py-1.5 text-start text-[12px] transition-colors ${sel ? "border-sky-500 bg-sky-50 dark:bg-sky-950" : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"}`}
              >
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${failed ? "bg-red-500" : i === evs.length - 1 ? "bg-emerald-500" : "bg-sky-500"}`} aria-hidden />
                  {self ? (
                    <span className="font-medium">{actorLabel(locale, e.actor)} <span className="text-zinc-400">↻</span></span>
                  ) : (
                    <span className="font-medium">
                      {actorLabel(locale, from)}
                      <span className="mx-1 inline-block rtl:rotate-180" aria-hidden>→</span>
                      {actorLabel(locale, e.actor)}
                    </span>
                  )}
                  <span className="text-zinc-700 dark:text-zinc-300">{t(locale, e.explain.titleKey)}</span>
                  <span className="ms-auto font-mono text-[11px] text-zinc-500" dir="ltr">t+{formatT(e.t)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
