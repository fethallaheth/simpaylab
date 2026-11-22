import { describe, expect, it } from "vitest";
import { COMMERCE, validateContent } from "@sim/content";
import { runScenario, type FailureId, type ModuleId } from "../src/index";

const MODULES: ModuleId[] = [
  "checkout", "wallet", "qr", "crypto", "custody",
  "nfc", "p2p", "mobilemoney", "remit", "bnpl", "demo"
];

const FAILURES: FailureId[] = [
  "decline", "insufficient", "expiredCard", "wrongCvc", "tdsFail", "tdsAbandon",
  "fraud", "duplicate", "timeout", "chargeback", "congestion", "delayedSettlement",
  "blockFail", "wrongAddress", "wrongNetwork", "underpaid", "depeg", "biometricFail",
  "lostDevice", "tokenSuspended", "offline", "expiredQr", "tamperedQr",
  "compromised", "lostSeed", "addressSwap"
];

describe("content validity", () => {
  it("validates all scenarios, quizzes, glossary, fees", () => {
    const v = validateContent();
    expect(v.scenarios).toBeGreaterThanOrEqual(25);
    expect(v.quizzes).toBeGreaterThanOrEqual(50);
    expect(v.glossary).toBeGreaterThanOrEqual(70);
  });
});

describe("commerce lens coverage", () => {
  it("every emitted event type has a plain-money line", () => {
    const seen = new Set<string>();
    for (const m of MODULES) {
      for (let seed = 1; seed <= 10; seed++) {
        for (const ev of runScenario(m, { seed }).events) seen.add(ev.type);
      }
      for (const f of FAILURES) {
        try {
          for (const ev of runScenario(m, { seed: 5, failures: [f] }).events) seen.add(ev.type);
        } catch {
          /* some combos abort at ledger level — still a lesson, covered by error card */
        }
      }
    }
    const missing = [...seen].filter((t) => !COMMERCE[t] || !COMMERCE[t].money);
    expect(missing).toEqual([]);
    expect(seen.size).toBeGreaterThan(60);
  });
});
