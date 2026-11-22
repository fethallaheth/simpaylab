/**
 * Cold-wallet (hardware-wallet) simulation engine.
 *
 * One serializable state object is the single source of truth: demo device
 * (model, power, PIN lockout, connection), setup ceremony, fictional
 * recovery profile, accounts/addresses/balances, unsigned proposals, device
 * approvals/rejections, signed payloads, broadcast attempts and confirmed or
 * failed transfers, recovery drills and air-gapped payload states.
 *
 * Pure TypeScript, no UI or browser imports, deterministic (all demo ids,
 * addresses, signatures and hashes derive from seed + counter). Everything
 * is fictional: addresses, assets, balances, signatures and hashes are
 * clearly-marked demo values and must never be presented as real.
 *
 * Invariants enforced by the guards below:
 * - preparing a proposal never moves funds
 * - device rejection never moves funds
 * - signing never broadcasts (signed != broadcast)
 * - a failed broadcast never completes a transfer
 * - a confirmed transfer settles balances exactly once
 * - a proposal cannot be approved or broadcast twice
 * - device and computer views always derive from the same proposal record
 */
export class IllegalColdAction extends Error {}

/** Fictional demo wordlist. DEMO ONLY — unusable on any real chain. */
export const COLD_DEMO_WORDS = [
  "alpine", "basalt", "cinder", "drift", "ember", "fjord", "glacier", "harbor",
  "igloo", "juniper", "krill", "lagoon", "moss", "narwhal", "onyx", "pumice",
  "quarry", "ridge", "spruce", "tarn", "umber", "vega", "willow", "yukon"
];

export interface ColdModel {
  id: string;
  brand: string;
  name: string;
  controls: "two-button" | "touch";
  blurb: string;
}

/** Original fictional branding — no real manufacturer names. */
export const COLD_MODELS: ColdModel[] = [
  { id: "stick", brand: "PolarVault", name: "PolarVault Stick", controls: "two-button", blurb: "Two physical buttons. Scroll with ▲▼, confirm with both." },
  { id: "touch", brand: "PolarVault", name: "PolarVault Touch", controls: "touch", blurb: "Small touchscreen. Tap to navigate, swipe pages to review." }
];

export interface ColdNetwork {
  id: string;
  label: string;
  native: string;
  addrPrefix: string;
  decimals: number;
  baseFeeMinor: number;
  confRequired: number;
}

/** Fictional demo networks. */
export const COLD_NETWORKS: ColdNetwork[] = [
  { id: "glacier", label: "Glacier Demo Net", native: "GLAC", addrPrefix: "glac1", decimals: 8, baseFeeMinor: 12_000, confRequired: 2 },
  { id: "tidepool", label: "Tidepool Demo Net", native: "TIDE", addrPrefix: "tide1", decimals: 8, baseFeeMinor: 8_000, confRequired: 1 }
];

export interface ColdAsset {
  symbol: string;
  name: string;
  network: string;
  decimals: number;
}

/** Fictional demo assets. */
export const COLD_ASSETS: ColdAsset[] = [
  { symbol: "GLAC", name: "Glacier coin (demo)", network: "glacier", decimals: 8 },
  { symbol: "DUSD", name: "Demo Dollar token (demo)", network: "glacier", decimals: 6 },
  { symbol: "TIDE", name: "Tidepool coin (demo)", network: "tidepool", decimals: 8 }
];

export type ColdSetupStage = "none" | "model" | "power" | "init" | "pin" | "seed" | "reveal" | "verify" | "ready";

export interface ColdDevice {
  model: string | null;
  powered: boolean;
  initialized: boolean;
  connected: boolean;
  locked: boolean;
  /** Simulated demo PIN, stored in clear as plain teaching state — never a real credential. */
  pin: string | null;
  attempts: number;
  maxAttempts: number;
  wiped: boolean;
}

export interface ColdAccount {
  id: string;
  name: string;
  network: string;
  address: string;
  balances: Record<string, number>;
}

export type ProposalStatus =
  | "draft" | "awaiting" | "signed" | "rejected" | "ready"
  | "pending" | "confirmed" | "failed" | "cancelled";

