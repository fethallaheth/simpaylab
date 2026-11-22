import { describe, expect, it } from "vitest";
import {
  bnplAdvance,
  bnplResult,
  createBnplFlow,
  createCryptoFlow,
  createCustodyFlow,
  createMmFlow,
  createNfcFlow,
  createP2pFlow,
  createQrFlow,
  createRemitFlow,
  createRunBase,
  createWalletFlow,
  cryptoAdvance,
  cryptoResult,
  custodyAdvance,
  custodyResult,
  mmAdvance,
  mmResult,
  nfcAdvance,
  nfcResult,
  p2pAdvance,
  p2pBalance,
  p2pResult,
  p2pUsers,
  qrAdvance,
  qrResult,
  remitAdvance,
  remitQuote,
  remitQuoteForReceive,
  remitResult,
  replayKey,
  runBnplScript,
  runCryptoScript,
  runCustodyScript,
  runMmScript,
  runNfcScript,
  runP2pScript,
  runQrScript,
  runRemitScript,
  runWalletScript,
  walletAdvance,
  walletResult
} from "../src/index";

const CARD = { pan: "4000000000000002", name: "AMINA BENALI", exp: "12/29", cvc: "123" };

describe("wallet staged flow", () => {
  it("card happy path settles", () => {
    const r = runWalletScript(42, { amountMinor: 2500 }, [], [
      { type: "add_card", ...CARD },
      { type: "start_pay", merchant: "Corner shop" },
      { type: "unlock_bio", pass: true }
    ]);
    expect(r.events.map((e) => e.type)).toEqual([
      "WALLET_OPENED", "CARD_PROVISIONED", "PROVISION_VERIFIED",
      "BIOMETRIC_PROMPT", "BIOMETRIC_OK", "CRYPTOGRAM_BUILT",
      "AUTHORIZED_HOLD", "CAPTURED", "CLEARED", "SETTLING", "SETTLED"
    ]);
    expect(r.finalState).toBe("SETTLED");
  });
  it("three failed biometrics fall back to device PIN", () => {
    const ctx = createRunBase("wallet", { seed: 7, params: { amountMinor: 1000 }, failures: [] });
    const flow = createWalletFlow(ctx);
    walletAdvance(flow, { type: "add_card", ...CARD });
    walletAdvance(flow, { type: "start_pay", merchant: "Kiosk" });
    walletAdvance(flow, { type: "unlock_bio", pass: false });
    walletAdvance(flow, { type: "unlock_bio", pass: false });
    walletAdvance(flow, { type: "unlock_bio", pass: false });
    expect(flow.stage).toBe("pin");
    walletAdvance(flow, { type: "unlock_pin", pin: "1234" });
    expect(walletResult(flow).finalState).toBe("SETTLED");
  });
  it("account mode debits by SMS code", () => {
    const ctx = createRunBase("wallet", { seed: 9, params: { walletKind: "account", amountMinor: 3000 }, failures: [] });
    const flow = createWalletFlow(ctx);
    walletAdvance(flow, { type: "link_account", rib: "12345678901234567890", phone: "0550123456" });
    walletAdvance(flow, { type: "start_pay", merchant: "Pharmacy" });
    expect(flow.stage).toBe("otp");
    walletAdvance(flow, { type: "submit_otp", code: flow.otp!.code });
    const r = walletResult(flow);
    expect(r.finalState).toBe("SETTLED");
    expect(r.events.map((e) => e.type)).toContain("MANDATE_CHARGED");
  });
  it("rejects out-of-range cards without a token", () => {
    const ctx = createRunBase("wallet", { seed: 3, params: {}, failures: [] });
    const flow = createWalletFlow(ctx);
    walletAdvance(flow, { type: "add_card", pan: "4111111111111111", name: "X", exp: "12/29", cvc: "123" });
    expect(flow.stage).toBe("empty");
    expect(flow.ctx.events.at(-1)!.type).toBe("CARD_REJECTED");
  });
  it("presenting a stored token skips card entry", () => {
    const ctx = createRunBase("wallet", { seed: 23, params: { amountMinor: 1500 }, failures: [] });
    const flow = createWalletFlow(ctx);
    walletAdvance(flow, { type: "present_token", last4: "0002", dpan: "dpan_...ab12" });
    expect(flow.stage).toBe("ready");
    expect(flow.ctx.events.map((e) => e.type)).toEqual(["WALLET_OPENED", "TOKEN_PRESENTED", "PROVISION_VERIFIED"]);
    walletAdvance(flow, { type: "start_pay", merchant: "Kiosk" });
    walletAdvance(flow, { type: "unlock_bio", pass: true });
    expect(walletResult(flow).finalState).toBe("SETTLED");
  });
  it("resend issues a fresh code; timeout retries safely", () => {
    const ctx = createRunBase("wallet", { seed: 24, params: { walletKind: "account", amountMinor: 1500 }, failures: ["timeout"] });
    const flow = createWalletFlow(ctx);
    walletAdvance(flow, { type: "link_account", rib: "12345678901234567890", phone: "0550123456" });
    walletAdvance(flow, { type: "start_pay", merchant: "Pharmacy" });
    const first = flow.otp!.code;
    walletAdvance(flow, { type: "resend_otp" });
    expect(flow.otp!.code).not.toBe(first);
    walletAdvance(flow, { type: "submit_otp", code: flow.otp!.code });
    const types = flow.ctx.events.map((e) => e.type);
    expect(types).toContain("GATEWAY_TIMEOUT");
    expect(types).toContain("RETRY_SAFE");
    expect(walletResult(flow).finalState).toBe("SETTLED");
  });
  it("duplicate submissions collapse to one payment", () => {
    const r = runWalletScript(25, { amountMinor: 1500 }, ["duplicate"], [
      { type: "add_card", ...CARD },
      { type: "start_pay", merchant: "Kiosk" },
      { type: "unlock_bio", pass: true }
    ]);
    expect(r.events.map((e) => e.type)).toContain("DUPLICATE_BLOCKED");
    expect(r.events.filter((e) => e.type === "CAPTURED")).toHaveLength(1);
    expect(r.finalState).toBe("SETTLED");
  });
  it("replays deterministically", () => {
    const acts = [
      { type: "add_card", ...CARD },
      { type: "start_pay", merchant: "Kiosk" },
      { type: "unlock_bio", pass: true }
    ] as const;
    const a = runWalletScript(5, { amountMinor: 999 }, [], [...acts]);
    const b = runWalletScript(5, { amountMinor: 999 }, [], [...acts]);
    expect(replayKey(a)).toBe(replayKey(b));
  });
});

