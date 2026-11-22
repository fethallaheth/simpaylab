/**
 * PolarVault hardware-device simulator: a separate physical object with its
 * own small screen, controls, LEDs and lock state — never just another
 * panel of the computer app. Presentational only; the parent owns the
 * engine state and interprets every button press.
 */
"use client";
import type { ColdState } from "@sim/engine";

export interface DevPage {
  label: string;
  value: string;
  warn?: boolean;
}

export type DevScreen =
  | { kind: "off" }
  | { kind: "note"; title: string; body: string }
  | { kind: "pin"; mode: "unlock" | "create"; len: number }
  | { kind: "menu"; items: string[]; sel: number }
  | { kind: "address"; addr: string; verified: boolean }
  | { kind: "review"; pages: DevPage[]; page: number; last: boolean }
  | { kind: "seed"; words: string[]; page: number; pages: number }
  | { kind: "lines"; title: string; lines: string[] };

const FLASH_RING: Record<string, string> = {
  connect: "ring-2 ring-emerald-400",
  unlock: "ring-2 ring-emerald-400",
  review: "ring-2 ring-amber-400",
  approve: "ring-2 ring-emerald-300",
  reject: "ring-2 ring-red-400",
  error: "ring-2 ring-red-500",
  power: "ring-2 ring-sky-400"
};

function chunk(addr: string, n = 16): string[] {
  const out: string[] = [];
  for (let i = 0; i < addr.length; i += n) out.push(addr.slice(i, i + n));
  return out;
}

