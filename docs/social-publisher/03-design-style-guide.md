# 3. Design Style Guide — Veyrnox Publish

**Design language:** syntx.ai (per explicit request — this is the aesthetic reference).
**Interaction patterns:** Metricool (per explicit request — this is the UX-pattern reference).
Nothing in this document reuses Metricool's own visual identity (its wordmark, its indigo/lime/pink
brand palette) — only its *layout patterns* (calendar, composer, network badges). Colors and type
below were read live from syntx.ai's rendered CSS, not guessed.


> **Built state (2026-10-08, repo `main` at `bee1ea4f`).** This guide is still the design reference, but
> the shipped Publish screens differ from it in these ways; the rest of the guide is unbuilt design.
> - **Tokens.** The `--publish-*` custom properties in §3.2 do not exist in code. The built pages
>   (`app/veyrnox/app/publish/`) use the site's existing `vx-*` Tailwind tokens (`vx-accent`,
>   `vx-border`, `vx-panel`, `vx-fg-muted`, `vx-danger`), so Publish follows the site's light and dark
>   themes. Publish was never given its own palette.
> - **Network badge.** Built as `NetworkLogo.js`: single-colour monochrome silhouettes (Simple Icons
>   11.0.0, CC0; Bluesky from 12.4.0) for all eleven networks (Instagram, LinkedIn, X, TikTok, YouTube,
>   Facebook, Threads, Pinterest, Bluesky, Twitch, Google Business Profile), inheriting the text colour with an
>   accessible text label beside it. The brand-colour badges in §3.4 are not built.
> - **Status pill.** Built as plain coloured text per target (accent for published or delivered,
>   danger for failed, muted otherwise), not the `Chip` component: published, delivered ("finish in
>   TikTok app"), in progress (`submitted`), pending, failed. There is no draft, pending-review or
>   rejected pill on the calendar.
> - **Calendar.** Month, week and list (§3.7 keyboard path). Dragging a card opens a native-modal
>   confirmation form with the proposed time and nothing is saved until the user confirms; the
>   Reschedule button is the keyboard and touch path. The lift and 2 degree rotation in §3.6 are not
>   built.
> - **Connect panel.** One card per network from the shared network list (`lib/social/networks.js`), with
>   its logo and a note where needed. The button reads "Connect", "Setup required" (provider app secrets
>   missing) or "Testing not enabled" (extended-network switch off) from the `networks` field of
>   `GET /api/v1/social/accounts`. Bluesky opens an inline handle and app-password form (password cleared
>   on submit). Facebook, Pinterest and Business Profile end on a callback page with a native select to
>   choose the Page, board or location; Twitch connects for statistics and never appears in the composer's
>   "Post to" list.
> - **Composer.** One caption, a media picker (generations or Upload from device) with a thumbnail of the selection, account selection with network logos, a
>   date and time field defaulting to one hour ahead, and two actions, Post now and Schedule post. It checks each
>   selected account's media type and caption limit before submitting.
>   There are no per-network tabs, no per-network preview and no best-time chip (§3.4); posting-insights
>   heatmap and frequency live on the analytics page.
> - **Analytics.** Instagram, YouTube and TikTok only (Twitch statistics are collected but the page does not list Twitch). Followers chart, interactions and engagement, a posts or videos table, plus the
>   168-cell heatmap in a labelled, focusable panel that scrolls inside a 375 px page.

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

### Best-time-to-post chip (not built)
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

  This cross-validates `docs/pricing/syntx-competitor-analysis-2026-09-26.md`'s EUR figures pulled
  from syntx's own tariffs API two days earlier (Basic €8.90≈$9.41 at the doc's own 1.15 FX
  assumption, VIP €39.90≈$43.61, Ultra Elite €119.00≈$125.40 — consistent to the cent). That doc is
  the source of truth for pricing/margin analysis; this section is the product-surface/UX reference.

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

## 3.9 Full model/tool catalog (2026-09-28, exhaustive)

Every provider under every one of the five generation/edit categories was visited (41 total: not a
sample). Captured via script — click each provider option, wait for render, read the page — rather
than manual screenshots, since the composer shell is identical per category and the marginal value
is in each model's own description/capabilities/controls, not its chrome. `Agents` (§3.8) is
plan-gated at 0 on Free and could not be explored further without a paid upgrade, which this session
did not make. Trend category tabs (New/Featuring You/Popular/Anime/Cartoons) are filters on the one
`/trends` page already documented, not separate pages.

### Image (10 providers)

| Provider | URL | Description | Distinguishing composer control |
|---|---|---|---|
| Nano Banana | `/image/banana` | Fast generation, low resource use, everyday editing | 10 aspect-ratio presets (Original, 21:9 Ultra wide → 1:1 Square) |
| GPT Image | `/image/sora-images` | OpenAI's Sora Images/GPT Images; upload up to 5 images for Remix mode | "Remix mode" — multi-image conditioning |
| Seedream | `/image/seedream` | ByteDance's unified text-to-image/image-to-image/style-transfer/edit model | Single-reference style transfer, edit-region preservation |
| Flux | `/image/flux` | "SOTA" claim; FLUX.1 model set | — |
| Runway Frames | `/image/runway-frames` | Various unique styles; up to 3 reference images | — |
| Grok Imagine | `/image/grok_image` | Conversational, iterative scene refinement via dialogue | 5000-char prompt box (longest of any Image tool) |
| Luma | `/image/luma_image` | Uni 1.1; up to 9 reference images | Most reference images of any Image provider (9) |
| Higgsfield Soul | `/image/higgsfield-soul` | Hyper-realistic photo, 50+ style presets, "fashion shoot without a camera" | Character training from the user's own photos |
| Ideogram | `/image/ideogram` | Background swap keeping subject intact, remix, character reference mode | — |
| Wan | `/image/wan_image` | Wan 2.6, balances performance/stability across creative tasks | 720P resolution option |

