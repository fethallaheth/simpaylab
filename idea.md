# MASTER PROMPT — FinTech Payment Simulation Lab

You are a senior full-stack engineer and fintech educator. Build a production-quality, **simulation-only** web platform used in university lectures to let students experience and dissect 10 electronic payment methods. Work autonomously, but plan first, build in the phases below, and verify each phase against its acceptance criteria before moving on.

---

## 0. Hard constraints

1. **Simulation only.** No real money, no real bank/card/PSP APIs, no real blockchain RPC. All accounts, cards, wallets, addresses, keys, and phone numbers are fictional.
2. **Never collect real data.** Every input that looks like a card number, PIN, OTP, seed phrase, or private key must show a persistent banner: "Simulation. Do not enter real data." Provide pre-filled demo values and validate that card numbers belong to a reserved fake range (reject Luhn-valid numbers outside it, with an educational message).
3. **No brand cloning.** Do not copy the UI, logos, or trademarks of Apple Pay, Google Pay, PayPal, Stripe, Alipay, WeChat Pay, Venmo, M-Pesa, etc. Use one original design language. Represent each provider's *workflow*, labeled generically (e.g. "Wallet app", "Card network", "PSP"). Real names may appear only in explanatory text as examples.
4. **Deterministic and replayable.** Same scenario + same seed = identical outcome. Lecturers must be able to replay a scenario exactly.
5. **Realism comes from flow and states, not pixel imitation:** authentication prompts, latency, pending states, error codes, receipts, reversals, delayed settlement.
6. **Illustrative numbers.** All fees, FX rates, interchange, network fees, and credit limits live in editable config files and are labeled "illustrative values for teaching". Never present them as current real-world rates.

---

## 1. Tech stack

- Next.js (App Router) + TypeScript (strict) + Tailwind CSS + shadcn/ui primitives
- State machines: XState v5 (or a tiny typed reducer if you justify it)
- Monorepo (pnpm workspaces):
  - `packages/engine` — pure TypeScript, **zero UI or browser imports**, fully unit-tested (Vitest)
  - `packages/content` — scenarios, lessons, quizzes, glossary, fee/FX configs (JSON/TS + zod schemas)
  - `apps/web` — Next.js app
- Persistence: IndexedDB (via Dexie) for sessions, ledger, event logs. No backend required for v1. Export/import a full session as JSON.
- i18n: English, French, Arabic (RTL support from day one, using `next-intl` or equivalent). Currency formatting for DZD, EUR, USD, KES, CNY, BTC, USDT.
- Animation: Framer Motion. Charts: Recharts. Diagrams: SVG components (sequence/flow diagrams driven by the event log).
- Testing: Vitest (engine), Playwright (critical UI flows). CI-ready scripts: `lint`, `typecheck`, `test`, `e2e`, `build`.

---

## 2. Core architecture (build this first)

### 2.1 Event-sourced simulation engine
Everything that happens emits an immutable **event**. The UI, timeline, under-the-hood inspector, receipts, ledger, analytics, and quizzes are all **projections of the event log**.

```ts
type SimEvent = {
  id: string;
  txId: string;
  t: number;               // simulated time (ms since scenario start)
  actor: ActorId;          // customer | merchant | wallet | issuer | acquirer | network | psp | agent | miner | lecturer ...
  type: string;            // e.g. "AUTH_REQUESTED", "3DS_CHALLENGE_PASSED", "BLOCK_MINED"
  payload: Record<string, unknown>;
  explain: { title: string; body: string; concept?: string }; // i18n keys, shown in inspector
};
```

### 2.2 Simulated clock
- Virtual clock with speed control (0.25x to 100x, pause, step-by-step "next event").
- Latency, block times, batch settlement windows (e.g. T+1, T+2), BNPL due dates, and remittance delivery all run on the virtual clock.

### 2.3 Seeded randomness
- One seeded PRNG per scenario run (e.g. mulberry32). All random outcomes (fraud flags, network congestion, approval decisions) draw from it.
- "Failure injection" lets a lecturer force specific outcomes instead of relying on chance.

### 2.4 Double-entry ledger
- Every value movement is a balanced set of ledger entries between fictional accounts (customer, merchant, issuer, acquirer, PSP, scheme, platform fee account, escrow, network fee sink, etc.).
- Invariant tests: ledger always sums to zero per currency; no negative balances except where the model allows (credit, BNPL).
- Distinguish **authorization hold**, **capture**, **clearing**, and **settlement** as separate ledger states. Make it visible that approval ≠ settlement.

