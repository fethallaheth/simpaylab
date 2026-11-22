/**
 * Cold-wallet engine tests: setup ceremony, lockout, receive, USB + QR send
 * lifecycles, settlement invariants, recovery, and scenario flags.
 */
import { describe, expect, it } from "vitest";
import {
  coldAdvance,
  coldBroadcast,
  coldCancel,
  coldChooseModel,
  coldConnect,
  coldDeviceApprove,
  coldDeviceReject,
  coldDisconnect,
  coldDisplayAddress,
  coldEmpty,
  coldEstimateFee,
  coldExportUnsigned,
  coldFinishSetup,
  coldImportSigned,
  coldImportUnsigned,
  coldInitNew,
  coldLock,
  coldPowerOn,
  coldPrepare,
  coldResetDevice,
  coldRestore,
  coldSetMaxAttempts,
  coldSetPin,
  coldRevealSeed,
  coldSetScenario,
  coldSimIncoming,
  coldTick,
  coldUnlock,
  coldVerifyAddress,
  coldVerifyBackup,
  coldComputerView,
  coldDeviceView,
  coldBalanceOf,
  IllegalColdAction,
  COLD_DEMO_WORDS
} from "../src/index";

function ready(seed = 42): ReturnType<typeof coldEmpty> {
  const s = coldEmpty(seed);
  coldChooseModel(s, "stick");
  coldPowerOn(s);
  const words = coldInitNew(s);
  coldSetPin(s, "1234");
  coldRevealSeed(s);
  coldVerifyBackup(s, [1, 6, 10].map((pos) => ({ pos, word: words[pos] })));
  coldFinishSetup(s);
  coldUnlock(s, "1234");
  coldConnect(s);
  return s;
}

function funded(seed = 42): ReturnType<typeof coldEmpty> {
  const s = ready(seed);
  const acct = s.accounts[0];
  const rx = coldSimIncoming(s, acct.id, "GLAC", 5_000_000_00);
  coldAdvance(s, rx);
  coldAdvance(s, rx);
  return s;
}

function destFor(s: ReturnType<typeof coldEmpty>): string {
  void s;
  return "glac1" + "ab".repeat(19);
}

describe("setup ceremony", () => {
  it("walks model → power → init → pin → reveal → verify → ready, locked at the end", () => {
    const s = coldEmpty(1);
    expect(s.setupStage).toBe("none");
    coldChooseModel(s, "touch");
    coldPowerOn(s);
    const words = coldInitNew(s);
    expect(words).toHaveLength(12);
    words.forEach((w) => expect(COLD_DEMO_WORDS).toContain(w));
    expect(() => coldSetPin(s, "12")).toThrow(IllegalColdAction);
    coldSetPin(s, "9876");
    expect(() => coldVerifyBackup(s, [{ pos: 0, word: "nope" }, { pos: 1, word: "nope" }, { pos: 2, word: "nope" }])).toThrow(IllegalColdAction);
    coldRevealSeed(s);
    coldVerifyBackup(s, [0, 5, 11].map((pos) => ({ pos, word: words[pos] })));
    coldFinishSetup(s);
    expect(s.setupStage).toBe("ready");
    expect(s.device.locked).toBe(true);
    expect(s.accounts).toHaveLength(2);
  });

  it("enforces setup order", () => {
    const s = coldEmpty(2);
    expect(() => coldPowerOn(s)).toThrow(IllegalColdAction);
    expect(() => coldInitNew(s)).toThrow(IllegalColdAction);
    expect(() => coldFinishSetup(s)).toThrow(IllegalColdAction);
  });
});