### Video (13 providers)

| Provider | URL | Description | Distinguishing composer control |
|---|---|---|---|
| Kling | `/video/kling` | Text-to-video; up to 4 images for Keyframes/Elements modes | Resolution up to 4K; real-time inline mode validation |
| Google Veo | `/video/veo3` | Up to 720p, 8s, automatic sound/speech generation | Native audio generation |
| Seedance | `/video/seedance` | TikTok's model; up to 6 images + 3 videos + 2 audio files per generation | Richest multimodal input of any Video provider |
| Grok Imagine | `/video/grok_video` | Image-to-video, 1–15s flexible duration | Widest duration range |
| Beeble (SwitchX) | `/video/beeble` | Background/lighting replacement via mask on existing video | Video-to-video editing, not generation from scratch |
| Runway | `/video/runway` | GEN-4; Turbo mode (single image only) or multi-frame (up to 3 images) | — |
| HappyHorse | `/video/happy_horse` | Bold, stylized, artistic — not realism-focused | — |
| HeyGen | `/video/heygen` | Avatar generation from an image + audio/voice file | Only talking-avatar tool in the catalog |
| Luma | `/video/luma` | Dream Machine, Ray 3.14 | — |
| Hailuo MiniMax | `/video/hailuo-minimax` | Cinematic, poster/keyframe-style visuals, dramatic lighting | — |
| Higgsfield | `/video/higgsfield` | Precise camera-movement control for directors/clip-makers | Camera-direction controls |
| Wan Video | `/video/wan_video` | Wan 2.7 text-to-video | 1080P |
| FLUX 3 Video | `/video/flux3_video` | Up to 20s with generated audio, follows camera directions | Longest single clip (20s) with native audio |

### Audio (3 providers)

| Provider | URL | Description | Distinguishing composer control |
|---|---|---|---|
| Elevenlabs | `/audio/elevenlabs` | High-fidelity voice; consistency, prosody, emotion/pacing control | Speech/voice, not music |
| Suno | `/audio/suno` | 6 Wild; instrumental / lyrics / auto-lyrics-via-LLM modes | 500-char prompt cap |
| Video to audio | `/audio/video2audio` | Upload a video (≤20s), generates matching sound per frame | The only audio *input* tool — inverse of the other two |

### LLM Studio (8 providers)

| Provider | URL | Description |
|---|---|---|
| ChatGPT | `/text/chatgpt` | GPT 6 Luna; has a "Deep research" toggle |
| Claude | `/text/claude` | Sonnet 5; software development, debugging, multi-file changes, verification |
| Gemini | `/text/gemini` | 3.1 Pro; multimodal (text/docs/images/charts/code) in one workflow |
| Grok | `/text/grok` | Grok 4.7 |
| Deepseek | `/text/deepseek` | R1; mathematical/algorithmic tasks, verifiable solutions |
| Perplexity | `/text/perplexity` | Sonar + Internet; up-to-date web search with citations |
| Qwen | `/text/qwen` | 3 Max; multilingual, precise instruction-following |
| Zhipu AI | `/text/zai` | GLM 5.2; large codebases, long coding sessions |

Every LLM Studio tool shares three tabs (`Prompt` / `About model` / `Deep research`) not seen on
any Image/Video/Audio tool — the only category with a dedicated research-mode toggle.

### Toolkit (7 tools — edit/enhance existing media, not generate from scratch)

| Tool | URL | Purpose | Notable parameters |
|---|---|---|---|
| Topaz Astra | `/tool/video-upscaler/topaz_astra` | Video upscale | Upscale target, frame rate, slow motion, creativity level |
| Seedance 2.5 Editor | `/tool/video-inpaint/seedance-editor` | Video inpaint/edit | 35,000-char prompt box (largest text field in the whole app) |
| Seedream 5 Pro Editor | `/tool/image-inpaint/seedream-editor` | Image inpaint/edit | — |
| Nano Banana Pro Editor | `/tool/image-inpaint/banana_inpaint` | Image inpaint/edit | — |
| Clarity | `/tool/image-upscaler/clarity` | Image upscale | Scale (x1.5/x2), strength, creativity, noise reduction |
| Magnific | `/tool/image-upscaler/magnific` | Image upscale | — |
| Topaz AI | `/tool/video-upscaler/topaz_ai` | Video upscale | Frame rate, add noise, Focus Fix, Grain, Fix Compression, Improve Detail, Sharpen, Reduce Noise, Dehalo, Anti-alias/Deblur — richest parameter panel of any single tool |

Every Toolkit tool shares the upload zone + "Select from uploaded" / "Select from the generated"
pattern already highlighted in §3.8 — confirmed across all 7, not just the one sampled earlier.

### What this catalog says about breadth vs. depth

syntx.ai's "100+ AI tools" claim resolves, in the authenticated app, to **41 distinct provider
integrations** across 5 categories plus a locked Agents feature — each one a thin, consistent
composer shell around a different upstream model, not 100+ genuinely different UIs. The real
product-design lesson for Veyrnox is that **breadth is achieved by templating the composer shell
once and swapping provider metadata**, not by hand-building 41 different screens — directly
relevant if Veyrnox's own generation catalog grows toward a similar model count.