describe("qr staged flow", () => {
  it("dynamic merchant code settles instantly", () => {
    const r = runQrScript(42, { amountMinor: 5800 }, [], [
      { type: "merchant_make", mode: "dynamic", amountMinor: 5800 },
      { type: "customer_scan" },
      { type: "submit_pin", pin: "1234" }
    ]);
    expect(r.finalState).toBe("SETTLED");
    expect(r.events.map((e) => e.type)).toContain("MERCHANT_NOTIFIED");
  });
  it("static code needs a typed amount", () => {
    const ctx = createRunBase("qr", { seed: 4, params: {}, failures: [] });
    const flow = createQrFlow(ctx);
    qrAdvance(flow, { type: "merchant_make", mode: "static" });
    qrAdvance(flow, { type: "customer_scan", amountMinor: 4500 });
    qrAdvance(flow, { type: "submit_pin", pin: "1234" });
    const r = qrResult(flow);
    expect(r.finalState).toBe("SETTLED");
    expect(r.receipt.amountMinor).toBe(4500);
  });
  it("expired and tampered codes die honestly", () => {
    const exp = runQrScript(4, {}, ["expiredQr"], [
      { type: "merchant_make", mode: "dynamic", amountMinor: 1000 },
      { type: "customer_scan" }
    ]);
    expect(exp.finalState).toBe("EXPIRED");
    const tam = runQrScript(4, {}, ["tamperedQr"], [
      { type: "merchant_make", mode: "dynamic", amountMinor: 1000 },
      { type: "customer_scan" }
    ]);
    expect(tam.finalState).toBe("DECLINED");
  });
  it("customer-presented code works from the other side", () => {
    const r = runQrScript(8, { amountMinor: 2200 }, [], [
      { type: "wallet_show" },
      { type: "merchant_scan" },
      { type: "submit_pin", pin: "1234" }
    ]);
    expect(r.finalState).toBe("SETTLED");
    expect(r.events.map((e) => e.type)).toContain("QR_SHOWN");
  });
  it("scan records the chosen funding source", () => {
    const r = runQrScript(12, { amountMinor: 3000 }, [], [
      { type: "merchant_make", mode: "dynamic", amountMinor: 3000 },
      { type: "customer_scan", source: "card" },
      { type: "submit_pin", pin: "1234" }
    ]);
    const scanned = r.events.find((e) => e.type === "QR_SCANNED")!;
    expect(scanned.payload.source).toBe("card");
    expect(r.finalState).toBe("SETTLED");
  });
});

