# Product

## Register

product

## Users

- **Students** (undergrad, fintech/econ courses): run simulations in free play
  or assigned scenarios, inspect what happens under the hood, self-check with
  quizzes. Context: laptops/tablets, in class or at home, mixed technical level.
- **Lecturers**: run a 45-minute class entirely from the app — launch seeded
  runs, replay them event by event, pause-and-predict, poll, export the session.
  Context: projector (1080p), bright lecture hall, one hand on the keyboard.
- Success: a lecturer replays any run byte-identically, students can
  explain authorization vs settlement and fee waterfalls in their own words.

## Product Purpose

SimPay Lab is a simulation-only teaching instrument for 10 electronic payment
methods (Tier A deep: checkout, wallets, QR, crypto, custody; Tier B
functional: NFC, P2P, mobile money, remittances, BNPL). Every pane —
experience, timeline, sequence diagram, inspector, receipts, ledger, quizzes —
is a projection of one deterministic, seeded event log. It exists so payment
flows can be *dissected* (who authorized, who earned what, when money really
moved), not just clicked through. Simulation boundary is absolute: no real
money, data, or networks, ever.

## Brand Personality

Calm, precise, didactic. Voice: a senior engineer teaching at a whiteboard —
plain sentences, named concepts, every number labeled illustrative. Emotional
goals: clarity under projector light, confidence in replay ("same seed, same
run"), curiosity about the machinery (fees, holds, mempool, air gaps).

## Anti-references

- No cloned fintech brands: no Apple Pay / Stripe / M-Pesa lookalikes, logos,
  or copied UI. One original SimPay identity; real names only as explanatory
  examples (hard constraint from the brief).
- No marketing-landing look: this is a tool, not a SaaS homepage. No hero
  metrics, no eyebrow-on-every-section, no gradient text, no card-grid sameness.
- No dark-terminal cliché: dark mode exists for the lecture hall, not as a
  dev-tool costume. Light is the default; contrast does the work.

## Design Principles

1. **The event log is the truth.** If it isn't in the log, the UI doesn't show
   it. Every visualization must trace back to an event.
2. **Approval ≠ settlement, always visible.** Holds, capture, clearing, and
   settlement are separate states with separate ledger rows — the core lesson
   of the product, never collapsed.
3. **Projector-first legibility.** 1080p, bright room, back row: large type
   option, high contrast, simplified chrome. If it fails on the projector, it
   fails, period.
4. **Didactic honesty.** Illustrative numbers labeled as such; fake data
   declared fake; errors are lessons (declines show reason codes, theft shows
   irreversibility).
5. **Calm chrome, vivid mechanism.** Neutral shell; color reserved for state
   (holds amber, settled green, failures red) and for the moving parts —
   mempool blocks, QR payloads, fee waterfalls.

## Accessibility & Inclusion

WCAG 2.1 AA (brief §6): keyboard navigation everywhere, screen-reader labels
on all timeline events, reduced-motion alternative (crossfade/instant),
RTL-verified Arabic layout. Body text ≥ 4.5:1; projector mode raises type and
contrast further. Trilingual EN/FR/AR from day one.