export function HwDevice({ s, model, screen, pinBuf, pinFocus, flash, onPower, onUp, onDown, onConfirm, onReject, onDigit }: {
  s: ColdState;
  model: "two-button" | "touch";
  screen: DevScreen;
  pinBuf: string;
  pinFocus: number;
  flash: string | null;
  onPower: () => void;
  onUp: () => void;
  onDown: () => void;
  onConfirm: () => void;
  onReject: () => void;
  onDigit: (d: string) => void;
}) {
  const d = s.device;
  const ring = (flash && FLASH_RING[flash]) || "";
  return (
    <div className="mx-auto w-fit" role="group" aria-label="Hardware wallet simulator">
      <div className={`w-[248px] rounded-[2rem] bg-zinc-900 p-3 shadow-xl transition-shadow dark:bg-zinc-800 ${ring}`}>
        <div className="flex items-center justify-between px-1 pb-1.5">
          <span className="text-[11px] font-bold tracking-[0.2em] text-zinc-400">POLARVAULT</span>
          <span className="flex items-center gap-1.5" aria-label="device indicators">
            <span title={d.powered ? "powered" : "off"} className={`h-2 w-2 rounded-full ${d.powered ? "bg-sky-400" : "bg-zinc-600"}`} />
            <span title={d.connected ? "USB connected" : "USB disconnected"} className={`h-2 w-2 rounded-full ${d.connected ? "bg-emerald-400" : "bg-zinc-600"}`} />
            <span title={d.locked ? "locked" : "unlocked"} className={`h-2 w-2 rounded-full ${!d.powered ? "bg-zinc-600" : d.locked ? "bg-red-400" : "bg-zinc-400"}`} />
          </span>
        </div>

        <div className="min-h-[228px] rounded-xl bg-zinc-950 p-2.5 font-mono text-[12px] leading-relaxed text-emerald-100/90" aria-live="polite">
          {screen.kind === "off" && (
            <div className="flex h-[208px] flex-col items-center justify-center gap-2 text-zinc-600">
              <div className="text-2xl">⏻</div>
              <div className="font-sans text-[11px]">press power</div>
            </div>
          )}
          {screen.kind === "note" && (
            <div className="space-y-2">
              <div className="font-sans text-[13px] font-bold text-zinc-100">{screen.title}</div>
              <div className="whitespace-pre-wrap font-sans text-[12px] text-zinc-300">{screen.body}</div>
            </div>
          )}
          {screen.kind === "lines" && (
            <div className="space-y-1.5">
              <div className="font-sans text-[13px] font-bold text-zinc-100">{screen.title}</div>
              {screen.lines.map((l, i) => <div key={i} className="font-sans text-[12px] text-zinc-300">{l}</div>)}
            </div>
          )}
          {screen.kind === "pin" && (
            <div className="space-y-2">
              <div className="font-sans text-[13px] font-bold text-zinc-100">
                {screen.mode === "unlock" ? "Enter demo PIN" : "Choose demo PIN"}
              </div>
              <div className="flex gap-1.5" aria-label="pin progress">
                {[...Array(screen.len)].map((_, i) => (
                  <span key={i} className={`flex h-7 w-7 items-center justify-center rounded border ${i < pinBuf.length ? "border-emerald-400 bg-emerald-950 text-emerald-200" : "border-zinc-700 text-zinc-600"}`}>
                    {i < pinBuf.length ? "•" : "–"}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-5 gap-1">
                {[...Array(10)].map((_, dig) => (
                  <button
                    key={dig}
                    aria-label={`digit ${dig}`}
                    onClick={() => (model === "touch" ? onDigit(String(dig)) : undefined)}
                    onFocus={() => undefined}
                    className={`rounded border py-1 text-center ${model === "two-button" && pinFocus === dig ? "border-amber-400 bg-amber-950 text-amber-200" : "border-zinc-700 text-zinc-300"} ${model === "touch" ? "hover:border-emerald-400" : ""}`}
                  >
                    {dig}
                  </button>
                ))}
              </div>
              <div className="font-sans text-[11px] text-zinc-500">
                {model === "two-button" ? "▲▼ pick digit · ✓ enter · ✕ erase" : "tap digits · ✕ erases"}
              </div>
            </div>
          )}
          {screen.kind === "menu" && (
            <div className="space-y-1">
              <div className="font-sans text-[11px] uppercase tracking-widest text-zinc-500">device menu</div>
              {screen.items.map((it, i) => (
                <div key={it} className={`rounded px-2 py-1 font-sans text-[13px] ${i === screen.sel ? "bg-emerald-900 text-emerald-100" : "text-zinc-300"}`}>
                  {i === screen.sel ? "▸ " : "  "}{it}
                </div>
              ))}
            </div>
          )}
          {screen.kind === "address" && (
            <div className="space-y-2">
              <div className="font-sans text-[11px] uppercase tracking-widest text-zinc-500">receive address</div>
              <div className="break-all text-[12px] text-zinc-100">
                {chunk(screen.addr).map((c, i) => <div key={i}>{c}</div>)}
              </div>
              <div className="font-sans text-[11px] text-zinc-400">compare with the computer, char by char</div>
              {screen.verified
                ? <div className="font-sans text-[12px] font-bold text-emerald-300">✓ verified on device</div>
                : <div className="font-sans text-[12px] text-amber-300">✓ = address matches</div>}
            </div>
          )}
          {screen.kind === "review" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-sans text-[11px] uppercase tracking-widest text-amber-300">review {screen.page + 1}/{screen.pages.length}</span>
                <span className="flex gap-1">{screen.pages.map((_, i) => <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === screen.page ? "bg-amber-300" : i < screen.page ? "bg-emerald-400" : "bg-zinc-700"}`} />)}</span>
              </div>
              {(() => {
                const pg = screen.pages[screen.page];
                if (!pg) return null;
                return (
                  <div className={pg.warn ? "rounded border border-red-500 p-1.5" : ""}>
                    <div className="font-sans text-[11px] uppercase tracking-widest text-zinc-500">{pg.label}</div>
                    <div className={`break-all text-[13px] ${pg.warn ? "text-red-300" : "text-zinc-100"}`}>{pg.value}</div>
                  </div>
                );
              })()}
              {screen.last && (
                <div className="rounded border border-amber-500 p-1.5 text-center font-sans text-[13px] font-bold text-amber-200">
                  approve? ✓ sign · ✕ reject
                </div>
              )}
              {!screen.last && <div className="font-sans text-[11px] text-zinc-500">▲▼ pages · ✕ reject</div>}
            </div>
          )}
          {screen.kind === "seed" && (
            <div className="space-y-1.5">
              <div className="rounded bg-red-950 px-1.5 py-0.5 text-center font-sans text-[10px] font-bold tracking-widest text-red-300">DEMO ONLY — NEVER REAL FUNDS</div>
              <div className="font-sans text-[11px] text-zinc-500">words {(screen.page * 4) + 1}–{Math.min(screen.words.length, screen.page * 4 + 4)} of {screen.words.length}</div>
              {screen.words.slice(screen.page * 4, screen.page * 4 + 4).map((w, i) => (
                <div key={i} className="text-[13px] text-zinc-100">{screen.page * 4 + i + 1}. {w}</div>
              ))}
              <div className="font-sans text-[11px] text-zinc-500">▲▼ pages · never photograph</div>
            </div>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between gap-1.5">
          <button onClick={onPower} aria-label="power" title="Power" className="rounded-full border border-zinc-700 px-2.5 py-1.5 text-[12px] text-zinc-300 hover:border-sky-400">⏻</button>
          {model === "two-button" ? (
            <>
              <button onClick={onUp} aria-label="up" className="flex-1 rounded-lg border border-zinc-700 py-1.5 text-zinc-200 hover:border-emerald-400">▲</button>
              <button onClick={onDown} aria-label="down" className="flex-1 rounded-lg border border-zinc-700 py-1.5 text-zinc-200 hover:border-emerald-400">▼</button>
            </>
          ) : (
            <span className="flex-1 text-center font-sans text-[10px] text-zinc-500">touchscreen</span>
          )}
          <button onClick={onConfirm} aria-label="confirm on device" title="Confirm" className="rounded-full bg-emerald-700 px-3 py-1.5 text-[13px] font-bold text-white hover:bg-emerald-600">✓</button>
          <button onClick={onReject} aria-label="reject on device" title="Reject" className="rounded-full bg-red-800 px-3 py-1.5 text-[13px] font-bold text-white hover:bg-red-700">✕</button>
        </div>
        <div className="mt-1.5 flex items-center justify-between px-1 font-sans text-[10px] text-zinc-500">
          <span>{s.device.connected ? "USB ● linked" : s.device.powered ? "USB ○ unplugged" : "offline"}</span>
          <span>{s.device.locked ? "🔒 locked" : "🔓 open"}</span>
        </div>
      </div>
    </div>
  );
}