describe("crypto staged flow", () => {
  const invoice = { chain: "btc-like", amountMinor: 250000 } as const;
  it("medium fee confirms in 3 blocks", () => {
    const ctx = createRunBase("crypto", { seed: 42, params: { ...invoice }, failures: [] });
    const flow = createCryptoFlow(ctx);
    cryptoAdvance(flow, { type: "make_invoice" });
    const addr = flow.address;
    cryptoAdvance(flow, { type: "build_tx", feeTier: "medium", dest: addr, amountMinor: 250000 });
    cryptoAdvance(flow, { type: "mine" });
    cryptoAdvance(flow, { type: "mine" });
    expect(flow.stage).toBe("mining");
    cryptoAdvance(flow, { type: "mine" });
    const r = cryptoResult(flow);
    expect(r.finalState).toBe("SETTLED");
    expect(r.events.map((e) => e.type)).toContain("MARKED_PAID");
  });
  it("low fee in congestion gets stuck, then RBF rescues it", () => {
    const ctx = createRunBase("crypto", { seed: 6, params: { ...invoice, congestion: "high" }, failures: [] });
    const flow = createCryptoFlow(ctx);
    cryptoAdvance(flow, { type: "make_invoice" });
    cryptoAdvance(flow, { type: "build_tx", feeTier: "low", dest: flow.address, amountMinor: 250000 });
    expect(flow.stage).toBe("stuck");
    cryptoAdvance(flow, { type: "rbf" });
    expect(flow.ctx.events.map((e) => e.type)).toContain("RBF_REPLACED");
    for (let i = 0; i < 3; i++) cryptoAdvance(flow, { type: "mine" });
    expect(cryptoResult(flow).finalState).toBe("SETTLED");
  });
  it("underpay and wrong address die with lessons", () => {
    const ctx = createRunBase("crypto", { seed: 3, params: { ...invoice }, failures: [] });
    const flow = createCryptoFlow(ctx);
    cryptoAdvance(flow, { type: "make_invoice" });
    cryptoAdvance(flow, { type: "build_tx", feeTier: "medium", dest: flow.address, amountMinor: 100 });
    expect(cryptoResult(flow).finalState).toBe("EXPIRED");
    const ctx2 = createRunBase("crypto", { seed: 3, params: { ...invoice }, failures: [] });
    const flow2 = createCryptoFlow(ctx2);
    cryptoAdvance(flow2, { type: "make_invoice" });
    cryptoAdvance(flow2, { type: "build_tx", feeTier: "medium", dest: "nope", amountMinor: 250000 });
    expect(cryptoResult(flow2).finalState).toBe("DECLINED");
  });
});