export interface ColdProposal {
  id: string;
  dir: "in" | "out";
  fromAcct: string | null;
  fromAddr: string;
  to: string;
  asset: string;
  network: string;
  amountMinor: number;
  feeMinor: number;
  via: "usb" | "qr";
  status: ProposalStatus;
  deviceVerdict: "none" | "approved" | "rejected";
  importedOnDevice: boolean;
  signedPayload: string | null;
  hash: string | null;
  confirms: number;
  confRequired: number;
  broadcastAttempts: number;
  settled: boolean;
  failReason: string | null;
  stages: { key: string; at: number }[];
  createdAt: number;
}

export interface ColdActivity {
  id: string;
  at: number;
  kind: string;
  text: string;
  tone: "info" | "good" | "bad" | "warn";
}

export interface ColdScenarios {
  tamperSend: boolean;
  tamperReceive: boolean;
  excessFee: boolean;
  failNextBroadcast: boolean;
  qrTtlMs: number;
}

export interface ColdState {
  version: 1;
  seed: number;
  ctr: number;
  clock: number;
  setupStage: ColdSetupStage;
  device: ColdDevice;
  seedWords: string[];
  seedRevealed: boolean;
  backupVerified: boolean;
  recoveryProfile: { words: string[]; model: string } | null;
  accounts: ColdAccount[];
  activeAccount: string | null;
  addrVerified: Record<string, boolean>;
  proposals: ColdProposal[];
  activity: ColdActivity[];
  scenarios: ColdScenarios;
  /** latest exported demo QR payloads, kept for the lesson UI */
  lastUnsignedQr: string | null;
  lastSignedQr: string | null;
}

export function coldEmpty(seed = 7): ColdState {
  return {
    version: 1,
    seed,
    ctr: 0,
    clock: 0,
    setupStage: "none",
    device: { model: null, powered: false, initialized: false, connected: false, locked: true, pin: null, attempts: 0, maxAttempts: 3, wiped: false },
    seedWords: [],
    seedRevealed: false,
    backupVerified: false,
    recoveryProfile: null,
    accounts: [],
    activeAccount: null,
    addrVerified: {},
    proposals: [],
    activity: [],
    scenarios: { tamperSend: false, tamperReceive: false, excessFee: false, failNextBroadcast: false, qrTtlMs: 120_000 },
    lastUnsignedQr: null,
    lastSignedQr: null
  };
}

export function coldReset(seed = 7): ColdState {
  return coldEmpty(seed);
}

/** Tiny deterministic demo hash (FNV-1a hex). Teaching aid, not cryptography. */
export function coldHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let out = "";
  let x = h >>> 0;
  for (let i = 0; i < 8; i++) {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    out += "0123456789abcdef"[x % 16];
  }
  return out;
}

function next(s: ColdState, tag: string): string {
  s.ctr += 1;
  return coldHash(`${s.seed}:${tag}:${s.ctr}`);
}

function tick(s: ColdState, ms = 1000): number {
  s.clock += ms;
  return s.clock;
}

function log(s: ColdState, kind: string, text: string, tone: ColdActivity["tone"] = "info"): void {
  s.ctr += 1;
  s.activity.push({ id: `ev${s.ctr}`, at: tick(s), kind, text, tone });
}

function demoAddr(s: ColdState, net: ColdNetwork, tag: string): string {
  return `${net.addrPrefix}${next(s, tag)}${next(s, `${tag}x`)}${next(s, `${tag}y`)}`.slice(0, net.addrPrefix.length + 38);
}

export function coldNetwork(id: string): ColdNetwork {
  const n = COLD_NETWORKS.find((x) => x.id === id);
  if (!n) throw new IllegalColdAction(`unsupported network: ${id}`);
  return n;
}

export function coldAsset(sym: string): ColdAsset {
  const a = COLD_ASSETS.find((x) => x.symbol === sym);
  if (!a) throw new IllegalColdAction(`unsupported asset: ${sym}`);
  return a;
}

export function coldAccount(s: ColdState, id: string): ColdAccount {
  const a = s.accounts.find((x) => x.id === id);
  if (!a) throw new IllegalColdAction(`unknown account: ${id}`);
  return a;
}

export function coldActive(s: ColdState): ColdAccount {
  if (!s.activeAccount) throw new IllegalColdAction("no active account");
  return coldAccount(s, s.activeAccount);
}

function needSetup(s: ColdState): void {
  if (s.setupStage !== "ready") throw new IllegalColdAction("device setup is not complete");
  if (!s.device.initialized || s.device.wiped) throw new IllegalColdAction("device is not initialized");
}

