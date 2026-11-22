import { describe, expect, it } from "vitest";
import {
  checkoutAdvance,
  checkoutResult,
  createCheckoutFlow,
  createRunBase,
  defaultCardFor,
  driveCheckout,
  driveCheckoutCanonical,
  flowBalances,
  flowCustomerHold,
  IllegalCheckoutAction,
  replayKey,
  runCheckoutScript,
  runScenario,
  type CheckoutAction,
  type CheckoutFlow,
  type FailureId
} from "../src/index";

const AMOUNT = 4999;
const FUNDED = AMOUNT * 4 + 10000;

function freshFlow(seed = 42, params: Record<string, unknown> = {}, failures: Parameters<typeof createRunBase>[1]["failures"] = []): CheckoutFlow {
  return createCheckoutFlow(createRunBase("checkout", { seed, params, failures }));
}

function happyFlow(seed = 42, params: Record<string, unknown> = {}, failures: FailureId[] = []): CheckoutFlow {
  const flow = freshFlow(seed, params, failures);
  checkoutAdvance(flow, { type: "submit_cart" });
  checkoutAdvance(flow, { type: "submit_card", ...defaultCardFor("debit") });
  expect(flow.stage).toBe("tds");
  checkoutAdvance(flow, { type: "submit_otp", code: flow.otp!.code });
  return flow;
}

const types = (flow: CheckoutFlow) => flow.ctx.events.map((e) => e.type);

describe("staged checkout happy path", () => {
  it("emits the full high-fidelity sequence", () => {
    const flow = happyFlow();
    expect(types(flow)).toEqual([
      "CART_CREATED",
      "CARD_VALIDATED",
      "TOKENIZED",
      "RISK_SCORED",
      "TDS_CHALLENGE_SHOWN",
      "OTP_SENT",
      "TDS_PASSED",
      "AUTH_REQUESTED",
      "AUTHORIZED_HOLD",
      "ORDER_CONFIRMED",
      "CAPTURED",
      "CLEARED",
      "SETTLING",
      "SETTLED"
    ]);
    const r = checkoutResult(flow);
    expect(r.finalState).toBe("SETTLED");
    expect(flowCustomerHold(flow)).toBe(0);
    expect(r.receipt.refundedMinor).toBe(0);
  });

  it("records the typed buyer identity in the cart event (never prefilled)", () => {
    const flow = freshFlow();
    checkoutAdvance(flow, { type: "submit_cart", items: [{ name: "Textbook", qty: 1, priceMinor: 4999 }], buyer: { email: "amina@example.dz", name: "Amina Benali" } });
    const cart = flow.ctx.events.find((e) => e.type === "CART_CREATED")!;
    expect(cart.payload.buyer).toEqual({ email: "amina@example.dz", name: "Amina Benali" });
    expect(cart.payload.itemCount).toBe(1);
  });

  it("is deterministic: same seed + same actions = byte-identical log", () => {
    const run = () => {
      const flow = freshFlow(7, { amountMinor: 8999 });
      checkoutAdvance(flow, { type: "submit_cart" });
      checkoutAdvance(flow, { type: "submit_card", ...defaultCardFor("debit") });
      checkoutAdvance(flow, { type: "resend_otp" });
      checkoutAdvance(flow, { type: "submit_otp", code: flow.otp!.code });
      return flow;
    };
    const a = run();
    const b = run();
    expect(replayKey(checkoutResult(a))).toBe(replayKey(checkoutResult(b)));
  });

  it("runCheckoutScript replays pure action lists (frictionless needs no OTP)", () => {
    const actions: CheckoutAction[] = [
      { type: "submit_cart" },
      { type: "submit_card", ...defaultCardFor("debit") }
    ];
    const a = runCheckoutScript(11, { tds: "auto", risk: "low" }, [], actions);
    const b = runCheckoutScript(11, { tds: "auto", risk: "low" }, [], actions);
    expect(a.finalState).toBe("SETTLED");
    expect(replayKey(a)).toBe(replayKey(b));
  });
  it("OTP codes are seeded (lecturer can read them from the log)", () => {
    const a = freshFlow(9);
    checkoutAdvance(a, { type: "submit_cart" });
    checkoutAdvance(a, { type: "submit_card", ...defaultCardFor("debit") });
    const codeA = a.ctx.events.find((e) => e.type === "OTP_SENT")!.payload.code;
    const b = freshFlow(9);
    checkoutAdvance(b, { type: "submit_cart" });
    checkoutAdvance(b, { type: "submit_card", ...defaultCardFor("debit") });
    expect(b.ctx.events.find((e) => e.type === "OTP_SENT")!.payload.code).toBe(codeA);
  });

  it("frictionless path skips the challenge", () => {
    const flow = freshFlow(11, { tds: "auto", risk: "low" });
    checkoutAdvance(flow, { type: "submit_cart" });
    checkoutAdvance(flow, { type: "submit_card", ...defaultCardFor("debit") });
    expect(flow.stage).toBe("post");
    expect(types(flow)).toContain("TDS_FRICTIONLESS");
    expect(types(flow)).not.toContain("OTP_SENT");
    expect(checkoutResult(flow).finalState).toBe("SETTLED");
  });

  it("delayed capture waits for the merchant", () => {
    const flow = freshFlow(13, { capture: "delayed" });
    checkoutAdvance(flow, { type: "submit_cart" });
    checkoutAdvance(flow, { type: "submit_card", ...defaultCardFor("debit") });
    checkoutAdvance(flow, { type: "submit_otp", code: flow.otp!.code });
    expect(flow.stage).toBe("capture");
    expect(types(flow)).toContain("CAPTURE_DEFERRED");
    expect(types(flow)).not.toContain("CAPTURED");
    checkoutAdvance(flow, { type: "capture" });
    expect(checkoutResult(flow).finalState).toBe("SETTLED");
    expect(flowCustomerHold(flow)).toBe(0);
  });
});