describe("custody staged flow", () => {
  const DEST = "sim1abcdef123456";
  it("hot wallet signs online", () => {
    const r = runCustodyScript(42, { amountMinor: 50000 }, [], [
      { type: "gen_seed" },
      { type: "choose", path: "hot", dest: DEST },
      { type: "hot_confirm" }
    ]);
    expect(r.finalState).toBe("SETTLED");
  });
  it("cold match signs offline; mismatch stops the theft", () => {
    const good = runCustodyScript(11, { amountMinor: 50000 }, [], [
      { type: "gen_seed" },
      { type: "choose", path: "cold", dest: DEST },
      { type: "device_check", match: true },
      { type: "cold_send" }
    ]);
    expect(good.finalState).toBe("SETTLED");
    expect(good.events.map((e) => e.type)).toContain("SIGNED_OFFLINE");
    const stopped = runCustodyScript(11, { amountMinor: 50000 }, [], [
      { type: "gen_seed" },
      { type: "choose", path: "cold", dest: DEST },
      { type: "device_check", match: false }
    ]);
    expect(stopped.finalState).toBe("CANCELLED");
    expect(stopped.events.map((e) => e.type)).toContain("SWAP_STOPPED");
  });
  it("missed swap loses funds irreversibly", () => {
    const r = runCustodyScript(13, { amountMinor: 50000 }, ["addressSwap"], [
      { type: "gen_seed" },
      { type: "choose", path: "cold", dest: DEST },
      { type: "device_check", match: true }
    ]);
    expect(r.finalState).toBe("SETTLED");
    expect(r.events.map((e) => e.type)).toContain("FUNDS_LOST");
  });
  it("recovery drill verifies the backup", () => {
    const ctx = createRunBase("custody", { seed: 21, params: {}, failures: [] });
    const flow = createCustodyFlow(ctx);
    custodyAdvance(flow, { type: "gen_seed" });
    custodyAdvance(flow, {
      type: "recover",
      checks: [{ pos: 0, word: flow.words[0] }, { pos: 5, word: flow.words[5] }]
    });
    expect(flow.ctx.events.map((e) => e.type)).toContain("RECOVERED");
    const ctx2 = createRunBase("custody", { seed: 21, params: {}, failures: [] });
    const flow2 = createCustodyFlow(ctx2);
    custodyAdvance(flow2, { type: "gen_seed" });
    custodyAdvance(flow2, { type: "recover", checks: [{ pos: 0, word: "nope" }] });
    expect(custodyResult(flow2).finalState).toBe("CANCELLED");
  });
});

describe("nfc staged flow", () => {
  it("under-limit tap flies through", () => {
    const r = runNfcScript(42, {}, [], [
      { type: "setup", amountMinor: 1250 },
      { type: "tap", method: "card" }
    ]);
    expect(r.finalState).toBe("SETTLED");
    expect(r.events.map((e) => e.type)).toEqual([
      "TERMINAL_READY", "APP_SELECTED", "DATA_READ", "CRYPTOGRAM",
      "AUTHORIZED_HOLD", "CAPTURED", "CLEARED", "SETTLING", "SETTLED"
    ]);
  });
  it("over-limit card tap demands PIN", () => {
    const ctx = createRunBase("nfc", { seed: 5, params: {}, failures: [] });
    const flow = createNfcFlow(ctx);
    nfcAdvance(flow, { type: "setup", amountMinor: 9000 });
    nfcAdvance(flow, { type: "tap", method: "card" });
    expect(flow.stage).toBe("cvm");
    expect(flow.ctx.events.map((e) => e.type)).toContain("CVM_REQUIRED");
    nfcAdvance(flow, { type: "enter_pin", pin: "1234" });
    expect(nfcResult(flow).finalState).toBe("SETTLED");
  });
  it("offline terminal honors the floor", () => {
    const ok = runNfcScript(9, { linkOnline: "offline" }, [], [
      { type: "setup", amountMinor: 1000 },
      { type: "tap", method: "card" }
    ]);
    expect(ok.finalState).toBe("SETTLED");
    expect(ok.events.map((e) => e.type)).toContain("OFFLINE_AUTH");
    const over = (() => {
      const c = createRunBase("nfc", { seed: 9, params: { linkOnline: "offline" }, failures: [] });
      const f = createNfcFlow(c);
      nfcAdvance(f, { type: "setup", amountMinor: 9000 });
      nfcAdvance(f, { type: "tap", method: "card" });
      nfcAdvance(f, { type: "enter_pin", pin: "1234" });
      return nfcResult(f);
    })();
    expect(over.finalState).toBe("DECLINED");
  });
});

