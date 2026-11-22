"use client";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isRTL, type Locale } from "@/i18n/dict";

interface Prefs {
  locale: Locale;
  setLocale: (l: Locale) => void;
  dark: boolean;
  setDark: (d: boolean) => void;
  projector: boolean;
  setProjector: (p: boolean) => void;
}

const Ctx = createContext<Prefs | null>(null);

export function Providers({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("en");
  const [dark, setDark] = useState(false);
  const [projector, setProjector] = useState(false);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRTL(locale) ? "rtl" : "ltr";
  }, [locale]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("projector", projector);
  }, [dark, projector]);

  const value = useMemo<Prefs>(
    () => ({ locale, setLocale, dark, setDark, projector, setProjector }),
    [locale, dark, projector]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs(): Prefs {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePrefs outside Providers");
  return v;
}
