"use client";
import Link from "next/link";
import { useState } from "react";
import { t } from "@/i18n/dict";
import { MODULES } from "@/lib/sim";
import { usePrefs } from "@/components/providers";
import { Badge, Kicker } from "@/components/ui";

/** Illustrative comparison (spec §3.4). Hand-rolled meters, no chart dep. */
type Row = {
  confirm: string;
  settle: string;
  cost: string;
  needs: string;
  rev: string;
  best: string;
  speed: number;
  costN: number;
  access: number;
};

const ROWS: Record<string, Row> = {
  checkout: { confirm: "seconds", settle: "T+1/2", cost: "~1.8% + fee", needs: "bank card + net", rev: "yes", best: "e-commerce", speed: 4, costN: 3, access: 3 },
  wallet: { confirm: "seconds", settle: "T+1", cost: "~1.2% + token", needs: "smartphone", rev: "yes", best: "in-app/pos", speed: 4, costN: 3, access: 3 },
  qr: { confirm: "seconds", settle: "instant", cost: "~0.5%", needs: "smartphone", rev: "rarely", best: "street retail", speed: 4, costN: 5, access: 3 },
  crypto: { confirm: "10–60 min", settle: "on-chain", cost: "fee market", needs: "wallet + net", rev: "no", best: "censorship-free", speed: 2, costN: 3, access: 2 },
  custody: { confirm: "10–60 min", settle: "on-chain", cost: "fee market", needs: "hardware", rev: "no", best: "savings", speed: 2, costN: 3, access: 2 },
  nfc: { confirm: "seconds", settle: "T+1", cost: "~1.3%", needs: "card/phone", rev: "yes", best: "transit/retail", speed: 5, costN: 3, access: 4 },
  p2p: { confirm: "seconds", settle: "instant–1d", cost: "0–1%", needs: "app account", rev: "rarely", best: "friends/split", speed: 4, costN: 4, access: 3 },
  mobilemoney: { confirm: "seconds", settle: "instant", cost: "~1% + fixed", needs: "any phone", rev: "rarely", best: "unbanked", speed: 4, costN: 4, access: 5 },
  remit: { confirm: "min–days", settle: "hours–days", cost: "2–6% all-in", needs: "ID + rail", rev: "sometimes", best: "corridors", speed: 2, costN: 2, access: 3 },
  bnpl: { confirm: "seconds", settle: "T+1 (merchant)", cost: "~3.5% MDR", needs: "card + score", rev: "yes", best: "basket split", speed: 4, costN: 2, access: 3 }
};

const ORDER = MODULES.map((m) => m.id);

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="font-medium text-zinc-600 dark:text-zinc-300">{label}</span>
        <span className="font-mono text-[10px] text-zinc-400">{value}/5</span>
      </div>
      <div className="mt-1 flex gap-1" role="img" aria-label={`${label}: ${value}/5`}>
        {[1, 2, 3, 4, 5].map((seg) => (
          <span key={seg} className={`h-1.5 flex-1 rounded-sm ${seg <= value ? "bg-zinc-700 dark:bg-zinc-400" : "bg-zinc-200 dark:bg-zinc-800"}`} />
        ))}
      </div>
    </div>
  );
}