describe("p2p staged flow", () => {
  it("top up then send from balance", () => {
    const ctx = createRunBase("p2p", { seed: 42, params: {}, failures: [] });
    const flow = createP2pFlow(ctx);
    p2pAdvance(flow, { type: "topup", amountMinor: 10000, account: "12345678" });
    expect(p2pBalance(flow)).toBe(10000 - 130);
    p2pAdvance(flow, { type: "send", to: "@yasmine", amountMinor: 2500, note: "taxi", funding: "balance", audience: "friends" });
    const r = p2pResult(flow);
    expect(r.finalState).toBe("SETTLED");
    expect(r.events.map((e) => e.type)).toContain("FEED_POSTED");
    expect(p2pBalance(flow)).toBe(10000 - 130 - 2500);
  });
  it("request waits, then the friend pays", () => {
    const r = runP2pScript(6, {}, [], [
      { type: "request", from: "@yasmine", amountMinor: 1000, note: "lunch" },
      { type: "friend_pays" }
    ]);
    expect(r.finalState).toBe("SETTLED");
    expect(r.events.map((e) => e.type)).toContain("REQUEST_PAID");
  });
  it("stranger request can be declined and reported", () => {
    const r = runP2pScript(7, {}, [], [
      { type: "incoming_request", from: "ghost-247", amountMinor: 5000 },
      { type: "answer_request", pay: false }
    ]);
    expect(r.events.map((e) => e.type)).toContain("SCAM_REPORTED");
  });
  it("splits must add up", () => {
    const r = runP2pScript(8, {}, [], [
      { type: "split", totalMinor: 6000, legs: [{ to: "@a", shareMinor: 2000 }, { to: "@b", shareMinor: 4000 }], note: "dinner" }
    ]);
    expect(r.events.filter((e) => e.type === "REQUEST_SENT")).toHaveLength(2);
  });
  it("mirrors per-user balances on both sides", () => {
    const ctx = createRunBase("p2p", { seed: 42, params: {}, failures: [] });
    const flow = createP2pFlow(ctx);
    p2pAdvance(flow, { type: "topup", amountMinor: 10000, account: "12345678" });
    p2pAdvance(flow, { type: "send", to: "@yasmine", amountMinor: 2500, note: "taxi", funding: "balance", audience: "private" });
    const users = p2pUsers(flow);
    expect(users["@you"]).toBe(10000 - 130 - 2500);
    expect(users["@yasmine"]).toBeGreaterThan(2500);
    // deterministic counterparties: same handle, same funds, every replay
    const ctx2 = createRunBase("p2p", { seed: 99, params: {}, failures: [] });
    const flow2 = createP2pFlow(ctx2);
    p2pAdvance(flow2, { type: "topup", amountMinor: 10000, account: "12345678" });
    p2pAdvance(flow2, { type: "send", to: "@yasmine", amountMinor: 2500, note: "taxi", funding: "balance", audience: "private" });
    expect(p2pUsers(flow2)["@yasmine"]).toBe(users["@yasmine"]);
  });
  it("bank rail pends, then settles or fails cleanly", () => {
    const ctx = createRunBase("p2p", { seed: 15, params: {}, failures: [] });
    const flow = createP2pFlow(ctx);
    p2pAdvance(flow, { type: "send", to: "@yasmine", amountMinor: 3000, note: "rent", funding: "bank", audience: "private" });
    expect(flow.stage).toBe("pending_bank");
    expect(flow.ctx.events.map((e) => e.type)).toContain("P2P_PENDING");
    p2pAdvance(flow, { type: "settle_bank" });
    expect(p2pResult(flow).finalState).toBe("SETTLED");
    expect(p2pUsers(flow)["@yasmine"]).toBeGreaterThanOrEqual(3000);
    const ctx2 = createRunBase("p2p", { seed: 16, params: {}, failures: [] });
    const flow2 = createP2pFlow(ctx2);
    p2pAdvance(flow2, { type: "send", to: "@yasmine", amountMinor: 3000, note: "rent", funding: "bank", audience: "private" });
    p2pAdvance(flow2, { type: "fail_bank" });
    const r2 = p2pResult(flow2);
    expect(r2.finalState).toBe("CANCELLED");
    expect(r2.events.map((e) => e.type)).toContain("BANK_PULL_FAILED");
  });
  it("requests cancel without moving money", () => {
    const ctx = createRunBase("p2p", { seed: 17, params: {}, failures: [] });
    const flow = createP2pFlow(ctx);
    p2pAdvance(flow, { type: "request", from: "@yasmine", amountMinor: 1000, note: "lunch" });
    p2pAdvance(flow, { type: "cancel_request" });
    expect(flow.ctx.events.map((e) => e.type)).toContain("REQUEST_CANCELLED");
    expect(flow.stage).toBe("terminal");
  });
  it("split legs resolve individually; organizer collects only paid shares", () => {
    const ctx = createRunBase("p2p", { seed: 18, params: {}, failures: [] });
    const flow = createP2pFlow(ctx);
    p2pAdvance(flow, { type: "split", totalMinor: 6000, legs: [{ to: "@a", shareMinor: 2000 }, { to: "@b", shareMinor: 4000 }], note: "dinner" });
    expect(flow.stage).toBe("split");
    expect(p2pUsers(flow)["@you"] ?? 0).toBe(0);
    p2pAdvance(flow, { type: "leg_paid", to: "@a" });
    expect(p2pUsers(flow)["@you"]).toBe(2000);
    p2pAdvance(flow, { type: "leg_declined", to: "@b" });
    expect(flow.ctx.events.map((e) => e.type)).toContain("SPLIT_COMPLETE");
    expect(p2pUsers(flow)["@you"]).toBe(2000);
  });
});

