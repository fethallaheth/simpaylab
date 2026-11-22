# SimPay Lab — FinTech Payment Simulation Lab (simulation-only)

University lecture platform to experience and dissect 10 electronic payment
methods. No real money, no real APIs, no real blockchains. Every account,
card, OTP, seed phrase and phone number is fictional.

## Quick start

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm test       # engine unit tests (Vitest)
pnpm typecheck  # web + engine + content
pnpm build
```

## Architecture

```
packages/engine    pure event log + deterministic runner
packages/content   scenarios, quizzes, glossary, fee/FX configs
src/               Next.js App Router shell + module experiences
```

- `packages/engine` — pure TypeScript, zero UI/browser imports. Event schema,
  virtual clock, seeded PRNG (mulberry32), double-entry ledger, generic
  transaction lifecycle machine, fee engine, FX quotes, deterministic scenario
  runner + per-module builders. Tested with Vitest (`packages/engine/test`).
- `packages/content` — zod-validated scenarios (25), quizzes (60, every answer
  explained), glossary (79 terms), illustrative fee/FX/limit configs.
- `src/` (Next.js App Router) — lab index, three-pane simulator
  (Experience / Timeline+sequence / Inspector), receipts, ledger explorer,
  comparison dashboard, safety + glossary pages, EN/FR/AR with RTL, light/dark
  + projector mode. All panes render from the event log only.

## Teaching workflow

1. Open a module (start with Online checkout).
2. Press Play or step event-by-event. Click any timeline event to inspect it:
   who authorized, message contents, fee waterfall, settlement timing, risks.
3. Reset to the seed to replay the run identically, or export it as JSON.
4. Use the Lesson pane: pause-and-predict prompts + reveal, talking points,
   discussion questions. Quiz tab for self-checks with explanations.

45-minute class recipe: run `checkout-happy-3ds` (10 min) → replay and inspect
the 3DS failure path (10 min) → `crypto-stuck-rbf` with mempool discussion
(10 min) → comparison dashboard + "Send 500 EUR to Algeria under 2%" challenge
(10 min) → quiz + discussion (5 min).

## Adding a new module (#11)

1. Content: add scenarios/quizzes/glossary entries in `packages/content/src/`
   (validated by zod; run `validateContent()`).
2. Engine: add a builder in `packages/engine/src/scenario.ts` + fee default +
   currency in `MODULE_CURRENCY`; emit events only (UI reads the log).
3. Web: add meta in `src/lib/sim.ts` (`MODULES`, `MODULE_FAILURES`), an
   experience branch in `src/components/experience.tsx`, dict names
   (`mod.<id>`) in `src/i18n/dict.ts`, and the id in `VALID` lists.
4. Add failure-injection tests in `packages/engine/test/`.

## Scenario authoring

A scenario = id + module + preset `{params, seed}` + `expectedEvents` (must be
event `type`s the builder emits) + objectives/talking points/discussion keys.
Keep seeds fixed so lecturers replay byte-identical runs (`replayKey`).

## Safety

No real money, networks, or data. The `/safety` page states the boundary, and
demo cards must use reserved fake ranges (`400000…`/`555555…`/`353011…`,
Luhn-valid). Seed phrases marked FAKE are drills. All fees/FX/limits are
illustrative values for teaching.