### 2.5 Domain model (shared)
`Actor`, `Account`, `Instrument` (card, wallet, bank account, mobile-money wallet, crypto address), `Merchant`, `Transaction` (state machine), `Fee` (rule-based), `FxQuote`, `RiskSignal`, `Scenario`, `Lesson`, `Quiz`, `Session`.

### 2.6 Generic transaction lifecycle
`INITIATED → AUTHENTICATED → AUTHORIZED → CAPTURED → CLEARED → SETTLED` with terminal/side states `DECLINED`, `EXPIRED`, `CANCELLED`, `REVERSED`, `REFUNDED`, `CHARGEBACK`, `DISPUTED`, `PENDING_REVIEW`. Each module specializes this machine; not every module uses every state.

### 2.7 Parameter system
Every module exposes a typed **parameter panel** (amount, currency, fee schedule, FX spread, network congestion, auth method, auth outcome, latency profile, fraud risk level, balance, limits). Changing a parameter re-runs the scenario from the seed. Presets are saveable as scenarios.

---

## 3. Shared UI/UX

### 3.1 App shell
- Modern banking-dashboard look: calm, high contrast, light and dark themes, **projector mode** (large type, high contrast, simplified chrome).
- Home dashboard: module grid (10 cards, grouped: Cards & Checkout, Mobile & Contactless, Transfers & Inclusion, Crypto), recent simulations, session transaction history, "Start lesson", "Free play".
- **Role switcher:** the student can view the same transaction as Customer, Merchant, Issuer bank, Acquirer, Card network/Scheme, Provider/Operator, or Regulator. The UI changes to that actor's perspective (what they see, what they pay/earn, what they can do).

### 3.2 Every module has three synchronized panes
1. **Experience pane:** the realistic user-facing interface (phone mock, POS terminal, checkout page, wallet app, USSD screen, etc.) with proper animation, loading, success, pending, and error states.
2. **Timeline pane:** live event timeline + animated sequence diagram of actors exchanging messages. Click any event to inspect it.
3. **Under-the-hood inspector:** for the selected event/transaction: who authorized, which institutions are involved, message contents (simplified, with annotations), fees charged and to whom (waterfall chart), settlement timing, reversibility, remaining risks, and a "concept" link to the glossary.

### 3.3 Receipts and ledger view
- Realistic receipt per transaction (customer receipt + merchant receipt + audit receipt with full fee breakdown).
- Ledger explorer: all fictional accounts, balances over time, double-entry rows per event.

### 3.4 Comparison dashboard
Compare any selected methods on: speed to confirmation, speed to final settlement, total cost (fixed + percentage + FX + network), accessibility (needs bank account? smartphone? internet?), reversibility, fraud/security model, who bears risk, and best-fit use case. Radar chart + sortable table. Data comes from simulation runs plus config.

### 3.5 Lecturer mode
- Toggle with a PIN (demo PIN shown in docs; local only).
- **Scenario launcher:** pick scenario, seed, speed; "Reset" returns to exact initial state.
- **Failure injector:** force decline, insufficient funds, expired card, wrong PIN, 3DS failure, timeout, duplicate submission, fraud flag, chargeback, network congestion, delayed settlement, failed block confirmation, wrong network/address, KYC rejection, BNPL denial, FX rate move.
- **Guided lesson player:** steps with talking points, pause-and-predict prompts ("What happens next?"), reveal buttons.
- **Live poll/quiz:** multiple choice and prediction questions tied to simulation outcomes; local scoring; optional shareable session code in later phases.
- **Discussion prompts** and case studies per module.
- Presenter notes panel (hidden from projector view).
- Export lesson summary (PDF/Markdown) with the event timeline of the run.

### 3.6 Student mode
Free play + assigned scenarios + self-check quizzes + "challenge mode" (e.g. "Complete this cross-border transfer for under 2% total cost", "Spot the fraudulent transaction").

---

## 4. The 10 modules

Priority: **Tier A** = deepest, most polished, built first: **Online checkout, Digital wallets, QR payments, Crypto payments + Hot/Cold wallets.** **Tier B** = fully functional but lighter: NFC, P2P, Mobile money, Remittances, BNPL. All ten must exist and be playable; Tier B reuses the engine and shared UI.

For each module: experience flow, parameters, failure scenarios, and the concepts it must teach.

### TIER A

