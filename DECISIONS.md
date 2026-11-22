# Decisions

Simulation-only FinTech Payment Simulation Lab. All numbers illustrative for teaching.

## D1 — State machine without XState (Phase 1)
Spec allows "XState v5 (or a tiny typed reducer if you justify it)".
Decision: pure typed reducer in `packages/engine/src/machine.ts`.
Why: zero-dependency deterministic core, fully unit-testable, no interpreter
nondeterminism, trivially serializable. XState can be adopted in Phase 2+
without changing the event schema (transition table is data).

## D2 — i18n without next-intl
Spec: "`next-intl` or equivalent". Decision: typed flat dictionaries in
`src/i18n/dict.ts` (`en` complete, `fr`/`ar` for UI chrome + module names,
engine strings fall back to EN) + `dir="rtl"` switch. Rationale:
offline-first, zero runtime network, small bundle. `t(locale, key)` mirrors
next-intl closely, so a swap later is mechanical.

## D3 — UI primitives without full shadcn CLI
Hand-rolled shadcn-style primitives in `src/components/ui.tsx` (Button/Card/
Badge/Input) with Tailwind + CSS variables, matching shadcn API so
`components/ui/*` can be replaced by generated shadcn components later.

## D4 — Demo card range
Reserved fake range: PANs must start with `400000` / `555555` / `353011`
AND pass Luhn. Anything else — even Luhn-valid (e.g. 4111…1111) — is
rejected with an educational message. Pre-filled demo values only.
Persistent banner on every page: "Simulation. Do not enter real data."

## D5 — Determinism contract
Same scenario + same seed = byte-identical event log (JSON.stringify equal).
Rules: no `Date.now`/`Math.random` in engine; one mulberry32 PRNG per run;
monotonic virtual clock; deterministic IDs (`evt-0001…`, `tx-…`).
Snapshot-covered by `replayKey` test.

## D6 — Ledger model
Double-entry over fictional accounts, one currency per run (remit posts a
src-leg and a dst-leg under the same txId). `HOLD` reserves but does not move
posted balances (approval ≠ settlement stays visible). Standard chain:
CAPTURE customer→acquirer, CLEARING acquirer→escrow, fee lines
acquirer→payee, SETTLEMENT escrow→merchant. Merchant + acquirer allow
negative balances (they can owe, e.g. chargebacks); customer/wallets cannot.
QR wallet-to-wallet and crypto custody post shorter direct chains.

## D7 — Module = data + builder + component
`packages/content` owns scenarios/quizzes/glossary/fees (zod-validated).
`packages/engine` owns the generic runner + per-module step builders.
`src/components/experience.tsx` owns one experience pane per module.
Adding module #11 = content entries + builder + experience branch; no engine
rewrite. Tier B modules reuse the generic stub builder + generic pane
(Phase 3 deepens them).

## D8 — No brand cloning
One original design language ("SimPay Lab"). Real provider names appear only
in `idea.md`/docs as workflow examples. No logos, no copied UI.

## D9 — Next.js 16 route config
`generateStaticParams` must live in a server component: `simulate/[moduleId]`
is a thin server wrapper around the client `SimulateClient`. Workspace
packages are consumed via `transpilePackages` + `tsconfig` path mapping to
`src/index.ts` (no dist build needed for dev/typecheck).

## D10 — Staged checkout runner (C1 rebrand)
`packages/engine/src/checkoutFlow.ts` drives checkout from user actions
(`submit_cart` → `submit_card` → `submit_otp` → `capture` → `refund` /
`open_chargeback` → `respond_chargeback`) instead of precomputing the run.
Same event schema, same ledger, same D5 contract: seed + action transcript =
byte-identical log (the transcript is the replay key). Dependency is one-way
(`checkoutFlow` → `scenario` shared core: `createRunBase`/`finishRunResult`/
`emit`/`move`/`step`/`post`/`settleChain`); no import cycles.
`buildCheckout` in scenario.ts stays FROZEN as the legacy scripted path until
the C4 cutover (then `runScenario("checkout")` switches to the canonical
driver `driveCheckoutCanonical` and the legacy builder is deleted).
Modeling notes: format-level card rejects (`CARD_REJECTED`) are retryable and
consume no PRNG stream; issuer declines stay at authorization (as before).
Refunds return principal only — processing fees are kept (illustrative rule,
stated in the receipt/inspector copy). `CHARGEBACK` is terminal in the
lifecycle machine (no `machine.ts` change): representment accept/fight/win/
lose are recorded as sub-events with ledger effects, `finalState` stays
`CHARGEBACK`.

