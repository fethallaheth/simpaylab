/**
 * Illustrative fee / FX / limit configs for teaching (spec §0.6).
 * NEVER present as real-world rates — the UI labels them illustrative.
 */
import type { ScenarioDef } from "./schemas";

export const ILLUSTRATIVE_NOTE = "illustrative-config";

export const FEE_CONFIGS = [
  {
    moduleId: "checkout",
    illustrative: true as const,
    rules: [
      { id: "interchange", labelKey: "fee.interchange", fixedMinor: 0, pctBps: 140, payer: "acquirer", payee: "issuer" },
      { id: "scheme", labelKey: "fee.scheme", fixedMinor: 0, pctBps: 12, payer: "acquirer", payee: "network" },
      { id: "psp", labelKey: "fee.psp", fixedMinor: 25, pctBps: 25, payer: "acquirer", payee: "psp" }
    ]
  },
  {
    moduleId: "wallet",
    illustrative: true as const,
    rules: [
      { id: "token", labelKey: "fee.token", fixedMinor: 5, pctBps: 0, payer: "acquirer", payee: "network" },
      { id: "issuer-w", labelKey: "fee.interchange", fixedMinor: 0, pctBps: 120, payer: "acquirer", payee: "issuer" }
    ]
  },
  {
    moduleId: "qr",
    illustrative: true as const,
    rules: [{ id: "provider", labelKey: "fee.provider", fixedMinor: 0, pctBps: 50, payer: "acquirer", payee: "psp" }]
  },
  {
    moduleId: "crypto",
    illustrative: true as const,
    rules: [{ id: "netfee", labelKey: "fee.network", fixedMinor: 150, pctBps: 0, payer: "customerWallet", payee: "miner" }]
  },
  {
    moduleId: "remit",
    illustrative: true as const,
    rules: [{ id: "mto", labelKey: "fee.provider", fixedMinor: 199, pctBps: 90, payer: "customer", payee: "psp" }]
  }
];

export const FX_CONFIGS = [
  { pair: "EUR/DZD", midRate: 140, spreadBps: 120, illustrative: true as const },
  { pair: "EUR/USD", midRate: 1.08, spreadBps: 35, illustrative: true as const },
  { pair: "USD/KES", midRate: 129, spreadBps: 90, illustrative: true as const },
  { pair: "USD/CNY", midRate: 7.2, spreadBps: 40, illustrative: true as const }
];

export const LIMITS = {
  contactlessCvmMinor: 5000,
  qrExpirySecDefault: 120,
  btcConfirmations: 3,
  stableConfirmations: 1,
  bnplMaxInstallments: 12,
  illustrative: true as const
};

