/**
 * Staged custody runner (MetaMask / Ledger-inspired, fake keys only).
 * Hot wallet: review and confirm online. Cold wallet: build unsigned on the
 * watch-only side, ferry by (mock) QR to the offline device, VERIFY the
 * address on the device screen — the student's own comparison decides whether
 * an address swap is caught or the funds are lost. Seed phrases are FAKE.
 */
import {
  createRunBase,
  emit,
  fails,
  finishRunResult,
  move,
  post,
  step,
  str,
  transition,
  type Ctx
} from "./scenario";
import type { FailureId, FeeRule, RunResult } from "./types";

export class IllegalCustodyAction extends Error {}

export type CustodyAction =
  | { type: "gen_seed" }
  | { type: "recover"; checks: { pos: number; word: string }[] }
  | { type: "choose"; path: "hot" | "cold"; dest: string }
  | { type: "hot_confirm" }
  | { type: "device_check"; match: boolean }
  | { type: "cold_send" };

export type CustodyStage = "fresh" | "seeded" | "hotconfirm" | "verify" | "coldconfirm" | "done" | "terminal";

export interface CustodyFlow {
  ctx: Ctx;
  stage: CustodyStage;
  words: string[];
  dest: string;
  swapTo: string | null;
  transcript: CustodyAction[];
}

const FAKE_WORDS = ["river", "candle", "orbit", "meadow", "cipher", "harbor", "lantern", "prairie", "quartz", "signal", "tundra", "velvet", "willow", "yonder", "zephyr", "anchor"];

export const FAKE_WORD_LIST = [...FAKE_WORDS];

export function createCustodyFlow(ctx: Ctx): CustodyFlow {
  return { ctx, stage: "fresh", words: [], dest: "", swapTo: null, transcript: [] };
}

function need(flow: CustodyFlow, ...stages: CustodyStage[]): void {
  if (!stages.includes(flow.stage)) throw new IllegalCustodyAction(`not allowed at stage ${flow.stage}`);
}

function broadcastTail(flow: CustodyFlow, extra: Record<string, unknown>): void {
  const ctx = flow.ctx;
  if (str(ctx.params, "multisig", "off") === "2-of-3") {
    emit(ctx, "device", "MULTISIG_APPROVED", { quorum: "2-of-3" }, { titleKey: "ev.multisig.title", bodyKey: "ev.multisig.body", concept: "multisig" });
    step(ctx, 200);
  }
  ctx.state = transition(ctx.state, "AUTHENTICATE");
  ctx.state = transition(ctx.state, "AUTHORIZE");
  const ev = emit(ctx, "customerWallet", "BROADCAST", { multisig: str(ctx.params, "multisig", "off") === "2-of-3" ? "2-of-3" : undefined, ...extra }, { titleKey: "ev.broadcast.title", bodyKey: "ev.broadcast.body", concept: "mempool" });
  postTail(flow, ev.id);
}

function postTail(flow: CustodyFlow, evId: string): void {
  const ctx = flow.ctx;
  post(ctx, evId, "SETTLEMENT", "customerWallet", "merchantWallet", ctx.amountMinor, ctx.currency, "ledger.settlement");
  for (const l of ctx.feeLines) post(ctx, evId, "FEE", "customerWallet", "miner", l.amountMinor, ctx.currency, l.labelKey);
  ctx.state = transition(ctx.state, "CAPTURE");
  ctx.state = transition(ctx.state, "CLEAR");
  ctx.state = transition(ctx.state, "SETTLE");
  emit(ctx, "miner", "CONFIRMED", { confirmations: 1 }, { titleKey: "ev.conf.title", bodyKey: "ev.conf.body", concept: "finality" });
  flow.stage = "done";
}

