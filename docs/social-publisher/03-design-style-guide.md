# 3. Design Style Guide — Veyrnox Publish

**Design language:** syntx.ai (per explicit request — this is the aesthetic reference).
**Interaction patterns:** Metricool (per explicit request — this is the UX-pattern reference).
Nothing in this document reuses Metricool's own visual identity (its wordmark, its indigo/lime/pink
brand palette) — only its *layout patterns* (calendar, composer, network badges). Colors and type
below were read live from syntx.ai's rendered CSS, not guessed.

## 3.1 Source: syntx.ai visual tokens (captured live)

| Token | Value | Where observed |
|---|---|---|
| Background (base) | `#EDE6DA` (`rgb(237,230,218)`) | `<body>` background |
| Text (primary) | `#241E20` (`rgb(36,30,32)`) | `<body>` color, H2 |
| Surface / off-white | `#F5F0E9` (`rgb(245,240,233)`) | button label color, card backgrounds |
| Accent (primary CTA) | `#E54717` (`rgb(229,71,23)`) | "Sign in" button background |
| Pill / chip background | `#E3D3BB` (`rgb(227,211,187)`) | model-name pills, H1 |
| Body / UI font | **Onest** (sans-serif) | body, buttons, pills — geometric grotesk, used at 14–16px for UI |
| Display / heading font | **Agse** (sans-serif family, rendered as a bold condensed slab in practice) | H1/H2 at 84–92px, weight 400–800 |
| Corner radius (buttons/pills) | `8px` | consistent across button, pill, CTA |
| Button padding | `8px 15px` (primary), `4px 8px` (compact/ghost) | |

