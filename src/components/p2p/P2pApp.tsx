/**
 * CirclePay — a social peer-to-peer payment app (original branding).
 * One shared sitting across tabs: onboarding -> friends directory -> send /
 * request / split wizards with review screens -> three funding rails
 * (balance instant+free, card instant+fee+limit, bank pending overnight) ->
 * privacy-aware activity feed -> wallet, notifications, settings, teach.
 * User switching is an explicit recipient preview; acting stays with the
 * signed-in profile while payback buttons simulate counterparties.
 */
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  computeWaterfall,
  createP2pFlow,
  createRunBase,
  defaultFeeRules,
  p2pAdvance,
  p2pResult,
  p2pUsers,
  type Audience,
  type FailureId,
  type P2pAction,
  type P2pFlow,
  type RunResult,
  type SimEvent
} from "@sim/engine";
import { t } from "@/i18n/dict";
import { formatMoney, formatT, listSessions, saveSession, type StoredSession } from "@/lib/sim";
import { usePrefs } from "../providers";
import { Badge, Btn, Card } from "../ui";
import { EmptyNote, StepHead, Time, inpCls, useSpecReset } from "../flows/kit";

const CCY = "EUR";
const PROFILE_KEY = "simpay.p2p.profile.v2";
const CONTACTS_KEY = "simpay.p2p.contacts.v2";
const SOURCES_KEY = "simpay.p2p.sources.v1";
const SETTINGS_KEY = "simpay.p2p.settings.v1";
const SITTING_KEY = "simpay.p2p.sitting.v1";
const NOTE_MAX = 140;
const CARD_TX_LIMIT = 50000;

interface Contact {
  handle: string;
  name: string;
  desc: string;
}
interface Source {
  id: string;
  kind: "card" | "bank";
  label: string;
  acct: string;
  isDefault: boolean;
}
interface Settings {
  audience: Audience;
  notifReq: boolean;
  notifFeed: boolean;
}
interface Profile {
  name: string;
  handle: string;
}

const SEED_CONTACTS: Contact[] = [
  { handle: "@maya-p", name: "Maya Chen", desc: "Designer, settles up fast" },
  { handle: "@jonasw", name: "Jonas Weber", desc: "Roommate, pays late" },
  { handle: "@priya-n", name: "Priya Nair", desc: "Classmate, splits everything" },
  { handle: "@samh-dz", name: "Sam Haddad", desc: "Cousin, always hungry" },
  { handle: "@lucia-g", name: "Lucia Gomez", desc: "Teammate, tracks every cent" }
];
const SEED_SOURCES: Source[] = [
  { id: "src-card", kind: "card", label: "Demo debit", acct: "40000012", isDefault: true },
  { id: "src-bank", kind: "bank", label: "Demo checking", acct: "12345678", isDefault: false }
];
const HUES = ["bg-sky-600", "bg-emerald-600", "bg-amber-600", "bg-rose-600", "bg-indigo-600", "bg-teal-600"];

