"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { usePrefs } from "./providers";
import { t } from "@/i18n/dict";

const LINKS = [
  { href: "/", key: "nav.dashboard" },
  { href: "/compare", key: "nav.compare" },
  { href: "/glossary", key: "nav.glossary" },
  { href: "/safety", key: "nav.safety" }
] as const;

export function TopNav() {
  const { locale, setLocale, dark, setDark, projector, setProjector } = usePrefs();
  const pathname = usePathname();

  const active = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/simulate") : pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
      <a
        href="#main"
        className="sr-only rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white focus:not-sr-only focus:absolute focus:start-4 focus:top-2 focus:z-50 dark:bg-white dark:text-zinc-900"
      >
        {t(locale, "a11y.skip")}
      </a>
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2" aria-label="SimPay Lab">
          <span className="text-[17px] font-semibold tracking-[-0.03em]">SimPay</span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">Lab</span>
        </Link>

        <nav className="order-3 flex w-full items-center gap-1 overflow-x-auto text-[13px] sm:order-none sm:w-auto" aria-label="Main">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active(l.href) ? "page" : undefined}
              className={`flex h-8 shrink-0 items-center border-b-2 px-2 font-medium transition-colors ${
                active(l.href)
                  ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-50"
                  : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              {t(locale, l.key)}
            </Link>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-1.5 text-[12px]">
          <select
            aria-label={t(locale, "nav.lang")}
            className="h-8 rounded-md border border-zinc-300 bg-transparent px-1.5 font-medium text-zinc-600 outline-none hover:border-zinc-400 focus-visible:border-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
            value={locale}
            onChange={(e) => setLocale(e.target.value as typeof locale)}
          >
            <option value="en">EN</option>
            <option value="fr">FR</option>
            <option value="ar">AR</option>
          </select>

          <button
            type="button"
            onClick={() => setDark(!dark)}
            aria-label={dark ? t(locale, "nav.light") : t(locale, "nav.dark")}
            title={dark ? t(locale, "nav.light") : t(locale, "nav.dark")}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-300 text-zinc-600 transition-colors hover:border-zinc-400 hover:text-zinc-900 active:translate-y-px dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-zinc-50"
          >
            {dark ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
              </svg>
            )}
          </button>

          <button
            type="button"
            onClick={() => setProjector(!projector)}
            aria-pressed={projector}
            className={`h-8 rounded-md border px-2 font-medium transition-colors active:translate-y-px ${
              projector
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-zinc-50"
            }`}
          >
            {t(locale, "nav.projector")}
          </button>
        </div>
      </div>
    </header>
  );
}

/* ---------------- primitives ---------------- */

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 ${className}`}>{children}</div>;
}

export function Btn({
  children,
  onClick,
  variant = "primary",
  small,
  disabled,
  title,
  type = "button"
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "outline" | "danger";
  small?: boolean;
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-[background-color,border-color,color,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/30";
  const size = small ? "h-8 px-2.5 text-[12px]" : "h-9 px-3.5 text-[13px]";
  const style =
    variant === "primary"
      ? "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      : variant === "danger"
        ? "bg-red-700 text-white hover:bg-red-600"
        : variant === "outline"
          ? "border border-zinc-300 bg-transparent text-zinc-700 hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50";
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${base} ${size} ${style}`}>
      {children}
    </button>
  );
}

export function Badge({ children, tone = "zinc" }: { children: ReactNode; tone?: "zinc" | "green" | "red" | "amber" | "blue" }) {
  const tones: Record<string, string> = {
    zinc: "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
    red: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
    amber: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-400/10 dark:text-amber-200",
    blue: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300"
  };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-4 ${tones[tone]}`}>{children}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-[12px]">
      <span className="mb-1 block font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  "w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 hover:border-zinc-400 focus:border-zinc-600 focus:ring-2 focus:ring-zinc-500/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600";

export function Kicker({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 ${className}`}>{children}</div>;
}
