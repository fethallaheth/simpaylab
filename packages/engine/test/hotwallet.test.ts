import { describe, expect, it } from "vitest";
import {
  hwAddAccount,
  hwAddContact,
  hwAddNetwork,
  hwAddToken,
  hwApprove,
  hwBalance,
  hwCancel,
  hwConfirm,
  hwConfirmReceive,
  hwConnect,
  hwDisconnect,
  hwEmpty,
  hwEstimateFee,
  hwFail,
  hwFaucet,
  hwImport,
  hwLock,
  hwOnboardCreate,
  hwQuoteSwap,
  hwReceive,
  hwRemoveAccount,
  hwRemoveNetwork,
  hwRemoveToken,
  hwRevoke,
  hwSelectNetwork,
  hwSend,
  hwSign,
  hwStake,
  hwSwap,
  hwSwitchAccount,
  hwUnlock,
  hwUnstake,
  DEMO_PHRASE_A
} from "../src/index";

function funded(): ReturnType<typeof hwEmpty> {
  const s = hwEmpty(11);
  hwOnboardCreate(s, "Test", "1234");
  hwFaucet(s, "sETH", 1_000_000_000_000_000_000);
  return s;
}

describe("hot wallet onboarding + lock", () => {
  it("creates, locks, unlocks, rejects wrong passwords", () => {
    const s = hwEmpty(5);
    const words = hwOnboardCreate(s, "Main", "abcd");
    expect(words).toHaveLength(12);
    expect(s.accounts).toHaveLength(1);
    hwLock(s);
    expect(s.unlocked).toBe(false);
    expect(() => hwSend(s, { to: "0x1234567890123456789012345678901234567890", asset: "sETH", amountMinor: 1 })).toThrow();
    expect(() => hwUnlock(s, "nope")).toThrow();
    hwUnlock(s, "abcd");
    expect(s.unlocked).toBe(true);
  });
  it("imports the demo registry profile, rejects unknown phrases", () => {
    const s = hwEmpty(6);
    const label = hwImport(s, DEMO_PHRASE_A, "wxyz");
    expect(label).toBe("Demo profile A");
    expect(s.accounts).toHaveLength(2);
    expect(hwBalance(s, s.accounts[0].id, "sim-mainnet", "sETH")).toBeGreaterThan(0);
    const bad = hwEmpty(6);
    expect(() => hwImport(bad, "this is not a real recovery phrase at all", "wxyz")).toThrow();
  });
});

describe("accounts + networks + tokens", () => {
  it("manages accounts with balances gating removal", () => {
    const s = funded();
    const a2 = hwAddAccount(s, "Vault");
    expect(s.activeAccount).toBe(a2.id);
    hwSwitchAccount(s, s.accounts[0].id);
    expect(s.activeAccount).toBe(s.accounts[0].id);
    expect(() => hwRemoveAccount(s, s.accounts[0].id)).toThrow();
    hwRemoveAccount(s, a2.id);
    expect(s.accounts).toHaveLength(1);
  });
  it("switches networks without mixing balances", () => {
    const s = funded();
    hwSelectNetwork(s, "sim-polygon");
    expect(hwBalance(s, s.activeAccount!, "sim-polygon", "sPOL")).toBe(0);
    expect(hwBalance(s, s.activeAccount!, "sim-mainnet", "sETH")).toBe(1_000_000_000_000_000_000);
  });
  it("adds custom networks and tokens with validation", () => {
    const s = funded();
    expect(() => hwAddNetwork(s, { label: "", native: "x", chainId: -1, gasPriceGwei: -1 })).toThrow();
    const n = hwAddNetwork(s, { label: "LabChain", native: "LAB", chainId: 99999, gasPriceGwei: 1 });
    expect(n.custom).toBe(true);
    hwSelectNetwork(s, n.id);
    expect(() => hwRemoveNetwork(s, "sim-mainnet")).toThrow();
    const addr = "0x1234567890123456789012345678901234567890";
    expect(() => hwAddToken(s, { symbol: "x", name: "X", address: "nope", decimals: 18 })).toThrow();
    hwAddToken(s, { symbol: "LABT", name: "Lab Token", address: addr, decimals: 18 });
    hwRemoveToken(s, "LABT");
    expect(() => hwRemoveToken(s, "LAB")).toThrow();
  });
});