describe("card validation (retryable, pre-token)", () => {
  it("rejects bad cards without touching the network or PRNG stream", () => {
    const flow = freshFlow();
    checkoutAdvance(flow, { type: "submit_cart" });
    const bad: CheckoutAction[] = [
      { type: "submit_card", pan: "4111111111111111", name: "X", exp: "12/29", cvc: "123" },
      { type: "submit_card", pan: "4000000000000001", name: "X", exp: "12/29", cvc: "123" },
      { type: "submit_card", pan: "4000000000000002", name: "X", exp: "13/29", cvc: "123" },
      { type: "submit_card", pan: "4000000000000002", name: "X", exp: "12/29", cvc: "12" }
    ];
    const reasons: unknown[] = [];
    for (const a of bad) {
      const { events } = checkoutAdvance(flow, a);
      expect(flow.stage).toBe("card");
      reasons.push(events[0].payload.reason);
    }
    expect(reasons).toEqual(["card.notDemoRange", "card.badLuhn", "card.badExpiry", "card.badFormat"]);
    expect(types(flow)).not.toContain("TOKENIZED");
    // a valid card still proceeds on the same stream
    checkoutAdvance(flow, { type: "submit_card", ...defaultCardFor("debit") });
    expect(types(flow)).toContain("TOKENIZED");
  });
});

describe("3DS challenge behaviour", () => {
  it("two wrong OTPs then the right one still passes", () => {
    const flow = freshFlow();
    checkoutAdvance(flow, { type: "submit_cart" });
    checkoutAdvance(flow, { type: "submit_card", ...defaultCardFor("debit") });
    const code = flow.otp!.code;
    const wrong = code === "000000" ? "000001" : "000000";
    checkoutAdvance(flow, { type: "submit_otp", code: wrong });
    checkoutAdvance(flow, { type: "submit_otp", code: wrong });
    expect(types(flow).filter((t) => t === "OTP_WRONG")).toHaveLength(2);
    checkoutAdvance(flow, { type: "submit_otp", code });
    expect(checkoutResult(flow).finalState).toBe("SETTLED");
  });

  it("third wrong OTP kills the payment", () => {
    const flow = freshFlow();
    checkoutAdvance(flow, { type: "submit_cart" });
    checkoutAdvance(flow, { type: "submit_card", ...defaultCardFor("debit") });
    const code = flow.otp!.code;
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 3; i++) checkoutAdvance(flow, { type: "submit_otp", code: wrong });
    const r = checkoutResult(flow);
    expect(types(flow).at(-1)).toBe("TDS_FAILED");
    expect(r.finalState).toBe("DECLINED");
  });

  it("malformed OTP does not burn an attempt", () => {
    const flow = freshFlow();
    checkoutAdvance(flow, { type: "submit_cart" });
    checkoutAdvance(flow, { type: "submit_card", ...defaultCardFor("debit") });
    const before = flow.otp!.attemptsLeft;
    checkoutAdvance(flow, { type: "submit_otp", code: "abc" });
    expect(flow.otp!.attemptsLeft).toBe(before);
  });

  it("resend issues a fresh code and the old one dies", () => {
    const flow = freshFlow();
    checkoutAdvance(flow, { type: "submit_cart" });
    checkoutAdvance(flow, { type: "submit_card", ...defaultCardFor("debit") });
    const oldCode = flow.otp!.code;
    checkoutAdvance(flow, { type: "resend_otp" });
    expect(types(flow).filter((t) => t === "OTP_SENT")).toHaveLength(2);
    expect(flow.otp!.code).not.toBe(oldCode);
    checkoutAdvance(flow, { type: "submit_otp", code: oldCode });
    expect(types(flow).at(-1)).toBe("OTP_WRONG");
    checkoutAdvance(flow, { type: "submit_otp", code: flow.otp!.code });
    expect(checkoutResult(flow).finalState).toBe("SETTLED");
  });

  it("abandon ends in TDS_FAILED with reason abandoned", () => {
    const flow = freshFlow();
    checkoutAdvance(flow, { type: "submit_cart" });
    checkoutAdvance(flow, { type: "submit_card", ...defaultCardFor("debit") });
    checkoutAdvance(flow, { type: "abandon_tds" });
    const evs = flow.ctx.events;
    expect(evs.at(-1)!.type).toBe("TDS_FAILED");
    expect(evs.at(-1)!.payload.reason).toBe("abandoned");
    expect(checkoutResult(flow).finalState).toBe("DECLINED");
  });
});