#### 4.1 Online checkout (PayPal/Stripe style)
- **Actors:** customer, merchant, PSP/gateway, acquirer, card network, issuer, 3DS server, fraud engine.
- **Experience:** build-a-cart merchant demo store → checkout page (card form with demo cards, saved card, "pay with account" option) → 3-D Secure challenge (OTP / app approval) → confirmation → receipt. Also a **merchant dashboard** view (payments list, payouts, disputes, fees) and an **issuer view**.
- **Lifecycle shown:** tokenization → risk scoring → 3DS → authorization (hold) → capture (immediate vs delayed) → clearing → batch settlement T+N → payout to merchant. Show refunds, partial captures, and chargebacks.
- **Parameters:** amount, currency, card type (debit/credit/prepaid), interchange + scheme + PSP fees, risk level, 3DS on/off/frictionless/challenge, issuer behavior, settlement delay.
- **Failures:** insufficient funds, expired card, wrong CVC, 3DS failed/abandoned, issuer decline (generic vs reason codes), suspected fraud, duplicate submission (idempotency key demo), timeout then retry, chargeback after settlement.
- **Teach:** authorization vs capture vs settlement, interchange/MDR fee waterfall, tokenization, 3DS liability shift, idempotency, chargeback lifecycle, who bears fraud risk.
- **Algerian variant:** local card (Edahabia-style) flow via a national interbank switch, with DZD and local-bank-style 3DS/OTP step (generic labels, no real branding).

#### 4.2 Digital / mobile wallets (Apple Pay, Google Pay, Edahabia/BaridiMob style)
- **Actors:** customer, wallet app, secure element/TEE, token service provider, issuer, merchant, acquirer.
- **Experience:** phone mock → add card to wallet (provisioning + issuer verification) → pay in-app / on web (biometric prompt mock: fingerprint/face/PIN) → confirmation. Also a local-bank-wallet variant (account-linked, QR/ID-based, SMS OTP) for the Algerian context.
- **Teach:** device tokenization (DPAN vs FPAN), cryptogram per transaction, why the real card number is never shared, biometrics unlock the key locally and are not sent to the merchant, card-linked vs account-linked wallets, wallet provisioning risk (fraudulent provisioning).
- **Parameters:** biometric success/fail/retry limits, device lost scenario, token suspended, wallet balance vs linked card, limits.
- **Failures:** biometric fail x3 → fallback PIN, token provisioning declined, lost device → remote suspend + token revocation, issuer declines, offline device.

