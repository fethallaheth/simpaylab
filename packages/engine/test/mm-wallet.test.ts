/**
 * Mobile-money wallet continuity: every add (cash-in) and sub (send, bill,
 * airtime, cash-out) must carry into later sessions via openBalanceMinor.
 * Regression cover for "operations don't work after cash-in".
 */
import { describe, expect, it } from "vitest";
import {
  createMmFlow,
  createRunBase,
  mmAdvance,
  mmBalance,
  mmResult,
  type FailureId,
  type MmFlow
} from "../src/index";

const PIN = "1234";
const RICH_TILL = 100_000_00;

function openSess(seed: number, openBal = 0, failures: FailureId[] = []): MmFlow {
  const ctx = createRunBase("mobilemoney", { seed, params: { pinExpected: PIN, openBalanceMinor: openBal }, failures });
  const flow = createMmFlow(ctx);
  mmAdvance(flow, { type: "ussd_open" });
  return flow;
}

function feeOf(flow: MmFlow): number {
  return mmResult(flow).receipt.totalFeesMinor;
}

describe("wallet continuity across sessions", () => {
  it("openBalanceMinor funds the ledger; default is still zero", () => {
    const withBal = openSess(1, 2500_00);
    expect(mmBalance(withBal)).toBe(2500_00);
    mmAdvance(withBal, { type: "balance" });
    const shown = withBal.ctx.events.find((e) => e.type === "BALANCE_SHOWN");
    expect(shown?.payload.balanceMinor).toBe(2500_00);

    const fresh = openSess(2);
    expect(mmBalance(fresh)).toBe(0);
  });

  it("cash-in then send/bill/airtime/cash-out all settle with exact balances", () => {
    // session 1: cash in 10,000
    const s1 = openSess(10);
    mmAdvance(s1, { type: "cashin", agentFloat: RICH_TILL, amountMinor: 10_000_00 });
    mmAdvance(s1, { type: "submit_pin", pin: PIN });
    expect(s1.stage).toBe("done");
    expect(mmBalance(s1)).toBe(10_000_00);

    // session 2: send 1,000 (amount + fee debited)
    const s2 = openSess(11, mmBalance(s1));
    expect(mmBalance(s2)).toBe(10_000_00);
    mmAdvance(s2, { type: "send", to: "0712345678", amountMinor: 1000_00 });
    mmAdvance(s2, { type: "submit_pin", pin: PIN });
    expect(s2.stage).toBe("done");
    expect(mmBalance(s2)).toBe(10_000_00 - 1000_00 - feeOf(s2));

    // session 3: pay bill 500
    const s3 = openSess(12, mmBalance(s2));
    mmAdvance(s3, { type: "paybill", biller: "Kenya Power", account: "ACC-1", amountMinor: 500_00 });
    mmAdvance(s3, { type: "submit_pin", pin: PIN });
    expect(s3.stage).toBe("done");
    const afterBill = mmBalance(s2) - 500_00 - feeOf(s3);
    expect(mmBalance(s3)).toBe(afterBill);

    // session 4: airtime 200
    const s4 = openSess(13, mmBalance(s3));
    mmAdvance(s4, { type: "airtime", phone: "0712345678", amountMinor: 200_00 });
    mmAdvance(s4, { type: "submit_pin", pin: PIN });
    expect(s4.stage).toBe("done");
    const afterAir = afterBill - 200_00 - feeOf(s4);
    expect(mmBalance(s4)).toBe(afterAir);

    // session 5: cash out 1,000 (till float covers it)
    const s5 = openSess(14, mmBalance(s4));
    mmAdvance(s5, { type: "cashout", agentFloat: RICH_TILL, amountMinor: 1000_00 });
    mmAdvance(s5, { type: "submit_pin", pin: PIN });
    expect(s5.stage).toBe("done");
    expect(mmBalance(s5)).toBe(afterAir - 1000_00 - feeOf(s5));

    // session 6: cash in again accumulates
    const s6 = openSess(15, mmBalance(s5));
    mmAdvance(s6, { type: "cashin", agentFloat: RICH_TILL, amountMinor: 2000_00 });
    mmAdvance(s6, { type: "submit_pin", pin: PIN });
    expect(s6.stage).toBe("done");
    expect(mmBalance(s6)).toBe(mmBalance(s5) + 2000_00);
  });

  it("send with no funds still declines (validation intact)", () => {
    const s = openSess(20);
    mmAdvance(s, { type: "send", to: "0712345678", amountMinor: 1000_00 });
    mmAdvance(s, { type: "submit_pin", pin: PIN });
    expect(s.stage).toBe("terminal");
    expect(s.ctx.events.map((e) => e.type)).toContain("WALLET_DECLINED");
    expect(mmBalance(s)).toBe(0);
  });

  it("dry till still refuses with AGENT_NO_FLOAT and keeps the wallet", () => {
    const s = openSess(21, 5000_00);
    mmAdvance(s, { type: "cashin", agentFloat: 100, amountMinor: 1000_00 });
    expect(s.stage).toBe("menu");
    expect(s.ctx.events.map((e) => e.type)).toContain("AGENT_NO_FLOAT");
    expect(mmBalance(s)).toBe(5000_00);
  });
});