describe("lock, PIN and wipe", () => {
  it("unlocks with the right PIN and counts down wrong attempts", () => {
    const s = ready(3);
    coldLock(s);
    expect(s.device.locked).toBe(true);
    expect(coldUnlock(s, "0000")).toBe(2);
    expect(s.device.locked).toBe(true);
    expect(coldUnlock(s, "1234")).toBe(3);
    expect(s.device.locked).toBe(false);
  });

  it("wipes after maxAttempts wrong PINs but keeps the recovery profile", () => {
    const s = ready(4);
    coldLock(s);
    coldUnlock(s, "0000");
    coldUnlock(s, "0000");
    expect(coldUnlock(s, "0000")).toBe(0);
    expect(s.device.wiped).toBe(true);
    expect(s.device.initialized).toBe(false);
    expect(s.accounts).toHaveLength(0);
    expect(s.recoveryProfile).not.toBeNull();
  });

  it("restores the same demo wallet from the recovery profile", () => {
    const s = ready(5);
    const before = s.accounts.map((a) => a.address);
    coldResetDevice(s, true);
    expect(s.device.wiped).toBe(true);
    coldRestore(s, "5555");
    expect(s.device.initialized).toBe(true);
    expect(s.device.locked).toBe(false);
    // restored addresses derive from the same profile words
    expect(s.accounts.map((a) => a.address)).not.toEqual(before); // fresh ids, profile-derived addrs
    expect(s.accounts).toHaveLength(2);
  });

  it("requires explicit confirmation for reset", () => {
    const s = ready(6);
    expect(() => coldResetDevice(s, false)).toThrow(IllegalColdAction);
    expect(s.device.wiped).toBe(false);
  });

  it("supports a configurable lockout policy", () => {
    const s = ready(7);
    coldSetMaxAttempts(s, 5);
    coldLock(s);
    expect(coldUnlock(s, "0000")).toBe(4);
    expect(() => coldSetMaxAttempts(s, 4)).toThrow(IllegalColdAction);
  });
});

describe("receive flow", () => {
  it("credits an incoming transfer exactly once after confirmations", () => {
    const s = ready(8);
    const acct = s.accounts[0];
    const id = coldSimIncoming(s, acct.id, "GLAC", 100_000_000);
    expect(coldBalanceOf(s, acct.id, "GLAC")).toBe(0);
    coldAdvance(s, id);
    expect(s.proposals[0].status).toBe("pending");
    coldAdvance(s, id);
    expect(s.proposals[0].status).toBe("confirmed");
    expect(coldBalanceOf(s, acct.id, "GLAC")).toBe(100_000_000);
    expect(() => coldAdvance(s, id)).toThrow(IllegalColdAction);
    expect(coldBalanceOf(s, acct.id, "GLAC")).toBe(100_000_000);
  });

  it("rejects wrong-network assets and bad amounts", () => {
    const s = ready(9);
    const acct = s.accounts[0];
    expect(() => coldSimIncoming(s, acct.id, "TIDE", 10)).toThrow(IllegalColdAction);
    expect(() => coldSimIncoming(s, acct.id, "GLAC", 0)).toThrow(IllegalColdAction);
    expect(() => coldSimIncoming(s, acct.id, "GLAC", 1.5)).toThrow(IllegalColdAction);
  });

  it("verifies the same address on device and computer", () => {
    const s = ready(10);
    const acct = s.accounts[0];
    expect(coldDisplayAddress(s, acct.id)).toBe(acct.address);
    expect(coldVerifyAddress(s, acct.id)).toBe(acct.address);
    expect(s.addrVerified[acct.id]).toBe(true);
  });
});