describe("mobile-money staged flow", () => {
  const PIN = { pinExpected: "1234" };
  it("cash in, then send", () => {
    const r = runMmScript(42, PIN, [], [
      { type: "ussd_open" },
      { type: "cashin", agentFloat: 100_000_00, amountMinor: 10_000_00 },
      { type: "submit_pin", pin: "1234" }
    ]);
    expect(r.finalState).toBe("SETTLED");
    expect(r.events.map((e) => e.type)).toContain("CASHIN_DONE");
  });
  it("three wrong PINs lock the wallet", () => {
    const ctx = createRunBase("mobilemoney", { seed: 5, params: PIN, failures: [] });
    const flow = createMmFlow(ctx);
    mmAdvance(flow, { type: "ussd_open" });
    mmAdvance(flow, { type: "cashin", agentFloat: 100_000_00, amountMinor: 5000_00 });
    mmAdvance(flow, { type: "submit_pin", pin: "0000" });
    mmAdvance(flow, { type: "submit_pin", pin: "0000" });
    mmAdvance(flow, { type: "submit_pin", pin: "0000" });
    const r = mmResult(flow);
    expect(r.events.map((e) => e.type)).toContain("PIN_LOCKED");
    expect(r.finalState).toBe("DECLINED");
  });
  it("dry till refuses cash-out, session can time out", () => {
    const dry = runMmScript(6, PIN, [], [
      { type: "ussd_open" },
      { type: "cashout", agentFloat: 100, amountMinor: 5000_00 }
    ]);
    expect(dry.events.map((e) => e.type)).toContain("AGENT_NO_FLOAT");
    const t = runMmScript(6, PIN, [], [
      { type: "ussd_open" },
      { type: "ussd_timeout" }
    ]);
    expect(t.finalState).toBe("EXPIRED");
  });
});