function needUnlocked(s: ColdState): void {
  needSetup(s);
  if (s.device.locked) throw new IllegalColdAction("device is locked — enter the demo PIN");
}

function findProposal(s: ColdState, id: string): ColdProposal {
  const p = s.proposals.find((x) => x.id === id);
  if (!p) throw new IllegalColdAction(`unknown proposal: ${id}`);
  return p;
}

function stage(p: ColdProposal, s: ColdState, key: string): void {
  p.stages.push({ key, at: tick(s) });
}

// ---------- setup ceremony ----------

export function coldChooseModel(s: ColdState, modelId: string): void {
  if (s.setupStage !== "none") throw new IllegalColdAction("setup already started");
  if (!COLD_MODELS.some((m) => m.id === modelId)) throw new IllegalColdAction(`unknown model: ${modelId}`);
  s.device.model = modelId;
  s.setupStage = "model";
  log(s, "setup", `Model selected: ${modelId}.`);
}

export function coldPowerOn(s: ColdState): void {
  if (s.setupStage !== "model") throw new IllegalColdAction("choose a model first");
  s.device.powered = true;
  s.setupStage = "power";
  log(s, "setup", "Device powered on. Genuine check skipped — this is a simulation.");
}

export function coldInitNew(s: ColdState): string[] {
  if (s.setupStage !== "power") throw new IllegalColdAction("power on first");
  if (!s.device.powered) throw new IllegalColdAction("device is off");
  const words: string[] = [];
  for (let i = 0; i < 12; i++) {
    const h = coldHash(`${s.seed}:seed:${s.ctr}:${i}`);
    words.push(COLD_DEMO_WORDS[parseInt(h.slice(0, 4), 16) % COLD_DEMO_WORDS.length]);
  }
  s.ctr += 1;
  s.seedWords = words;
  s.seedRevealed = false;
  s.backupVerified = false;
  s.recoveryProfile = { words: [...words], model: s.device.model ?? "stick" };
  s.device.initialized = true;
  s.device.wiped = false;
  s.device.attempts = 0;
  s.setupStage = "init";
  log(s, "setup", "New demo wallet initialized. Recovery phrase generated inside the device (DEMO ONLY).", "warn");
  return [...words];
}

export function coldSetPin(s: ColdState, pin: string): void {
  if (s.setupStage !== "init" && s.setupStage !== "pin") throw new IllegalColdAction("initialize first");
  if (!/^[0-9]{4,8}$/.test(pin)) throw new IllegalColdAction("demo PIN must be 4–8 digits");
  s.device.pin = pin;
  s.device.attempts = 0;
  s.device.locked = false;
  s.setupStage = "pin";
  log(s, "setup", "Demo PIN created. In a real device the PIN unlocks signing, it is not the key.");
}

export function coldRevealSeed(s: ColdState): string[] {
  if (s.setupStage !== "pin" && s.setupStage !== "seed") throw new IllegalColdAction("create a PIN first");
  if (s.device.locked) throw new IllegalColdAction("device is locked");
  s.seedRevealed = true;
  s.setupStage = "seed";
  log(s, "setup", "Recovery phrase revealed on the device screen — never on the computer.", "warn");
  return [...s.seedWords];
}

export function coldVerifyBackup(s: ColdState, picks: { pos: number; word: string }[]): void {
  if (s.setupStage !== "seed" && s.setupStage !== "reveal" && s.setupStage !== "verify") throw new IllegalColdAction("reveal the phrase first");
  if (!s.seedRevealed) throw new IllegalColdAction("reveal the phrase first");
  const ok = picks.length >= 3 && picks.every(
    ({ pos, word }) => s.seedWords[pos] !== undefined && s.seedWords[pos].toLowerCase() === word.trim().toLowerCase()
  );
  if (!ok) throw new IllegalColdAction("backup check failed — compare with the device screen and retry");
  s.backupVerified = true;
  s.setupStage = "verify";
  log(s, "setup", "Backup verified: requested words matched in order.", "good");
}