export default function ComparePage() {
  const { locale } = usePrefs();
  const [a, setA] = useState("checkout");
  const [b, setB] = useState("qr");
  const [sort, setSort] = useState<"id" | "costN" | "speed" | "access">("id");

  const ids = [...ORDER].sort((x, y) => (sort === "id" ? ORDER.indexOf(x) - ORDER.indexOf(y) : ROWS[y][sort] - ROWS[x][sort]));
  const pair = [a, b];

  return (
    <div className="space-y-8">
      <header className="grid gap-4 border-b border-zinc-200 pb-6 dark:border-zinc-800 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-end">
        <div>
          <Kicker>{t(locale, "cmp.kicker")}</Kicker>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">{t(locale, "cmp.title")}</h1>
          <p className="mt-2 max-w-[60ch] text-[13px] leading-6 text-zinc-600 dark:text-zinc-400">{t(locale, "cmp.sub")}</p>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <label className="block text-[11px]">
            <span className="mb-1 block font-medium text-zinc-500">{t(locale, "cmp.method")} A</span>
            <select
              className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-[12px] outline-none hover:border-zinc-400 focus:border-zinc-600 focus:ring-2 focus:ring-zinc-600/15 dark:border-zinc-700 dark:bg-zinc-900"
              value={a}
              onChange={(e) => setA(e.target.value)}
            >
              {ORDER.map((id) => (
                <option key={id} value={id}>{t(locale, `mod.${id}`)}</option>
              ))}
            </select>
          </label>
          <span className="pb-2 font-mono text-[10px] text-zinc-400">{t(locale, "cmp.vs")}</span>
          <label className="block text-[11px]">
            <span className="mb-1 block font-medium text-zinc-500">{t(locale, "cmp.method")} B</span>
            <select
              className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-[12px] outline-none hover:border-zinc-400 focus:border-zinc-600 focus:ring-2 focus:ring-zinc-600/15 dark:border-zinc-700 dark:bg-zinc-900"
              value={b}
              onChange={(e) => setB(e.target.value)}
            >
              {ORDER.map((id) => (
                <option key={id} value={id}>{t(locale, `mod.${id}`)}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <section className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        {pair.map((id, i) => {
          const row = ROWS[id];
          return (
            <article key={`${id}-${i}`} className="border-t border-zinc-300 pt-3 dark:border-zinc-700">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[15px] font-semibold">{t(locale, `mod.${id}`)}</h2>
                <Badge tone="zinc">{i === 0 ? "A" : "B"}</Badge>
              </div>
              <p className="mt-1 text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">{t(locale, `mod.${id}.d`)}</p>
              <div className="mt-4 space-y-2.5">
                <Meter label={t(locale, "cmp.speed")} value={row.speed} />
                <Meter label={t(locale, "cmp.cost")} value={row.costN} />
                <Meter label={t(locale, "cmp.access")} value={row.access} />
              </div>
              <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-400">{t(locale, "cmp.scale")}</p>
              <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2.5 text-[12px]">
                {[
                  ["cmp.speed", row.confirm],
                  ["cmp.settle", row.settle],
                  ["cmp.cost", row.cost],
                  ["cmp.access", row.needs],
                  ["cmp.reverse", row.rev],
                  ["cmp.best", row.best]
                ].map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-[10px] uppercase tracking-[0.1em] text-zinc-400">{t(locale, key)}</dt>
                    <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">{value}</dd>
                  </div>
                ))}
              </dl>
              <Link
                href={`/simulate/${id}`}
                className="mt-4 inline-flex items-center gap-1 text-[12px] font-semibold text-zinc-800 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-600 dark:text-zinc-300"
              >
                {t(locale, "home.start")} <span aria-hidden>→</span>
              </Link>
            </article>
          );
        })}
      </section>

      <section className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-y border-zinc-200 text-[12px] dark:border-zinc-800">
          <thead>
            <tr className="text-start text-[10px] uppercase tracking-[0.1em] text-zinc-500">
              <th className="px-2 py-2 text-start font-semibold">
                <button type="button" onClick={() => setSort("id")} className="hover:text-zinc-900 dark:hover:text-zinc-100">
                  {t(locale, "cmp.method")} <span aria-hidden>↕</span>
                </button>
              </th>
              <th className="px-2 py-2 text-start font-semibold">
                <button type="button" onClick={() => setSort("speed")} className="hover:text-zinc-900 dark:hover:text-zinc-100">
                  {t(locale, "cmp.speed")} <span aria-hidden>↕</span>
                </button>
              </th>
              <th className="px-2 py-2 text-start font-semibold">{t(locale, "cmp.settle")}</th>
              <th className="px-2 py-2 text-start font-semibold">
                <button type="button" onClick={() => setSort("costN")} className="hover:text-zinc-900 dark:hover:text-zinc-100">
                  {t(locale, "cmp.cost")} <span aria-hidden>↕</span>
                </button>
              </th>
              <th className="px-2 py-2 text-start font-semibold">
                <button type="button" onClick={() => setSort("access")} className="hover:text-zinc-900 dark:hover:text-zinc-100">
                  {t(locale, "cmp.access")} <span aria-hidden>↕</span>
                </button>
              </th>
              <th className="px-2 py-2 text-start font-semibold">{t(locale, "cmp.reverse")}</th>
              <th className="px-2 py-2 text-start font-semibold">{t(locale, "cmp.best")}</th>
            </tr>
          </thead>
          <tbody>
            {ids.map((id) => {
              const selected = pair.includes(id);
              return (
                <tr key={id} className={`border-t border-zinc-200 dark:border-zinc-800 ${selected ? "bg-zinc-50/70 dark:bg-zinc-950/30" : ""}`}>
                  <td className="px-2 py-2 font-semibold">
                    <Link href={`/simulate/${id}`} className={selected ? "text-zinc-800 dark:text-zinc-300" : "hover:text-zinc-800 dark:hover:text-zinc-300"}>
                      {t(locale, `mod.${id}`)}
                    </Link>
                  </td>
                  <td className="px-2 py-2 tnum">{ROWS[id].confirm}</td>
                  <td className="px-2 py-2 tnum">{ROWS[id].settle}</td>
                  <td className="px-2 py-2 tnum">{ROWS[id].cost}</td>
                  <td className="px-2 py-2">{ROWS[id].needs}</td>
                  <td className="px-2 py-2">{ROWS[id].rev}</td>
                  <td className="px-2 py-2">{ROWS[id].best}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
