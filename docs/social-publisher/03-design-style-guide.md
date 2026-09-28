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

## 3.8 Authenticated app — verified live (2026-09-28 update)

The rest of this document was originally written from syntx.ai's **logged-out marketing site**
only, with an explicit caveat that the in-app screens weren't reachable (cookie import into the
automated browser didn't carry the session — likely a token-in-localStorage SPA auth, not a
readable cookie; logged as a durable learning). The user then logged into syntx.ai themselves in
the built-in browser pane and this session drove that already-authenticated tab directly — this
section is real, not inferred, and supersedes any earlier guess at the in-app nav.

### Real primary navigation

Triggered by a four-dot grid icon in the top-right header (distinct from the hamburger icon, which
opens a secondary utility menu — Home/Academy/Contest/FAQ/Status Page/Support/Language). Seven
items, each with its own icon, current section highlighted in the accent orange:

| Item | Icon | Route | Purpose |
|---|---|---|---|
| Trends | flame, "New" badge | `/trends` | Template gallery (see below) |
| Agents | robot | `/agent` | Persistent custom agents with memory/browsing/tool access |
| LLM Studio | sparkle | `/text` | Chat interface across providers |
| Image | image+sparkle | `/image` | Image generation |
| Video | clapperboard+sparkle | `/video` | Video generation |
| Audio | note+sparkle | `/audio` | Music/audio generation |
| Toolkit | pencil | `/tool` | Enhance/upscale/edit tools (not generation from scratch) |

This is a materially richer taxonomy than the marketing site's `Trends · Pricing · Tools · FAQ`
header — "Tools" on the marketing site collapses what the app actually splits into five distinct
top-level areas (Agents, LLM Studio, Image, Video, Audio) plus a sixth for post-processing
(Toolkit). Veyrnox Publish's own nav doesn't need this many top-level items, but the **split between
"create from scratch" and "edit/enhance existing"** (Image/Video/Audio vs. Toolkit) is a pattern
worth carrying into Veyrnox's own generation surfaces even outside Publish.

### Verified component patterns (transferable to Veyrnox's composer, not just Publish)

- **Two-tier model picker.** Every generation tool (`/text`, `/image`, `/video`, `/audio`) opens a
  provider dropdown (e.g. "ChatGPT") plus a model sub-dropdown (e.g. "GPT 6 Luna"), with a
  first-use inline tooltip ("Here you can choose the AI and its model. ✕"). A **"Model filter"**
  row above it lets the user filter the whole list by cost tier — `Free ∞ / Low ●○○ / Medium ●●○ /
  High ●●●` pill buttons with a dot-strength indicator, plus a `Reset` link. This is directly
  analogous to a "select network + select post type" step in Veyrnox Publish's composer, and the
  cost-tier filter is a pattern worth reusing for Veyrnox's own model picker generally.
- **Per-tool composer bottom bar**, consistent shape across Image/Video/Audio/Toolkit but with
  tool-specific option pills inline before the send button: attach (clip icon), aspect ratio pill
  (`9:16`), resolution pill (`1K` / `720`), duration pill (`5.0s`), settings gear, an "enhance
  prompt" sparkle icon, mic (voice input), and a **cost badge** (`25 ⚡`) directly on the send
  button showing the token cost of the current configuration before generating — cost is always
  visible, never a surprise at submit time.
- **Inline real-time validation** inside the picker itself, not just at submit: switching Kling to
  "Image to Video" mode immediately shows red text ("There should be 1 image in this mode") right
  under the mode dropdown. Veyrnox Publish's per-network validation (technical spec §2.4) should
  surface the same way — inline, at the point of the mismatched selection, not deferred to a
  submit-time toast.
- **"Select from uploaded / Select from the generated."** The Toolkit's image-editing tool
  (`/tool/image-inpaint/banana_inpaint`) offers a drag-and-drop upload zone plus two buttons:
  "Select from uploaded" and "Select from the generated" — i.e., pick from your own past output.
  This is the exact pattern Veyrnox Publish's composer already specifies for sourcing media
  (technical spec §2.2 `social_post_media.source_job_id`, user-flows §4.3's Generate→Schedule
  handoff) — seeing it live, shipped, in a directly comparable product is good validation that the
  pattern is right, not just theoretically sound.
- **Trend template modal.** Clicking a Trends grid card opens a full-bleed preview (image/video)
  with `Close ✕` top-left, a download icon and a primary **"✦ Use this template"** button bottom
  bar. "Use this template" presumably opens the composer pre-filled with that trend's prompt —
  structurally the same as Publish's own best-time-to-post chip pattern (§3.4 above): a
  recommendation surface that, on click, pre-fills the next step rather than just informing.
- **Account/profile page** (`/user/profile`): avatar + name + email, a `Subscription` card showing
  the current plan name and a `Buy subscription` CTA, a token balance with a lightning-bolt icon,
  a `Plan usage limits` card with **two progress bars** (Current session / Weekly) each showing
  "Not started" / "X% used" and a relative-time "Last updated" stamp with a manual refresh icon,
  a plan-benefits list, and a `Referrals` card (Partner Tokens balance, Available Funds balance,
  a copyable referral link). The session-vs-weekly dual rate-limit display is a pattern worth
  considering for Veyrnox's own rate-limited surfaces.
- **Pricing modal** (opened from `Buy subscription`, not a separate marketing page): a swipeable
  card carousel with dot pagination, an `Annual (-15%) / Monthly` toggle above the cards, and one
  card per tier showing plan name (display font), price, a token-count bar, a feature bullet list,
  and a `Buy subscription` CTA. Real, live (authenticated) monthly pricing observed 2026-09-28,
  **noted here for competitive awareness only — not to be copied into Veyrnox's own pricing**, and
  materially different from the logged-out marketing page's numbers seen earlier in this pack:

  | Plan | Price/mo | Tokens/mo |
  |---|---|---|
  | Basic | $9.41 | 260 |
  | Pro | $17.96 | 680 |
  | VIP | $43.61 | 1,700 |
  | Elite | $65.46 | 2,600 |
  | Ultra Elite | $125.40 | 3,000 |

- **Generation feed** (`/user/feed`, i.e. their Library): filter chips by media type
  (Text/Image/Video/Audio), a list/grid view toggle (two icon buttons, top-right), and an empty
  state (sparkle icon, "There's nothing here yet," a `+ Create` CTA) — directly comparable to
  Veyrnox's own existing Library and worth a straight comparison pass if Veyrnox's Library doesn't
  already have type filters and a view-density toggle.
- **Notifications panel**: a dropdown (not a full page) with `Mark all as read`, one card per
  update (thumbnail or icon, bold title, one-line description, date, trailing arrow), unread items
  marked with a small red dot rather than bold text or a background tint.
- **404 page**: on-brand rather than generic — big gradient background, oversized ghost-logo mark,
  "Error 404 / Page not found" in the display font, a row of quick-link pills to popular models, and
  a single `Home` button. Worth matching this level of polish on Veyrnox's own 404 rather than a
  bare error page.

### Theme note

The authenticated `/trends` page renders in a **dark theme** (near-black `#0D0908`-range background,
cream text) — a contrast with the light-cream theme everywhere else observed (marketing site, other
in-app tool pages, profile, pricing modal). This may be a deliberate "immersive gallery" treatment
specific to the trends/template browsing surface rather than a general dark-mode toggle; no
dark-mode switch was found in settings during this pass. Worth confirming with a longer session
before assuming it's the exception rather than evidence of a broader dark variant not yet found.