export function coldFinishSetup(s: ColdState): void {
  if (!s.backupVerified) throw new IllegalColdAction("verify the backup first");
  if (s.accounts.length === 0) {
    for (const net of COLD_NETWORKS) {
      s.ctr += 1;
      const id = `acct${s.ctr}`;
      s.accounts.push({
        id,
        name: net.id === "glacier" ? "Glacier savings" : "Tidepool savings",
        network: net.id,
        address: demoAddr(s, net, `addr-${net.id}`),
        balances: {}
      });
    }
    s.activeAccount = s.accounts[0].id;
  }
  s.device.connected = false;
  s.device.locked = true;
  s.setupStage = "ready";
  log(s, "setup", "Setup complete. Device locked — enter the demo PIN to use it.", "good");
}

// ---------- lock / connection ----------

export function coldConnect(s: ColdState): void {
  needSetup(s);
  if (!s.device.powered) throw new IllegalColdAction("device is off");
  s.device.connected = true;
  log(s, "device", "USB link established (simulated). The computer still never sees the keys.");
}

export function coldDisconnect(s: ColdState): void {
  needSetup(s);
  s.device.connected = false;
  log(s, "device", "Device disconnected. Unsigned QR export still works — signing never needs the wire.", "warn");
}

export function coldLock(s: ColdState): void {
  needSetup(s);
  s.device.locked = true;
  s.device.attempts = 0;
  log(s, "device", "Device locked.");
}

/** Returns attempts remaining. Wipes the device when attempts run out. */
export function coldUnlock(s: ColdState, pin: string): number {
  needSetup(s);
  if (!s.device.locked) return s.device.maxAttempts;
  if (s.device.pin === null) throw new IllegalColdAction("no PIN set");
  if (pin === s.device.pin) {
    s.device.locked = false;
    s.device.attempts = 0;
    log(s, "device", "Unlocked with the demo PIN.", "good");
    return s.device.maxAttempts;
  }
  s.device.attempts += 1;
  const left = s.device.maxAttempts - s.device.attempts;
  if (left <= 0) {
    wipeDevice(s, "Too many wrong PIN attempts — device wiped (simulated). Restore from the recovery profile.");
    return 0;
  }
  log(s, "device", `Wrong PIN. ${left} attempt(s) left before the simulated wipe.`, "bad");
  return left;
}

export function coldSetMaxAttempts(s: ColdState, n: number): void {
  if (![3, 5, 10].includes(n)) throw new IllegalColdAction("max attempts must be 3, 5 or 10");
  s.device.maxAttempts = n;
  s.device.attempts = 0;
  log(s, "device", `Lockout policy set to ${n} attempts (educational setting).`);
}

function wipeDevice(s: ColdState, reason: string): void {
  s.device.initialized = false;
  s.device.wiped = true;
  s.device.pin = null;
  s.device.locked = true;
  s.device.connected = false;
  s.device.attempts = 0;
  s.seedWords = [];
  s.seedRevealed = false;
  s.backupVerified = false;
  s.accounts = [];
  s.activeAccount = null;
  s.addrVerified = {};
  s.setupStage = "ready";
  log(s, "device", reason, "bad");
}

export function coldResetDevice(s: ColdState, confirmed: boolean): void {
  needSetup(s);
  if (!confirmed) throw new IllegalColdAction("reset needs explicit confirmation");
  wipeDevice(s, "Device reset to factory state (simulated). The recovery profile is retained for the restore drill.");
}

export function coldRestore(s: ColdState, pin: string): void {
  if (!s.device.wiped && s.device.initialized) throw new IllegalColdAction("device already holds a wallet");
  const prof = s.recoveryProfile;
  if (!prof) throw new IllegalColdAction("no recovery profile stored");
  if (!/^[0-9]{4,8}$/.test(pin)) throw new IllegalColdAction("demo PIN must be 4–8 digits");
  s.seedWords = [...prof.words];
  s.seedRevealed = false;
  s.backupVerified = true;
  s.device.model = prof.model;
  s.device.powered = true;
  s.device.initialized = true;
  s.device.wiped = false;
  s.device.pin = pin;
  s.device.locked = false;
  s.device.attempts = 0;
  s.device.connected = false;
  for (const net of COLD_NETWORKS) {
    s.ctr += 1;
    const id = `acct${s.ctr}`;
    // same account record as setup: addresses derive from the profile words
    const addrTag = coldHash(`${prof.words.join(" ")}:${net.id}`);
    s.accounts.push({
      id,
      name: net.id === "glacier" ? "Glacier savings (restored)" : "Tidepool savings (restored)",
      network: net.id,
      address: `${net.addrPrefix}${addrTag}${coldHash(`${addrTag}x`)}${coldHash(`${addrTag}y`)}`.slice(0, net.addrPrefix.length + 38),
      balances: {}
    });
  }
  s.activeAccount = s.accounts[0].id;
  s.setupStage = "ready";
  log(s, "recovery", "Wallet restored from the recovery profile — losing the device need not mean losing access.", "good");
}

