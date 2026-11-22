/**
 * Hot-wallet simulation engine (self-custody browser-wallet model).
 * One serializable state object is the single source of truth: profile,
 * accounts, networks, tokens, balances, pending/confirmed/failed
 * transactions, gas charges, swaps, dApp connections, signing requests,
 * allowances and notifications. Deterministic (seeded RNG in state), pure
 * TypeScript, no UI imports. All funds fictional.
 */
export class IllegalHwAction extends Error {}

export interface HWNetwork {
  id: string;
  label: string;
  native: string;
  chainId: number;
  rpcLabel: string;
  gasPriceGwei: number;
  blockSec: number;
  testnet: boolean;
  custom?: boolean;
}

export interface HWToken {
  symbol: string;
  name: string;
  decimals: number;
  /** null = native asset */
  address: string | null;
  /** illustrative USD price, not a market rate */
  priceUsd: number;
  custom?: boolean;
}

export interface HWAccount {
  id: string;
  name: string;
  address: string;
}

export type HWTxStatus = "pending" | "confirmed" | "failed" | "cancelled" | "stuck";
export type HWTxKind = "send" | "receive" | "swap" | "approve" | "sign" | "stake" | "unstake";

export interface HWTx {
  id: string;
  hash: string;
  kind: HWTxKind;
  status: HWTxStatus;
  from: string;
  to: string;
  network: string;
  asset: string;
  amountMinor: number;
  feeMinor: number;
  nonce: number;
  submittedAt: number;
  confirmedAt: number | null;
  block: number | null;
  failReason?: string;
  note?: string;
}

export interface HWConn {
  dapp: string;
  account: string;
  network: string;
}

export interface HWAllow {
  token: string;
  spender: string;
  amountMinor: number | null;
  dapp: string;
}

export interface HWNotif {
  id: string;
  kind: string;
  text: string;
  at: number;
  read: boolean;
}

export interface HWState {
  version: 1;
  rng: number;
  counters: { tx: number; notif: number; time: number; block: number };
  unlocked: boolean;
  hasPassword: boolean;
  password: string | null;
  seedWords: string[] | null;
  backedUp: boolean;
  autoLockSec: number;
  accounts: HWAccount[];
  activeAccount: string | null;
  networks: HWNetwork[];
  activeNetwork: string;
  tokens: Record<string, HWToken[]>;
  balances: Record<string, number>;
  nonces: Record<string, number>;
  txs: HWTx[];
  conns: HWConn[];
  allows: HWAllow[];
  notifs: HWNotif[];
  contacts: { name: string; address: string }[];
  stakes: Record<string, number>;
  submitted: string[];
}

const FAKE_WORDS = ["river", "candle", "orbit", "meadow", "cipher", "harbor", "lantern", "prairie", "quartz", "signal", "tundra", "velvet", "willow", "yonder", "zephyr", "anchor"];

/** Registry of importable demo profiles (fictional phrases only). */
const DEMO_REGISTRY: { words: string[]; label: string }[] = [
  {
    label: "Demo profile A",
    words: ["candy", "maple", "cake", "sugar", "pudding", "cream", "honey", "rich", "smooth", "crumble", "sweet", "treat"]
  },
  {
    label: "Demo profile B",
    words: ["abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract", "absurd", "abuse", "access", "accident"]
  }
];

export const DEMO_PHRASE_A = DEMO_REGISTRY[0].words.join(" ");

function nextRand(s: HWState): number {
  let a = s.rng | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  s.rng = a;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function hex(s: HWState, n: number): string {
  const chars = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < n; i++) out += chars[Math.floor(nextRand(s) * 16)];
  return out;
}

function tick(s: HWState): number {
  s.counters.time += 1;
  return s.counters.time;
}

function notify(s: HWState, kind: string, text: string): void {
  s.counters.notif += 1;
  s.notifs.push({ id: `nt-${s.counters.notif}`, kind, text, at: tick(s), read: false });
}

function balKey(account: string, network: string, asset: string): string {
  return `${account}|${network}|${asset}`;
}

