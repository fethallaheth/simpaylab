---
name: SimPay Lab
description: Calm, projector-first teaching instrument for dissecting payment flows.
colors:
  signal-blue: "#0284c7"
  caution-amber: "#fcd34d"
  settled-green: "#059669"
  failure-red: "#dc2626"
  ink: "#18181b"
  paper: "#ffffff"
  app-bg: "#fafafa"
  muted: "#52525b"
  line: "#e4e4e7"
  night-bg: "#09090b"
  night-surface: "#09090b"
  night-line: "#27272a"
  night-muted: "#a1a1aa"
typography:
  display:
    fontFamily: "Geist, Arial, Helvetica, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Geist, Arial, Helvetica, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Geist, Arial, Helvetica, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Geist, Arial, Helvetica, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "8px"
  md: "12px"
  full: "9999px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "16px"
  page: "16px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "#3f3f46"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-danger:
    backgroundColor: "{colors.failure-red}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
  badge-state:
    backgroundColor: "{colors.app-bg}"
    textColor: "{colors.muted}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
---

# Design System: SimPay Lab

## 1. Overview

**Creative North Star: "The Whiteboard Lab"**

A neutral board with a vivid mechanism. The shell is quiet zinc and white so
that color always means state: amber for holds and waiting, green for settled,
red for failures, blue for information and selection. Nothing is decorative;
every hue is a signal the lecturer can read from the back row. Density is
didactic, not admin-dense: three synchronized panes (experience, timeline,
inspector) beat one crowded canvas, and mono type marks every machine value
(ids, amounts, payloads) as distinct from human prose. This system explicitly
rejects cloned fintech branding and SaaS-landing grammar (PRODUCT.md
anti-references): no hero metrics, no gradient text, no eyebrow scaffolding,
no card-grid sameness. Projector mode raises the whole room's type one step
rather than restyling anything.

**Key Characteristics:**
- Quiet instruments: restrained controls; the simulation visuals carry energy.
- State-colored, chrome-neutral: ≤10% accent per screen; rarity is the point.
- Mono for machines, sans for humans: ids, amounts, and payloads always mono.
- Flat by default: borders and tone separate surfaces; shadow answers hover.

## 2. Colors

One functional accent on a zinc shell; the rest of the palette is state.