// ---------- accounts / receive ----------

export function coldSwitchAccount(s: ColdState, id: string): void {
  needSetup(s);
  coldAccount(s, id);
  s.activeAccount = id;
  log(s, "account", `Switched to account ${id}.`);
}

/** The single shared record: computer and device must show this exact address. */
export function coldAddressOf(s: ColdState, acctId: string): string {
  needSetup(s);
  return coldAccount(s, acctId).address;
}

export function coldVerifyAddress(s: ColdState, acctId: string): string {
  needUnlocked(s);
  const addr = coldAccount(s, acctId).address;
  s.addrVerified[acctId] = true;
  log(s, "verify", `Address verified on device for ${acctId}. Compare it with the computer.`, "good");
  return addr;
}

/** Computer-side display address (spoofed when the tamper scenario is on). */
export function coldDisplayAddress(s: ColdState, acctId: string): string {
  const real = coldAddressOf(s, acctId);
  if (s.scenarios.tamperReceive) {
    const net = coldNetwork(coldAccount(s, acctId).network);
    return `${net.addrPrefix}${coldHash(`attacker:${s.seed}`)}${coldHash(`attacker2:${s.seed}`)}`.slice(0, net.addrPrefix.length + 38);
  }
  return real;
}

export function coldSimIncoming(s: ColdState, acctId: string, asset: string, amountMinor: number): string {
  needSetup(s);
  const acct = coldAccount(s, acctId);
  const a = coldAsset(asset);
  if (a.network !== acct.network) throw new IllegalColdAction(`${asset} does not live on ${acct.network}`);
  if (!(amountMinor > 0) || !Number.isInteger(amountMinor)) throw new IllegalColdAction("amount must be a positive integer (minor units)");
  s.ctr += 1;
  const p: ColdProposal = {
    id: `rx${s.ctr}`, dir: "in", fromAcct: null, fromAddr: "demo-faucet(sim)",
    to: acct.address, asset, network: acct.network, amountMinor, feeMinor: 0,
    via: "usb", status: "pending", deviceVerdict: "none", importedOnDevice: false,
    signedPayload: null, hash: `0xDEMO${next(s, "rxhash")}`, confirms: 0,
    confRequired: coldNetwork(acct.network).confRequired, broadcastAttempts: 1,
    settled: false, failReason: null, stages: [], createdAt: tick(s)
  };
  stage(p, s, "received-pending");
  s.proposals.push(p);
  log(s, "receive", `Simulated incoming transfer of ${amountMinor} ${asset} (pending). The device can stay offline — receiving only needs the address.`);
  return p.id;
}

// ---------- send: prepare ----------

export function coldEstimateFee(s: ColdState, network: string, amountMinor: number): number {
  const net = coldNetwork(network);
  if (s.scenarios.excessFee) return Math.max(net.baseFeeMinor, Math.floor(amountMinor * 0.4));
  return net.baseFeeMinor;
}

export interface ColdPrepareInput {
  fromAcct: string;
  to: string;
  asset: string;
  amountMinor: number;
  via: "usb" | "qr";
}