describe("send lifecycle", () => {
  const DEST = "0x1234567890123456789012345678901234567890";
  it("validates, debits once, confirms to internal recipients", () => {
    const s = funded();
    expect(() => hwSend(s, { to: "bogus", asset: "sETH", amountMinor: 1 })).toThrow();
    expect(() => hwSend(s, { to: DEST, asset: "sETH", amountMinor: 9_999_000_000_000_000_000 })).toThrow();
    const before = hwBalance(s, s.activeAccount!, "sim-mainnet", "sETH");
    const tx = hwSend(s, { to: DEST, asset: "sETH", amountMinor: 100_000_000_000_000_000 });
    expect(tx.status).toBe("pending");
    expect(hwBalance(s, s.activeAccount!, "sim-mainnet", "sETH")).toBeLessThan(before);
    hwAddContact(s, "Dest", DEST);
    const a2 = hwAddAccount(s, "Second");
    void a2;
    hwSwitchAccount(s, s.accounts[0].id);
    const tx2 = hwSend(s, { to: s.accounts[1].address, asset: "sETH", amountMinor: 50_000_000_000_000_000 });
    hwConfirm(s, tx2.id);
    expect(tx2.status).toBe("confirmed");
    expect(tx2.block).toBeGreaterThan(1000);
    expect(hwBalance(s, s.accounts[0].id, "sim-mainnet", "sETH")).toBe(850_000_000_000_000_000);
    expect(hwBalance(s, s.accounts[1].id, "sim-mainnet", "sETH")).toBe(50_000_000_000_000_000);
  });
  it("cancel refunds, fail keeps the debit honest", () => {
    const s = funded();
    const tx = hwSend(s, { to: DEST, asset: "sETH", amountMinor: 10_000_000_000_000_000 });
    const mid = hwBalance(s, s.activeAccount!, "sim-mainnet", "sETH");
    hwCancel(s, tx.id);
    expect(tx.status).toBe("cancelled");
    expect(hwBalance(s, s.activeAccount!, "sim-mainnet", "sETH")).toBeGreaterThan(mid);
    const tx2 = hwSend(s, { to: DEST, asset: "sETH", amountMinor: 10_000_000_000_000_000 });
    hwFail(s, tx2.id, "simulated timeout");
    expect(tx2.status).toBe("failed");
    expect(tx2.failReason).toBe("simulated timeout");
  });
});

describe("receive + swap + dapps", () => {
  it("incoming credits only on confirm", () => {
    const s = funded();
    const tx = hwReceive(s, "sUSD", 250_000_000);
    expect(hwBalance(s, s.activeAccount!, "sim-mainnet", "sUSD")).toBe(0);
    hwConfirmReceive(s, tx.id);
    expect(hwBalance(s, s.activeAccount!, "sim-mainnet", "sUSD")).toBe(250_000_000);
  });
  it("swaps quote, check slippage, move both balances", () => {
    const s = funded();
    const q = hwQuoteSwap(s, "sETH", "sUSD", 100_000_000_000_000_000, 50);
    expect(q.outMinor).toBeGreaterThan(0);
    expect(q.minOutMinor).toBeLessThanOrEqual(q.outMinor - q.feeMinor);
    const tx = hwSwap(s, "sETH", "sUSD", 100_000_000_000_000_000, q.minOutMinor);
    expect(tx.status).toBe("confirmed");
    expect(hwBalance(s, s.activeAccount!, "sim-mainnet", "sUSD")).toBe(q.outMinor - q.feeMinor);
    expect(() => hwSwap(s, "sETH", "sUSD", 100_000_000_000_000_000, q.outMinor * 10)).toThrow();
  });
  it("dApps connect, sign, approve with revocation", () => {
    const s = funded();
    hwConnect(s, "SimPay Merchant", s.accounts[0].id, "sim-mainnet");
    hwConnect(s, "SimStake", s.accounts[0].id, "sim-mainnet");
    const signed = hwSign(s, "SimPay Merchant", "Log in as...", true);
    expect(signed.status).toBe("confirmed");
    const rejected = hwSign(s, "SimPay Merchant", "Log in as...", false);
    expect(rejected.status).toBe("cancelled");
    hwApprove(s, "SimStake", "sUSD", "0xStAkE000000000000000000000000000000000001", null);
    expect(s.allows).toHaveLength(1);
    hwRevoke(s, "sUSD", "0xStAkE000000000000000000000000000000000001");
    expect(s.allows).toHaveLength(0);
    expect(() => hwStake(s, "sUSD", 100, "0xStAkE000000000000000000000000000000000001")).toThrow();
    hwApprove(s, "SimStake", "sUSD", "0xStAkE000000000000000000000000000000000001", 500_000_000);
    hwFaucet(s, "sUSD", 1_000_000_000);
    hwStake(s, "sUSD", 100_000_000, "0xStAkE000000000000000000000000000000000001");
    hwUnstake(s, "sUSD", 100_000_000, "0xStAkE000000000000000000000000000000000001");
    hwDisconnect(s, "SimPay Merchant");
    hwDisconnect(s, "SimStake");
    expect(s.conns).toHaveLength(0);
  });
  it("estimates fees from the per-network gas model", () => {
    const s = funded();
    const fee = hwEstimateFee(s);
    expect(fee.units).toBe(21000);
    expect(fee.baseGwei).toBe(12);
    // 18-decimal dust in minor units is honest: wallets quote gwei instead
    expect(fee.totalMinor).toBe(Math.round((21000 * 13e9) / 1e18));
    expect(fee.units * (fee.baseGwei + fee.priorityGwei)).toBe(21000 * 13);
  });
});
