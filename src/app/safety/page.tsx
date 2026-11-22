"use client";
import Link from "next/link";
import { t } from "@/i18n/dict";
import { usePrefs } from "@/components/providers";
import { Kicker } from "@/components/ui";

const RULES = ["safe.rule1", "safe.rule2", "safe.rule3", "safe.rule4"];

export default function SafetyPage() {
  const { locale } = usePrefs();
  return (
    <article className="max-w-4xl">
      <header className="border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <Kicker>{t(locale, "safe.kicker")}</Kicker>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">{t(locale, "safe.title")}</h1>
        <p className="mt-3 max-w-[64ch] text-[14px] leading-7 text-zinc-600 dark:text-zinc-400">{t(locale, "safe.body")}</p>
      </header>

      <div className="mt-8 grid gap-10 md:grid-cols-[minmax(0,1fr)_250px] md:gap-12">
        <section>
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{t(locale, "safe.rules")}</h2>
          <ol className="mt-3 border-t border-zinc-200 dark:border-zinc-800">
            {RULES.map((key, i) => (
              <li key={key} className="flex gap-4 border-b border-zinc-200 py-4 dark:border-zinc-800">
                <span className="w-6 shrink-0 pt-0.5 font-mono text-[10px] text-zinc-400">0{i + 1}</span>
                <p className="text-[13px] leading-6 text-zinc-700 dark:text-zinc-300">{t(locale, key)}</p>
              </li>
            ))}
          </ol>
        </section>

        <aside className="border-t border-zinc-300 pt-4 dark:border-zinc-700 md:border-s md:border-t-0 md:ps-6 md:pt-0">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">{t(locale, "safe.boundaryLabel")}</p>
          <p className="mt-2 text-[15px] font-medium leading-6">{t(locale, "safe.boundary")}</p>

          <div className="mt-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{t(locale, "safe.prefixes")}</p>
            <ul className="mt-2 space-y-1 font-mono text-[12px] text-zinc-600 dark:text-zinc-400">
              <li>400000…</li>
              <li>555555…</li>
              <li>353011…</li>
            </ul>
          </div>

          <Link
            href="/"
            className="mt-7 inline-flex items-center gap-1 text-[12px] font-semibold text-zinc-800 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-600 dark:text-zinc-300"
          >
            {t(locale, "safe.open")} <span aria-hidden>→</span>
          </Link>
        </aside>
      </div>
    </article>
  );
}