export function hwBalance(s: HWState, account: string, network: string, asset: string): number {
  return s.balances[balKey(account, network, asset)] ?? 0;
}

function addBalance(s: HWState, account: string, network: string, asset: string, delta: number): void {
  const k = balKey(account, network, asset);
  s.balances[k] = (s.balances[k] ?? 0) + delta;
}

function networkOf(s: HWState, id: string): HWNetwork {
  const n = s.networks.find((x) => x.id === id);
  if (!n) throw new IllegalHwAction("unknown network");
  return n;
}

function tokenOf(s: HWState, network: string, symbol: string): HWToken {
  const tk = (s.tokens[network] ?? []).find((x) => x.symbol === symbol);
  if (!tk) throw new IllegalHwAction("unknown asset on this network");
  return tk;
}

function accountOf(s: HWState, id: string): HWAccount {
  const a = s.accounts.find((x) => x.id === id);
  if (!a) throw new IllegalHwAction("unknown account");
  return a;
}

function newAddress(s: HWState): string {
  return `0x${hex(s, 40)}`;
}

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export function hwEmpty(seed = 7): HWState {
  return {
    version: 1,
    rng: seed >>> 0,
    counters: { tx: 0, notif: 0, time: 0, block: 1000 },
    unlocked: false,
    hasPassword: false,
    password: null,
    seedWords: null,
    backedUp: false,
    autoLockSec: 300,
    accounts: [],
    activeAccount: null,
    networks: [
      { id: "sim-mainnet", label: "SimMainnet", native: "sETH", chainId: 110, rpcLabel: "simulated-rpc-mainnet (no real endpoint)", gasPriceGwei: 12, blockSec: 12, testnet: false },
      { id: "sim-polygon", label: "SimPolygon", native: "sPOL", chainId: 13701, rpcLabel: "simulated-rpc-polygon (no real endpoint)", gasPriceGwei: 30, blockSec: 2, testnet: false },
      { id: "sim-testnet", label: "SimTestnet", native: "tETH", chainId: 11155111, rpcLabel: "simulated-rpc-testnet (no real endpoint)", gasPriceGwei: 2, blockSec: 12, testnet: true },
      { id: "sim-local", label: "LocalSim", native: "lETH", chainId: 31337, rpcLabel: "fictional-local-sim (no real endpoint)", gasPriceGwei: 1, blockSec: 1, testnet: true }
    ],
    activeNetwork: "sim-mainnet",
    tokens: {
      "sim-mainnet": [
        { symbol: "sETH", name: "Sim Ether", decimals: 18, address: null, priceUsd: 3200 },
        { symbol: "sUSD", name: "Sim Dollar", decimals: 6, address: "0xSimUsd00000000000000000000000000000001", priceUsd: 1 },
        { symbol: "sUNI", name: "Sim Swap Token", decimals: 18, address: "0xSimUni00000000000000000000000000000002", priceUsd: 8.4 }
      ],
      "sim-polygon": [
        { symbol: "sPOL", name: "Sim Polygon Coin", decimals: 18, address: null, priceUsd: 0.72 },
        { symbol: "sUSD", name: "Sim Dollar", decimals: 6, address: "0xSimUsd00000000000000000000000000000011", priceUsd: 1 }
      ],
      "sim-testnet": [
        { symbol: "tETH", name: "Test Ether", decimals: 18, address: null, priceUsd: 0 },
        { symbol: "sUSD", name: "Sim Dollar", decimals: 6, address: "0xSimUsd00000000000000000000000000000021", priceUsd: 1 }
      ],
      "sim-local": [
        { symbol: "lETH", name: "Local Ether", decimals: 18, address: null, priceUsd: 0 }
      ]
    },
    balances: {},
    nonces: {},
    txs: [],
    conns: [],
    allows: [],
    notifs: [],
    contacts: [],
    stakes: {},
    submitted: []
  };
}