export function coldPrepare(s: ColdState, input: ColdPrepareInput): string {
  needSetup(s);
  const acct = coldAccount(s, input.fromAcct);
  const a = coldAsset(input.asset);
  if (a.network !== acct.network) throw new IllegalColdAction(`${input.asset} is not on ${acct.network} — check the network`);
  const net = coldNetwork(acct.network);
  const dest = input.to.trim();
  const addrRe = new RegExp(`^${net.addrPrefix}[0-9a-f]{38}$`);
  if (!addrRe.test(dest)) throw new IllegalColdAction(`recipient fails ${net.label} address validation`);
  if (!(input.amountMinor > 0) || !Number.isInteger(input.amountMinor)) throw new IllegalColdAction("amount must be a positive integer (minor units)");
  // minor units are the smallest unit — anything fractional is rejected above
  const fee = coldEstimateFee(s, acct.network, input.amountMinor);
  const bal = acct.balances[input.asset] ?? 0;
  if (input.amountMinor + fee > bal) throw new IllegalColdAction("insufficient funds for amount + fee");
  s.ctr += 1;
  const p: ColdProposal = {
    id: `tx${s.ctr}`, dir: "out", fromAcct: acct.id, fromAddr: acct.address,
    to: dest, asset: input.asset, network: acct.network, amountMinor: input.amountMinor,
    feeMinor: fee, via: input.via, status: "awaiting", deviceVerdict: "none",
    importedOnDevice: input.via === "usb", signedPayload: null, hash: null,
    confirms: 0, confRequired: net.confRequired, broadcastAttempts: 0,
    settled: false, failReason: null, stages: [], createdAt: tick(s)
  };
  stage(p, s, "prepared");
  s.proposals.push(p);
  log(s, "prepare", `Unsigned proposal ${p.id} prepared (${input.via === "usb" ? "USB" : "air-gapped QR"}). No funds moved.`, "warn");
  return p.id;
}

/** Computer-side proposal view (spoofed destination when the tamper scenario is on). */
export function coldComputerView(s: ColdState, id: string): ColdProposal & { displayTo: string; spoofed: boolean } {
  const p = findProposal(s, id);
  const spoofed = p.dir === "out" && s.scenarios.tamperSend && p.status !== "confirmed";
  const net = coldNetwork(p.network);
  const displayTo = spoofed
    ? `${net.addrPrefix}${coldHash(`attacker:${s.seed}:${p.id}`)}${coldHash(`attackerX:${p.id}`)}`.slice(0, net.addrPrefix.length + 38)
    : p.to;
  return { ...p, displayTo, spoofed };
}

/** Device-side proposal view — always the true record, never the computer's description. */
export function coldDeviceView(s: ColdState, id: string): ColdProposal {
  return { ...findProposal(s, id) };
}

export function coldCancel(s: ColdState, id: string): void {
  const p = findProposal(s, id);
  if (p.status !== "awaiting" && p.status !== "draft") throw new IllegalColdAction("only an unsigned proposal can be cancelled");
  p.status = "cancelled";
  p.failReason = "cancelled by student";
  stage(p, s, "cancelled");
  log(s, "cancel", `Proposal ${id} cancelled before signing. No funds moved.`, "warn");
}

// ---------- air-gapped payloads ----------

interface AirUnsigned {
  kind: "unsigned-tx";
  id: string;
  from: string;
  to: string;
  asset: string;
  network: string;
  amountMinor: number;
  feeMinor: number;
  exp: number;
  sum: string;
}

interface AirSigned {
  kind: "signed-tx";
  id: string;
  sig: string;
  exp: number;
  sum: string;
}

function airSum(obj: Record<string, unknown>): string {
  const body = ["kind", "id", "from", "to", "asset", "network", "amountMinor", "feeMinor", "sig"]
    .map((k) => `${k}=${String(obj[k] ?? "")}`).join("|");
  return `D${coldHash(`airgap:${body}`).slice(0, 6).toUpperCase()}`;
}

export function coldExportUnsigned(s: ColdState, id: string): string {
  const p = findProposal(s, id);
  if (p.dir !== "out") throw new IllegalColdAction("only outgoing proposals are exported");
  if (p.status !== "awaiting") throw new IllegalColdAction("only an awaiting proposal can be exported");
  if (p.via !== "qr") throw new IllegalColdAction("this proposal uses the USB path");
  const payload: AirUnsigned = {
    kind: "unsigned-tx", id: p.id, from: p.fromAddr, to: p.to, asset: p.asset,
    network: p.network, amountMinor: p.amountMinor, feeMinor: p.feeMinor,
    exp: s.clock + s.scenarios.qrTtlMs, sum: ""
  };
  payload.sum = airSum(payload as unknown as Record<string, unknown>);
  const raw = JSON.stringify(payload);
  s.lastUnsignedQr = raw;
  stage(p, s, "exported-qr");
  log(s, "airgap", `Unsigned payload for ${id} exported as a demo QR (expires in ${Math.round(s.scenarios.qrTtlMs / 1000)}s).`);
  return raw;
}