### Primary
- **Signal Blue** (#0284c7): selection, links, in-progress bars inside module
  surfaces. Used at ≤10% of any screen; its rarity is the point. The shell
  chrome itself stays zinc.

### Secondary
- **Caution Amber** (#fcd34d, #fbbf24 in dark): pending/waiting states and
  boundary notes. Amber means "attention, nothing is final."

### Tertiary
- **Settled Green** (#059669) and **Failure Red** (#dc2626): terminal states
  only — settled/confirmed/paid vs declined/failed/tampered. Never used for
  brand or decoration.

### Neutral
- **Ink** (#18181b): primary buttons, headings, body text on light.
- **Paper** (#ffffff): cards and inputs on light.
- **App Wash** (#fafafa): page background; timeline wells slightly darker.
- **Muted Slate** (#52525b): secondary text, labels (body contrast ≥4.5:1).
- **Hairline** (#e4e4e7): 1px borders, table rules.
- **Night** (#09090b): page and card surfaces in dark mode.
- **Night Line** (#27272a) / **Night Muted** (#a1a1aa): dark borders and
  secondary text.

### Named Rules (optional, powerful)
**The Signal Rule.** Color always means state, never decoration. If an element
isn't authorized/pending/settled/failed/selected, it stays zinc.
**The Neutral Shell Rule.** Navigation, page headers and index chrome are
monochrome zinc. No accent squares, no tinted bars, no colored wordmark; hue
enters only through state and module content.

## 3. Typography

**Display Font:** Geist (next/font, with system fallback)
**Body Font:** Geist (same family, 400/500/600 weights)
**Label/Mono Font:** Geist Mono (ids, amounts, payloads, event types)

**Character:** Grotesque display restraint over a neutral body. One family in
multiple weights does the work; mono is fenced off for machine values so
students learn to see the two registers at a glance.

### Hierarchy
- **Display** (700, 1.5rem/24px, 1.2, -0.02em): dashboard title only.
- **Headline** (700, 1.25rem/20px, 1.25, -0.02em): simulator module titles.
- **Title** (600, 0.875rem/14px): pane headers, card titles, quiz questions.
- **Body** (400, 0.875rem/14px, 1.5, max 65–75ch): explanations, inspector
  prose, lesson copy.
- **Label** (500, 0.8125rem/13px): field labels, badges, timeline meta.
- **Mono** (400, 0.75rem/12px): tx/event ids, amounts alongside currency,
  JSON payloads, QR payload strings.

### Named Rules (optional)
**The Two Registers Rule.** Machine values are always mono; human prose never
is. If an amount isn't mono, it's a bug.
**The Balance Rule.** h1–h3 use balanced wrapping; long prose uses pretty
wrapping to starve orphans.

## 4. Elevation

Flat by default. Surfaces separate with 1px Hairline borders and tonal steps
(white cards on App Wash, wells one step darker), never with resting shadows.

### Shadow Vocabulary (if applicable)
- **Card rest** (none, border 1px #e4e4e7): every card, input, pane.
- **Module hover** (0 4px 12px rgba(0,0,0,0.08)): dashboard module cards only,
  answering the pointer that the whole card is a link.

### Named Rules (optional)
**The Flat-By-Default Rule.** Shadows appear only as a response to state
(hover, selection ring in Signal Blue). A shadow at rest is a defect. (Never
pair a 1px border with a ≥16px soft shadow on the same element.)

## 5. Components

### Buttons
- **Shape:** gently rounded rectangles (8px). Pills reserved for tags/filters.
- **Primary:** Ink fill, Paper text, 8px 16px. Hover deepens to zinc-700.
- **Hover / Focus:** background shift only, plus a visible focus ring; motion
  is a 150ms crossfade honoring reduced-motion.
- **Secondary / Ghost / Tertiary:** Outline (1px Hairline) and Ghost
  (transparent, hover wash) for adjacent actions; Danger (Failure Red fill)
  for destructive or failure-armed controls only.

### Chips
- **Style:** full-pill badges, tinted backgrounds with darker-hue text
  (emerald/sky/amber/red/zinc). State chips carry the Signal Rule colors.
- **State:** selected failure-injector pills invert to red-bordered emphasis;
  role tabs use Ink fill when active, Hairline outline when idle.

### Cards / Containers
- **Corner Style:** 12px, never pill-shaped, never above 16px.
- **Background:** Paper on App Wash (light); Night on Night (dark).
- **Shadow Strategy:** flat at rest per Elevation; module cards lift on hover.
- **Border:** 1px Hairline always; selected timeline rows swap to Signal Blue.
- **Internal Padding:** 12px panes, 16px pages (page gutter 16px, max 80rem).

### Inputs / Fields
- **Style:** 1px Hairline stroke, Paper fill, 8px radius, 13px labels above.
- **Focus:** neutral zinc border shift; no glow archaeology.
- **Error / Disabled:** Failure Red text for validation (demo-card range
  messages); 50% opacity + not-allowed cursor when disabled.

### Navigation
- Top bar: wordmark left, four links, locale/theme/projector controls right.
  13px, hover wash, active link underlined in zinc. Mobile wraps; controls stay
  reachable, never clipped.

### Sequence Diagram
- Signature component: SVG lanes per actor, arrows per event, selected event
  in Signal Blue at 2.5px. Driven entirely by the event log; decorative
  diagrams are forbidden.

## 6. Do's and Don'ts

### Do:
- **Do** keep accent coverage ≤10% per screen (The Signal Rule); let zinc do
  the framing.
- **Do** set machine values (ids, amounts, payloads) in mono at 11–12px.
- **Do** use full 1px Hairline borders on cards and timeline rows; reserve the
  blue border for the selected event only.
- **Do** raise type and contrast in projector mode instead of restyling.
- **Do** keep shell chrome neutral zinc; hue belongs to state and module content.
- **Do** honor `prefers-reduced-motion` with crossfade/instant alternatives.

### Don't:
- **Don't** clone fintech brands or their UI (PRODUCT.md anti-reference) —
  no lookalike wallets, terminals, or logos; SimPay identity only.
- **Don't** build marketing-landing patterns (PRODUCT.md anti-reference) — no
  hero metrics, gradient text, eyebrow-on-every-section, or identical card
  grids.
- **Don't** use side-stripe borders (>1px colored left/right edge) on cards,
  callouts, or timeline rows.
- **Don't** pair a 1px border with a ≥16px soft shadow on the same element.
- **Don't** round cards beyond 16px; pills are for tags and toggles only.
- **Don't** animate layout properties or gate content on entrance reveals;
  framer-motion accents (opacity/transform, ≤300ms, exponential ease-out)
  enhance an already-visible default.