export function hwOnboardCreate(s: HWState, walletName: string, password: string): string[] {
  if (s.seedWords) throw new IllegalHwAction("wallet already exists");
  if (!password || password.length < 4) throw new IllegalHwAction("password must be 4+ characters");
  const words = Array.from({ length: 12 }, () => FAKE_WORDS[Math.floor(nextRand(s) * FAKE_WORDS.length)]);
  s.seedWords = words;
  s.password = password;
  s.hasPassword = true;
  s.unlocked = true;
  const id = `acct-${s.accounts.length + 1}`;
  s.accounts.push({ id, name: walletName || "Account 1", address: newAddress(s) });
  s.activeAccount = id;
  notify(s, "onboard", "Demo wallet created — back it up before funding it.");
  return words;
}

export function hwImport(s: HWState, phrase: string, password: string): string {
  const words = phrase.trim().toLowerCase().split(/\s+/);
  const found = DEMO_REGISTRY.find((r) => r.words.join(" ") === words.join(" "));
  if (!found || !password || password.length < 4) throw new IllegalHwAction("unknown demo phrase (use a registry demo profile)");
  s.seedWords = [...found.words];
  s.backedUp = true;
  s.password = password;
  s.hasPassword = true;
  s.unlocked = true;
  s.accounts = [];
  const mk = (name: string) => {
    const id = `acct-${s.accounts.length + 1}`;
    s.accounts.push({ id, name, address: newAddress(s) });
    return id;
  };
  const a1 = mk("Trading");
  const a2 = mk("Savings");
  s.activeAccount = a1;
  addBalance(s, a1, "sim-mainnet", "sETH", 250_000_000_000_000_000);
  addBalance(s, a1, "sim-mainnet", "sUSD", 1_500_000_000);
  addBalance(s, a2, "sim-mainnet", "sETH", 1_000_000_000_000_000_000);
  addBalance(s, a1, "sim-polygon", "sPOL", 800_000_000_000_000_000_000);
  notify(s, "onboard", `${found.label} restored with demo funds.`);
  return found.label;
}

export function hwUnlock(s: HWState, password: string): void {
  if (!s.hasPassword || s.password !== password) throw new IllegalHwAction("wrong password");
  s.unlocked = true;
}

export function hwLock(s: HWState): void {
  s.unlocked = false;
}

function requireUnlocked(s: HWState): void {
  if (!s.unlocked) throw new IllegalHwAction("wallet is locked");
}

export function hwRevealSeed(s: HWState, password: string): string[] {
  requireUnlocked(s);
  if (s.password !== password || !s.seedWords) throw new IllegalHwAction("authentication failed");
  return [...s.seedWords];
}

export function hwSetPassword(s: HWState, oldPw: string, newPw: string): void {
  requireUnlocked(s);
  if (s.password !== oldPw || !newPw || newPw.length < 4) throw new IllegalHwAction("password change rejected");
  s.password = newPw;
  notify(s, "security", "Unlock password changed.");
}

export function hwAddAccount(s: HWState, name: string): HWAccount {
  requireUnlocked(s);
  const id = `acct-${s.accounts.length + 1}-${Math.floor(nextRand(s) * 1e6)}`;
  const a = { id, name: name.trim() || `Account ${s.accounts.length + 1}`, address: newAddress(s) };
  s.accounts.push(a);
  s.activeAccount = a.id;
  notify(s, "account", `Account "${a.name}" created.`);
  return a;
}

export function hwRenameAccount(s: HWState, id: string, name: string): void {
  requireUnlocked(s);
  if (name.trim().length < 1) throw new IllegalHwAction("name required");
  accountOf(s, id).name = name.trim();
}

export function hwSwitchAccount(s: HWState, id: string): void {
  requireUnlocked(s);
  accountOf(s, id);
  s.activeAccount = id;
}

export function hwRemoveAccount(s: HWState, id: string): void {
  requireUnlocked(s);
  const acct = accountOf(s, id);
  for (const net of s.networks) {
    for (const tk of s.tokens[net.id] ?? []) {
      if (hwBalance(s, id, net.id, tk.symbol) !== 0) throw new IllegalHwAction("only empty accounts can be removed");
    }
  }
  s.accounts = s.accounts.filter((x) => x.id !== id);
  if (s.activeAccount === id) s.activeAccount = s.accounts[0]?.id ?? null;
  void acct;
  notify(s, "account", "Empty account removed.");
}