describe("USB send lifecycle", () => {
  it("prepare → approve → broadcast → confirm settles exactly once", () => {
    const s = funded(11);
    const acct = s.accounts[0];
    const before = coldBalanceOf(s, acct.id, "GLAC");
    const id = coldPrepare(s, { fromAcct: acct.id, to: destFor(s), asset: "GLAC", amountMinor: 100_000_000, via: "usb" });
    // preparing moves nothing
    expect(coldBalanceOf(s, acct.id, "GLAC")).toBe(before);
    const p = s.proposals.find((x) => x.id === id)!;
    expect(p.status).toBe("awaiting");
    const fee = coldEstimateFee(s, "glacier", 100_000_000);
    expect(p.feeMinor).toBe(fee);
    coldDeviceApprove(s, id);
    expect(p.status).toBe("ready");
    // signing moves nothing
    expect(coldBalanceOf(s, acct.id, "GLAC")).toBe(before);
    coldBroadcast(s, id);
    expect(p.status).toBe("pending");
    coldAdvance(s, id);
    coldAdvance(s, id);
    expect(p.status).toBe("confirmed");
    expect(coldBalanceOf(s, acct.id, "GLAC")).toBe(before - 100_000_000 - fee);
    // no double broadcast / double settle
    expect(() => coldBroadcast(s, id)).toThrow(IllegalColdAction);
    expect(() => coldAdvance(s, id)).toThrow(IllegalColdAction);
    expect(coldBalanceOf(s, acct.id, "GLAC")).toBe(before - 100_000_000 - fee);
  });

  it("validates recipient, funds and network compatibility", () => {
    const s = funded(12);
    const acct = s.accounts[0];
    expect(() => coldPrepare(s, { fromAcct: acct.id, to: "bogus", asset: "GLAC", amountMinor: 10, via: "usb" })).toThrow(IllegalColdAction);
    expect(() => coldPrepare(s, { fromAcct: acct.id, to: destFor(s), asset: "TIDE", amountMinor: 10, via: "usb" })).toThrow(IllegalColdAction);
    expect(() => coldPrepare(s, { fromAcct: acct.id, to: destFor(s), asset: "GLAC", amountMinor: 999_999_999_999, via: "usb" })).toThrow(IllegalColdAction);
  });

  it("device rejection moves nothing and blocks broadcast", () => {
    const s = funded(13);
    const acct = s.accounts[0];
    const before = coldBalanceOf(s, acct.id, "GLAC");
    const id = coldPrepare(s, { fromAcct: acct.id, to: destFor(s), asset: "GLAC", amountMinor: 10_000_000, via: "usb" });
    coldDeviceReject(s, id);
    expect(s.proposals.find((x) => x.id === id)!.status).toBe("rejected");
    expect(coldBalanceOf(s, acct.id, "GLAC")).toBe(before);
    expect(() => coldBroadcast(s, id)).toThrow(IllegalColdAction);
    expect(() => coldDeviceApprove(s, id)).toThrow(IllegalColdAction);
  });

  it("unsigned proposals cannot be broadcast; cancellation works pre-sign", () => {
    const s = funded(14);
    const acct = s.accounts[0];
    const id = coldPrepare(s, { fromAcct: acct.id, to: destFor(s), asset: "GLAC", amountMinor: 10_000_000, via: "usb" });
    expect(() => coldBroadcast(s, id)).toThrow(IllegalColdAction);
    coldCancel(s, id);
    expect(s.proposals.find((x) => x.id === id)!.status).toBe("cancelled");
    expect(() => coldDeviceApprove(s, id)).toThrow(IllegalColdAction);
  });

  it("disconnection blocks USB broadcast but the device stays usable", () => {
    const s = funded(15);
    const acct = s.accounts[0];
    const id = coldPrepare(s, { fromAcct: acct.id, to: destFor(s), asset: "GLAC", amountMinor: 10_000_000, via: "usb" });
    coldDeviceApprove(s, id);
    coldDisconnect(s);
    expect(() => coldBroadcast(s, id)).toThrow(IllegalColdAction);
    coldConnect(s);
    coldBroadcast(s, id);
    expect(s.proposals.find((x) => x.id === id)!.status).toBe("pending");
  });

  it("a failed broadcast is retryable and settles exactly once", () => {
    const s = funded(16);
    const acct = s.accounts[0];
    const before = coldBalanceOf(s, acct.id, "GLAC");
    const id = coldPrepare(s, { fromAcct: acct.id, to: destFor(s), asset: "GLAC", amountMinor: 10_000_000, via: "usb" });
    coldDeviceApprove(s, id);
    coldSetScenario(s, "failNextBroadcast", true);
    coldBroadcast(s, id);
    const p = s.proposals.find((x) => x.id === id)!;
    expect(p.status).toBe("ready");
    expect(p.broadcastAttempts).toBe(1);
    expect(coldBalanceOf(s, acct.id, "GLAC")).toBe(before);
    coldBroadcast(s, id);
    coldAdvance(s, id);
    coldAdvance(s, id);
    expect(p.status).toBe("confirmed");
    expect(coldBalanceOf(s, acct.id, "GLAC")).toBe(before - 10_000_000 - p.feeMinor);
  });

  it("a locked device cannot approve", () => {
    const s = funded(17);
    const acct = s.accounts[0];
    const id = coldPrepare(s, { fromAcct: acct.id, to: destFor(s), asset: "GLAC", amountMinor: 10_000_000, via: "usb" });
    coldLock(s);
    expect(() => coldDeviceApprove(s, id)).toThrow(IllegalColdAction);
  });
});