describe("issuer declines", () => {
  const cases: [string, string][] = [
    ["insufficient", "insufficient-funds"],
    ["expiredCard", "expired-card"],
    ["wrongCvc", "wrong-cvc"],
    ["decline", "issuer-decline"]
  ];
  it("maps each failure to its reason code", () => {
    for (const [failure, reason] of cases) {
      const flow = freshFlow(5, {}, [failure as never]);
      checkoutAdvance(flow, { type: "submit_cart" });
      checkoutAdvance(flow, { type: "submit_card", ...defaultCardFor("debit") });
      checkoutAdvance(flow, { type: "submit_otp", code: flow.otp!.code });
      const declined = flow.ctx.events.find((e) => e.type === "ISSUER_DECLINED")!;
      expect(declined.payload.reason).toBe(reason);
      expect(checkoutResult(flow).finalState).toBe("DECLINED");
    }
  });

  it("canonical driver reproduces tdsFail / tdsAbandon declines", () => {
    const ctx = createRunBase("checkout", { seed: 5, params: {}, failures: ["tdsFail"] });
    const flow = driveCheckoutCanonical(ctx);
    expect(checkoutResult(flow).finalState).toBe("DECLINED");
    expect(types(flow).filter((t) => t === "OTP_WRONG")).toHaveLength(2);
    expect(types(flow).at(-1)).toBe("TDS_FAILED");

    const ctx2 = createRunBase("checkout", { seed: 5, params: {}, failures: ["tdsAbandon"] });
    const flow2 = driveCheckoutCanonical(ctx2);
    expect(flow2.ctx.events.at(-1)!.payload.reason).toBe("abandoned");
  });
});

describe("gateway anomalies", () => {
  it("duplicate submission charges once", () => {
    const flow = happyFlow(5, {}, ["duplicate"]);
    expect(types(flow)).toContain("DUPLICATE_BLOCKED");
    expect(types(flow).filter((t) => t === "AUTHORIZED_HOLD")).toHaveLength(1);
    expect(types(flow).filter((t) => t === "CAPTURED")).toHaveLength(1);
    expect(checkoutResult(flow).finalState).toBe("SETTLED");
  });

  it("timeout retries on the same key", () => {
    const flow = happyFlow(5, {}, ["timeout"]);
    const t = types(flow);
    expect(t).toContain("GATEWAY_TIMEOUT");
    expect(t).toContain("RETRY_SAFE");
    expect(t.indexOf("GATEWAY_TIMEOUT")).toBeLessThan(t.indexOf("RETRY_SAFE"));
    expect(checkoutResult(flow).finalState).toBe("SETTLED");
  });
});