export const SCENARIOS: ScenarioDef[] = [
  // ---- online checkout (5) ----
  { id: "checkout-happy-3ds", moduleId: "checkout", titleKey: "sc.checkoutHappy", objectivesKeys: ["lo.authVsSettle", "lo.tds"], preset: { params: { amountMinor: 4999, currency: "EUR", tds: "challenge", risk: "low" }, seed: 42 }, expectedEvents: ["CART_CREATED", "TOKENIZED", "RISK_SCORED", "TDS_CHALLENGE_SHOWN", "TDS_PASSED", "AUTH_REQUESTED", "AUTHORIZED_HOLD", "CAPTURED", "CLEARED", "SETTLING", "SETTLED"], talkingPointsKeys: ["tp.holdVsSettle"], discussionKeys: ["dq.whoBearsRisk"] },
  { id: "checkout-frictionless", moduleId: "checkout", titleKey: "sc.checkoutFrictionless", objectivesKeys: ["lo.tds", "lo.risk"], preset: { params: { amountMinor: 1200, currency: "EUR", tds: "auto", risk: "low" }, seed: 7 }, expectedEvents: ["CART_CREATED", "TOKENIZED", "RISK_SCORED", "TDS_FRICTIONLESS", "AUTH_REQUESTED", "AUTHORIZED_HOLD", "CAPTURED", "CLEARED", "SETTLING", "SETTLED"], talkingPointsKeys: ["tp.liabilityShift"], discussionKeys: ["dq.frictionVsSafety"] },
  { id: "checkout-delayed-capture", moduleId: "checkout", titleKey: "sc.checkoutDelayed", objectivesKeys: ["lo.authVsSettle"], preset: { params: { amountMinor: 8999, currency: "EUR", capture: "delayed", settlementDays: 2 }, seed: 13 }, expectedEvents: ["CART_CREATED", "AUTHORIZED_HOLD", "CAPTURE_DEFERRED", "CAPTURED", "CLEARED", "SETTLING", "SETTLED"], talkingPointsKeys: ["tp.holdExpiry"], discussionKeys: ["dq.whyDelay"] },
  { id: "checkout-decline", moduleId: "checkout", titleKey: "sc.checkoutDecline", objectivesKeys: ["lo.declines"], preset: { params: { amountMinor: 4999, currency: "EUR" }, seed: 5 }, expectedEvents: ["CART_CREATED", "TOKENIZED", "RISK_SCORED", "ISSUER_DECLINED"], talkingPointsKeys: ["tp.declineCodes"], discussionKeys: ["dq.retrySafely"] },
  { id: "checkout-chargeback", moduleId: "checkout", titleKey: "sc.checkoutChargeback", objectivesKeys: ["lo.chargeback"], preset: { params: { amountMinor: 4999, currency: "EUR" }, seed: 5 }, expectedEvents: ["SETTLED", "CHARGEBACK_OPENED"], talkingPointsKeys: ["tp.cbLifecycle"], discussionKeys: ["dq.whoBearsRisk"] },
  // ---- wallets (4) ----
  { id: "wallet-happy", moduleId: "wallet", titleKey: "sc.walletHappy", objectivesKeys: ["lo.tokenization", "lo.biometric"], preset: { params: { amountMinor: 3500, currency: "EUR" }, seed: 21 }, expectedEvents: ["WALLET_OPENED", "CARD_PROVISIONED", "PROVISION_VERIFIED", "BIOMETRIC_PROMPT", "BIOMETRIC_OK", "CRYPTOGRAM_BUILT", "AUTHORIZED_HOLD", "CAPTURED", "CLEARED", "SETTLING", "SETTLED"], talkingPointsKeys: ["tp.dpan"], discussionKeys: ["dq.whyNoPanShared"] },
  { id: "wallet-bio-fallback", moduleId: "wallet", titleKey: "sc.walletBioFallback", objectivesKeys: ["lo.biometric"], preset: { params: { amountMinor: 3500 }, seed: 5 }, expectedEvents: ["BIOMETRIC_PROMPT", "BIOMETRIC_FAILED", "PIN_FALLBACK_OK", "SETTLED"], talkingPointsKeys: ["tp.localBio"], discussionKeys: ["dq.fallbackRisk"] },
  { id: "wallet-lost-device", moduleId: "wallet", titleKey: "sc.walletLost", objectivesKeys: ["lo.revocation"], preset: { params: { amountMinor: 3500 }, seed: 5 }, expectedEvents: ["DEVICE_LOST", "TOKEN_REVOKED", "REPROVISIONED", "SETTLED"], talkingPointsKeys: ["tp.revoke"], discussionKeys: ["dq.remoteWipe"] },
  { id: "wallet-dzd-local", moduleId: "wallet", titleKey: "sc.walletDzd", objectivesKeys: ["lo.accountLinked"], preset: { params: { amountMinor: 250000, currency: "EUR" }, seed: 77 }, expectedEvents: ["WALLET_OPENED", "CARD_PROVISIONED", "SETTLED"], talkingPointsKeys: ["tp.cardVsAccount"], discussionKeys: ["dq.inclusion"] },
  // ---- QR (4) ----
  { id: "qr-dynamic", moduleId: "qr", titleKey: "sc.qrDynamic", objectivesKeys: ["lo.qrDynamic"], preset: { params: { amountMinor: 1800, currency: "EUR", qrMode: "merchant-dynamic" }, seed: 31 }, expectedEvents: ["QR_GENERATED", "QR_SCANNED", "QR_VALIDATED", "PIN_CONFIRMED", "WALLET_TO_WALLET", "MERCHANT_NOTIFIED", "SETTLED"], talkingPointsKeys: ["tp.qrPayload"], discussionKeys: ["dq.staticVsDynamic"] },
  { id: "qr-static", moduleId: "qr", titleKey: "sc.qrStatic", objectivesKeys: ["lo.qrStatic"], preset: { params: { amountMinor: 900, currency: "EUR", qrMode: "merchant-static" }, seed: 32 }, expectedEvents: ["QR_GENERATED", "QR_SCANNED", "QR_VALIDATED", "SETTLED"], talkingPointsKeys: ["tp.qrSwap"], discussionKeys: ["dq.qrFraud"] },
  { id: "qr-customer-presented", moduleId: "qr", titleKey: "sc.qrCustomer", objectivesKeys: ["lo.qrModels"], preset: { params: { amountMinor: 2200, currency: "EUR", qrMode: "customer-presented" }, seed: 33 }, expectedEvents: ["QR_GENERATED", "QR_SCANNED", "QR_VALIDATED", "SETTLED"], talkingPointsKeys: ["tp.twoModels"], discussionKeys: ["dq.whichModel"] },
  { id: "qr-tampered", moduleId: "qr", titleKey: "sc.qrTampered", objectivesKeys: ["lo.qrFraud"], preset: { params: { amountMinor: 1800, currency: "EUR" }, seed: 5 }, expectedEvents: ["QR_GENERATED", "QR_TAMPER_WARNING"], talkingPointsKeys: ["tp.checksum"], discussionKeys: ["dq.verifyMerchant"] },
  // ---- crypto (4) ----
  { id: "crypto-btc", moduleId: "crypto", titleKey: "sc.cryptoBtc", objectivesKeys: ["lo.finality", "lo.fees"], preset: { params: { amountMinor: 25000, chain: "btc-like", feeTier: "medium", confirmations: 3 }, seed: 51 }, expectedEvents: ["INVOICE_CREATED", "TX_BUILT", "FEE_CHOSEN", "BROADCAST", "MEMPOOL_QUEUED", "BLOCK_MINED", "CONFIRMED", "MARKED_PAID"], talkingPointsKeys: ["tp.confirmations"], discussionKeys: ["dq.zeroConf"] },
  { id: "crypto-stuck-rbf", moduleId: "crypto", titleKey: "sc.cryptoStuck", objectivesKeys: ["lo.feeMarket"], preset: { params: { amountMinor: 25000, chain: "btc-like", feeTier: "low", congestion: "high" }, seed: 52 }, expectedEvents: ["BROADCAST", "MEMPOOL_QUEUED", "TX_STUCK", "RBF_REPLACED", "CONFIRMED"], talkingPointsKeys: ["tp.mempool"], discussionKeys: ["dq.feeChoice"] },
  { id: "crypto-stable", moduleId: "crypto", titleKey: "sc.cryptoStable", objectivesKeys: ["lo.stablecoin"], preset: { params: { amountMinor: 50000, chain: "stablecoin", feeTier: "medium", confirmations: 1 }, seed: 53 }, expectedEvents: ["INVOICE_CREATED", "TX_BUILT", "BROADCAST", "CONFIRMED", "MARKED_PAID"], talkingPointsKeys: ["tp.gasNonce"], discussionKeys: ["dq.wrongNetwork"] },
  { id: "crypto-depeg", moduleId: "crypto", titleKey: "sc.cryptoDepeg", objectivesKeys: ["lo.depeg"], preset: { params: { amountMinor: 50000, chain: "stablecoin" }, seed: 5 }, expectedEvents: ["INVOICE_CREATED", "DEPEG", "CONFIRMED"], talkingPointsKeys: ["tp.depegRisk"], discussionKeys: ["dq.stableRisks"] },
  // ---- custody (3) ----
  { id: "custody-cold", moduleId: "custody", titleKey: "sc.custodyCold", objectivesKeys: ["lo.coldWallet"], preset: { params: { amountMinor: 25000 }, seed: 61 }, expectedEvents: ["SEED_GENERATED", "HOT_SIGNED", "WATCHONLY_BUILT", "QTRANSFER_TO_OFFLINE", "DEVICE_VERIFIED", "SIGNED_OFFLINE", "QTRANSFER_BACK", "BROADCAST", "CONFIRMED"], talkingPointsKeys: ["tp.airgap"], discussionKeys: ["dq.convenienceVsSecurity"] },
  { id: "custody-swap", moduleId: "custody", titleKey: "sc.custodySwap", objectivesKeys: ["lo.verification"], preset: { params: { amountMinor: 25000 }, seed: 5 }, expectedEvents: ["DEVICE_VERIFIED", "ADDRESS_SWAP", "BROADCAST", "FUNDS_LOST"], talkingPointsKeys: ["tp.verifyOnDevice"], discussionKeys: ["dq.clipboardAttack"] },
  { id: "custody-seed", moduleId: "custody", titleKey: "sc.custodySeed", objectivesKeys: ["lo.recovery"], preset: { params: { amountMinor: 25000 }, seed: 5 }, expectedEvents: ["SEED_GENERATED", "SEED_LOST"], talkingPointsKeys: ["tp.backup"], discussionKeys: ["dq.whoRecovers"] },
  // ---- Tier B stubs (1 each, deepened in Phase 3) ----
  { id: "nfc-tap", moduleId: "nfc", titleKey: "sc.nfcTap", objectivesKeys: ["lo.nfc"], preset: { params: { amountMinor: 1800, currency: "EUR" }, seed: 3 }, expectedEvents: ["FLOW_STARTED", "AUTHORIZED_HOLD", "CAPTURED", "SETTLED"], talkingPointsKeys: ["tp.cvm"], discussionKeys: ["dq.nfcTech"] },
  { id: "p2p-send", moduleId: "p2p", titleKey: "sc.p2pSend", objectivesKeys: ["lo.p2p"], preset: { params: { amountMinor: 2500, currency: "EUR" }, seed: 3 }, expectedEvents: ["FLOW_STARTED", "SETTLED"], talkingPointsKeys: ["tp.float"], discussionKeys: ["dq.scams"] },
  { id: "mm-cashout", moduleId: "mobilemoney", titleKey: "sc.mmCashout", objectivesKeys: ["lo.float"], preset: { params: { amountMinor: 100000, currency: "EUR" }, seed: 3 }, expectedEvents: ["FLOW_STARTED", "SETTLED"], talkingPointsKeys: ["tp.trustAccount"], discussionKeys: ["dq.agentFloat"] },
  { id: "remit-corridor", moduleId: "remit", titleKey: "sc.remitCorridor", objectivesKeys: ["lo.remitCost"], preset: { params: { amountMinor: 50000, currency: "EUR", fxPair: "EUR/DZD", fxMidRate: 140, fxSpreadBps: 120, dstCurrency: "DZD" }, seed: 3 }, expectedEvents: ["FX_QUOTED", "FLOW_STARTED", "SETTLED"], talkingPointsKeys: ["tp.spread"], discussionKeys: ["dq.fivePct"] },
  { id: "bnpl-split", moduleId: "bnpl", titleKey: "sc.bnplSplit", objectivesKeys: ["lo.bnpl"], preset: { params: { amountMinor: 12000, currency: "EUR" }, seed: 3 }, expectedEvents: ["FLOW_STARTED", "SETTLED"], talkingPointsKeys: ["tp.mdr"], discussionKeys: ["dq.stacking"] }
];
