"use client";
import { useMemo, useState } from "react";
import { GLOSSARY } from "@sim/content";
import { t, tx } from "@/i18n/dict";
import { usePrefs } from "@/components/providers";
import { Kicker } from "@/components/ui";
import type { Locale } from "@/i18n/dict";

export default function GlossaryPage() {
  const { locale } = usePrefs();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();

  const groups = useMemo(() => {
    const term = (g: (typeof GLOSSARY)[number]) => g.term[locale as Locale] ?? g.term.en;
    const filtered = GLOSSARY.filter((g) => {
      if (!query) return true;
      return (
        term(g).toLowerCase().includes(query) ||
        g.term.en.toLowerCase().includes(query) ||
        g.id.includes(query) ||
        (g.def[locale as Locale] ?? g.def.en).toLowerCase().includes(query)
      );
    });
    const collator = new Intl.Collator(locale, { sensitivity: "base" });
    const map = new Map<string, typeof GLOSSARY>();
    for (const g of [...filtered].sort((x, y) => collator.compare(term(x), term(y)))) {
      const key = term(g).trim().charAt(0).toUpperCase() || "#";
      const list = map.get(key) ?? [];
      list.push(g);
      map.set(key, list);
    }
    return [...map.entries()].sort((x, y) => collator.compare(x[0], y[0]));
  }, [locale, query]);

  const total = groups.reduce((n, [, list]) => n + list.length, 0);

  return (
    <div className="space-y-7">
      <header className="border-b border-zinc-200 pb-5 dark:border-zinc-800">
        <Kicker>{t(locale, "gl.kicker")}</Kicker>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">{t(locale, "gl.title")}</h1>
          <span className="font-mono text-[11px] text-zinc-400">{tx(locale, "gl.count", { n: GLOSSARY.length })}</span>
        </div>
        <p className="mt-2 max-w-[62ch] text-[13px] leading-6 text-zinc-600 dark:text-zinc-400">{t(locale, "gl.sub")}</p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative block w-full max-w-md">
          <span className="sr-only">{t(locale, "gl.filter")}</span>
          <svg className="pointer-events-none absolute start-3 top-2.5 text-zinc-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t(locale, "gl.filter")}
            className="h-9 w-full rounded-md border border-zinc-300 bg-white ps-9 pe-3 text-[13px] outline-none placeholder:text-zinc-400 hover:border-zinc-400 focus:border-zinc-600 focus:ring-2 focus:ring-zinc-600/15 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-400">
          {total}/{GLOSSARY.length}
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-10 text-center text-[13px] text-zinc-500 dark:border-zinc-700">
          {t(locale, "gl.empty")}
        </p>
      ) : (
        <div className="space-y-8">
          {groups.map(([letter, list]) => (
            <section key={letter} className="grid gap-4 border-t border-zinc-200 pt-4 dark:border-zinc-800 md:grid-cols-[3rem_minmax(0,1fr)] md:gap-8">
              <h2 className="font-mono text-[22px] font-medium leading-none text-zinc-300 dark:text-zinc-600">{letter}</h2>
              <dl className="grid gap-x-10 gap-y-5 md:grid-cols-2">
                {list.map((g) => (
                  <div key={g.id} className="max-w-[62ch]">
                    <dt className="text-[13px] font-semibold">
                      {g.term[locale as Locale] ?? g.term.en}
                      <span className="ms-2 font-mono text-[9px] font-normal uppercase tracking-[0.1em] text-zinc-400">{g.id}</span>
                    </dt>
                    <dd className="mt-1 text-[12.5px] leading-5 text-zinc-600 dark:text-zinc-400">{g.def[locale as Locale] ?? g.def.en}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
