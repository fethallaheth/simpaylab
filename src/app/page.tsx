"use client";
import Link from "next/link";
import { t } from "@/i18n/dict";
import { usePrefs } from "@/components/providers";
import { Kicker } from "@/components/ui";
import { MODULES } from "@/lib/sim";
import type { ModuleId } from "@sim/engine";

const GROUPS: { id: "shop" | "mobile" | "send" | "crypto"; modules: ModuleId[] }[] = [
  { id: "shop", modules: ["checkout", "nfc", "bnpl"] },
  { id: "mobile", modules: ["wallet", "qr"] },
  { id: "send", modules: ["p2p", "mobilemoney", "remit"] },
  { id: "crypto", modules: ["crypto", "custody"] }
];

const ORDER = new Map(GROUPS.flatMap((g) => g.modules).map((id, i) => [id, i + 1]));
const TIER = new Map(MODULES.map((m) => [m.id, m.tier]));

export default function Dashboard() {
  const { locale } = usePrefs();

  return (
    <div className="space-y-10">
      <header className="grid gap-8 border-b border-zinc-200 pb-8 dark:border-zinc-800 lg:grid-cols-[minmax(0,1fr)_290px] lg:gap-12">
        <div>
          <h1 className="max-w-[15ch] text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.04em] sm:text-[3.5rem]">
            {t(locale, "home.title")}
          </h1>
          <p className="mt-5 max-w-[62ch] text-[15px] leading-7 text-zinc-600 dark:text-zinc-400">{t(locale, "home.sub")}</p>
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link
              href="/simulate/checkout"
              className="group inline-flex h-10 items-center gap-2 rounded-md bg-zinc-900 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-zinc-700 active:translate-y-px dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {t(locale, "home.start")}
              <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>
                →
              </span>
            </Link>
            <a href="#index" className="text-[13px] font-medium text-zinc-600 underline decoration-zinc-300 decoration-1 underline-offset-4 transition-colors hover:text-zinc-900 hover:decoration-zinc-500 dark:text-zinc-400 dark:hover:text-zinc-100">
              {t(locale, "home.explore")}
            </a>
          </div>
        </div>

        <aside className="lg:border-s lg:border-zinc-200 lg:ps-8 dark:lg:border-zinc-800">
          <Kicker>{t(locale, "dash.how")}</Kicker>
          <ol className="mt-4 space-y-3">
            {[1, 2, 3].map((n) => (
              <li key={n} className="flex gap-3 text-[13px] leading-6 text-zinc-600 dark:text-zinc-400">
                <span className="w-5 shrink-0 pt-0.5 font-mono text-[10px] text-zinc-400">0{n}</span>
                <span>{t(locale, `dash.how.${n}`)}</span>
              </li>
            ))}
          </ol>
          <p className="mt-5 border-t border-dashed border-zinc-300 pt-4 text-[12px] leading-5 text-zinc-500 dark:border-zinc-700">
            {t(locale, "dash.replay")}
          </p>
        </aside>
      </header>

      <section id="index" className="scroll-mt-24">
        <div className="flex items-end justify-between border-b border-zinc-300 pb-2 dark:border-zinc-700">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{t(locale, "home.explore")}</h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-400">{t(locale, "dash.methods")}</span>
        </div>

        {GROUPS.map((group, gi) => (
          <section key={group.id} className="grid gap-3 border-b border-zinc-200 py-6 dark:border-zinc-800 md:grid-cols-[168px_minmax(0,1fr)] md:gap-8">
            <header className="md:sticky md:top-20 md:self-start">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[10px] text-zinc-400">{String(gi + 1).padStart(2, "0")}</span>
                <h3 className="text-[14px] font-semibold">{t(locale, `home.cat.${group.id}`)}</h3>
              </div>
              <p className="mt-1.5 max-w-[26ch] text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">{t(locale, `home.cat.${group.id}.d`)}</p>
            </header>

            <ul className="border-t border-zinc-200 dark:border-zinc-800">
              {group.modules.map((id) => {
                const tier = TIER.get(id);
                return (
                  <li key={id} className="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800">
                    <Link
                      href={`/simulate/${id}`}
                      className="group flex items-start gap-3 px-2 py-3 -mx-2 transition-colors hover:bg-white dark:hover:bg-zinc-900/70"
                    >
                      <span className="w-7 shrink-0 pt-0.5 font-mono text-[10px] text-zinc-400">{String(ORDER.get(id)).padStart(2, "0")}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-[14px] font-semibold transition-colors group-hover:text-zinc-800 dark:group-hover:text-zinc-300">{t(locale, `mod.${id}`)}</span>
                          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-400">
                            {t(locale, tier === "A" ? "dash.tier.a" : "dash.tier.b")}
                          </span>
                        </span>
                        <span className="mt-1 block max-w-[78ch] text-[12.5px] leading-5 text-zinc-600 dark:text-zinc-400">{t(locale, `mod.${id}.d`)}</span>
                        <span className="mt-1 block text-[11.5px] leading-5 text-zinc-500">
                          <span className="font-medium text-zinc-600 dark:text-zinc-300">{t(locale, "home.learn")}:</span> {t(locale, `home.learn.${id}`)}
                        </span>
                      </span>
                      <span className="mt-0.5 hidden shrink-0 items-center gap-1 pt-0.5 text-[11px] font-semibold text-zinc-800 opacity-0 transition-opacity group-hover:opacity-100 sm:flex dark:text-zinc-300">
                        {t(locale, "home.start")} <span aria-hidden>→</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </section>

      </div>
  );
}