export function coldImportUnsigned(s: ColdState, raw: string): string {
  needUnlocked(s);
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new IllegalColdAction("invalid QR payload — not a demo transaction envelope");
  }
  if (obj.kind !== "unsigned-tx" || typeof obj.id !== "string") throw new IllegalColdAction("invalid QR payload — wrong envelope kind");
  if (obj.sum !== airSum(obj)) throw new IllegalColdAction("invalid QR payload — checksum mismatch (tampered?)");
  if (typeof obj.exp !== "number" || s.clock > obj.exp) throw new IllegalColdAction("expired QR payload — export a fresh one");
  const p = findProposal(s, obj.id);
  const pairs: [keyof AirUnsigned, keyof ColdProposal][] = [
    ["from", "fromAddr"], ["to", "to"], ["asset", "asset"],
    ["network", "network"], ["amountMinor", "amountMinor"], ["feeMinor", "feeMinor"]
  ];
  const mismatch = pairs.some(([a, b]) => (obj[a] as unknown) !== (p[b] as unknown));
  if (mismatch) throw new IllegalColdAction("payload does not match the proposal — abort (this is the tamper lesson)");
  if (p.status !== "awaiting") throw new IllegalColdAction("proposal is no longer awaiting a signature");
  p.importedOnDevice = true;
  stage(p, s, "imported-device");
  log(s, "airgap", `Device received unsigned payload for ${p.id} and validated every field.`);
  return p.id;
}

// ---------- device review / sign ----------

function needReviewable(s: ColdState, p: ColdProposal): void {
  needUnlocked(s);
  if (p.dir !== "out") throw new IllegalColdAction("only outgoing proposals need device approval");
  if (p.status !== "awaiting") throw new IllegalColdAction("proposal is not awaiting confirmation");
  if (p.via === "usb" && !s.device.connected) throw new IllegalColdAction("device is disconnected — reconnect, or use the QR path");
  if (p.via === "qr" && !p.importedOnDevice) throw new IllegalColdAction("import the QR payload on the device first");
}

export function coldDeviceApprove(s: ColdState, id: string): string {
  const p = findProposal(s, id);
  needReviewable(s, p);
  if (p.deviceVerdict !== "none") throw new IllegalColdAction("proposal already decided on the device");
  // the device signs exactly what it displayed (the true record)
  const sig = `DEMOSIG-${coldHash(`sign:${s.seed}:${p.id}:${p.to}:${p.amountMinor}`).toUpperCase()}`;
  const payload: AirSigned = { kind: "signed-tx", id: p.id, sig, exp: s.clock + s.scenarios.qrTtlMs, sum: "" };
  payload.sum = airSum(payload as unknown as Record<string, unknown>);
  const raw = JSON.stringify(payload);
  p.deviceVerdict = "approved";
  p.signedPayload = raw;
  p.status = "signed";
  stage(p, s, "signed-device");
  log(s, "sign", `Device signed ${id} (demo signature). Keys never left the device.`, "good");
  if (p.via === "usb") {
    p.status = "ready";
    stage(p, s, "ready-broadcast");
    log(s, "sign", `${id} is signed and ready — broadcasting is still a separate step.`);
  } else {
    s.lastSignedQr = raw;
    log(s, "airgap", "Signed payload exported as a demo QR. Ferry it back to the computer.");
  }
  return raw;
}

export function coldDeviceReject(s: ColdState, id: string): void {
  const p = findProposal(s, id);
  needReviewable(s, p);
  if (p.deviceVerdict !== "none") throw new IllegalColdAction("proposal already decided on the device");
  p.deviceVerdict = "rejected";
  p.status = "rejected";
  p.failReason = "rejected on the device";
  stage(p, s, "rejected-device");
  log(s, "sign", `Device rejected ${id}. Nothing was signed, no funds moved.`, "bad");
}

export function coldImportSigned(s: ColdState, raw: string): string {
  needSetup(s);
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new IllegalColdAction("invalid signed payload — not a demo envelope");
  }
  if (obj.kind !== "signed-tx" || typeof obj.id !== "string" || typeof obj.sig !== "string") {
    throw new IllegalColdAction("invalid signed payload — wrong envelope kind");
  }
  if (obj.sum !== airSum(obj)) throw new IllegalColdAction("invalid signed payload — checksum mismatch");
  if (typeof obj.exp !== "number" || s.clock > obj.exp) throw new IllegalColdAction("signed payload expired — sign again");
  const p = findProposal(s, obj.id);
  if (p.signedPayload !== raw) throw new IllegalColdAction("signed payload does not match this proposal");
  if (p.status !== "signed") throw new IllegalColdAction("proposal is not in signed state");
  p.status = "ready";
  stage(p, s, "ready-broadcast");
  log(s, "airgap", `${p.id} accepted by the computer and ready to broadcast.`, "good");
  return p.id;
}