export function hwFaucet(s: HWState, asset: string, amountMinor: number): void {
  requireUnlocked(s);
  if (!(amountMinor > 0)) throw new IllegalHwAction("amount required");
  const acct = s.activeAccount!;
  const net = s.activeNetwork;
  tokenOf(s, net, asset);
  addBalance(s, acct, net, asset, amountMinor);
  recordTx(s, { kind: "receive", status: "confirmed", from: "faucet(sim)", to: acct, network: net, asset, amountMinor, feeMinor: 0, note: "test faucet drip" });
  notify(s, "faucet", `Faucet credited ${asset} (test coins, worthless).`);
}

export interface GasEstimate {
  units: number;
  baseGwei: number;
  priorityGwei: number;
  totalMinor: number;
}

export function hwEstimateFee(s: HWState, units = 21000, priorityGwei = 1): GasEstimate {
  const net = networkOf(s, s.activeNetwork);
  const tk = tokenOf(s, net.id, net.native);
  const gasPrice = (net.gasPriceGwei + priorityGwei) * 1e9;
  const totalMinor = Math.round((units * gasPrice) / 10 ** tk.decimals);
  return { units, baseGwei: net.gasPriceGwei, priorityGwei, totalMinor };
}

function recordTx(s: HWState, init: Partial<HWTx> & { kind: HWTxKind; status: HWTxStatus }): HWTx {
  s.counters.tx += 1;
  const tx: HWTx = {
    id: `htx-${s.counters.tx}`,
    hash: `0x${hex(s, 32)}`,
    from: "",
    to: "",
    network: s.activeNetwork,
    asset: "",
    amountMinor: 0,
    feeMinor: 0,
    nonce: 0,
    submittedAt: tick(s),
    confirmedAt: null,
    block: null,
    ...init
  } as HWTx;
  s.txs.push(tx);
  return tx;
}

function pushTx(s: HWState, tx: HWTx, text: string): void {
  notify(s, tx.kind, text);
}

export interface SendInput {
  to: string;
  asset: string;
  amountMinor: number;
  units?: number;
  priorityGwei?: number;
}

/** Build + sign + submit in one classroom step. Debit happens now; the
 *  network confirms it when confirmTx runs (or it fails first). */
export function hwSend(s: HWState, input: SendInput): HWTx {
  requireUnlocked(s);
  const acct = accountOf(s, s.activeAccount!);
  const net = networkOf(s, s.activeNetwork);
  if (!ADDR_RE.test(input.to)) throw new IllegalHwAction("invalid destination address for this network");
  if (input.to.toLowerCase() === acct.address.toLowerCase()) throw new IllegalHwAction("cannot pay yourself on the same account");
  if (!(input.amountMinor > 0)) throw new IllegalHwAction("amount required");
  const tk = tokenOf(s, net.id, input.asset);
  const fee = hwEstimateFee(s, input.units ?? 21000, input.priorityGwei ?? 1);
  const isNative = tk.address === null;
  const need = isNative ? input.amountMinor + fee.totalMinor : input.amountMinor;
  const have = hwBalance(s, acct.id, net.id, tk.symbol);
  const haveFee = isNative ? 0 : hwBalance(s, acct.id, net.id, net.native);
  if (have < need) throw new IllegalHwAction("insufficient asset balance");
  if (!isNative && haveFee < fee.totalMinor) throw new IllegalHwAction("insufficient native balance for the fee");
  const id = `send-${s.counters.tx + 1}-${Math.floor(nextRand(s) * 1e6)}`;
  if (s.submitted.includes(id)) throw new IllegalHwAction("duplicate submission blocked");
  s.submitted.push(id);
  addBalance(s, acct.id, net.id, tk.symbol, -need);
  if (!isNative) addBalance(s, acct.id, net.id, net.native, -fee.totalMinor);
  const nonce = (s.nonces[acct.id] ?? 0) + 1;
  s.nonces[acct.id] = nonce;
  const tx = recordTx(s, {
    kind: "send", status: "pending", from: acct.id, to: input.to,
    network: net.id, asset: tk.symbol, amountMinor: input.amountMinor,
    feeMinor: isNative ? 0 : fee.totalMinor, nonce, note: `gas ${fee.units}×${fee.baseGwei + fee.priorityGwei}gwei`
  });
  void id;
  pushTx(s, tx, `Sent ${input.asset} — awaiting network confirmation.`);
  return tx;
}

