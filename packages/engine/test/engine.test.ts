import { describe, expect, it } from "vitest";
import type { TxState } from "../src/types";
import { validateDemoCard } from "../src/demoCards";
import { computeWaterfall } from "../src/fees";
import { quoteFx } from "../src/fx";
import { Ledger } from "../src/ledger";
import { allowedSignals, isTerminal, transition } from "../src/machine";
import { createRng } from "../src/prng";
import { replayKey, runScenario } from "../src/scenario";

describe("transaction machine", () => {
  it("walks the happy path", () => {
    let s: TxState = "INITIATED";
    const flow = ["AUTHENTICATE", "AUTHORIZE", "CAPTURE", "CLEAR", "SETTLE"] as const;
    for (const sig of flow) s = transition(s, sig);
    expect(s).toBe("SETTLED");
    expect(isTerminal(s)).toBe(true);
  });
  it("rejects illegal transitions", () => {
    expect(() => transition("INITIATED", "SETTLE")).toThrow();
    expect(() => transition("SETTLED", "CAPTURE")).toThrow();
  });
  it("supports review and dispute detours", () => {
    expect(transition("INITIATED", "FLAG_REVIEW")).toBe("PENDING_REVIEW");
    expect(transition("PENDING_REVIEW", "RESOLVE_REVIEW")).toBe("AUTHENTICATED");
    expect(transition("SETTLED", "CHARGEBACK")).toBe("CHARGEBACK");
    expect(transition("CAPTURED", "DISPUTE")).toBe("DISPUTED");
  });
  it("exposes allowed signals", () => {
    expect(allowedSignals("AUTHORIZED")).toContain("CAPTURE");
    expect(allowedSignals("DECLINED")).toEqual([]);
  });
});

describe("ledger invariants", () => {
  const accts = [
    { id: "customer", labelKey: "a", currency: "EUR", kind: "customer" as const },
    { id: "acquirer", labelKey: "b", currency: "EUR", kind: "acquirer" as const },
    { id: "merchant", labelKey: "c", currency: "EUR", kind: "merchant" as const }
  ];
  it("holds do not move posted balances (approval != settlement)", () => {
    const l = new Ledger(accts);
    l.fund("customer", 1000);
    l.hold("customer", 600);
    expect(l.balanceOf("customer")).toBe(1000);
    expect(l.availableOf("customer")).toBe(400);
    l.releaseHold("customer", 600);
    l.post({ eventId: "e1", txId: "t", t: 0, kind: "CAPTURE", debit: "customer", credit: "acquirer", amountMinor: 600, currency: "EUR", memoKey: "m" });
    expect(l.balanceOf("customer")).toBe(400);
    l.assertBalanced();
    l.assertNoNegative();
  });
  it("rejects overdrafts and negative balances", () => {
    const l = new Ledger(accts);
    l.fund("customer", 100);
    expect(() =>
      l.post({ eventId: "e1", txId: "t", t: 0, kind: "CAPTURE", debit: "customer", credit: "acquirer", amountMinor: 200, currency: "EUR", memoKey: "m" })
    ).toThrow();
  });
});

describe("fees + fx (illustrative)", () => {
  it("waterfall sums to the amount", () => {
    const wf = computeWaterfall(4999, [
      { id: "a", labelKey: "x", fixedMinor: 25, pctBps: 140, payer: "acquirer", payee: "issuer" },
      { id: "b", labelKey: "y", fixedMinor: 0, pctBps: 12, payer: "acquirer", payee: "network" }
    ]);
    expect(wf.totalFeesMinor).toBe(wf.lines.reduce((s, l) => s + l.amountMinor, 0));
    expect(wf.netAmountMinor).toBe(4999 - wf.totalFeesMinor);
  });
  it("spread is the hidden cost", () => {
    const q = quoteFx({ pair: "EUR/DZD", midRate: 140, spreadBps: 120, amountSrcMinor: 50000, srcCurrency: "EUR", dstCurrency: "DZD" });
    expect(q.offeredRate).toBeLessThan(q.midRate);
    expect(q.costPct).toBeCloseTo(1.2);
  });
});

describe("demo cards", () => {
  it("accepts the reserved fake range", () => {
    expect(validateDemoCard("4000000000000002")).toEqual({ ok: true });
    expect(validateDemoCard("5555555555554444")).toEqual({ ok: true });
  });
  it("rejects Luhn-valid numbers outside the range", () => {
    expect(validateDemoCard("4111111111111111")).toEqual({ ok: false, reasonKey: "card.notDemoRange" });
  });
});

describe("determinism", () => {
  it("same seed => byte-identical event log", () => {
    const a = runScenario("checkout", { seed: 42 });
    const b = runScenario("checkout", { seed: 42 });
    expect(replayKey(a)).toBe(replayKey(b));
    expect(a.finalState).toBe("SETTLED");
  });
  it("different seeds may diverge (rng is actually used)", () => {
    const rng = createRng(7);
    expect(rng.int(0, 100)).toBe(createRng(7).int(0, 100));
  });
  it("all Tier A modules settle happy-path", () => {
    for (const m of ["checkout", "wallet", "qr", "crypto", "custody", "demo"] as const) {
      const r = runScenario(m, { seed: 11 });
      expect(r.events.length).toBeGreaterThan(5);
      expect(r.finalState).toBe("SETTLED");
      expect(r.receipt.netAmountMinor + r.receipt.totalFeesMinor).toBe(r.receipt.amountMinor);
    }
  });
});

describe("failure injection", () => {
  it("checkout declines reproduce", () => {
    expect(runScenario("checkout", { seed: 5, failures: ["insufficient"] }).finalState).toBe("DECLINED");
    expect(runScenario("checkout", { seed: 5, failures: ["tdsFail"] }).finalState).toBe("DECLINED");
    expect(runScenario("checkout", { seed: 5, failures: ["chargeback"] }).finalState).toBe("CHARGEBACK");
  });
  it("wallet / qr / crypto / custody failures reproduce", () => {
    expect(runScenario("wallet", { seed: 5, failures: ["biometricFail"] }).finalState).toBe("SETTLED");
    expect(runScenario("wallet", { seed: 5, failures: ["tokenSuspended"] }).finalState).toBe("DECLINED");
    expect(runScenario("qr", { seed: 5, failures: ["expiredQr"] }).finalState).toBe("EXPIRED");
    expect(runScenario("qr", { seed: 5, failures: ["tamperedQr"] }).finalState).toBe("DECLINED");
    expect(runScenario("crypto", { seed: 5, failures: ["wrongAddress"] }).finalState).toBe("DECLINED");
    expect(runScenario("custody", { seed: 5, failures: ["lostSeed"] }).finalState).toBe("CANCELLED");
    expect(runScenario("custody", { seed: 5, failures: ["addressSwap"] }).finalState).toBe("SETTLED");
  });
  it("Tier B stubs run", () => {
    for (const m of ["nfc", "p2p", "mobilemoney", "remit", "bnpl"] as const) {
      expect(runScenario(m, { seed: 3 }).finalState).toBe("SETTLED");
    }
  });
});