export function custodyAdvance(flow: CustodyFlow, action: CustodyAction): { stage: CustodyStage } {
  const ctx = flow.ctx;
  flow.transcript.push(action);
  switch (action.type) {
    case "gen_seed": {
      need(flow, "fresh");
      flow.words = Array.from({ length: 12 }, () => ctx.rng.pick(FAKE_WORDS));
      emit(ctx, "customerWallet", "SEED_GENERATED", { words: flow.words, fake: true }, { titleKey: "ev.seed.title", bodyKey: "ev.seed.body", concept: "custody" });
      step(ctx, 300);
      flow.stage = "seeded";
      break;
    }
    case "recover": {
      need(flow, "seeded");
      const ok = action.checks.length > 0 && action.checks.every(
        ({ pos, word }) => flow.words[pos] !== undefined && flow.words[pos].toLowerCase() === word.trim().toLowerCase()
      );
      if (ok) {
        emit(ctx, "customerWallet", "RECOVERED", { verified: action.checks.length }, { titleKey: "ev.recovered.title", bodyKey: "ev.recovered.body", concept: "recovery" });
        step(ctx, 200);
      } else {
        ctx.state = transition(ctx.state, "AUTHENTICATE");
        move(ctx, "CANCEL", "customer", "SEED_LOST", {}, { titleKey: "ev.seedLost.title", bodyKey: "ev.seedLost.body", concept: "recovery" });
        flow.stage = "terminal";
      }
      break;
    }
    case "choose": {
      need(flow, "seeded");
      if (fails(ctx, "lostSeed")) {
        ctx.state = transition(ctx.state, "AUTHENTICATE");
        move(ctx, "CANCEL", "customer", "SEED_LOST", {}, { titleKey: "ev.seedLost.title", bodyKey: "ev.seedLost.body", concept: "recovery" });
        flow.stage = "terminal";
        break;
      }
      if (action.dest.trim().length < 6) throw new IllegalCustodyAction("destination is required");
      flow.dest = action.dest.trim();
      if (action.path === "hot") {
        emit(ctx, "customerWallet", "HOT_SIGNED", { online: true }, { titleKey: "ev.hot.title", bodyKey: "ev.hot.body", concept: "hot-wallet" });
        step(ctx, 250);
        if (fails(ctx, "compromised")) {
          emit(ctx, "system", "HOT_COMPROMISED", { vector: "malware" }, { titleKey: "ev.comp.title", bodyKey: "ev.comp.body", concept: "custody" });
        }
        flow.stage = "hotconfirm";
      } else {
        emit(ctx, "customerWallet", "WATCHONLY_BUILT", { unsigned: true, dest: flow.dest }, { titleKey: "ev.watch.title", bodyKey: "ev.watch.body", concept: "cold-wallet" });
        step(ctx, 300);
        emit(ctx, "customer", "QTRANSFER_TO_OFFLINE", { via: "qr" }, { titleKey: "ev.qoff.title", bodyKey: "ev.qoff.body", concept: "cold-wallet" });
        step(ctx, 400);
        flow.swapTo = fails(ctx, "addressSwap") ? `sim1${ctx.rng.hex(10)}` : null;
        flow.stage = "verify";
      }
      break;
    }
    case "hot_confirm": {
      need(flow, "hotconfirm");
      broadcastTail(flow, { to: flow.dest });
      break;
    }
    case "device_check": {
      need(flow, "verify");
      if (!action.match) {
        emit(ctx, "system", "ADDRESS_SWAP", { caught: true }, { titleKey: "ev.swap.title", bodyKey: "ev.swap.body", concept: "phishing" });
        ctx.state = transition(ctx.state, "AUTHENTICATE");
        move(ctx, "CANCEL", "customer", "SWAP_STOPPED", {}, { titleKey: "ev.swapStop.title", bodyKey: "ev.swapStop.body", concept: "verification" });
        flow.stage = "terminal";
        break;
      }
      if (flow.swapTo) {
        emit(ctx, "device", "DEVICE_VERIFIED", { amountMinor: ctx.amountMinor, addressOk: false }, { titleKey: "ev.devVer.title", bodyKey: "ev.devVer.body", concept: "verification" });
        step(ctx, 300);
        emit(ctx, "system", "ADDRESS_SWAP", { caught: false }, { titleKey: "ev.swap.title", bodyKey: "ev.swap.body", concept: "phishing" });
        ctx.state = transition(ctx.state, "AUTHENTICATE");
        ctx.state = transition(ctx.state, "AUTHORIZE");
        const ev = emit(ctx, "customerWallet", "BROADCAST", { to: "attacker" }, { titleKey: "ev.broadcast.title", bodyKey: "ev.broadcast.body", concept: "mempool" });
        post(ctx, ev.id, "SETTLEMENT", "customerWallet", "attacker", ctx.amountMinor, ctx.currency, "ledger.settlement");
        ctx.state = transition(ctx.state, "CAPTURE");
        ctx.state = transition(ctx.state, "CLEAR");
        ctx.state = transition(ctx.state, "SETTLE");
        emit(ctx, "system", "FUNDS_LOST", { reversible: false }, { titleKey: "ev.lost2.title", bodyKey: "ev.lost2.body", concept: "irreversibility" });
        flow.stage = "terminal";
        break;
      }
      emit(ctx, "device", "DEVICE_VERIFIED", { amountMinor: ctx.amountMinor, addressOk: true }, { titleKey: "ev.devVer.title", bodyKey: "ev.devVer.body", concept: "verification" });
      step(ctx, 300);
      emit(ctx, "device", "SIGNED_OFFLINE", { airgapped: true }, { titleKey: "ev.signed.title", bodyKey: "ev.signed.body", concept: "cold-wallet" });
      step(ctx, 300);
      emit(ctx, "customer", "QTRANSFER_BACK", { via: "qr" }, { titleKey: "ev.qback.title", bodyKey: "ev.qback.body", concept: "cold-wallet" });
      step(ctx, 250);
      flow.stage = "coldconfirm";
      break;
    }
    case "cold_send": {
      need(flow, "coldconfirm");
      broadcastTail(flow, { to: flow.dest });
      break;
    }
  }
  return { stage: flow.stage };
}

export function runCustodyScript(seed: number, params: Record<string, unknown>, failures: FailureId[], actions: CustodyAction[], feeRules?: FeeRule[]): RunResult {
  const ctx = createRunBase("custody", { seed, params, failures, feeRules });
  const flow = createCustodyFlow(ctx);
  for (const a of actions) custodyAdvance(flow, a);
  return custodyResult(flow);
}

export function custodyResult(flow: CustodyFlow): RunResult {
  return finishRunResult(flow.ctx);
}
