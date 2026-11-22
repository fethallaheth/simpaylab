/**
 * Realistic phone mock: bezel, side buttons, dynamic island, live status
 * bar (time, signal, battery) and a scrollable screen. Presentational only
 * — children render the handset experience.
 */
"use client";
import type { ReactNode } from "react";
import { Time } from "../flows/kit";

export function PhoneMock({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-fit" role="group" aria-label="Phone simulator">
      <div className="relative rounded-[3rem] bg-zinc-900 p-2.5 shadow-2xl dark:bg-zinc-800">
        {/* side buttons */}
        <div aria-hidden className="absolute -left-[2px] top-24 h-10 w-[3px] rounded-l bg-zinc-700" />
        <div aria-hidden className="absolute -left-[2px] top-40 h-14 w-[3px] rounded-l bg-zinc-700" />
        <div aria-hidden className="absolute -left-[2px] top-56 h-14 w-[3px] rounded-l bg-zinc-700" />
        <div aria-hidden className="absolute -right-[2px] top-44 h-20 w-[3px] rounded-r bg-zinc-700" />
        {/* screen */}
        <div
          className="relative flex h-[620px] max-h-[76vh] w-[300px] flex-col overflow-hidden rounded-[2.4rem]"
          style={{ background: "radial-gradient(120% 90% at 20% 0%, #143f32 0%, #0a0f0d 55%, #000000 100%)" }}
        >
          {/* wallpaper glow */}
          <div aria-hidden className="pointer-events-none absolute -left-10 top-24 h-48 w-48 rounded-full bg-emerald-500/20 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -right-12 bottom-32 h-56 w-56 rounded-full bg-sky-500/10 blur-3xl" />
          {/* dynamic island */}
          <div aria-hidden className="absolute left-1/2 top-2 z-20 h-[22px] w-[92px] -translate-x-1/2 rounded-full bg-black ring-1 ring-zinc-800" />
          {/* status bar */}
          <div aria-hidden className="flex shrink-0 items-center justify-between px-6 pb-0.5 pt-2.5 text-[11px] font-semibold text-zinc-100">
            <span><Time timeOnly /></span>
            <span className="flex items-center gap-1.5">
              <span className="flex items-end gap-[2px]">
                {[4, 7, 10, 13].map((h) => (
                  <span key={h} style={{ height: h }} className="w-[3px] rounded-sm bg-zinc-100" />
                ))}
              </span>
              <span className="text-[10px]">4G</span>
              <span className="flex items-center rounded-[4px] border border-zinc-400 px-[3px] py-[1px]">
                <span className="h-[7px] w-[16px] rounded-[2px] bg-emerald-400" />
              </span>
            </span>
          </div>
          {/* screen content */}
          <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
            {children}
          </div>
          {/* home indicator */}
          <div aria-hidden className="mx-auto mb-1.5 h-1 w-28 shrink-0 rounded-full bg-zinc-600" />
        </div>
      </div>
    </div>
  );
}