/** Mine the pending tx: credit internal recipients, stamp block + confirms. */
export function hwConfirm(s: HWState, txId: string): HWTx {
  requireUnlocked(s);
  const tx = s.txs.find((x) => x.id === txId);
  if (!tx || tx.status !== "pending") throw new IllegalHwAction("only pending transactions confirm");
  const internal = s.accounts.find((a) => a.address.toLowerCase() === tx.to.toLowerCase());
  if (internal && tx.kind !== "sign" && tx.kind !== "approve") {
    addBalance(s, internal.id, tx.network, tx.asset, tx.amountMinor);
  }
  s.counters.block += 1;
  tx.status = "confirmed";
  tx.block = s.counters.block;
  tx.confirmedAt = tick(s);
  pushTx(s, tx, `Confirmed in block ${tx.block}.`);
  return tx;
}

export function hwFail(s: HWState, txId: string, reason: string): HWTx {
  const tx = s.txs.find((x) => x.id === txId);
  if (!tx || tx.status !== "pending") throw new IllegalHwAction("only pending transactions fail");
  tx.status = "failed";
  tx.failReason = reason;
  notify(s, tx.kind, `Failed: ${reason}.`);
  return tx;
}

export function hwCancel(s: HWState, txId: string): HWTx {
  requireUnlocked(s);
  const tx = s.txs.find((x) => x.id === txId);
  if (!tx || tx.status !== "pending") throw new IllegalHwAction("only pending transactions cancel");
  if (tx.kind === "send") {
    const tk = tokenOf(s, tx.network, tx.asset);
    const isNative = tk.address === null;
    addBalance(s, tx.from, tx.network, tx.asset, isNative ? tx.amountMinor + tx.feeMinor : tx.amountMinor);
    if (!isNative) addBalance(s, tx.from, tx.network, networkOf(s, tx.network).native, tx.feeMinor);
  }
  tx.status = "cancelled";
  notify(s, tx.kind, "Cancelled before confirmation — funds restored.");
  return tx;
}

/** Faucet-style incoming transfer: pending first, credited only on confirm. */
export function hwReceive(s: HWState, asset: string, amountMinor: number, fromLabel = "faucet(sim)"): HWTx {
  requireUnlocked(s);
  const acct = accountOf(s, s.activeAccount!);
  tokenOf(s, s.activeNetwork, asset);
  if (!(amountMinor > 0)) throw new IllegalHwAction("amount required");
  const tx = recordTx(s, {
    kind: "receive", status: "pending", from: fromLabel, to: acct.id,
    network: s.activeNetwork, asset, amountMinor, feeMinor: 0
  });
  pushTx(s, tx, `Incoming ${asset} detected — confirm to credit it.`);
  return tx;
}

export function hwConfirmReceive(s: HWState, txId: string): HWTx {
  const tx = hwConfirm(s, txId);
  if (tx.kind === "receive") {
    addBalance(s, tx.to, tx.network, tx.asset, tx.amountMinor);
  }
  return tx;
}

export interface SwapQuote {
  rate: number;
  outMinor: number;
  minOutMinor: number;
  impactBps: number;
  feeMinor: number;
}

const SWAP_RESERVES: Record<string, { a: number; b: number }> = {
  "sETH|sUSD": { a: 120_000_000_000_000_000_000, b: 384_000_000_000 },
  "sETH|sUNI": { a: 120_000_000_000_000_000_000, b: 45_700_000_000_000_000_000_000 }
};

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