#### 4.3 QR code payments (Alipay / WeChat Pay style)
- **Both models:** **merchant-presented QR** (static and dynamic) and **customer-presented QR** (merchant scanner reads the wallet's code).
- **Experience:** generate scannable-looking QR (render a real QR encoding a fake payload string using a library; show the decoded payload structure, EMV-QR-style fields simplified) → "scan" with simulated camera (drag or button) → review amount/merchant → confirm with PIN/biometric → success with receipt. Merchant side shows instant notification and a soundbox-style confirmation.
- **Teach:** static vs dynamic QR, what is inside the code (merchant ID, amount, reference, checksum), QR swapping fraud (replacing a merchant's sticker), expiry/time-bound codes, account-based settlement (funds move wallet-to-wallet, often cheaper than cards), interoperability between providers.
- **Parameters:** QR expiry time, static vs dynamic, amount entered by customer vs preset, provider fee, settlement speed, cross-border QR with FX.
- **Failures:** expired QR, tampered/malicious QR (checksum mismatch or merchant mismatch warning), wrong amount, insufficient wallet balance, scanned twice (duplicate), provider outage.

#### 4.4 Cryptocurrency payments + 4.5 Hot vs. cold wallets (treated as two linked modules)
**Crypto payments (module 8):**
- **Chains simulated (all fake, no real RPC):** a Bitcoin-like UTXO chain and an EVM-like account chain with a stablecoin token (USDT/USDC-style) and a fast low-fee chain option.
- **Experience:** merchant checkout shows invoice (address, amount, expiry, exchange-rate lock) → customer wallet builds transaction → choose fee tier (low/medium/high) → broadcast → **mempool view** (fee-rate-ordered queue) → block production animation → confirmation counter (0/1/3/6, with finality discussion) → merchant marks paid.
- **Bitcoin-like specifics:** UTXO selection visualizer (inputs/outputs/change), fee rate in sat/vB, replace-by-fee, stuck low-fee transaction, orphan/reorg demo.
- **Stablecoin specifics:** gas, nonce, approve + transfer for tokens, wrong-network deposit, stablecoin depeg scenario, issuer freeze/blacklist demo, on-/off-ramp (fiat ↔ stablecoin) with fees and spread.
- **Teach:** irreversibility, confirmations and finality, fee market, volatility vs stablecoin risk, address errors, on-chain transparency vs privacy, custody and compliance (KYC/AML at on/off-ramps).
- **Parameters:** congestion level, fee tier, volatility (price path with seeded random walk), confirmations required, exchange rate lock window, chain choice.
- **Failures:** underpaid invoice, overpaid invoice, expired invoice rate, stuck transaction, wrong address, wrong network, double-spend attempt on 0-conf, price moved before confirmation, stablecoin depeg.

**Hot vs. cold wallets (module 9):**
- **Experience:** side-by-side workflows. **Hot wallet:** app/browser wallet signs online. **Cold wallet:** air-gapped signing flow, build an unsigned transaction on the online "watch-only" device → transfer by QR/file to the offline "hardware device" mock → user verifies details on the device screen → signs → transfer signed transaction back → broadcast.
- **Include:** fake seed-phrase generation (clearly marked FAKE, wordlist sample), backup and recovery drill, multisig demo (2-of-3), phishing/malware scenarios (clipboard address swap, fake wallet site, malicious approval).
- **Teach:** custody models (self vs custodial), key management, attack surface comparison, convenience vs security trade-off, recovery and loss risk, why the NFC and wallet-type distinction matters (custody model, not a payment rail).
- **Failures:** compromised hot wallet, lost seed phrase, malicious signing request, address swap caught or missed depending on user verification, exchange (custodial) failure scenario.

### TIER B

#### 4.6 NFC contactless
- Tap virtual card or phone on a POS terminal (drag-to-tap animation, terminal beep, LED sequence). Show the EMV contactless exchange simplified: select application → read data → cryptogram → online/offline authorization decision.
- **Teach:** NFC is a technology, not a payment network; contactless limits and CVM (no-CVM below limit, PIN/biometric above), offline vs online authorization, relay-attack risk, cumulative limit, terminal vs wallet-host (HCE).
- **Parameters:** contactless limit, offline floor limit, terminal connectivity, amount.
- **Failures:** limit exceeded → PIN prompt, card read error, terminal offline, double tap, cumulative limit reached.

#### 4.7 P2P transfers (Venmo-style)
- Contacts list, send/request money, split-bill flow (equal/custom/by item), social feed toggle (privacy teaching), funded by balance/bank/card.
- **Teach:** funding source costs, instant vs standard transfer fees, pending vs completed, irreversibility and scams, limits and KYC tiers, float held by the provider.
- **Failures:** insufficient balance, recipient not registered (pending claim), wrong recipient, payment request scam, account limit, transfer reversed after failed bank pull.

#### 4.8 Mobile money for the unbanked (M-Pesa style)
- **USSD-style interface** (monospace phone screen, numbered menus, session timeout), agent network: cash-in/cash-out at an **agent** (agent view with float and commission), send money, pay bill, airtime, merchant pay.
- **Actors:** customer, agent, mobile-money operator (trust account), partner bank, telecom network, regulator.
- **Teach:** e-money vs bank deposit, trust account backing, agent liquidity (float) management, KYC tiers, why feature phones and no bank account still work, fee structure, financial inclusion impact.
- **Failures:** USSD session timeout mid-flow, wrong PIN lockout, agent out of float, wrong number, transaction limit exceeded, SIM swap fraud scenario.

#### 4.9 Cross-border remittances
- Select send/receive countries, currencies, amount, and delivery method (bank, wallet, cash pickup). **Provider comparison table:** bank wire (correspondent chain with SWIFT-style hops and intermediary fees), money-transfer operator, fintech app, mobile-money corridor, stablecoin rail.
- **Show:** mid-market rate vs offered rate (FX spread), fixed + percent fees, total cost %, delivery time, amount received, hidden-fee detector.
- **Teach:** the true cost of remittances, correspondent banking, nostro/vostro, FX spread as hidden fee, regulation/sanctions screening, why alternative rails are cheaper/faster, the "5% cost" policy target.
- **Parameters:** corridor, FX volatility, provider fee schedules, compliance checks, cut-off times, delivery rail.
- **Failures:** compliance hold, name mismatch at receiving bank, intermediary bank deducts fee, FX rate moves before lock, cash-out location out of cash.
- **Challenge:** "Send 500 EUR to Algeria with the lowest total cost and delivery under 24h."

#### 4.10 BNPL (Buy Now, Pay Later)
- Checkout option "Pay in 4" and "Pay in 12": soft credit check mock (approval/denial with reasons), installment schedule, auto-debit from linked card, reminders, late fee, missed payment consequences, return/refund handling.
- **Actors:** customer, merchant (receives full amount minus MDR, bears no credit risk), BNPL provider (credit risk), funding bank/investors.
- **Teach:** who earns what (merchant discount fee, late fees, interchange), underwriting with limited data, credit risk and loss provisions, debt stacking across providers, regulatory discussion, comparison with credit cards.
- **Parameters:** approval threshold, merchant discount rate, late-fee policy, default rate, customer income/obligation inputs.
- **Failures:** declined, auto-debit fails (NSF), partial payment, return after first installment, stacked-loans overload.

---

## 5. Content layer (`packages/content`)
- **Scenarios:** at least 5 per Tier A module, 2 to 3 per Tier B module. Each: title, learning objectives, parameters preset, seed, expected events, talking points, discussion questions.
- **Quizzes:** 8 to 12 questions per module (multiple choice, prediction, ordering, match-the-actor). Explanations required for every answer.
- **Glossary:** 100+ terms (authorization, clearing, settlement, interchange, MDR, acquirer, issuer, 3DS, tokenization, DPAN, cryptogram, UTXO, mempool, nonce, gas, finality, custody, float, nostro/vostro, spread, KYC/AML, chargeback, idempotency, etc.), each linked from the inspector.
- **Case studies:** short written cases (e.g. financial inclusion via mobile money, QR dominance in China, remittance cost corridors, BNPL growth and risk, stablecoin depeg event) with questions.
- All content in EN/FR/AR. Provide translation keys; fill EN fully, FR/AR at least for UI and Tier A modules.

---

## 6. Non-functional requirements
- **Performance:** engine runs a full scenario in under 50 ms; UI stays at 60 fps during animations.
- **Accessibility:** WCAG 2.1 AA, keyboard navigation, reduced-motion mode, screen-reader labels on all timeline events, RTL layout verified.
- **Responsive:** desktop-first (projector, 1080p), usable on tablet and phone.
- **Offline-capable:** works without network after first load (PWA); no external calls at runtime.
- **Testing:** unit tests for every state machine transition and every ledger invariant; snapshot tests for deterministic replays; Playwright for one complete happy path and one failure path per Tier A module.
- **Docs:** README with setup, architecture diagram, "How to add a new module" guide, scenario authoring guide, and a lecturer quick-start (one page).
- **Safety/ethics page** inside the app explaining the simulation boundary and the no-real-data rule.

---

## 7. Build phases and acceptance criteria

**Phase 1 — Foundation.** Monorepo, engine core (events, clock, PRNG, ledger, transaction machine, fee engine, FX quote), app shell, dashboard, three-pane module layout, timeline, inspector, receipt, ledger view, i18n + RTL, theme + projector mode.
*Accept:* a dummy module runs end to end; replaying the same seed yields byte-identical event logs; ledger invariants pass; all UI panes update from the event log only.

**Phase 2 — Tier A modules.** Online checkout, digital wallets, QR payments (both models), crypto payments, hot/cold wallets. Merchant, issuer, and role-switcher views. Failure injector wired to every listed failure.
*Accept:* every listed failure scenario is reproducible by the lecturer; fee waterfall sums to the amount; crypto confirmation, mempool, and cold-signing animations driven by events; each module has a guided lesson and quiz.

**Phase 3 — Tier B modules.** NFC, P2P, mobile money (USSD + agent view), remittances (provider comparison), BNPL.
*Accept:* all ten modules reachable from the dashboard, each with at least 2 scenarios, 8 quiz questions, and working failure paths.

**Phase 4 — University layer.** Lecturer mode complete, guided lessons, live prediction prompts, comparison dashboard, challenge mode, session export (JSON + PDF/Markdown summary), lecturer quick-start, presenter notes.
*Accept:* a lecturer can run a 45-minute class entirely from the app, reset any scenario instantly, and export the session summary.

**Phase 5 — Polish.** Motion design pass, accessibility audit, FR/AR content completion, performance pass, Playwright suite, documentation.

---

## 8. Working rules for you (the AI)
1. Start by writing a short plan: folder structure, engine API, event schema, state machine diagrams for online checkout and crypto. Show it, then implement.
2. Build **engine first**, UI second. If a UI feature needs data that is not in the event log, extend the event schema instead of hacking the UI.
3. Keep modules **data-driven**: a module = state machine config + parameter schema + experience component + content. Adding module #11 should not require touching the engine.
4. Commit in small steps with clear messages; run typecheck, lint, and tests before moving to the next phase.
5. When a real-world detail is uncertain (exact fee rates, protocol field names, regulations), **simplify and label it as illustrative** rather than inventing precise claims.
6. Ask me only when a decision blocks progress; otherwise choose the sensible default, document it in `DECISIONS.md`, and continue.
7. At the end of each phase, report: what was built, what is stubbed, what the acceptance criteria results are, and what you recommend next.

Begin with Phase 1.