// ---------- broadcast / confirm ----------

export function coldBroadcast(s: ColdState, id: string): void {
  needSetup(s);
  const p = findProposal(s, id);
  if (p.dir !== "out") throw new IllegalColdAction("only outgoing proposals are broadcast");
  if (p.status !== "ready") throw new IllegalColdAction("only a device-signed proposal can be broadcast");
  if (p.deviceVerdict !== "approved" || !p.signedPayload) throw new IllegalColdAction("device approval missing");
  if (p.via === "usb" && !s.device.connected) throw new IllegalColdAction("device is disconnected — reconnect to broadcast via USB");
  p.broadcastAttempts += 1;
  if (s.scenarios.failNextBroadcast) {
    s.scenarios.failNextBroadcast = false;
    p.status = "failed";
    p.failReason = "simulated network rejection (failNextBroadcast)";
    stage(p, s, "broadcast-failed");
    log(s, "broadcast", `${id} rejected by the simulated network. Retry is safe — nothing was deducted.`, "bad");
    // retryable: back to ready, approval retained
    p.status = "ready";
    return;
  }
  p.status = "pending";
  p.hash = `0xDEMO${next(s, `hash-${id}`).toUpperCase()}`;
  p.confirms = 0;
  stage(p, s, "broadcast");
  log(s, "broadcast", `${id} submitted to the simulated network (${p.hash}). Signed ≠ confirmed.`);
}

/** Manual classroom stepping: pending receives one confirmation per call. */
export function coldAdvance(s: ColdState, id: string): void {
  needSetup(s);
  const p = findProposal(s, id);
  if (p.dir === "in") {
    if (p.status !== "pending") throw new IllegalColdAction("incoming transfer is not pending");
    p.confirms += 1;
    stage(p, s, `confirm-${p.confirms}`);
    if (p.confirms >= p.confRequired && !p.settled) {
      p.settled = true;
      p.status = "confirmed";
      stage(p, s, "confirmed");
      const acct = s.accounts.find((a) => a.address === p.to);
      if (acct) acct.balances[p.asset] = (acct.balances[p.asset] ?? 0) + p.amountMinor;
      log(s, "confirm", `Incoming ${p.amountMinor} ${p.asset} confirmed and credited exactly once.`, "good");
    }
    return;
  }
  if (p.status !== "pending") throw new IllegalColdAction("transaction is not pending");
  p.confirms += 1;
  stage(p, s, `confirm-${p.confirms}`);
  log(s, "confirm", `${id}: ${p.confirms}/${p.confRequired} confirmations.`);
  if (p.confirms >= p.confRequired && !p.settled) {
    p.settled = true;
    p.status = "confirmed";
    stage(p, s, "confirmed");
    const acct = p.fromAcct ? coldAccount(s, p.fromAcct) : null;
    if (acct) {
      acct.balances[p.asset] = (acct.balances[p.asset] ?? 0) - p.amountMinor - p.feeMinor;
    }
    log(s, "confirm", `${id} confirmed. Debited amount + fee exactly once.`, "good");
  }
}

export function coldSetScenario(s: ColdState, key: keyof ColdScenarios, value: number | boolean): void {
  if (key === "qrTtlMs") {
    if (typeof value !== "number" || value < 1000) throw new IllegalColdAction("QR TTL must be >= 1000ms");
    s.scenarios.qrTtlMs = value;
  } else {
    s.scenarios[key] = Boolean(value);
  }
  log(s, "scenario", `Scenario flag ${key} → ${String(value)}.`);
}

/** Advance the demo clock (used to expire QR payloads in class). */
export function coldTick(s: ColdState, ms: number): void {
  if (!(ms > 0)) throw new IllegalColdAction("tick must be positive");
  tick(s, ms);
  log(s, "clock", `Demo clock advanced ${ms}ms.`);
}

export function coldHistory(s: ColdState): ColdProposal[] {
  return [...s.proposals].reverse();
}

export function coldBalanceOf(s: ColdState, acctId: string, asset: string): number {
  return coldAccount(s, acctId).balances[asset] ?? 0;
}