function load<T>(key: string, fallback: T): T {
  try {
    if (typeof window === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* noop */ }
}
function hueFor(handle: string): string {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}
const major = (v: string) => Math.round(Number(v.replace(",", ".")) * 100);

function Avatar({ handle, name, size = "md" }: { handle: string; name: string; size?: "sm" | "md" | "lg" }) {
  const cls = size === "lg" ? "h-14 w-14 text-xl" : size === "sm" ? "h-6 w-6 text-[10px]" : "h-9 w-9 text-sm";
  const initials = name.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${cls} ${hueFor(handle)}`} aria-hidden>
      {initials}
    </span>
  );
}

type Tab = "home" | "friends" | "pay" | "activity" | "wallet" | "settings";

export function P2pApp({ seed, params, failures, onLive }: {
  seed: number;
  params: Record<string, unknown>;
  failures: FailureId[];
  onLive: (r: RunResult) => void;
}) {
  const { locale } = usePrefs();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [asUser, setAsUser] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [settings, setSettings] = useState<Settings>({ audience: "friends", notifReq: true, notifFeed: true });
  const [tab, setTab] = useState<Tab>("home");
  const [notice, setNotice] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [seenNotifs, setSeenNotifs] = useState(0);
  const [showNotifs, setShowNotifs] = useState(false);
  const [detail, setDetail] = useState<SimEvent | null>(null);
  const [orders, setOrders] = useState<StoredSession[]>([]);
  const [payView, setPayView] = useState<"menu" | "send" | "request" | "split">("menu");
  const [sendStep, setSendStep] = useState<"pick" | "compose" | "review" | "processing" | "result">("pick");
  const [draft, setDraft] = useState({ to: "", amount: "", note: "", funding: "balance", audience: "friends" as Audience });
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [sendDone, setSendDone] = useState<"ok" | "pending" | null>(null);
  const [req, setReq] = useState({ from: "", amount: "", note: "" });
  const [split, setSplit] = useState({ total: "", note: "", includeMe: true, legs: [{ to: "", share: "" }, { to: "", share: "" }] as { to: string; share: string }[] });
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [obName, setObName] = useState("");
  const [obHandle, setObHandle] = useState("");
  const [obErr, setObErr] = useState<string | null>(null);
  const [topSrc, setTopSrc] = useState("");
  const [topAmount, setTopAmount] = useState("");
  const [q, setQ] = useState("");
  const [ncName, setNcName] = useState("");
  const [ncHandle, setNcHandle] = useState("");
  const [nsLabel, setNsLabel] = useState("");
  const [nsKind, setNsKind] = useState<"card" | "bank">("card");
  const [nsAcct, setNsAcct] = useState("");
  const [proName, setProName] = useState("");
  const [proHandle, setProHandle] = useState("");

  const flowRef = useRef<P2pFlow | null>(null);
  const timers = useRef<number[]>([]);

  // ---------- persistence ----------
  useEffect(() => {
    setProfile(load<Profile | null>(PROFILE_KEY, null));
    const c = load<Contact[] | null>(CONTACTS_KEY, null);
    setContacts(c ?? SEED_CONTACTS);
    if (!c) store(CONTACTS_KEY, SEED_CONTACTS);
    const s = load<Source[] | null>(SOURCES_KEY, null);
    setSources(s ?? SEED_SOURCES);
    if (!s) store(SOURCES_KEY, SEED_SOURCES);
    setSettings(load<Settings>(SETTINGS_KEY, { audience: "friends", notifReq: true, notifFeed: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (profile && !asUser) {
      setAsUser(profile.handle);
      setProName(profile.name);
      setProHandle(profile.handle);
    }
  }, [profile, asUser]);
  useEffect(() => () => { timers.current.forEach((id) => window.clearTimeout(id)); }, []);
  useEffect(() => {
    if (tab === "activity") setOrders(listSessions().filter((s) => s.spec.moduleId === "p2p"));
  }, [tab]);

  const specKey = JSON.stringify({ seed, params, failures });
  useSpecReset(specKey, () => {
    flowRef.current = null;
    try { localStorage.removeItem(SITTING_KEY); } catch { /* noop */ }
  });

  const persistSitting = () => {
    const flow = flowRef.current;
    if (!flow) return;
    store(SITTING_KEY, { seed, params, failures, actions: flow.transcript });
  };
  const sitting = (): P2pFlow => {
    if (!flowRef.current) {
      flowRef.current = createP2pFlow(createRunBase("p2p", { seed, params, failures }), profile?.handle ?? "@you");
    }
    return flowRef.current;
  };
  useEffect(() => {
    if (!profile) return;
    const saved = load<{ seed: number; params: unknown; failures: unknown; actions: P2pAction[] } | null>(SITTING_KEY, null);
    if (!saved) return;
    if (JSON.stringify({ seed: saved.seed, params: saved.params, failures: saved.failures }) !== specKey) return;
    try {
      const flow = createP2pFlow(createRunBase("p2p", { seed, params, failures }), profile.handle);
      for (const a of saved.actions) p2pAdvance(flow, a);
      flowRef.current = flow;
      onLive(p2pResult(flow));
    } catch {
      flowRef.current = null;
      try { localStorage.removeItem(SITTING_KEY); } catch { /* noop */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const push = (): RunResult => {
    const r = p2pResult(flowRef.current!);
    onLive(r);
    persistSitting();
    return r;
  };
  const act = (action: P2pAction): void => {
    p2pAdvance(sitting(), action);
    push();
  };
  const runWith = (label: string, fn: () => void) => {
    setProcessing(label);
    timers.current.push(window.setTimeout(() => {
      try {
        fn();
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      }
      setProcessing(null);
    }, 750));
  };

  const doTopup = () => {
    const amt = major(topAmount);
    if (!(amt > 0) || topSrc.replace(/\D/g, "").length < 6) { setNotice(t(locale, "pp.topBad")); return; }
    runWith(t(locale, "pv.processing"), () => {
      act({ type: "topup", amountMinor: amt, account: topSrc.trim() });
      setNotice(`${t(locale, "pp.topped")}: ${formatMoney(p2pUsers(flowRef.current!).me ?? 0, CCY, locale)}`);
      setTopAmount("");
    });
  };

  const flow = flowRef.current;
  const users = flow ? p2pUsers(flow) : {};
  const myHandle = profile?.handle ?? "@you";
  const previewing = asUser !== "" && asUser !== myHandle;

  // ---------- directory ----------
  const directory: Contact[] = useMemo(() => {
    const mine: Contact[] = profile ? [{ handle: profile.handle, name: `${profile.name} (you)`, desc: "" }] : [];
    return [...mine, ...contacts];
  }, [profile, contacts]);
  const nameOf = (h: string) => directory.find((c) => c.handle === h)?.name ?? h;
  const searchHits = q.trim().length === 0 ? directory
    : directory.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.handle.toLowerCase().includes(q.toLowerCase()));
  const recentPartners = useMemo(() => {
    const seen: string[] = [];
    for (const e of flow?.ctx.events ?? []) {
      const p = e.payload as Record<string, unknown>;
      for (const h of [p.to, p.from]) {
        if (typeof h === "string" && h !== myHandle && !seen.includes(h)) seen.push(h);
      }
    }
    return seen.slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, notice]);

  // ---------- feed ----------
  interface FeedItem {
    id: string;
    from: string;
    to: string;
    note: string;
    amount?: number;
    audience: Audience;
    at: number;
    txId: string;
    ev: SimEvent;
  }
  const feedSitting: FeedItem[] = (flow?.ctx.events ?? [])
    .filter((e) => e.type === "FEED_POSTED")
    .map((e) => ({
      id: e.id, from: String(e.payload.from ?? "?"), to: String(e.payload.to ?? "?"),
      note: String(e.payload.note ?? ""), audience: (e.payload.audience as Audience) ?? "friends",
      at: e.t, txId: e.txId, ev: e
    }));
  const feedSaved: FeedItem[] = orders.flatMap((o) =>
    o.result.events.filter((e) => e.type === "FEED_POSTED").map((e) => ({
      id: `${o.id}-${e.id}`, from: String(e.payload.from ?? "?"), to: String(e.payload.to ?? "?"),
      note: String(e.payload.note ?? ""), audience: (e.payload.audience as Audience) ?? "friends",
      at: o.at, txId: o.result.txId, ev: e
    }))
  );
  const visible = (f: FeedItem) => {
    if (f.audience === "public") return true;
    if (f.audience === "friends") return true;
    return f.from === asUser || f.to === asUser;
  };
  const feed = [...feedSitting, ...feedSaved].filter(visible);

  // ---------- notifications ----------
  interface Notif {
    id: string;
    text: string;
    kind: "in" | "out" | "warn";
  }
  const notifs: Notif[] = [];
  if (flow && profile) {
    for (const e of flow.ctx.events) {
      const p = e.payload as Record<string, unknown>;
      const amt = (v: unknown) => formatMoney(Number(v ?? 0), CCY, locale);
      if (e.type === "REQUEST_PAID" && p.to === myHandle) notifs.push({ id: e.id, kind: "in", text: `${p.from} paid your request (${amt(p.amountMinor)})` });
      else if (e.type === "INCOMING_REQUEST" && settings.notifReq) notifs.push({ id: e.id, kind: "warn", text: `${p.from} requested ${amt(p.amountMinor)}` });
      else if (e.type === "LEG_PAID" && p.to === myHandle) notifs.push({ id: e.id, kind: "in", text: `${p.from} paid their split share` });
      else if (e.type === "P2P_SENT" && p.from === myHandle) notifs.push({ id: e.id, kind: "out", text: `Sent ${amt(p.amountMinor)} to ${p.to}` });
      else if (e.type === "TOPUP_FUNDED") notifs.push({ id: e.id, kind: "in", text: `Topped up ${amt(p.amountMinor)}` });
      else if (e.type === "P2P_PENDING") notifs.push({ id: e.id, kind: "warn", text: `Bank transfer pending: ${amt(p.amountMinor)} to ${p.to}` });
      else if (e.type === "BANK_PULL_FAILED") notifs.push({ id: e.id, kind: "warn", text: `Bank pull failed — reservation released, nobody paid` });
      else if (e.type === "REQUEST_SENT") notifs.push({ id: e.id, kind: "out", text: `Requested ${amt(p.amountMinor)} from ${p.from}` });
      else if (e.type === "SPLIT_CREATED" && settings.notifFeed) notifs.push({ id: e.id, kind: "out", text: `Split ${amt(p.totalMinor)} across ${String(p.legs)} friends` });
    }
  }
  const unread = Math.max(0, notifs.length - seenNotifs);

  // ---------- funding helpers ----------
  const resolveFunding = (fundingId: string): "balance" | "card" | "bank" => {
    if (fundingId === "balance") return "balance";
    return sources.find((s) => s.id === fundingId)?.kind ?? "balance";
  };
  const feePreview = (fundingId: string, minor: number): number => {
    if (resolveFunding(fundingId) !== "card") return 0;
    return computeWaterfall(minor, defaultFeeRules("p2p")).totalFeesMinor;
  };
  const persistSources = (ss: Source[]) => {
    const clean = ss.map(({ id, kind, label, acct, isDefault }) => ({ id, kind, label, acct, isDefault }));
    setSources(clean);
    store(SOURCES_KEY, clean);
  };
  const persistSettings = (s: Settings) => {
    setSettings(s);
    store(SETTINGS_KEY, s);
  };

  // ---------- send wizard ----------
  const validAmount = (v: string) => /^\d+([.,]\d{1,2})?$/.test(v.trim()) && major(v) > 0;
  const beginSend = (to: string) => {
    setDraft({ to, amount: "", note: "", funding: "balance", audience: settings.audience });
    setSendErr(null);
    setSendDone(null);
    setSendStep("compose");
  };
  const reviewSend = () => {
    if (!validAmount(draft.amount)) { setSendErr(t(locale, "pv.amountBad")); return; }
    if (draft.note.length > NOTE_MAX) { setSendErr(t(locale, "pv.noteLong")); return; }
    if (draft.to.trim() === myHandle) { setSendErr(t(locale, "pv.selfPay")); return; }
    const amt = major(draft.amount);
    const f = resolveFunding(draft.funding);
    if (f === "card" && amt + feePreview(draft.funding, amt) > CARD_TX_LIMIT) { setSendErr(t(locale, "pv.cardLimit")); return; }
    if (f === "balance" && amt > (users[myHandle] ?? 0)) { setSendErr(t(locale, "pv.noFunds")); return; }
    setSendErr(null);
    setSendStep("review");
  };
  const confirmSend = () => {
    const amt = major(draft.amount);
    const f = resolveFunding(draft.funding);
    setSendStep("processing");
    runWith(t(locale, "pv.processing"), () => {
      try {
        act({ type: "send", to: draft.to.trim(), amountMinor: amt, note: draft.note.trim(), funding: f, audience: draft.audience });
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
        setSendStep("compose");
        return;
      }
      const st = flowRef.current!.stage;
      if (st === "pending_bank" || flowRef.current!.ctx.events.some((e) => e.type === "SETTLED" && e.id >= (flowRef.current!.ctx.events.find((ev) => ev.type === "P2P_SENT")?.id ?? ""))) {
        setSendDone(flowRef.current!.stage === "pending_bank" ? "pending" : "ok");
        setSendStep("result");
        setDraft({ to: "", amount: "", note: "", funding: "balance", audience: settings.audience });
      } else {
        const d = [...flowRef.current!.ctx.events].reverse().find((ev) => /DECLINED/.test(ev.type));
        setSendErr(d ? t(locale, "co.decline.insufficient-funds") : t(locale, "pv.failed"));
        setSendStep("compose");
      }
    });
  };

  // ---------- request ----------
  const doRequest = () => {
    const amt = major(req.amount);
    if (req.from.trim().length < 2 || !(amt > 0)) { setNotice(t(locale, "pp.sendBad")); return; }
    try {
      act({ type: "request", from: req.from.trim(), amountMinor: amt, note: req.note.trim(), audience: settings.audience });
      setNotice(t(locale, "pp.reqSent"));
      setReq({ from: "", amount: "", note: "" });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  // ---------- split ----------
  const evenSplit = () => {
    const total = major(split.total);
    const n = split.legs.length;
    if (!(total > 0) || n === 0) return;
    const myShare = split.includeMe ? Math.floor(total / (n + 1)) : 0;
    const rest = total - myShare;
    const each = Math.floor(rest / n);
    setSplit((s) => ({
      ...s,
      legs: s.legs.map((l, i) => ({ ...l, share: ((i === n - 1 ? rest - each * (n - 1) : each) / 100).toFixed(2) }))
    }));
  };
  const setLeg = (i: number, patch: Partial<{ to: string; share: string }>) =>
    setSplit((s) => ({ ...s, legs: s.legs.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const doSplit = () => {
    const total = major(split.total);
    const parsed = split.legs.map((l) => ({ to: l.to.trim(), shareMinor: major(l.share) }));
    if (!(total > 0)) { setNotice(t(locale, "pp.sendBad")); return; }
    try {
      const othersTotal = parsed.reduce((s, l) => s + l.shareMinor, 0);
      let engineTotal = total;
      let note = split.note.trim() || t(locale, "pp.splitNote");
      if (split.includeMe) {
        const myShare = total - othersTotal;
        if (myShare < 0) { setNotice(t(locale, "pp.splitBad")); return; }
        engineTotal = othersTotal;
        note = `${note} (${t(locale, "pv.myShare")}: ${formatMoney(myShare, CCY, locale)})`;
      } else if (othersTotal !== total) {
        setNotice(t(locale, "pp.splitBad"));
        return;
      }
      act({ type: "split", totalMinor: engineTotal, legs: parsed, note });
      setNotice(t(locale, "pp.splitDone"));
      setSplit({ total: "", note: "", includeMe: true, legs: [{ to: "", share: "" }, { to: "", share: "" }] });
    } catch {
      setNotice(t(locale, "pp.splitBad"));
    }
  };
  // ---------- reset ----------
  const resetDemo = () => {
    flowRef.current = null;
    try { localStorage.removeItem(SITTING_KEY); } catch { /* noop */ }
    persistContacts(SEED_CONTACTS);
    const p = { name: "Alex Rivers", handle: "@alex-r" };
    setProfile(p);
    store(PROFILE_KEY, p);
    setAsUser(p.handle);
    persistSources(SEED_SOURCES);
    persistSettings({ audience: "friends", notifReq: true, notifFeed: true });
    clearSessions();
    setTab("home");
    setPayView("menu");
    setSendStep("pick");
    setNotice(null);
  };
  const clearSessions = () => {
    try {
      const all = listSessions().filter((s) => s.spec.moduleId !== "p2p");
      localStorage.setItem("simpay.sessions.v1", JSON.stringify(all));
    } catch { /* noop */ }
    setOrders([]);
  };
  const saveSitting = () => {
    if (!flowRef.current || flowRef.current.ctx.events.length === 0) return;
    saveSession({ moduleId: "p2p", seed, params, failures }, p2pResult(flowRef.current));
    setNotice(t(locale, "pp.saved"));
    setOrders(listSessions().filter((s) => s.spec.moduleId === "p2p"));
  };
  const persistContacts = (c: Contact[]) => {
    setContacts(c);
    store(CONTACTS_KEY, c);
  };

  // ---------- onboarding gate ----------
  if (!profile) {
    return (
      <div className="mx-auto max-w-[380px] space-y-2">
        <Card className="space-y-2 p-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-sky-600 text-2xl font-bold text-white">C</div>
          <div className="text-lg font-bold">{t(locale, "pv.brand")}</div>
          <div className="text-[13px] text-zinc-500">{t(locale, "pv.onboardB")}</div>
          <label className="block text-left text-[13px]"><span className="mb-1 block font-medium">{t(locale, "pv.name")}</span>
            <input className={inpCls} value={obName} onChange={(e) => setObName(e.target.value)} placeholder="Alex Rivers" autoComplete="off" /></label>
          <label className="block text-left text-[13px]"><span className="mb-1 block font-medium">{t(locale, "pv.handle")}</span>
            <input dir="ltr" className={`${inpCls} font-mono`} value={obHandle} onChange={(e) => setObHandle(e.target.value)} placeholder="@alex-r" autoComplete="off" /></label>
          {obErr && <div className="text-[13px] text-red-700 dark:text-red-400">{obErr}</div>}
          <Btn onClick={() => {
            const h = obHandle.trim().toLowerCase();
            if (obName.trim().length < 2) { setObErr(t(locale, "co.err.required")); return; }
            if (!/^@[a-z0-9][a-z0-9-]{1,15}$/.test(h)) { setObErr(t(locale, "pv.handleBad")); return; }
            if (contacts.some((c) => c.handle === h)) { setObErr(t(locale, "pv.handleTaken")); return; }
            const p = { name: obName.trim(), handle: h };
            setProfile(p);
            store(PROFILE_KEY, p);
            setAsUser(h);
            setObErr(null);
          }}>{t(locale, "pv.create")}</Btn>
          <div className="text-[11px] text-zinc-500">{t(locale, "pv.fictional")}</div>
        </Card>
      </div>
    );
  }

  const meBal = users[myHandle] ?? 0;
  const viewContact = directory.find((c) => c.handle === asUser);
  const myPending = flow?.stage === "pending" ? flow.pendingRequest : null;
  const myIncoming = flow?.stage === "incoming" ? flow.pendingRequest : null;
  const bankPending = flow?.stage === "pending_bank" ? flow.pendingBank : null;
  const splitBoard = flow?.split ?? null;
  const collected = splitBoard ? splitBoard.legs.filter((l) => l.status === "paid").reduce((s, l) => s + l.shareMinor, 0) : 0;
  const outstanding = splitBoard ? splitBoard.legs.filter((l) => l.status === "pending").reduce((s, l) => s + l.shareMinor, 0) : 0;

  const nav: { id: Exclude<typeof tab, never>; label: string }[] = [
    { id: "home", label: t(locale, "pv.nav.home") },
    { id: "friends", label: t(locale, "pv.nav.friends") },
    { id: "pay", label: t(locale, "pv.nav.pay") },
    { id: "activity", label: t(locale, "pv.nav.activity") },
    { id: "wallet", label: t(locale, "pv.nav.wallet") },
    { id: "settings", label: t(locale, "pv.nav.settings") }
  ];

  return (
    <div className="space-y-2 pb-16 md:pb-0">
      {/* header */}
      <div className="flex items-center gap-2">
        <Avatar handle={myHandle} name={profile.name} />
        <div className="flex-1">
          <div className="font-bold leading-tight">{profile.name}</div>
          <div className="font-mono text-[12px] leading-tight text-zinc-500" dir="ltr">{myHandle}</div>
          <div className="flex items-center gap-1.5 text-[12px] text-zinc-500">
            <span>{t(locale, "pv.viewing")}</span>
            <select aria-label={t(locale, "pv.viewing")} className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 font-mono text-[12px] dark:border-zinc-700" value={asUser} onChange={(e) => setAsUser(e.target.value)}>
              <option value={myHandle}>{myHandle} ({t(locale, "pv.you")})</option>
              {contacts.map((c) => <option key={c.handle} value={c.handle}>{c.handle}</option>)}
            </select>
            {previewing && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200">{t(locale, "pv.preview")}</span>}
          </div>
        </div>
        <button aria-label={t(locale, "pv.notifs")} onClick={() => { setShowNotifs(!showNotifs); setSeenNotifs(notifs.length); }} className="relative rounded-full border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700">
          <span aria-hidden>◉</span>
          {unread > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">{unread}</span>}
        </button>
      </div>
      {/* desktop tabs */}
      <div className="hidden flex-wrap gap-1 md:flex">
        {nav.map((n) => (
          <button key={n.id} onClick={() => setTab(n.id)} className={`rounded-lg px-3 py-1 text-sm ${tab === n.id ? "bg-zinc-900 font-bold text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}>
            {n.label}
          </button>
        ))}
      </div>
      {notice && <div className="rounded-lg bg-sky-50 p-2 text-[13px] text-sky-900 dark:bg-sky-950 dark:text-sky-200">{notice}</div>}
      {processing && (
        <div className="flex items-center gap-2 rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-sky-600" />
          {processing}…
        </div>
      )}
      {showNotifs && (
        <Card className="space-y-1.5 p-3">
          <div className="font-semibold">{t(locale, "pv.notifs")}</div>
          {notifs.length === 0 && <EmptyNote>{t(locale, "pv.noNotifs")}</EmptyNote>}
          {notifs.slice().reverse().map((n) => (
            <div key={n.id} className={`rounded-lg p-2 text-[13px] ${n.kind === "warn" ? "bg-amber-50 dark:bg-amber-950" : n.kind === "in" ? "bg-emerald-50 dark:bg-emerald-950" : "bg-zinc-50 dark:bg-zinc-900"}`}>
              {n.text}
            </div>
          ))}
        </Card>
      )}

      {tab === "home" && (
        <div className="space-y-2">
          <Card className="p-4 text-center">
            <div className="text-[11px] uppercase tracking-widest text-zinc-500">{t(locale, "pv.homeBal")}</div>
            <div className="font-mono text-3xl font-bold">{formatMoney(meBal, CCY, locale)}</div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <Btn small onClick={() => { setPayView("menu"); setSendStep("pick"); setTab("pay"); }}>{t(locale, "pv.qaSend")}</Btn>
              <Btn small variant="outline" onClick={() => { setPayView("menu"); setTab("pay"); }}>{t(locale, "pv.qaReq")}</Btn>
              <Btn small variant="outline" onClick={() => { setPayView("menu"); setTab("pay"); }}>{t(locale, "pv.qaSplit")}</Btn>
            </div>
          </Card>
          {(myPending || myIncoming || bankPending || (splitBoard && outstanding > 0)) && (
            <Card className="space-y-1.5 p-3">
              <div className="font-semibold">{t(locale, "pv.pendingT")}</div>
              {myPending && (
                <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-2 text-[13px] dark:bg-amber-950">
                  <span className="flex-1">{t(locale, "pv.reqOutstanding")}: {myPending.from} · {formatMoney(myPending.amountMinor, CCY, locale)}</span>
                  <Btn small variant="outline" onClick={() => { act({ type: "friend_pays" }); setNotice(t(locale, "pp.reqPaid")); }}>{t(locale, "pp.friendPays")}</Btn>
                  <Btn small variant="outline" onClick={() => { act({ type: "cancel_request" }); setNotice(t(locale, "pv.reqCancelled")); }}>{t(locale, "pv.cancel")}</Btn>
                </div>
              )}
              {myIncoming && (
                <div className="rounded-lg border border-red-300 p-2 text-[13px] dark:border-red-800">
                  <b>{myIncoming.from}</b> → {formatMoney(myIncoming.amountMinor, CCY, locale)}
                  <div className="mt-1.5 flex gap-1.5">
                    <Btn small variant="danger" onClick={() => { act({ type: "answer_request", pay: true }); }}>{t(locale, "pp.scamPay")}</Btn>
                    <Btn small variant="outline" onClick={() => { act({ type: "answer_request", pay: false }); }}>{t(locale, "pp.scamDecline")}</Btn>
                  </div>
                </div>
              )}
              {bankPending && (
                <div className="rounded-lg bg-sky-50 p-2 text-[13px] dark:bg-sky-950">
                  {t(locale, "pv.bankPending")}: {formatMoney(bankPending.amountMinor, CCY, locale)} → {bankPending.to}
                  <div className="mt-1.5 flex gap-1.5">
                    <Btn small variant="outline" onClick={() => { act({ type: "settle_bank" }); }}>{t(locale, "pv.settleBank")}</Btn>
                    <Btn small variant="outline" onClick={() => { act({ type: "fail_bank" }); }}>{t(locale, "pv.failBank")}</Btn>
                  </div>
                </div>
              )}
              {splitBoard && outstanding > 0 && (
                <div className="rounded-lg bg-zinc-50 p-2 text-[13px] dark:bg-zinc-900">
                  {t(locale, "pp.splitTitle")}: {formatMoney(collected, CCY, locale)} / {formatMoney(splitBoard.totalMinor, CCY, locale)} · {t(locale, "pv.outstanding")}: {formatMoney(outstanding, CCY, locale)}
                </div>
              )}
            </Card>
          )}
          <Card className="space-y-1.5 p-3">
            <div className="font-semibold">{t(locale, "pv.recentT")}</div>
            {(!flow || flow.ctx.events.length === 0) && <EmptyNote>{t(locale, "pv.recentEmpty")}</EmptyNote>}
            {(flow?.ctx.events.filter((e) => ["P2P_SENT", "REQUEST_PAID", "TOPUP_FUNDED", "LEG_PAID"].includes(e.type)).slice(-3).reverse() ?? []).map((e) => (
              <button key={e.id} onClick={() => setDetail(e)} className="w-full rounded-lg bg-zinc-50 p-2 text-left text-[13px] dark:bg-zinc-900">
                <span className="font-mono font-bold">{e.type}</span> · <span className="font-mono">{typeof e.payload.amountMinor === "number" ? formatMoney(e.payload.amountMinor, CCY, locale) : typeof e.payload.shareMinor === "number" ? formatMoney(e.payload.shareMinor, CCY, locale) : ""}</span>
              </button>
            ))}
          </Card>
        </div>
      )}

      {tab === "friends" && (
        <div className="space-y-2">
          <input className={inpCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(locale, "pv.searchPh")} aria-label={t(locale, "pv.search")} />
          {searchHits.filter((c) => c.handle !== myHandle).length === 0 && <EmptyNote>{t(locale, "pv.noHits")}</EmptyNote>}
          {searchHits.filter((c) => c.handle !== myHandle).map((c) => (
            <Card key={c.handle} className="flex items-center gap-2.5 p-3">
              <Avatar handle={c.handle} name={c.name} />
              <div className="flex-1">
                <div className="text-sm font-bold">{c.name}</div>
                <div className="font-mono text-[12px] text-zinc-500">{c.handle}</div>
                {"desc" in c && (c as Contact).desc && <div className="text-[12px] text-zinc-500">{(c as Contact).desc}</div>}
              </div>
              <Btn small variant="outline" onClick={() => { setDraft({ to: c.handle, amount: "", note: "", funding: "balance", audience: settings.audience }); setSendErr(null); setSendStep("compose"); setPayView("menu"); setTab("pay"); }}>{t(locale, "pv.payReq")}</Btn>
              <button aria-label="remove" className="opacity-50" onClick={() => {
                const next = contacts.filter((x) => x.handle !== c.handle);
                setContacts(next);
                store(CONTACTS_KEY, next);
              }}>×</button>
            </Card>
          ))}
          <Card className="space-y-2 p-3">
            <StepHead title={t(locale, "pv.addContact")} />
            <div className="flex gap-1.5">
              <input className="flex-1 rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" value={ncName} onChange={(e) => setNcName(e.target.value)} placeholder={t(locale, "pv.name")} />
              <input dir="ltr" className="w-32 rounded-lg border border-zinc-300 px-2 py-1 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900" value={ncHandle} onChange={(e) => setNcHandle(e.target.value)} placeholder="@handle" />
              <Btn small onClick={() => {
                const h = ncHandle.trim().toLowerCase();
                if (ncName.trim().length < 2 || !/^@[a-z0-9][a-z0-9-]{1,15}$/.test(h)) { setNotice(t(locale, "pv.contactBad")); return; }
                if (h === myHandle || contacts.some((c) => c.handle === h)) { setNotice(t(locale, "pv.handleTaken")); return; }
                const next = [...contacts, { handle: h, name: ncName.trim(), desc: "" }];
                setContacts(next);
                store(CONTACTS_KEY, next);
                setNcName(""); setNcHandle("");
                setNotice(null);
              }}>{t(locale, "pp.add")}</Btn>
            </div>
          </Card>
          {recentPartners.length > 0 && (
            <Card className="space-y-1.5 p-3">
              <div className="font-semibold">{t(locale, "pv.recentPartners")}</div>
              <div className="flex flex-wrap gap-1.5">
                {recentPartners.map((h) => (
                  <button key={h} onClick={() => { setDraft({ to: h, amount: "", note: "", funding: "balance", audience: settings.audience }); setSendStep("compose"); setTab("pay"); }} className="rounded-full border border-zinc-300 px-2.5 py-0.5 font-mono text-[12px] dark:border-zinc-700">
                    {h}
                  </button>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === "pay" && (
        <div className="space-y-2">
          {payView === "menu" && sendStep === "pick" && (
            <div className="grid gap-1.5">
              {[
                { id: "send", t: "pv.act.send", d: "pv.act.sendD" },
                { id: "request", t: "pv.act.req", d: "pv.act.reqD" },
                { id: "split", t: "pv.act.split", d: "pv.act.splitD" }
              ].map((a) => (
                <button key={a.id} onClick={() => {
                  if (a.id === "send") { setDraft({ to: "", amount: "", note: "", funding: "balance", audience: settings.audience }); setSendErr(null); setSendStep("pick"); }
                  if (a.id === "request") { setReq({ from: "", amount: "", note: "" }); }
                  setPayView(a.id as "send" | "request" | "split");
                }} className="rounded-2xl border border-zinc-200 p-3 text-left dark:border-zinc-800">
                  <div className="text-sm font-bold">{t(locale, a.t)}</div>
                  <div className="text-[13px] text-zinc-500">{t(locale, a.d)}</div>
                </button>
              ))}
              <Card className="space-y-2 p-3">
                <StepHead title={t(locale, "pp.scamTitle")} sub={t(locale, "pp.scamSub")} />
                {!myIncoming ? (
                  <Btn small variant="outline" onClick={() => { act({ type: "incoming_request", from: "ghost-247", amountMinor: 5000 }); }}>{t(locale, "pp.scamSim")}</Btn>
                ) : (
                  <div className="rounded-lg border border-red-300 p-2 text-sm dark:border-red-800">
                    <div className="font-mono font-bold">{myIncoming.from} → {formatMoney(myIncoming.amountMinor, CCY, locale)}</div>
                    <div className="mt-1.5 flex gap-1.5">
                      <Btn small variant="danger" onClick={() => { act({ type: "answer_request", pay: true }); }}>{t(locale, "pp.scamPay")}</Btn>
                      <Btn small variant="outline" onClick={() => { act({ type: "answer_request", pay: false }); }}>{t(locale, "pp.scamDecline")}</Btn>
                    </div>
                  </div>
                )}
              </Card>
            </div>
          )}

          {payView === "send" && sendStep === "pick" && (
            <Card className="space-y-2 p-3">
              <StepHead title={t(locale, "pv.pickT")} />
              <input className={inpCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(locale, "pv.searchPh")} aria-label={t(locale, "pv.search")} />
              <div className="max-h-56 space-y-1 overflow-auto">
                {searchHits.filter((c) => c.handle !== myHandle).map((c) => (
                  <button key={c.handle} onClick={() => { setDraft({ to: c.handle, amount: "", note: "", funding: "balance", audience: settings.audience }); setSendErr(null); setSendStep("compose"); }} className="flex w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <Avatar handle={c.handle} name={c.name} size="sm" />
                    <span className="text-sm font-bold">{c.name}</span>
                    <span className="font-mono text-[12px] text-zinc-500">{c.handle}</span>
                  </button>
                ))}
              </div>
              <Btn small variant="outline" onClick={() => setPayView("menu")}>{t(locale, "wsh.back")}</Btn>
            </Card>
          )}

          {payView === "send" && sendStep === "compose" && (
            <Card className="space-y-2 p-3">
              <div className="flex items-center gap-2">
                <Avatar handle={draft.to} name={nameOf(draft.to)} />
                <div>
                  <div className="text-sm font-bold">{nameOf(draft.to)}</div>
                  <div className="font-mono text-[12px] text-zinc-500">{draft.to}</div>
                </div>
                <button className="ms-auto text-[12px] underline opacity-70" onClick={() => setSendStep("pick")}>{t(locale, "pv.change")}</button>
              </div>
              <label className="block text-center"><span className="mb-1 block text-[12px] font-bold uppercase tracking-widest text-zinc-500">{t(locale, "wa.amount")} ({CCY})</span>
                <input dir="ltr" inputMode="decimal" aria-label="amount" className="w-full bg-transparent text-center font-mono text-4xl font-bold outline-none" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value.replace(/[^0-9.,]/g, "") })} placeholder="0.00" autoComplete="off" /></label>
              <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "pp.note")} ({NOTE_MAX - draft.note.length})</span>
                <input className={inpCls} value={draft.note} maxLength={NOTE_MAX} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder={t(locale, "pp.notePh")} autoComplete="off" /></label>
              <div>
                <div className="mb-1 text-[13px] font-medium">{t(locale, "pv.funding")}</div>
                <div className="space-y-1">
                  <button onClick={() => setDraft({ ...draft, funding: "balance" })} className={`w-full rounded-xl border p-2 text-left text-[13px] ${draft.funding === "balance" ? "border-sky-500 bg-sky-50 dark:bg-sky-950" : "border-zinc-200 dark:border-zinc-800"}`}>
                    <div className="font-bold">{t(locale, "pv.fundBal")} · <span className="font-mono">{formatMoney(users[myHandle] ?? 0, CCY, locale)}</span></div>
                    <div className="text-zinc-500">{t(locale, "pv.fundBalD")}</div>
                  </button>
                  {sources.map((s) => (
                    <button key={s.id} onClick={() => setDraft({ ...draft, funding: s.id })} className={`w-full rounded-xl border p-2 text-left text-[13px] ${draft.funding === s.id ? "border-sky-500 bg-sky-50 dark:bg-sky-950" : "border-zinc-200 dark:border-zinc-800"}`}>
                      <div className="font-bold">{s.label} ••{s.acct.slice(-4)} {s.isDefault ? `· ${t(locale, "wm.isDefault")}` : ""}</div>
                      <div className="text-zinc-500">{s.kind === "card" ? t(locale, "pv.fundCardD") : t(locale, "pv.fundBankD")}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[13px] font-medium">{t(locale, "pv.privacy")}</div>
                <div className="flex gap-1">
                  {(["private", "friends", "public"] as const).map((a) => (
                    <button key={a} onClick={() => setDraft({ ...draft, audience: a })} className={`rounded-lg px-2.5 py-1 text-[13px] ${draft.audience === a ? "bg-zinc-900 font-bold text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}>
                      {t(locale, `pv.aud.${a}`)}
                    </button>
                  ))}
                </div>
              </div>
              {sendErr && <div className="text-[13px] text-red-700 dark:text-red-400">{sendErr}</div>}
              <div className="flex gap-1.5">
                <Btn small variant="outline" onClick={() => setSendStep("pick")}>{t(locale, "wsh.back")}</Btn>
                <Btn small onClick={reviewSend}>{t(locale, "pv.review")}</Btn>
              </div>
            </Card>
          )}

          {payView === "send" && sendStep === "review" && (
            <Card className="space-y-2 p-3">
              <div className="font-bold">{t(locale, "pv.reviewT")}</div>
              <div className="flex items-center gap-2 rounded-xl bg-zinc-50 p-2.5 dark:bg-zinc-900">
                <Avatar handle={draft.to} name={nameOf(draft.to)} />
                <div>
                  <div className="text-sm font-bold">{nameOf(draft.to)}</div>
                  <div className="font-mono text-[12px] text-zinc-500">{draft.to}</div>
                </div>
              </div>
              <div className="space-y-1 rounded-xl bg-zinc-50 p-3 font-mono text-[13px] dark:bg-zinc-900">
                <div className="flex justify-between"><span className="font-sans text-zinc-500">{t(locale, "wa.amount")}</span><span>{formatMoney(major(draft.amount), CCY, locale)}</span></div>
                <div className="flex justify-between"><span className="font-sans text-zinc-500">{t(locale, "pv.funding")}</span><span className="font-sans">{draft.funding === "balance" ? t(locale, "pv.fundBal") : sources.find((s) => s.id === draft.funding)?.label}</span></div>
                <div className="flex justify-between"><span className="font-sans text-zinc-500">{t(locale, "rm.fee")}</span><span>{formatMoney(feePreview(draft.funding, major(draft.amount)), CCY, locale)}</span></div>
                <div className="flex justify-between border-t border-zinc-200 pt-1 font-bold dark:border-zinc-800"><span className="font-sans font-medium text-zinc-500">{t(locale, "pv.totalDebit")}</span><span>{formatMoney(major(draft.amount) + feePreview(draft.funding, major(draft.amount)), CCY, locale)}</span></div>
                {draft.note && <div className="flex justify-between"><span className="font-sans text-zinc-500">{t(locale, "pp.note")}</span><span className="font-sans">{draft.note}</span></div>}
                <div className="flex justify-between"><span className="font-sans text-zinc-500">{t(locale, "pv.privacy")}</span><span className="font-sans">{t(locale, `pv.aud.${draft.audience}`)}</span></div>
              </div>
              <div className="flex gap-1.5">
                <Btn small variant="outline" onClick={() => setSendStep("compose")}>{t(locale, "wsh.back")}</Btn>
                <Btn small variant="outline" onClick={() => { setSendStep("pick"); }}>{t(locale, "wsh.cancel")}</Btn>
                <Btn small onClick={confirmSend}>{t(locale, "pv.confirm")}</Btn>
              </div>
            </Card>
          )}

          {payView === "send" && sendStep === "result" && (
            <Card className="space-y-2 p-3 text-center">
              {sendDone === "ok" ? (
                <>
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-xl font-bold text-white">✓</div>
                  <div className="font-bold">{t(locale, "pv.sentOk")}</div>
                  <div className="text-[13px] text-zinc-500">{t(locale, "pv.sentRef")}: {flow?.ctx.txId}</div>
                </>
              ) : (
                <>
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-sky-600 text-xl font-bold text-white">…</div>
                  <div className="font-bold">{t(locale, "pv.pendingOk")}</div>
                  <div className="text-[13px] text-zinc-500">{t(locale, "pv.pendingOkB")}</div>
                </>
              )}
              <div className="flex justify-center gap-1.5">
                <Btn small variant="outline" onClick={() => { setPayView("menu"); setSendStep("pick"); }}>{t(locale, "pv.done")}</Btn>
              </div>
            </Card>
          )}

          {payView === "request" && (
            <div className="space-y-2">
              <Card className="space-y-2 p-3">
                <StepHead title={t(locale, "pp.reqTitle")} />
                <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "pp.from")}</span>
                  <input list="pv-req-contacts" className={inpCls} value={req.from} onChange={(e) => setReq({ ...req, from: e.target.value })} placeholder="@handle" autoComplete="off" />
                  <datalist id="pv-req-contacts">{contacts.map((c) => <option key={c.handle} value={c.handle}>{c.name}</option>)}</datalist></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "wa.amount")} ({CCY})</span>
                    <input dir="ltr" inputMode="decimal" className={`${inpCls} font-mono`} value={req.amount} onChange={(e) => setReq({ ...req, amount: e.target.value.replace(/[^0-9.,]/g, "") })} placeholder="10.00" autoComplete="off" /></label>
                  <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "pp.note")}</span>
                    <input className={inpCls} value={req.note} maxLength={NOTE_MAX} onChange={(e) => setReq({ ...req, note: e.target.value })} autoComplete="off" /></label>
                </div>
                <div className="flex gap-1.5">
                  <Btn small variant="outline" onClick={() => setPayView("menu")}>{t(locale, "wsh.back")}</Btn>
                  <Btn small onClick={doRequest}>{t(locale, "pp.request")}</Btn>
                </div>
              </Card>
              <RequestCenterLive />
            </div>
          )}

          {payView === "split" && (
            <div className="space-y-2">
              <Card className="space-y-2 p-3">
                <StepHead title={t(locale, "pp.splitTitle")} sub={t(locale, "pp.splitSub")} />
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "pp.splitTotal")} ({CCY})</span>
                    <input dir="ltr" inputMode="decimal" className={`${inpCls} font-mono`} value={split.total} onChange={(e) => setSplit({ ...split, total: e.target.value.replace(/[^0-9.,]/g, "") })} placeholder="60.00" autoComplete="off" /></label>
                  <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "pp.note")}</span>
                    <input className={inpCls} value={split.note} onChange={(e) => setSplit({ ...split, note: e.target.value })} placeholder={t(locale, "pp.splitNote")} autoComplete="off" /></label>
                </div>
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={split.includeMe} onChange={(e) => setSplit({ ...split, includeMe: e.target.checked })} />
                  {t(locale, "pv.includeMe")}
                </label>
                {split.legs.map((l, i) => (
                  <div key={i} className="grid grid-cols-[1fr_100px_32px] gap-1.5">
                    <input list="pv-split-contacts" className="rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" value={l.to} onChange={(e) => setLeg(i, { to: e.target.value })} placeholder="@handle" />
                    <input dir="ltr" inputMode="decimal" className="rounded-lg border border-zinc-300 px-2 py-1 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900" value={l.share} onChange={(e) => setLeg(i, { share: e.target.value.replace(/[^0-9.,]/g, "") })} placeholder="0.00" />
                    <button aria-label="remove leg" className="rounded border border-zinc-300 dark:border-zinc-700" onClick={() => setSplit({ ...split, legs: split.legs.filter((_, j) => j !== i) })}>×</button>
                  </div>
                ))}
                <datalist id="pv-split-contacts">{contacts.map((c) => <option key={c.handle} value={c.handle}>{c.name}</option>)}</datalist>
                <ShareHint />
                <div className="flex gap-1.5">
                  <Btn small variant="outline" onClick={evenSplit}>{t(locale, "pv.evenSplit")}</Btn>
                  <Btn small variant="outline" onClick={() => setSplit({ ...split, legs: [...split.legs, { to: "", share: "" }] })}>+ {t(locale, "pp.addLeg")}</Btn>
                  <Btn small onClick={doSplit}>{t(locale, "pp.splitGo")}</Btn>
                </div>
                <Btn small variant="outline" onClick={() => setPayView("menu")}>{t(locale, "wsh.back")}</Btn>
              </Card>
              <SplitBoard />
            </div>
          )}
        </div>
      )}

      {tab === "activity" && (
        <div className="space-y-2">
          <div className="flex gap-1.5">
            <Btn small variant="outline" onClick={saveSitting}>{t(locale, "pp.saveSitting")}</Btn>
          </div>
          {feed.length === 0 && <EmptyNote>{t(locale, "pp.feedEmpty")}</EmptyNote>}
          {feed.map((f) => (
            <button key={f.id} onClick={() => setDetail(f.ev)} className="w-full rounded-xl border border-zinc-200 p-2.5 text-left dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <Avatar handle={f.from} name={nameOf(f.from)} size="sm" />
                <div className="flex-1 text-[13px]">
                  <b>{nameOf(f.from)}</b> → <b>{nameOf(f.to)}</b>
                  <div className="text-zinc-500">{f.note || "—"}</div>
                </div>
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800">{f.audience}</span>
              </div>
            </button>
          ))}
          {orders.length > 0 && (
            <Card className="space-y-1.5 p-3">
              <div className="text-[12px] font-bold uppercase tracking-widest text-zinc-500">{t(locale, "pv.earlier")}</div>
              {orders.slice(0, 5).map((o) => (
                <div key={o.id} className="flex items-center gap-2 text-[13px]">
                  <span className="font-mono">{o.result.txId}</span>
                  <Badge tone={o.result.finalState === "SETTLED" ? "green" : "red"}>{o.result.finalState}</Badge>
                  <span className="ms-auto text-zinc-500"><Time at={o.at} /></span>
                </div>
              ))}
            </Card>
          )}
          <Teach />
        </div>
      )}

      {tab === "wallet" && (
        <div className="space-y-2">
          <Card className="p-4 text-center">
            <div className="text-[11px] uppercase tracking-widest text-zinc-500">{t(locale, "pv.viewBal").replace("{u}", asUser)}</div>
            <div className="font-mono text-3xl font-bold">{formatMoney(users[asUser] ?? 0, CCY, locale)}</div>
            {previewing && <div className="mt-1 text-[12px] text-amber-700 dark:text-amber-300">{t(locale, "pv.previewNote")}</div>}
          </Card>
          {bankPending && (
            <Card className="space-y-1.5 p-3">
              <div className="font-semibold">{t(locale, "pv.bankPending")}: {formatMoney(bankPending.amountMinor, CCY, locale)} → {bankPending.to}</div>
              <div className="text-[13px] text-zinc-500">{t(locale, "pv.bankPendingB")}</div>
              <div className="flex gap-1.5">
                <Btn small variant="outline" onClick={() => { act({ type: "settle_bank" }); }}>{t(locale, "pv.settleBank")}</Btn>
                <Btn small variant="outline" onClick={() => { act({ type: "fail_bank" }); }}>{t(locale, "pv.failBank")}</Btn>
              </div>
            </Card>
          )}
          <Card className="space-y-2 p-3">
            <StepHead title={t(locale, "pv.topupT")} />
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "pv.bankSrc")}</span>
                <select className={inpCls} value={topSrc} onChange={(e) => setTopSrc(e.target.value)}>
                  <option value="">—</option>
                  {sources.filter((s) => s.kind === "bank").map((s) => <option key={s.id} value={s.acct}>{s.label} ••{s.acct.slice(-4)}</option>)}
                </select></label>
              <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "wa.amount")} ({CCY})</span>
                <input dir="ltr" inputMode="decimal" className={`${inpCls} font-mono`} value={topAmount} onChange={(e) => setTopAmount(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="50" autoComplete="off" /></label>
            </div>
            <div><Btn small onClick={doTopup}>{t(locale, "pp.topup")}</Btn></div>
          </Card>
          <Card className="space-y-1.5 p-3">
            <div className="font-semibold">{t(locale, "pv.sourcesT")}</div>
            <div className="text-[13px] text-zinc-500">{t(locale, "pv.sourcesB")}</div>
            {sources.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg bg-zinc-50 p-2 text-[13px] dark:bg-zinc-900">
                <div className="flex-1">
                  <div className="font-bold">{s.label} ···· {s.acct.slice(-4)} {s.isDefault ? `· ${t(locale, "wm.isDefault")}` : ""}</div>
                  <div className="text-zinc-500">{s.kind === "card" ? t(locale, "pv.srcCardD") : t(locale, "pv.srcBankD")}</div>
                </div>
                {!s.isDefault && <button className="text-[12px] underline opacity-70" onClick={() => persistSources(sources.map((x) => ({ ...x, isDefault: x.id === s.id })))}>{t(locale, "wm.setDefault")}</button>}
                <button className="text-[12px] underline opacity-70" onClick={() => persistSources(sources.filter((x) => x.id !== s.id))}>{t(locale, "wa.forget")}</button>
              </div>
            ))}
            <div className="grid grid-cols-3 gap-1.5">
              <input className="rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" value={nsLabel} onChange={(e) => setNsLabel(e.target.value)} placeholder={t(locale, "pv.srcLabel")} />
              <select className="rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" value={nsKind} onChange={(e) => setNsKind(e.target.value as "card" | "bank")}>
                <option value="card">{t(locale, "pv.srcCard")}</option>
                <option value="bank">{t(locale, "pv.srcBank")}</option>
              </select>
              <input dir="ltr" inputMode="numeric" className="rounded-lg border border-zinc-300 px-2 py-1 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900" value={nsAcct} onChange={(e) => setNsAcct(e.target.value.replace(/\D/g, "").slice(0, 12))} placeholder="40000012" />
            </div>
            <div><Btn small variant="outline" onClick={() => {
              if (nsLabel.trim().length < 2 || nsAcct.replace(/\D/g, "").length < 6) { setNotice(t(locale, "pv.srcBad")); return; }
              persistSources([...sources, { id: `src-${Date.now()}`, kind: nsKind, label: nsLabel.trim(), acct: nsAcct.replace(/\D/g, ""), isDefault: sources.length === 0 }]);
              setNsLabel(""); setNsAcct("");
            }}>{t(locale, "pv.srcAdd")}</Btn></div>
          </Card>
        </div>
      )}

      {tab === "settings" && (
        <div className="space-y-2">
          <Card className="space-y-2 p-3">
            <div className="font-semibold">{t(locale, "pv.profileT")}</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "pv.name")}</span>
                <input className={inpCls} value={proName} onChange={(e) => setProName(e.target.value)} /></label>
              <label className="block text-[13px]"><span className="mb-1 block font-medium">{t(locale, "pv.handle")}</span>
                <input dir="ltr" className={`${inpCls} font-mono`} value={proHandle} onChange={(e) => setProHandle(e.target.value)} /></label>
            </div>
            <div><Btn small variant="outline" onClick={() => {
              const h = proHandle.trim().toLowerCase();
              if (proName.trim().length < 2 || !/^@[a-z0-9][a-z0-9-]{1,15}$/.test(h) || contacts.some((c) => c.handle === h)) { setNotice(t(locale, "pv.profileBad")); return; }
              const p = { name: proName.trim(), handle: h };
              setProfile(p);
              store(PROFILE_KEY, p);
              setAsUser(h);
              setNotice(null);
            }}>{t(locale, "pv.saveProfile")}</Btn></div>
          </Card>
          <Card className="space-y-2 p-3">
            <div className="font-semibold">{t(locale, "pv.privacyT")}</div>
            <div className="text-[13px] text-zinc-500">{t(locale, "pv.privacyB")}</div>
            <div className="flex gap-1">
              {(["private", "friends", "public"] as const).map((a) => (
                <button key={a} onClick={() => persistSettings({ ...settings, audience: a })} className={`rounded-lg px-2.5 py-1 text-[13px] ${settings.audience === a ? "bg-zinc-900 font-bold text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}>
                  {t(locale, `pv.aud.${a}`)}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={settings.notifReq} onChange={(e) => persistSettings({ ...settings, notifReq: e.target.checked })} />
              {t(locale, "pv.notifReq")}
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={settings.notifFeed} onChange={(e) => persistSettings({ ...settings, notifFeed: e.target.checked })} />
              {t(locale, "pv.notifFeed")}
            </label>
          </Card>
          <Card className="space-y-1.5 p-3 text-sm">
            <div className="font-semibold">{t(locale, "wm.resetT")}</div>
            <div className="text-[13px] text-zinc-500">{t(locale, "pv.resetB")}</div>
            <ResetBtn onReset={resetDemo} />
          </Card>
        </div>
      )}

      {/* mobile bottom nav + detail modal + processing veil */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 md:hidden" aria-label="CirclePay">
        <div className="grid grid-cols-6">
          {nav.map((n) => (
            <button key={n.id} onClick={() => setTab(n.id)} className={`py-2 text-[10px] font-bold ${tab === n.id ? "text-sky-700 dark:text-sky-300" : "text-zinc-500"}`}>
              {n.label}
            </button>
          ))}
        </div>
      </nav>

      {detail && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 p-3 sm:items-center" onClick={() => setDetail(null)}>
          <div className="w-full max-w-[420px] space-y-1.5 rounded-2xl bg-white p-4 text-sm dark:bg-zinc-950" onClick={(e) => e.stopPropagation()}>
            <DetailBody ev={detail} />
            <div className="pt-1"><Btn small variant="outline" onClick={() => setDetail(null)}>{t(locale, "pv.close")}</Btn></div>
          </div>
        </div>
      )}
    </div>
  );

  function DetailBody({ ev }: { ev: SimEvent }) {
    const p = ev.payload as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === "number" ? formatMoney(v, CCY, locale) : "—");
    return (
      <>
        <div className="font-mono text-[12px] text-zinc-500">{ev.type} · {ev.txId}</div>
        <div className="font-bold">{t(locale, "pv.detailT")}</div>
        <div className="space-y-0.5 rounded-xl bg-zinc-50 p-2.5 font-mono text-[12px] dark:bg-zinc-900">
          {"from" in p && <div className="flex justify-between"><span className="font-sans text-zinc-500">from</span><span>{String(p.from)}</span></div>}
          {"to" in p && <div className="flex justify-between"><span className="font-sans text-zinc-500">to</span><span>{String(p.to)}</span></div>}
          {"amountMinor" in p && <div className="flex justify-between"><span className="font-sans text-zinc-500">amount</span><span>{num(p.amountMinor)}</span></div>}
          {"shareMinor" in p && <div className="flex justify-between"><span className="font-sans text-zinc-500">share</span><span>{num(p.shareMinor)}</span></div>}
          {"totalMinor" in p && <div className="flex justify-between"><span className="font-sans text-zinc-500">total</span><span>{num(p.totalMinor)}</span></div>}
          {"feeMinor" in p && <div className="flex justify-between"><span className="font-sans text-zinc-500">fee</span><span>{num(p.feeMinor)}</span></div>}
          {"note" in p && typeof p.note === "string" && p.note && <div className="flex justify-between gap-2"><span className="font-sans text-zinc-500">note</span><span className="font-sans">{p.note}</span></div>}
          {"funding" in p && <div className="flex justify-between"><span className="font-sans text-zinc-500">funding</span><span>{asUser === String(p.from) || !p.from ? String(p.funding) : "···"}</span></div>}
          {"audience" in p && <div className="flex justify-between"><span className="font-sans text-zinc-500">audience</span><span>{String(p.audience)}</span></div>}
          <div className="flex justify-between"><span className="font-sans text-zinc-500">at</span><span>{formatT(ev.t)}</span></div>
          <div className="flex justify-between"><span className="font-sans text-zinc-500">ref</span><span>{ev.id}</span></div>
        </div>
      </>
    );
  }

  function RequestCenterLive() {
    if (!myPending && !myIncoming) return null;
    return (
      <Card className="space-y-1.5 p-3">
        <div className="font-semibold">{t(locale, "pv.reqCenterT")}</div>
        {myPending && (
          <div className="rounded-lg bg-amber-50 p-2 text-[13px] dark:bg-amber-950">
            <div>{t(locale, "pv.reqOutstanding")}: {myPending.from} · {formatMoney(myPending.amountMinor, CCY, locale)}</div>
            <div className="mt-1.5 flex gap-1.5">
              <Btn small onClick={() => { act({ type: "friend_pays" }); setNotice(t(locale, "pp.reqPaid")); }}>{t(locale, "pp.friendPays")}</Btn>
              <Btn small variant="outline" onClick={() => { act({ type: "cancel_request" }); setNotice(t(locale, "pv.reqCancelled")); }}>{t(locale, "pv.cancel")}</Btn>
            </div>
          </div>
        )}
        {myIncoming && !dismissed.includes(`in-${myIncoming.from}-${myIncoming.amountMinor}`) && (
          <div className="rounded-lg border border-red-300 p-2 text-[13px] dark:border-red-800">
            <div><b>{myIncoming.from}</b> → {formatMoney(myIncoming.amountMinor, CCY, locale)}</div>
            <div className="mt-1.5 flex gap-1.5">
              <Btn small variant="danger" onClick={() => { act({ type: "answer_request", pay: true }); }}>{t(locale, "pp.scamPay")}</Btn>
              <Btn small variant="outline" onClick={() => { act({ type: "answer_request", pay: false }); }}>{t(locale, "pp.scamDecline")}</Btn>
              <Btn small variant="outline" onClick={() => setDismissed((d) => [...d, `in-${myIncoming.from}-${myIncoming.amountMinor}`])}>{t(locale, "pv.remindLater")}</Btn>
            </div>
          </div>
        )}
      </Card>
    );
  }

  function SplitBoard() {
    if (!flow?.split) return null;
    if (!flow?.split) return null;
    const s = flow.split;
    const paid = s.legs.filter((l) => l.status === "paid").reduce((x, l) => x + l.shareMinor, 0);
    const open = s.legs.filter((l) => l.status === "pending").reduce((x, l) => x + l.shareMinor, 0);
    return (
      <Card className="space-y-1.5 p-3">
        <div className="flex justify-between text-sm"><span className="font-semibold">{t(locale, "pv.boardT")}</span>
          <span className="font-mono text-[12px]">{formatMoney(paid, CCY, locale)} / {formatMoney(s.totalMinor, CCY, locale)}</span></div>
        {s.legs.map((l) => (
          <div key={l.to} className="flex items-center gap-2 rounded-lg bg-zinc-50 p-2 text-[13px] dark:bg-zinc-900">
            <Avatar handle={l.to} name={nameOf(l.to)} size="sm" />
            <div className="flex-1">
              <div className="font-bold">{l.to} <span className="font-mono font-normal">{formatMoney(l.shareMinor, CCY, locale)}</span></div>
              <div className="text-zinc-500">{t(locale, `pv.leg.${l.status}`)}</div>
            </div>
            {l.status === "pending" && (
              <>
                <Btn small variant="outline" onClick={() => { act({ type: "leg_paid", to: l.to }); }}>{t(locale, "pv.simPay").replace("{u}", l.to)}</Btn>
                <Btn small variant="outline" onClick={() => { act({ type: "leg_declined", to: l.to }); }}>{t(locale, "pv.simDecline")}</Btn>
              </>
            )}
          </div>
        ))}
        <div className="text-[12px] text-zinc-500">{t(locale, "pv.outstanding")}: {formatMoney(open, CCY, locale)}</div>
      </Card>
    );
  }

  function ShareHint() {
    const total = major(split.total);
    const sum = split.legs.reduce((x, l) => x + major(l.share), 0);
    if (!(total > 0)) return null;
    const myShare = split.includeMe ? total - sum : 0;
    const ok = split.includeMe ? myShare >= 0 : sum === total;
    return (
      <div className={`text-[13px] ${ok ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
        {t(locale, "pv.splitSum").replace("{a}", formatMoney(sum, CCY, locale)).replace("{d}", split.includeMe
          ? `${t(locale, "pv.myShare")}: ${formatMoney(myShare, CCY, locale)}`
          : `${t(locale, "pv.splitDiff")}: ${formatMoney(total - sum, CCY, locale)}`)}
      </div>
    );
  }

  function ResetBtn({ onReset }: { onReset: () => void }) {
    const [arm, setArm] = useState(false);
    return <Btn small variant="outline" onClick={() => { if (!arm) setArm(true); else { setArm(false); onReset(); } }}>{arm ? t(locale, "wm.resetConfirm") : t(locale, "wm.reset")}</Btn>;
  }

  function Teach() {
    const [open, setOpen] = useState(false);
    const topics = ["p2p", "req", "fund", "ledger", "pending", "split", "privacy", "wrong"] as const;
    return (
      <Card className="space-y-1.5 p-3 text-[13px]">
        <button className="font-semibold" onClick={() => setOpen(!open)}>{t(locale, "pv.teachT")} {open ? "▾" : "▸"}</button>
        {!open && <div className="text-zinc-500">{t(locale, "pv.teachSub")}</div>}
        {open && (
          <div className="space-y-1.5 text-zinc-600 dark:text-zinc-400">
            {topics.map((x) => (
              <div key={x}><b>{t(locale, `pv.teach.${x}T`)}.</b> {t(locale, `pv.teach.${x}`)}</div>
            ))}
            <details className="rounded-lg bg-zinc-50 p-2 font-mono text-[12px] dark:bg-zinc-900">
              <summary className="cursor-pointer font-sans font-semibold">{t(locale, "pv.teachTech")}</summary>
              <div className="mt-1">{t(locale, "pv.teachTechB")}</div>
            </details>
          </div>
        )}
      </Card>
    );
  }
}