describe("remit staged flow", () => {
  it("quotes expose fee + spread, sending delivers", () => {
    const q = remitQuote("fr-dz", 50000, "fintech", "wallet");
    expect(q.totalCostPct).toBeGreaterThan(0);
    expect(q.receiveCcy).toBe("DZD");
    const r = runRemitScript(42, { currency: "EUR" }, [], [
      { type: "quote", corridor: "fr-dz", amountSrcMinor: 50000, provider: "fintech", deliver: "wallet" },
      { type: "send" }
    ]);
    expect(r.finalState).toBe("SETTLED");
    expect(r.events.map((e) => e.type)).toContain("DELIVERED");
  });
  it("bank wires hop through correspondents; fraud holds compliance", () => {
    const r = runRemitScript(7, { currency: "EUR" }, [], [
      { type: "quote", corridor: "fr-dz", amountSrcMinor: 100000, provider: "bank", deliver: "bank" },
      { type: "send" }
    ]);
    expect(r.events.filter((e) => e.type === "CORRIDOR_HOP")).toHaveLength(2);
    const held = runRemitScript(7, { currency: "EUR" }, ["fraud"], [
      { type: "quote", corridor: "fr-dz", amountSrcMinor: 100000, provider: "bank", deliver: "bank" },
      { type: "send" }
    ]);
    expect(held.finalState).toBe("PENDING_REVIEW");
  });
  it("funding rails change fee and ETA", () => {
    const bal = remitQuote("fr-dz", 50000, "fintech", "wallet", "balance");
    const card = remitQuote("fr-dz", 50000, "fintech", "wallet", "card");
    const bank = remitQuote("fr-dz", 50000, "fintech", "wallet", "bank");
    expect(card.feeMinor).toBeGreaterThan(bal.feeMinor);
    expect(card.fundingFeeMinor).toBeGreaterThan(0);
    expect(bal.fundingFeeMinor).toBe(0);
    expect(bank.etaMs).toBeGreaterThan(bal.etaMs);
    expect(bank.feeMinor).toBe(bal.feeMinor);
  });
  it("reverse quotes land on the requested receive amount", () => {
    const { srcMinor, quote } = remitQuoteForReceive("fr-dz", 7_250_00, "fintech", "wallet", "balance");
    expect(srcMinor).toBeGreaterThan(0);
    expect(Math.abs(quote.receiveMinor - 7_250_00) / 7_250_00).toBeLessThan(0.005);
    const r = runRemitScript(21, { currency: "EUR" }, [], [
      { type: "quote", corridor: "fr-dz", amountSrcMinor: srcMinor, provider: "fintech", deliver: "wallet" },
      { type: "send" }
    ]);
    expect(r.finalState).toBe("SETTLED");
  });
  it("declined funding and partner delays behave differently", () => {
    const dec = runRemitScript(22, { currency: "EUR" }, ["decline"], [
      { type: "quote", corridor: "fr-dz", amountSrcMinor: 50000, provider: "fintech", deliver: "wallet" },
      { type: "send" }
    ]);
    expect(dec.finalState).toBe("DECLINED");
    expect(dec.events.map((e) => e.type)).toContain("FUNDING_DECLINED");
    const slow = runRemitScript(23, { currency: "EUR" }, ["timeout"], [
      { type: "quote", corridor: "fr-dz", amountSrcMinor: 50000, provider: "fintech", deliver: "wallet" },
      { type: "send" }
    ]);
    expect(slow.finalState).toBe("SETTLED");
    expect(slow.events.map((e) => e.type)).toContain("TRANSFER_DELAYED");
  });
  it("new corridors validate currency and payouts", () => {
    const r = runRemitScript(24, { currency: "EUR" }, [], [
      { type: "quote", corridor: "es-ma", amountSrcMinor: 20000, provider: "mto", deliver: "cash", funding: "card" },
      { type: "send" }
    ]);
    expect(r.finalState).toBe("SETTLED");
    expect(r.events.map((e) => e.type)).toContain("DELIVERED");
    expect(() => runRemitScript(24, { currency: "USD" }, [], [
      { type: "quote", corridor: "es-ma", amountSrcMinor: 20000, provider: "mto", deliver: "cash" }
    ])).toThrow();
  });
});