**Font licensing note:** `Agse` is syntx.ai's own licensed display font and should not be used
verbatim without a license. Recommended open substitutes with the same bold-slab, high-x-height
editorial character: **Fraunces** (variable, has a "soft"/rounded axis close to Agse's warmth) for
display headings, or **Instrument Serif** for a lighter editorial feel. **Onest** itself is open
source (SIL OFL) and can be used directly for UI/body text.

## 3.2 Veyrnox Publish design tokens

```css
:root {
  /* Base palette — from syntx.ai */
  --publish-bg:           #EDE6DA;
  --publish-surface:      #F5F0E9;
  --publish-ink:          #241E20;
  --publish-ink-muted:    #6B6062;   /* derived: ~55% lightness of --publish-ink */
  --publish-pill:         #E3D3BB;
  --publish-accent:       #E54717;
  --publish-accent-ink:   #F5F0E9;   /* text-on-accent */
  --publish-border:       #D9CDBA;   /* derived: between bg and pill */

  /* Status colors — reuse this repo's existing Chip tones, not new ones */
  --publish-status-draft:    var(--chip-neutral);
  --publish-status-scheduled: var(--chip-accent);
  --publish-status-review:   var(--chip-warn);
  --publish-status-published: var(--chip-solid);
  --publish-status-failed:   var(--chip-danger);

  --publish-radius-sm: 8px;
  --publish-radius-md: 12px;
  --publish-radius-lg: 20px;

  --publish-font-ui: "Onest", sans-serif;
  --publish-font-display: "Fraunces", serif; /* Agse substitute, see §3.1 */
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --publish-bg:        #1C1817;
    --publish-surface:   #241E20;
    --publish-ink:       #EDE6DA;
    --publish-ink-muted: #A79C90;
    --publish-pill:      #3A302B;
    --publish-accent:    #FF6A3D;   /* lifted +10% lightness for AA contrast on dark */
    --publish-accent-ink: #1C1817;
    --publish-border:    #362E2A;
  }
}
```

Contrast check: `--publish-accent` (#E54717) on `--publish-bg` (#EDE6DA) is **not** AA-compliant
for body text (≈3.1:1) — use it only for large text (≥24px/bold), icons, and filled buttons where
the label is `--publish-accent-ink` on the accent fill (which *is* compliant, ≈8.9:1), never as
small orange-on-cream text.

## 3.3 Layout patterns borrowed from Metricool (structure only, restyled)

Metricool's own marketing site describes its shell as "1-in-1: Planner, assistant, and calendar"
and shows a four-tab shell: **Planner · Analytics · Reporting · Inbox**. Veyrnox Publish adopts the
same tab shape, restyled:

```
┌─────────────────────────────────────────────────────────────────┐
│  Veyrnox   ›   Publish                         [Brand: Veyrnox ▾]│
├───────────┬───────────┬───────────┬──────────────────────────────┤
│  Planner  │  Compose  │ Analytics │  Accounts                    │
├───────────┴───────────┴───────────┴──────────────────────────────┤
│                                                                    │
│   (tab content — calendar / composer / analytics / connections)   │
│                                                                    │
└─────────────────────────────────────────────────────────────────┘
```

- **Planner tab** — a month/week/list calendar. Each scheduled post renders as a small card:
  network icon badge (top-left corner, platform's own brand color — the one deliberate exception to
  the syntx palette, since network recognizability matters more than palette purity here), a
  thumbnail crop of the first media item, truncated caption, and a status pill using the tones in
  §3.2. Drag-and-drop between days/times reschedules; a ghost/preview card follows the cursor.
- **Compose tab** — two-pane layout: left pane is a vertical list of network chips (toggle which
  networks this post targets); selecting a chip reveals that network's override fields below the
  global caption box. Right pane is a live device-frame preview (phone-shaped card) rendering the
  post roughly as it will appear on the selected network — this single feature is the highest-value
  UX borrowed from Metricool's composer, since per-network formatting mistakes (wrong aspect ratio,
  truncated caption) are the #1 scheduling-tool complaint.
- **Analytics tab** — top row of stat tiles (followers, reach, engagement, posts — each with a
  small sparkline and a delta vs. previous period), below it a network-evolution line chart, below
  that a sortable table of recent posts with per-post metrics. Use the `dataviz` design system
  already available in this environment for chart styling rather than inventing new chart
  components.
- **Accounts tab** — a grid of connection cards, one per network, each either "Connect →" (ghost
  button, network's own icon) or showing the connected account's avatar/handle with a status pill
  and a "Disconnect" ghost action.

## 3.4 Components

### Network badge
A small circular or squircle icon using each platform's own recognizable mark and brand color
(Instagram gradient, TikTok black/cyan/pink, X black, LinkedIn `#0A66C2`, YouTube `#FF0000`,
Pinterest `#E60023`, Threads black, Bluesky `#1185FE`, Facebook `#1877F2`, GMB Google multicolor).
This is the one place brand-color purity is intentionally broken — a network badge in the wrong
color reads as broken, not "on brand."

### Status pill
Reuse the existing `Chip` component (`neutral | accent | money | danger | solid | warn` tones
already defined in this codebase — see prior session notes) rather than inventing a parallel pill
system:

| Post status | Chip tone |
|---|---|
| Draft | `neutral` |
| Scheduled | `accent` |
| Pending review | `warn` |
| Rejected | `danger` |
| Publishing | `accent` (with a subtle pulse/loading treatment) |
| Published | `solid` |
| Failed | `danger` |

### Composer media tray
A horizontal strip of attached media thumbnails, each with a small "AI generated" badge when
`source_job_id` is set (reusing the existing Library asset-card disclosure pattern already shipped
for the Cinema feature) — this keeps the AI-disclosure requirement consistent across the whole app
rather than inventing a second convention for Publish.

### Best-time-to-post chip
A small inline suggestion ("Best time: Tue 6:00 PM · high engagement") rendered as a tan
(`--publish-pill`) chip with a subtle upward-trend icon, clickable to auto-fill the schedule time —
directly modeled on Metricool's own heatmap-derived suggestion, restyled into the syntx palette.

## 3.5 Typography scale

| Role | Font | Size | Weight |
|---|---|---|---|
| Page title ("Publish") | `--publish-font-display` | 32px | 600 |
| Section heading ("This week", "Analytics") | `--publish-font-display` | 22px | 500 |
| Card title / post caption preview | `--publish-font-ui` | 15px | 500 |
| Body / form labels | `--publish-font-ui` | 14px | 400 |
| Meta text (timestamps, counts) | `--publish-font-ui` | 12px | 400, `--publish-ink-muted` |
| Button label | `--publish-font-ui` | 14px | 500 |

## 3.6 Motion

- Calendar drag: card lifts with a small shadow and 2° rotation on pick-up (subtle, not
  cartoonish), settles with a 150ms ease-out on drop.
- Composer network-tab switch: 120ms crossfade, no layout jump — reserve height for the tallest
  tab's content ahead of time so switching doesn't reflow.
- Publish success: a brief inline checkmark morph on the calendar card, not a full-screen modal —
  scheduling should feel lightweight and reversible, matching the "clean, organized workspace"
  feeling Metricool's own marketing explicitly sells.
- Respect `prefers-reduced-motion`: disable the drag rotation and crossfade, keep state changes
  instant.

## 3.7 Accessibility

- Every network badge has an accessible name ("Instagram", not just an icon).
- Status pills carry text, never color alone (colorblind-safe by construction, since the Chip
  component already does this).
- Calendar is keyboard-navigable: arrow keys move focus between days, Enter opens the day's posts,
  a dedicated "Reschedule" menu action provides a non-drag path to the same result as drag-and-drop.
- Composer's live preview pane is `aria-live="polite"` only for validation errors, not for every
  keystroke, to avoid screen-reader noise while typing a caption.
