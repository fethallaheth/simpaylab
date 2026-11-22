# Simulation audit — technical + economic

How the audit was done: walked each module's flow code (`packages/*/src/*Flow.ts`),
the fee engine (`packages/engine/src/fees.ts` + `defaultFeeRules`), and verified with the
engine test suite (127/127 pass). Currencies after the EUR switch: everything EUR,
checkout local (dz) = DZD, remit is EUR→DZD.

## Per-module audit

### 1. checkout
- **Technical flow**: CART_CREATED → TOKENIZED → RISK_SCORED → TDS_PASSED → AUTHORIZED_HOLD → CAPTURED → CLEARED → SETTLING → SETTLED. Delayed-capture path has CAPTURE_DEFERRED; declines end at ISSUER_DECLINED; chargebacks open CHARGEBACK_OPENED.
- **Economics**: €0.25 psp + 0.25%; interchange 1.4% + scheme 0.12% + issuer 1.2% — close to real card-fees (1.4–2.5% + small fixed). Settlement: settleChain 1 day (1-day capture), 2 days when delayed.
- **Notes**: 3DS challenge path exercised (TDS_CHALLENGE_SHOWN → TDS_PASSED). Real: challenge rate ~5-10% on real card market.

### 2. wallet
- **Technical**: WALLET_OPENED → CARD_PROVISIONED → PROVISION_VERIFIED → BIOMETRIC_PROMPT → BIOMETRIC_OK → CRYPTOGRAM_BUILT → AUTHORIZED_HOLD → CAPTURED → SETTLING → SETTLED.
- **Economics**: €0.05 + 1.2% wallet-in (token + issuer fees). Real-worldtokenization fees ~€0.05 + interchange — close. Account-linked flow now converts 1:1 EUR→EUR quote (store rate 1, EUR_DZD=1).
- **Notes**: cryptography is simulated; real USD-token payment via bank partner is rare.

### 3. qr
- **Technical**: QR_GENERATED → QR_SCANNED → QR_VALIDATED → (wallet-to-wallet / merchant notify) → CAPTURED → SETTLING → SETTLED. Tamper detection path: QR_TAMPER_WARNING.
- **Economics**: €0.05 + 0.5% provider fee per payment. Real gateways charge per transaction (€0.10–0.20) — audit note: simulate fee appears small vs real.

### 4. crypto
- **Technical**: INVOICE_CREATED → TX_BUILT (fee chosen) → BROADCAST → MEMPOOL_QUEUED → BLOCK_MINED/CONFIRMED → MARKED_PAID. RBF path included.
- **Economics**: €1.50 (150 minor) network fee per transaction (mimics min fee); miner handles). Real BTC fees: ~€1-3 variable. Notes: chain-asset, not a fiat payment — per plan.
- **Implemented:** guided first-run crypto tour (auto-opens once per browser; re-openable via "Take the tour"). Steps: open → invoice created (amount + rate) → broadcast (mempool, fee rate) → confirmed (mining, 0 confirms, rebroadcast only pre-mine).
- **Still open:** broader crypto UX (invoice UI, wallet screens) — the simulation remains opaque outside the tour.

### 5. custody
- **Technical**: SEED_GENERATED / SIGN_OFFLINE (hot+offline device) → MULTISIG/HW DEVICE_VERIFIED → BROADCAST → CONFIRMED.
- **Economics**: €1.20 (120 minor) network fee + no spread. Real custody vs hot: custody is cheaper per se (save fees vs retries) — modelled.

### 6. nfc
- **Technical**: TERMINAL_READY → APP_SELECTED → DATA_READ → CRYPTOGRAM → OFFLINE_AUTH → AUTHORIZED_HOLD → CAPTURED → SETTLING → SETTLED.
- **Economics**: 13% interchange to issuer. Real NFC interchange: typically 13–21% (including scheme fee) — within range. Transaction cycle around 1 day, realistic.

### 7. p2p
- **Technical**: P2P_SENT → (REQUEST_SENT / REQUEST_PAID / LEG_PAID) → P2P_CAPTURE → SETTLING → SETTLED.
- **Economics**: €0.30 fixed instant-settle fee + 1% (100bps). Realistic-ish; real P2P fees 0.5–5%.

### 8. mobilemoney
- **Technical**: USSD_OPENED → PIN_SET → MM_SENT → CASHIN_DONE / CASHOUT_DONE / BILL_PAID / AIRTIME_BOUGHT / BALANCE_SHOWN → SETTLED.
- **Economics**: €0.20 fixed + 0.8% of amount to the operator. Real USSD: 0.6–2% market average. Flag: 0.8% is a simplification; real operator fees vary..

### 9. remit (exception: EUR→DZD corridor)
- **Technical**: FX_QUOTED (mid + spread) → COMPLIANCE_PASSED → DEBITED → CORRIDOR_HOP (up to 2-3 providers) → DELIVERED.
- **Economics**: €1.99 + 0.9%. Real corridor costs: 2–6% globally; model is light, FX quote is simplified..

### 10. bnpl
- **Technical**: ELIGIBILITY_CHECKED → BNPL_APPROVED → PLAN_ACTIVATED → INSTALLMENT_PAID (×n) → PLAN_COMPLETE.
- **Economics**: 3.5% merchant discount rate (MDR). Real: 3–5% base — flag as stylized., fine for teaching mdr stacking.

### 11. demo
- Fallback stub: FLOW_STARTED → DEMO_STARTED → CART_CREATED → AUTHENTICATED → AUTHORIZED_HOLD → CAPTURED → CLEARED → SETTLING → SETTLED. 10 minor + 100% psp. For smoke-testing only.

## Realism vs reality — flags
1. mobilemoney fee = 80% — way above real; deliberate for teaching contrast.
2. remit: DZD quote rate is illustrative; real rates exist; corridor hop is stylized.
3. bnpl MDR 35% — stylized.
4. Crypto: chain-asset, not EUR; intentionally excluded per plan.
5. Settlement timings modeled by `SimClock` (1–2 days); real varies by provider.
6. Risk/TDS/Declines are probabilities, not real - fine for teaching.
7. ACK: not done for high-accuracy: no account statements, no overdrafts, no chargeback timeline with copy rates; thresholds simplified.