describe("post-payment lifecycle", () => {
  it("full refund returns principal; fees stay with the merchant as the lesson", () => {
    const flow = happyFlow();
    const before = checkoutResult(flow);
    checkoutAdvance(flow, { type: "refund" });
    const r = checkoutResult(flow);
    expect(types(flow).at(-1)).toBe("REFUND_ISSUED");
    expect(r.finalState).toBe("REFUNDED");
    expect(r.receipt.refundedMinor).toBe(AMOUNT);
    const bal = flowBalances(flow);
    expect(bal.customer).toBe(FUNDED);
    expect(bal.merchant).toBe(-before.receipt.totalFeesMinor);
    expect(flowCustomerHold(flow)).toBe(0);
  });

  it(" partial refunds accumulate; completing them closes the payment", () => {
    const flow = happyFlow();
    checkoutAdvance(flow, { type: "refund", amountMinor: 1000 });
    expect(types(flow).at(-1)).toBe("REFUND_PARTIAL");
    expect(checkoutResult(flow).finalState).toBe("SETTLED");
    checkoutAdvance(flow, { type: "refund", amountMinor: 999999 });
    const r = checkoutResult(flow);
    expect(r.finalState).toBe("REFUNDED");
    expect(r.receipt.refundedMinor).toBe(AMOUNT);
  });

  it("chargeback then accept keeps money with the buyer", () => {
    const flow = happyFlow();
    checkoutAdvance(flow, { type: "open_chargeback" });
    expect(checkoutResult(flow).finalState).toBe("CHARGEBACK");
    checkoutAdvance(flow, { type: "respond_chargeback", verdict: "accept" });
    expect(types(flow).at(-1)).toBe("CHARGEBACK_ACCEPTED");
    const bal = flowBalances(flow);
    expect(bal.customer).toBe(FUNDED);
  });

  it("won representment returns the pulled amount to the merchant", () => {
    const flow = happyFlow();
    const settled = checkoutResult(flow);
    checkoutAdvance(flow, { type: "open_chargeback" });
    checkoutAdvance(flow, { type: "respond_chargeback", verdict: "fight", win: true });
    expect(types(flow).at(-1)).toBe("REPRESENTMENT_WON");
    const bal = flowBalances(flow);
    expect(bal.merchant).toBe(settled.receipt.netAmountMinor);
    expect(bal.customer).toBe(FUNDED - AMOUNT);
  });

  it("lost representment leaves the pullback standing", () => {
    const flow = happyFlow();
    checkoutAdvance(flow, { type: "open_chargeback" });
    checkoutAdvance(flow, { type: "respond_chargeback", verdict: "fight", win: false });
    expect(types(flow).at(-1)).toBe("REPRESENTMENT_LOST");
    expect(checkoutResult(flow).finalState).toBe("CHARGEBACK");
    expect(flowBalances(flow).customer).toBe(FUNDED);
  });

  it("scripted runs replay byte-identically (transcript is the replay key)", () => {
    const actions: CheckoutAction[] = [
      { type: "submit_cart" },
      { type: "submit_card", ...defaultCardFor("debit") }
    ];
    const run = () => {
      const flow = freshFlow(21);
      for (const a of actions) checkoutAdvance(flow, a);
      checkoutAdvance(flow, { type: "submit_otp", code: flow.otp!.code });
      checkoutAdvance(flow, { type: "refund", amountMinor: 500 });
      return replayKey(checkoutResult(flow));
    };
    expect(run()).toBe(run());
  });

  it("resuming a saved transcript continues the exact log, then appends merchant actions", () => {
    const flow = freshFlow(33, { amountMinor: 6000 });
    checkoutAdvance(flow, { type: "submit_cart", items: [{ name: "Lamp", qty: 1, priceMinor: 6000 }] });
    checkoutAdvance(flow, { type: "submit_card", ...defaultCardFor("debit") });
    checkoutAdvance(flow, { type: "resend_otp" });
    checkoutAdvance(flow, { type: "submit_otp", code: flow.otp!.code });
    const transcript = [...flow.transcript];
    const before = replayKey(checkoutResult(flow));
    // merchant resumes later from the saved transcript
    const ctx2 = createRunBase("checkout", { seed: 33, params: { amountMinor: 6000 }, failures: [] });
    const resumed = driveCheckout(ctx2, transcript);
    expect(replayKey(checkoutResult(resumed))).toBe(before);
    checkoutAdvance(resumed, { type: "refund" });
    const r = checkoutResult(resumed);
    expect(r.finalState).toBe("REFUNDED");
    expect(r.receipt.refundedMinor).toBe(6000);
  });
});

describe("action ordering is enforced", () => {
  it("rejects out-of-order and post-terminal actions", () => {
    const flow = freshFlow();
    expect(() => checkoutAdvance(flow, { type: "submit_otp", code: "123456" })).toThrow(IllegalCheckoutAction);
    expect(() => checkoutAdvance(flow, { type: "capture" })).toThrow(IllegalCheckoutAction);
    expect(() => checkoutAdvance(flow, { type: "refund" })).toThrow(IllegalCheckoutAction);
    checkoutAdvance(flow, { type: "submit_cart" });
    expect(() => checkoutAdvance(flow, { type: "submit_cart" })).toThrow(IllegalCheckoutAction);
  });
});

describe("legacy scripted path stays frozen", () => {
  it("runScenario(checkout) is untouched by the staged runner", () => {
    const r = runScenario("checkout", { seed: 42 });
    expect(r.finalState).toBe("SETTLED");
    const t = r.events.map((e) => e.type);
    expect(t).toContain("TOKENIZED");
    expect(t).not.toContain("CARD_VALIDATED");
    expect(t).not.toContain("OTP_SENT");
  });
});