export function hwQuoteSwap(s: HWState, fromSym: string, toSym: string, amountMinor: number, slippageBps = 50): SwapQuote {
  const net = networkOf(s, s.activeNetwork);
  tokenOf(s, net.id, fromSym);
  tokenOf(s, net.id, toSym);
  if (fromSym === toSym) throw new IllegalHwAction("pick two different assets");
  if (!(amountMinor > 0)) throw new IllegalHwAction("amount required");
  const key = pairKey(fromSym, toSym);
  const pool = SWAP_RESERVES[key] ?? { a: 1_000_000_000, b: 1_000_000_000 };
  const [ra, rb] = fromSym < toSym ? [pool.a, pool.b] : [pool.b, pool.a];
  const outMinor = Math.floor((rb * amountMinor) / (ra + amountMinor));
  const price = rb / ra;
  const ideal = amountMinor * price;
  const impactBps = ideal > 0 ? Math.round(((ideal - outMinor) / ideal) * 10_000) : 0;
  const feeMinor = Math.floor((outMinor * 30) / 10_000);
  return {
    rate: price,
    outMinor,
    minOutMinor: Math.floor(((outMinor - feeMinor) * (10_000 - slippageBps)) / 10_000),
    impactBps,
    feeMinor
  };
}

export function hwSwap(s: HWState, fromSym: string, toSym: string, amountMinor: number, minOutMinor: number): HWTx {
  requireUnlocked(s);
  const acct = accountOf(s, s.activeAccount!);
  const net = networkOf(s, s.activeNetwork);
  const quote = hwQuoteSwap(s, fromSym, toSym, amountMinor);
  if (hwBalance(s, acct.id, net.id, fromSym) < amountMinor) throw new IllegalHwAction("insufficient balance for this swap");
  if (quote.outMinor - quote.feeMinor < minOutMinor) throw new IllegalHwAction("slippage failure: quote moved past your minimum");
  const fee = hwEstimateFee(s);
  if (hwBalance(s, acct.id, net.id, net.native) < fee.totalMinor) throw new IllegalHwAction("insufficient native balance for gas");
  if (fromSym === net.native && hwBalance(s, acct.id, net.id, fromSym) < amountMinor + fee.totalMinor) {
    throw new IllegalHwAction("insufficient balance: amount plus gas exceeds holdings");
  }
  if (fromSym !== net.native && hwBalance(s, acct.id, net.id, fromSym) < amountMinor) throw new IllegalHwAction("insufficient balance for this swap");
  const key = pairKey(fromSym, toSym);
  const pool = SWAP_RESERVES[key] ?? { a: 1_000_000_000, b: 1_000_000_000 };
  if (fromSym < toSym) { pool.a += amountMinor; pool.b -= quote.outMinor; }
  else { pool.b += amountMinor; pool.a -= quote.outMinor; }
  SWAP_RESERVES[key] = pool;
  addBalance(s, acct.id, net.id, fromSym, -amountMinor);
  addBalance(s, acct.id, net.id, net.native, -fee.totalMinor);
  addBalance(s, acct.id, net.id, toSym, quote.outMinor - quote.feeMinor);
  const tx = recordTx(s, {
    kind: "swap", status: "confirmed", from: acct.id, to: "simswap-dex",
    network: net.id, asset: `${fromSym}→${toSym}`, amountMinor,
    feeMinor: fee.totalMinor, note: `min-out ${minOutMinor}, impact ${quote.impactBps}bps`
  });
  tx.block = (s.counters.block += 1);
  tx.confirmedAt = tick(s);
  pushTx(s, tx, `Swapped ${fromSym} → ${toSym}.`);
  return tx;
}

export function hwConnect(s: HWState, dapp: string, account: string, network: string): void {
  requireUnlocked(s);
  accountOf(s, account);
  networkOf(s, network);
  if (!s.conns.some((c) => c.dapp === dapp)) {
    s.conns.push({ dapp, account, network });
    notify(s, "connect", `${dapp} connected to ${accountOf(s, account).name}.`);
  }
}

export function hwDisconnect(s: HWState, dapp: string): void {
  requireUnlocked(s);
  s.conns = s.conns.filter((c) => c.dapp !== dapp);
  notify(s, "connect", `${dapp} disconnected. It sees nothing anymore.`);
}