describe("bnpl staged flow", () => {
  const apply = { type: "apply", incomeMinor: 120000, obligationsMinor: 20000, plan: 4 } as const;
  it("healthy file gets 4, pays them all", () => {
    const ctx = createRunBase("bnpl", { seed: 42, params: { amountMinor: 24000 }, failures: [] });
    const flow = createBnplFlow(ctx);
    bnplAdvance(flow, apply);
    expect(flow.stage).toBe("offer");
    expect(flow.legs).toHaveLength(4);
    bnplAdvance(flow, { type: "activate" });
    for (const leg of [...flow.legs]) bnplAdvance(flow, { type: "pay_leg", n: leg.n });
    const r = bnplResult(flow);
    expect(r.finalState).toBe("SETTLED");
    expect(r.events.map((e) => e.type)).toContain("PLAN_COMPLETE");
  });
  it("borderline files verify by code, then get the offer", () => {
    const ctx = createRunBase("bnpl", { seed: 30, params: { amountMinor: 12000 }, failures: [] });
    const flow = createBnplFlow(ctx);
    bnplAdvance(flow, { type: "apply", incomeMinor: 100000, obligationsMinor: 27500, plan: 4 });
    expect(flow.stage).toBe("verify");
    expect(flow.ctx.events.map((e) => e.type)).toContain("VERIFICATION_REQUIRED");
    bnplAdvance(flow, { type: "submit_verification", code: flow.verify!.code });
    expect(flow.stage).toBe("offer");
    expect(flow.legs).toHaveLength(4);
  });
  it("three wrong verification codes decline the file", () => {
    const ctx = createRunBase("bnpl", { seed: 30, params: { amountMinor: 12000 }, failures: [] });
    const flow = createBnplFlow(ctx);
    bnplAdvance(flow, { type: "apply", incomeMinor: 100000, obligationsMinor: 27500, plan: 4 });
    const wrong = flow.verify!.code === "000000" ? "000001" : "000000";
    bnplAdvance(flow, { type: "submit_verification", code: wrong });
    bnplAdvance(flow, { type: "submit_verification", code: wrong });
    bnplAdvance(flow, { type: "submit_verification", code: wrong });
    expect(bnplResult(flow).finalState).toBe("DECLINED");
  });
  it("gateway timeout retries safely around eligibility", () => {
    const ctx = createRunBase("bnpl", { seed: 42, params: { amountMinor: 24000 }, failures: ["timeout"] });
    const flow = createBnplFlow(ctx);
    bnplAdvance(flow, apply);
    expect(flow.ctx.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["GATEWAY_TIMEOUT", "RETRY_SAFE", "ELIGIBILITY_CHECKED"])
    );
    expect(flow.stage).toBe("offer");
  });
  it("overloaded file is denied; missed legs accrue late fees", () => {
    const denied = runBnplScript(5, { amountMinor: 24000 }, [], [
      { type: "apply", incomeMinor: 30000, obligationsMinor: 25000, plan: 12 }
    ]);
    expect(denied.finalState).toBe("DECLINED");
    const ctx = createRunBase("bnpl", { seed: 9, params: { amountMinor: 12000 }, failures: [] });
    const flow = createBnplFlow(ctx);
    bnplAdvance(flow, { type: "apply", incomeMinor: 120000, obligationsMinor: 10000, plan: 4 });
    bnplAdvance(flow, { type: "activate" });
    bnplAdvance(flow, { type: "miss_leg", n: 1 });
    expect(flow.lateTotal).toBeGreaterThan(0);
    expect(flow.ctx.events.map((e) => e.type)).toContain("LATE_FEE_CHARGED");
  });
  it("returns unwind the remainder and refund the paid", () => {
    const ctx = createRunBase("bnpl", { seed: 12, params: { amountMinor: 12000 }, failures: [] });
    const flow = createBnplFlow(ctx);
    bnplAdvance(flow, { type: "apply", incomeMinor: 120000, obligationsMinor: 10000, plan: 4 });
    bnplAdvance(flow, { type: "activate" });
    bnplAdvance(flow, { type: "pay_leg", n: 1 });
    bnplAdvance(flow, { type: "return_goods" });
    const r = bnplResult(flow);
    expect(r.events.map((e) => e.type)).toContain("RETURNED");
    expect(r.receipt.refundedMinor).toBe(0);
  });
});