## D11 — All-method rebrand: reference apps as workflow specs
Every module reproduces the interaction pattern of leading real apps, with
generic labels and no brand cloning (per §0.3). What was studied per method:
wallet (double-click + biometric + DPAN cryptogram; RIB link + SMS OTP for
account wallets), QR (merchant static/dynamic + customer-presented, real QR
payloads, checksum anti-swap), crypto (invoice + rate lock + fee-tier mempool
+ per-block confirmations + RBF), custody (hot sign-online vs cold air-gap QR
ferry with verify-or-lose on the device screen; FAKE seed drills), NFC (EMV
contactless exchange + CVM-over-limit + offline floor), P2P (balance top-up,
send/request, equal-custom splits, private/friends audiences, stranger-request
drill), mobile money (USSD sittings with 120s clock, first-use PIN, agent
tills with floats, cash-in/out, bills, airtime), remittances (quote-first with
spread-as-cost, provider rails, corridor hops, compliance holds, under-2%
challenge), BNPL (soft eligibility scoring, 4/12 schedules, per-leg autopay,
late fees, returns). Shared patterns: empty initial state, user-typed
fictional data, staged engines (seed + transcript = replay), history from
saved sessions, timeline/inspector fed by the log only.

## D12 — Backend funding rule (no surprise declines, no fake balances)
`runScenario` funds the buyer with 4× amount + buffer once the amount is
known. Staged flows where the user types the amount mid-run (NFC till, QR
static/dynamic scan, remittance quote) top the backend up to the same formula
at that moment. Balances the student can SEE (P2P provider balance, mobile-
money wallet) start at zero and are only ever fed by user actions (top-up,
cash-in). Balances nobody sees never cause a decline the UI cannot explain.

## D13 — Wallet sheets use nominative style labels, no brand cloning
The three checkout options are labeled "Device wallet sheet", "In-app
wallet" and "Postal provider (BaridiMob-style)" as plain text, with original
sheet designs. No logos, no copied trade dress, no provider SDKs. The
BaridiMob-style flow mirrors public documented behavior (CCP-centred
account, phone+card+expiry adhesion with time-sensitive SMS code, visible
balance, mini-statement, 50,000 DZD/day cap, per-operation fees) with all
values illustrative. Passwords and card secrets exist only in screen state
and are never persisted; only tokens (last4/expiry/DPAN) and non-sensitive
account references are stored locally.

## D14 — Wallet setup stores a fictional demo passcode locally
The wallet setup ceremony persists `{name, pin}` in localStorage, explicitly
demo-only. Rationale: a wallet that forgets its passcode on every refresh
cannot teach unlock flows; real credentials are never requested (fictional
test data enforced by copy + range gates), so the stored 4-digit code carries
the same risk class as the documented demo PIN 1234. Every visit still starts
locked. Card PANs/CVCs are never persisted anywhere — only last4/expiry/
name/DPAN tokens, minted through the engine at provisioning time.

## D15 — P2P identity model: single profile acts, switching previews
CirclePay keeps one sitting (one ledger + transcript) per browser. Acting
(send/request/split/topup) always runs as the signed-in profile; "switch
user" is an explicit read-only recipient preview (balances, inbox, feed as
they see it), while payback buttons simulate counterparties through real
engine transitions. Counterparties hold deterministic demo funds derived
from their handle (no preloaded visual balances for the student, who starts
at $0). Sitting transcripts persist in localStorage and replay
byte-identically on reload (seed + actions), so refresh never duplicates or
loses money. Saved sessions stay read-only history.