export function hwSign(s: HWState, dapp: string, message: string, approved: boolean): HWTx {
  requireUnlocked(s);
  const conn = s.conns.find((c) => c.dapp === dapp);
  if (!conn) throw new IllegalHwAction("dApp is not connected");
  const tx = recordTx(s, {
    kind: "sign", status: approved ? "confirmed" : "cancelled",
    from: conn.account, to: dapp, network: conn.network, asset: "",
    amountMinor: 0, feeMinor: 0, note: message.slice(0, 120)
  });
  if (approved) pushTx(s, tx, `Message signed for ${dapp}. No funds moved.`);
  else pushTx(s, tx, `Signature rejected for ${dapp}. Nothing happened.`);
  return tx;
}

export function hwApprove(s: HWState, dapp: string, token: string, spender: string, amountMinor: number | null): HWTx {
  requireUnlocked(s);
  const conn = s.conns.find((c) => c.dapp === dapp);
  if (!conn) throw new IllegalHwAction("dApp is not connected");
  tokenOf(s, conn.network, token);
  s.allows = s.allows.filter((a) => !(a.token === token && a.spender === spender));
  s.allows.push({ token, spender, amountMinor, dapp });
  const tx = recordTx(s, {
    kind: "approve", status: "confirmed", from: conn.account, to: spender,
    network: conn.network, asset: token, amountMinor: amountMinor ?? 0, feeMinor: 0,
    note: amountMinor === null ? "unlimited allowance" : `allowance ${amountMinor}`
  });
  pushTx(s, tx, amountMinor === null
    ? `Unlimited ${token} allowance for ${spender} — review what that means.`
    : `${token} allowance set for ${spender}.`);
  return tx;
}

export function hwRevoke(s: HWState, token: string, spender: string): void {
  requireUnlocked(s);
  s.allows = s.allows.filter((a) => !(a.token === token && a.spender === spender));
  notify(s, "approve", `Allowance revoked: ${spender} can no longer move your ${token}.`);
}

export function hwStake(s: HWState, asset: string, amountMinor: number, pool: string): HWTx {
  requireUnlocked(s);
  const acct = accountOf(s, s.activeAccount!);
  const allow = s.allows.find((a) => a.token === asset && a.spender === pool);
  if (!allow) throw new IllegalHwAction("approve the pool first — staking needs an allowance");
  if (allow.amountMinor !== null && allow.amountMinor < amountMinor) throw new IllegalHwAction("allowance too small for this stake");
  if (hwBalance(s, acct.id, s.activeNetwork, asset) < amountMinor) throw new IllegalHwAction("insufficient balance to stake");
  addBalance(s, acct.id, s.activeNetwork, asset, -amountMinor);
  const k = `${acct.id}|${s.activeNetwork}|${asset}`;
  s.stakes[k] = (s.stakes[k] ?? 0) + amountMinor;
  const tx = recordTx(s, {
    kind: "stake", status: "confirmed", from: acct.id, to: pool,
    network: s.activeNetwork, asset, amountMinor, feeMinor: 0
  });
  pushTx(s, tx, `Staked ${asset} in ${pool}.`);
  return tx;
}

export function hwUnstake(s: HWState, asset: string, amountMinor: number, pool: string): HWTx {
  requireUnlocked(s);
  const acct = accountOf(s, s.activeAccount!);
  const k = `${acct.id}|${s.activeNetwork}|${asset}`;
  if ((s.stakes[k] ?? 0) < amountMinor) throw new IllegalHwAction("nothing staked to withdraw");
  s.stakes[k] -= amountMinor;
  addBalance(s, acct.id, s.activeNetwork, asset, amountMinor);
  const tx = recordTx(s, {
    kind: "unstake", status: "confirmed", from: pool, to: acct.id,
    network: s.activeNetwork, asset, amountMinor, feeMinor: 0
  });
  pushTx(s, tx, `Unstaked ${asset} from ${pool}.`);
  return tx;
}