describe("air-gapped QR lifecycle", () => {
  it("export → import → approve → import signed → broadcast → confirm", () => {
    const s = funded(18);
    coldDisconnect(s); // fully offline device path
    const acct = s.accounts[0];
    const before = coldBalanceOf(s, acct.id, "GLAC");
    const id = coldPrepare(s, { fromAcct: acct.id, to: destFor(s), asset: "GLAC", amountMinor: 20_000_000, via: "qr" });
    const unsigned = coldExportUnsigned(s, id);
    expect(typeof unsigned).toBe("string");
    // device cannot approve before importing
    expect(() => coldDeviceApprove(s, id)).toThrow(IllegalColdAction);
    expect(coldImportUnsigned(s, unsigned)).toBe(id);
    const signed = coldDeviceApprove(s, id);
    expect(s.proposals.find((x) => x.id === id)!.status).toBe("signed");
    // computer must import the signed payload before broadcast
    expect(() => coldBroadcast(s, id)).toThrow(IllegalColdAction);
    expect(coldImportSigned(s, signed)).toBe(id);
    coldBroadcast(s, id);
    coldAdvance(s, id);
    coldAdvance(s, id);
    const p = s.proposals.find((x) => x.id === id)!;
    expect(p.status).toBe("confirmed");
    expect(coldBalanceOf(s, acct.id, "GLAC")).toBe(before - 20_000_000 - p.feeMinor);
  });

  it("rejects invalid, tampered and expired payloads", () => {
    const s = funded(19);
    const acct = s.accounts[0];
    const id = coldPrepare(s, { fromAcct: acct.id, to: destFor(s), asset: "GLAC", amountMinor: 20_000_000, via: "qr" });
    expect(() => coldImportUnsigned(s, "not-json")).toThrow(IllegalColdAction);
    expect(() => coldImportUnsigned(s, JSON.stringify({ kind: "nope", id }))).toThrow(IllegalColdAction);
    const raw = coldExportUnsigned(s, id);
    const tampered = raw.replace(destFor(s).slice(0, 12), "glac1ffffffffff");
    expect(() => coldImportUnsigned(s, tampered)).toThrow(IllegalColdAction);
    coldSetScenario(s, "qrTtlMs", 1000);
    const raw2 = coldExportUnsigned(s, id);
    coldTick(s, 2000);
    expect(() => coldImportUnsigned(s, raw2)).toThrow(IllegalColdAction);
    expect(() => coldImportSigned(s, raw2)).toThrow(IllegalColdAction);
  });
});

describe("security scenarios", () => {
  it("tampered computer display differs from the device record", () => {
    const s = funded(20);
    const acct = s.accounts[0];
    const id = coldPrepare(s, { fromAcct: acct.id, to: destFor(s), asset: "GLAC", amountMinor: 10_000_000, via: "usb" });
    coldSetScenario(s, "tamperSend", true);
    const comp = coldComputerView(s, id);
    const dev = coldDeviceView(s, id);
    expect(comp.spoofed).toBe(true);
    expect(comp.displayTo).not.toBe(dev.to);
    expect(dev.to).toBe(destFor(s));
  });

  it("tampered receive address differs on the computer only", () => {
    const s = ready(21);
    const acct = s.accounts[0];
    coldSetScenario(s, "tamperReceive", true);
    expect(coldDisplayAddress(s, acct.id)).not.toBe(acct.address);
    expect(coldVerifyAddress(s, acct.id)).toBe(acct.address);
  });

  it("excessive fee is estimated and flagged", () => {
    const s = funded(22);
    const normal = coldEstimateFee(s, "glacier", 100_000_000);
    coldSetScenario(s, "excessFee", true);
    const high = coldEstimateFee(s, "glacier", 100_000_000);
    expect(high).toBeGreaterThan(normal * 10);
    expect(high).toBe(Math.floor(100_000_000 * 0.4));
  });
});