## D16 — Remittance tracker reveals a synchronous log; recipient credit is UI-side
The engine still settles a transfer in one deterministic run (-keeps replay
and ledger invariants trivial), while the tracker reveals its events step by
step under Continue/auto control — theater on truth, same pattern as the NFC
and BNPL ladders. Reverse quotes iterate the forward integer math to a stable
answer (no float money anywhere). Recipient wallet balances and cash
collections are UI-side records credited only at/after delivery reveal,
guarded per transfer id; failed or held transfers can never credit. Saved
sessions carry the wizard inputs so retry restores the exact quote context.

## D17 — Hot wallet (Ember): engine-owned ledger, UI-owned ceremony
`packages/engine/src/hotwallet.ts` owns ALL wallet truth: one serializable
state (accounts, per-network balances, nonces, tx lifecycle incl. stuck/
cancelled, swaps on fictional reserves, connections, allowances, stakes,
notifications) mutated only through checked actions, seeded RNG in-state.
The UI never computes money; ceremony codes, countdowns and press-and-hold
are presentational. Passwords persist in localStorage demo-labeled — the
app states plainly this is not production key storage. Crypto-module
integration is a pay-intent handoff (destination/amount/asset in, tx
reference out); each engine still settles its own leg. Custody mounts the
full wallet beside its hot-vs-cold comparer; neither route changed shape.

## D18 — Cold wallet (PolarVault): persistent device engine + two-pane ceremony
`packages/engine/src/coldwallet.ts` owns all cold-wallet truth in one
serializable state (device model/power/PIN-lockout/connection, setup
ceremony, demo seed + retained recovery profile, accounts/addresses/
balances, proposals with draft→awaiting→signed→ready→pending→confirmed plus
rejected/failed/cancelled, air-gap envelopes with demo checksum + TTL,
scenario flags), mutated only through guards that enforce the settlement
invariants (prepare/reject/sign never move funds, broadcast-once,
confirm-settles-once, failed-broadcast retryable). Demo ids/addresses/
signatures derive from seed + counter — deterministic without storing RNG.
The computer UI (`ColdWallet.tsx`) and the physical device object
(`HwDevice.tsx`) are two views over the same record: spoof scenarios alter
only the computer's display copy, the device always renders proposal truth.
Old custody tabs (hot/cold/recover/activity) untouched; new `device` tab
mounts the experience. PIN + seed persist in localStorage labeled DEMO ONLY.

## D19 — Journey / timeline / inspector rebuild (translation paused mid-way)
Below-fold sections now share one pipeline over the visible event-log
slice: `src/components/journey.tsx` owns per-module step definitions
(`JOURNEY_DEFS`, matched against real engine event types only, optional
steps hidden when unused), step computation (`computeSteps`: done / now /
todo / failed with timestamps, post-settlement disputes unwind the final
step, `ADDRESS_SWAP` counts as failure only when uncaught), a working
replay controller (play / pause / prev / next / restart / scrubber /
speed / "Step k of n" / completion badge — cursor only slices the log, so
replay never re-executes money), an actor-based sequence view (translated
actor chips, from → to rows with RTL-mirrored arrows, selected-event
sync), and translated buyer/seller whereabouts. `panels.tsx` Timeline /
Inspector / Receipt / Ledger / Params / Failures / Quiz chrome all go
through `t()`/`tx()` (new interpolation helper); inspector sanitizes
secret-looking payload keys and keeps raw JSON behind a translated
disclosure. `FAIL_TYPES` grew to cover chargebacks, funding declines,
SIM-swap flags, fund loss, missed/late BNPL legs and hot compromise.
`commerceText(type, locale)` localizes the commerce lens (EN fallback per
line). Dictionaries: full EN for all new keys; FR/AR complete for the
journey/timeline/inspector/shell/homepage scope via `dict-fr.ts` /
`dict-ar.ts` sidecars merged in `DICTS` plus `commerce-fr/ar.ts` — per
user request the translation pass PAUSED there: the ten module experience
panes (co/wa/qr/cr/hw/cw/...) and quiz question bodies remain EN-fallback
until resumed. Verified headlessly: tsc clean, 127/127 engine tests, a
16-case esbuild harness over the real `computeSteps` all green, and
scripted audits (every UI key exists in EN, every step-match type is a
real emitted event, sidecar keys ⊆ EN, commerce maps cover all 150 keys).