export function hwAddContact(s: HWState, name: string, address: string): void {
  requireUnlocked(s);
  if (!ADDR_RE.test(address)) throw new IllegalHwAction("invalid address for this wallet");
  if (!s.contacts.some((c) => c.address.toLowerCase() === address.toLowerCase())) {
    s.contacts.push({ name: name.trim() || address.slice(0, 10), address });
  }
}

export function hwAddNetwork(s: HWState, n: { label: string; native: string; chainId: number; gasPriceGwei: number }): HWNetwork {
  requireUnlocked(s);
  if (!n.label.trim() || !/^[A-Z]{2,6}$/.test(n.native) || !(n.chainId > 0) || !(n.gasPriceGwei >= 0)) {
    throw new IllegalHwAction("label, 2–6 letter currency, chain id and gas price required");
  }
  if (s.networks.some((x) => x.chainId === n.chainId)) throw new IllegalHwAction("chain id already configured");
  const net: HWNetwork = {
    id: `custom-${n.chainId}`, label: n.label.trim(), native: n.native,
    chainId: n.chainId, rpcLabel: "fictional custom network (no real endpoint)",
    gasPriceGwei: n.gasPriceGwei, blockSec: 5, testnet: true, custom: true
  };
  s.networks.push(net);
  s.tokens[net.id] = [{ symbol: net.native, name: `${net.label} Coin`, decimals: 18, address: null, priceUsd: 0, custom: true }];
  notify(s, "network", `${net.label} added as a simulated network.`);
  return net;
}

export function hwRemoveNetwork(s: HWState, id: string): void {
  requireUnlocked(s);
  const net = networkOf(s, id);
  if (!net.custom) throw new IllegalHwAction("built-in networks cannot be removed");
  s.networks = s.networks.filter((x) => x.id !== id);
  if (s.activeNetwork === id) s.activeNetwork = "sim-mainnet";
  notify(s, "network", `${net.label} removed.`);
}

export function hwSelectNetwork(s: HWState, id: string): void {
  requireUnlocked(s);
  const prev = s.activeNetwork;
  networkOf(s, id);
  s.activeNetwork = id;
  if (prev !== id) notify(s, "network", `Switched to ${networkOf(s, id).label}. Balances shown are per-network.`);
}

export function hwAddToken(s: HWState, t: { symbol: string; name: string; address: string; decimals: number }): HWToken {
  requireUnlocked(s);
  if (!/^[A-Z0-9]{2,8}$/.test(t.symbol) || !ADDR_RE.test(t.address) || !(t.decimals >= 0 && t.decimals <= 18)) {
    throw new IllegalHwAction("symbol (2–8 chars), valid address and 0–18 decimals required");
  }
  const list = s.tokens[s.activeNetwork] ?? [];
  if (list.some((x) => x.symbol === t.symbol)) throw new IllegalHwAction("asset already listed");
  const tk: HWToken = { symbol: t.symbol, name: t.name.trim() || t.symbol, decimals: t.decimals, address: t.address, priceUsd: 0, custom: true };
  list.push(tk);
  s.tokens[s.activeNetwork] = list;
  notify(s, "token", `${tk.symbol} added to the visible list.`);
  return tk;
}

export function hwRemoveToken(s: HWState, symbol: string): void {
  requireUnlocked(s);
  const list = s.tokens[s.activeNetwork] ?? [];
  const tk = list.find((x) => x.symbol === symbol);
  if (!tk || tk.address === null) throw new IllegalHwAction("native assets cannot be removed");
  if (!tk.custom) throw new IllegalHwAction("only imported tokens can be removed");
  s.tokens[s.activeNetwork] = list.filter((x) => x.symbol !== symbol);
  notify(s, "token", `${symbol} hidden. History entries stay put.`);
}

export function hwMarkRead(s: HWState, id?: string): void {
  if (id) {
    const n = s.notifs.find((x) => x.id === id);
    if (n) n.read = true;
  } else {
    s.notifs.forEach((x) => { x.read = true; });
  }
}

export function hwReset(seed = 7): HWState {
  return hwEmpty(seed);
}
