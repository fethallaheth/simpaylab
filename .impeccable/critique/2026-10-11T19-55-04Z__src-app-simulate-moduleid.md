---
target: simulate three-pane surface
total_score: 25
p0_count: 0
p1_count: 3
timestamp: 2026-10-11T19-55-04Z
slug: src-app-simulate-moduleid
---
# Critique — simulate three-pane surface (src/app/simulate/[moduleId], panels, experience)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | No progress % or aria-live on stepping |
| 2 | Match System / Real World | 2 | Raw engine ids leak (scenario ids, event TYPE codes) |
| 3 | User Control and Freedom | 3 | Reset/seed/speed solid; no failure multi-undo needed |
| 4 | Consistency and Standards | 3 | Shared primitives; tab buttons diverge from Btn |
| 5 | Error Prevention | 2 | Irrelevant param selects per module; free-text currency |
| 6 | Recognition Rather Than Recall | 2 | Wall of 26 failure pills; cryptic scenario ids |
| 7 | Flexibility and Efficiency | 1 | No shortcuts, no deep-linkable seeds |
| 8 | Aesthetic and Minimalist Design | 3 | Calm, on-system; mild dashboard tile sameness |
| 9 | Error Recovery | 3 | Engine error card + reset; import fails silently |
| 10 | Help and Documentation | 2 | Glossary/safety linked; no contextual pane help |
| **Total** | | **25/40** | **Acceptable** |

## Anti-Patterns Verdict

**LLM assessment**: No hard bans triggered — no side-stripes, gradient text,
glass, hero metrics, ghost-cards, or doodles. Timeline numbers are a true
sequence (order carries info), allowed. Two soft tells: dashboard module tiles
are same-size title+desc cards (navigation tiles, acceptable but plain), and
the three uppercase pane labels flirt with the kicker trope (kept: they are
the system's fixed 3-pane grammar, not per-section scaffolding).
**Deterministic scan**: 1 warning — overused font (Geist). Body is actually
Arial/system; judged P3, won't fix. No other tells.
**Visual overlays**: none — no browser automation in this environment
(fallback signal, no overlay claimed).

## Overall Impression

Concept is strong (every pane traces to one event log; sequence diagram +
payload inspector is genuine insight). Biggest opportunity: reduce control
clutter and jargon so a first-timer reaches the insight without a guide.

## What's Working

1. **Log-truthful panes.** Experience/timeline/inspector/receipt/ledger all
   render from `result.events` — the product's core promise, structurally kept.
2. **Inspector payload + fee waterfall.** Simplified message JSON plus
   per-payee fee bars teach the machinery, not just the outcome.
3. **Didactic honesty.** Persistent sim banner, demo-range validation with
   educational rejects, FAKE-labeled seeds.

## Priority Issues

- **[P1] Failure wall.** What: all 26 injector pills visible always.
  Why: working-memory overload; unusable on projector. Fix: module-relevant
  first, rest behind a disclosure. Command: $impeccable polish.
- **[P1] Param drift.** What: every module shows risk/tds/capture/qr/chain
  selects regardless of relevance. Why: invites invalid combos, teaches
  nothing. Fix: per-module select sets + currency dropdown. Command:
  $impeccable polish.
- **[P1] Status-text contrast.** What: emerald-600/red-600/amber-600/zinc-400
  small text on light fails 4.5:1. Why: WCAG AA violation on teaching
  content. Fix: -700/-800 shades, zinc-500 for meta. Command: $impeccable
  polish (verifies $impeccable audit a11y).
- **[P2] Raw ids in UI.** What: scenario dropdown shows `checkout-happy-3ds`;
  lesson shows `lo.authVsSettle`-style keys. Why: Jordan can't choose. Fix:
  humanized labels from dict. Command: $impeccable clarify.
- **[P2] Dark body var.** What: `.dark` class doesn't flip `--background`.
  Why: body bg stuck light in dark toggle. Fix: `.dark` var override.
  Command: $impeccable polish.
- **[P2] No keyboard accelerators.** What: play/step/reset are pointer-only.
  Why: Alex (lecturer, one hand on keyboard) slowed. Fix: space/arrow
  shortcuts + visible hints. Command: $impeccable harden.

## Persona Red Flags

**Alex (Power User)**: no shortcuts; no URL-encoded seed/spec for replay
links; failure reset is all-or-nothing per pill only.
**Jordan (First-Timer)**: scenario ids cryptic; event TYPE codes
(AUTHORIZED_HOLD) unexplained inline; no suggested first run.
**Sam (a11y)**: weak focus visibility on custom buttons; status-text contrast
fails; timeline aria-labels good; SVG has label, good.
**Lecturer (project-specific)**: 26-pill wall unreadable from back row;
needs 2-3 preset failure buttons per module.
**Student (project-specific)**: quiz strong; lesson expected-event codes
(`TX_STUCK`) need plain-language companions.

## Minor Observations

- Tab buttons restyle Btn instead of reusing it.
- `poly` dead code in compare radar; junk ternary in ParamPanel.
- Import-session failure is silent (empty catch).
- Wordmark sky accent is large/bold: passes 3:1, keep.

## Questions to Consider

- What if the injector showed only this module's failures, with the rest one
  click away?
- Does the lesson tab need event codes at all, or only their plain-language
  titles (already in the log)?
- What would a one-keystroke lecture flow (play/step/inject) feel like?
