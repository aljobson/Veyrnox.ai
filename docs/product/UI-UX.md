# UI/UX Brief — Veyrnox.ai

**Status:** Current · 2026-10-02 (audited against `main` at `2da81dc`, after
the receipt redesign #404 and the slip tilt #406)
**Source of truth:** the code. Tokens in `app/globals.css` and
`app/veyrnox/veyrnox.css`, Tailwind mapping in `tailwind.config.js`, fonts in
`app/layout.js` + `app/veyrnox/layout.js`, components in
`app/veyrnox/_components/`, page sections in `app/veyrnox/_sections/`.
This brief records the language so new work extends it instead of starting a
second one. Known gaps are listed in [ISSUES.md](ISSUES.md) §UI.

## 1. Look and feel

Two materials on one near-black ground:

- **The control room** — flat panels, hairline borders, one teal accent,
  dense monospaced figures. The Studio, Account, Publish, Cinema and admin
  screens.
- **The receipt** — cool thermal-paper slips (`.vx-paper`) with torn edges,
  perforations and dotted leaders, printed out of a slot. Used where money is
  stated: the landing hero, `/pricing`, `/app/credits`, the credit statement,
  the 404. The idea: every generation has an exact price, so the price looks
  like a till receipt.

Every click spends Credits, so the interface reads as an instrument with
honest numbers. No illustration, no gradients-as-decoration, no emoji.

## 2. Colour

Tokens are space-separated RGB channels, consumed through Tailwind as
`rgb(var(--vx-*) / <alpha-value>)`. **Never hard-code a colour.** Dark is the
default; `ThemeToggle` writes `data-theme="light"` on `<html>` and remembers
it. There is no automatic `prefers-color-scheme` switch.

| token | dark | light | paper (`.vx-paper`) | use |
|---|---|---|---|---|
| `--vx-base` | `10 10 11` | `255 255 255` | `255 255 255` | page ground |
| `--vx-panel` | `20 20 22` | `246 246 247` | `236 240 238` | cards, rails, the slip itself |
| `--vx-border` | `38 38 42` | `220 220 224` | `196 204 200` | hairlines |
| `--vx-border-boost` | `62 62 68` | `168 168 176` | `150 160 155` | high-contrast borders (CSS only, no Tailwind key) |
| `--vx-fg` | `242 242 243` | `10 10 11` | `16 22 20` | headings, ink rules, ink-pill CTA |
| `--vx-fg-body` | `201 201 207` | `63 63 70` | `52 61 57` | body |
| `--vx-fg-muted` | `154 154 163` | `82 82 91` | `78 88 84` | labels, metadata |
| `--vx-fg-faint` | `130 130 137` | `107 107 115` | `104 114 110` | hints, disabled |
| `--vx-accent` | `62 230 196` | `11 122 102` | light value | primary action, focus ring, refunds/credits-in |
| `--vx-accent-hover` | `111 242 216` | `9 95 80` | light value | accent hover |
| `--vx-accent-ink` | `6 35 31` | `255 255 255` | `255 255 255` | text on accent |
| `--vx-money` | `228 169 60` | `138 90 0` | light value | Credit costs and balances |
| `--vx-money-ink` | `35 23 3` | `255 255 255` | `255 255 255` | text on money fills |
| `--vx-danger` | `255 92 71` | `196 36 26` | *not overridden* | errors, destructive |

`.vx-paper` adds **no new token names**: it re-points the 15 tokens inside the
slip and sets `color-scheme: light`, so any component works on paper
unchanged. `@media print` re-points them again for paper output.

Rules:
- **Amber means Credits.** A number in amber is a quantity of Credits. The
  only non-number use allowed is the "premium" tag on a premium-priced model,
  because it is a price signal. Nothing else is amber — see ISSUES.md §UI for
  the current violations.
- **One accent hue.** Teal is the only chromatic accent. The ink pill
  (`bg-vx-fg text-vx-base`) is the marketing primary CTA and inverted
  selected state; it is a neutral, not a second accent.
- A new colour need becomes a token first, in dark, light and paper.
- `prefers-contrast: more` swaps borders and text up a step;
  `forced-colors: active` keeps accent and money fills. Every component
  survives both.

## 3. Type

All three faces are self-hosted with `next/font/local` (`app/fonts/*.woff2`,
OFL) — no Google Fonts request.

| role | face | how |
|---|---|---|
| body and UI on every Veyrnox page | Archivo | `.vx-root` applies `font-vx` |
| display headings | Archivo 900 | `.vx-display`: line-height .94, tracking −0.04em, `text-wrap: balance` |
| figures, ids, slip lines, Studio micro-labels | JetBrains Mono | `font-vx-mono`; `.vx-num` for tabular numerals |
| fallback outside `.vx-root` | Inter (loaded, effectively unused) | see ISSUES.md §UI |

Scale is set per section, not tokenised:

| role | size |
|---|---|
| landing hero h1 | 52 / 76 / 92 px (base / sm / lg) |
| pricing, presets h1 | 52 / 80 / 104 |
| closing CTA | 52 / 84 / 112 |
| section h2 | 40 / 56 |
| app h1 (Explore, Library, Credits) | 40 / 56, `.vx-display` |
| Studio, Account, Publish, admin h1 | `text-2xl`–`text-3xl font-black` |
| lead paragraph | 18–20 px, `fg-body`, leading 1.5 |
| slip lines | mono 13–13.5 px |
| balance figure | mono 56 / 72 px, amber |

Labels: on public and money screens, **sentence-case Archivo 13–14 px
semibold**. Mono uppercase micro-labels (9–11 px, tracking .1–.14em) remain
in the Studio and admin only. Numbers that change are mono so they don't
jitter.

## 4. Layout

Tailwind default breakpoints (sm 640, md 768, lg 1024, xl 1280).

| surface | max width | gutters |
|---|---|---|
| marketing (landing, pricing, presets, legal, 404) | 1300 px | 16 / 24 px |
| Explore, Library | 1400 px | 16 / 32 px |
| Studio | 1500 px | 16 / 32 px |
| Credits | 1200 px | — |
| Account, Publish | 900 px | — |
| Cinema | 1000–1100 px | — |
| legal text column | 68ch | — |

- Marketing rhythm: sections `pt-28 sm:pt-36`.
- Grids: hero `lg:[1.1fr_0.9fr]`; Studio `lg:[minmax(0,1fr)_360px]` (canvas
  left, rail right, one column below lg); Credits `md:[1fr_340px]`.
- Nav: sticky, 64 px, `bg-vx-base/90` + backdrop blur; anchors get
  `scroll-margin-top: 5rem`.
- Radii: pills and buttons `rounded-full`; cards and panels `rounded-2xl`
  (1.5rem); pack radios and the slip button `rounded-xl` (1rem); inputs
  `rounded-lg`. **Paper is never rounded** — it has torn edges
  (`--vx-tooth: 14px` conic mask).
- Rules: `border-t-2 border-vx-fg` ink rule above lists; hairline
  `border-b border-vx-border` between rows; dashed border for empty states.
- Depth: flat by default. The only shadows are the paper drop-shadow
  (`.vx-paper-shadow`) and the printer slot's inset (`.vx-slot`).
- `/m/*` is a separate mobile prototype inside `IOSFrame`; the main app is
  responsive on its own and never routes phones there.

## 5. Components — reuse before building

**`app/veyrnox/_components/`**

| component | purpose |
|---|---|
| `Button` | pill button: primary, money, ghost, danger; optional mono `−N cr` cost |
| `Chip` | mono micro-label with a glyph per tone (✓ ◆ ✕ ★ △) so colour is never alone |
| `Modal`, `ConfirmDialog` | native `<dialog>` with focus containment and return; destructive confirm |
| `PriceSlip` | landing hero working form on paper: prompt, model chips, length toggle, price and refund lines; hands off to Studio via `_lib/landingDraft.js` |
| `PresetGallery`, `PresetCard` | category filter + grid shared by `/presets` and `/app`; card shows leader + amber `N cr` |
| `MediaTile` | image/video tile with hover/touch/reduced-motion playback policy |
| `CreditStatement` | the user's ledger as a receipt list |
| `TopUpPacks`, `TopUpHistory` | pack chooser with supply consent (exports `TopUpReturn`); purchase history |
| `NavBar` (`MarketingNav`, `AppNav`), `NavAuthButtons`, `MobileMenu`, `Logo`, `ThemeToggle`, `SiteSearch`, `SiteChrome` | chrome |
| `BalancePill` | amber balance with tick-up; now used only in `/m/*` |
| `CopyButton` | copy a model id with aria-live confirmation |
| `MfaPanel`, `AccountBoundary` | TOTP enrolment; remount on identity change |
| `JobWatcher`, `JobAssetPreview`, `AssetLoadStatus`, `AssetRetention` | job polling, output preview, load/error state, retention notice |
| `SourcePickers`, `CameraPanel`, `CharacterPanel`, `DrawOnImage` | Studio inputs |
| `EditSheet` | Clip Editor sheet in the Library |
| `IOSFrame` | bezel for `/m/*` |

**`app/veyrnox/_sections/`** — landing blocks: `hero.js` (`Hero`,
`FeaturedHeroCards`), `showcase.js` (`PresetWall`, `ModelShelf`),
`footer.js` (`LedgerExample`, `FAQBlock`, `ClosingCTA`, `FooterForest`).

**`components/`** — `AuthGate` (the one sign-in modal), `Turnstile`,
`ParticleButton` (Studio Generate), `ToasterMount`.

A new surface starts from these. A new component is justified only when none
fits, and it uses tokens, not literals.

## 6. Motion

One easing: `--vx-ease-out: cubic-bezier(0.23, 1, 0.32, 1)`.

| class | spec | use |
|---|---|---|
| `.vx-press` | transform 140 ms; colours 160 ms; `:active` scale .97 | every pressable |
| `.vx-tile` | 200 ms; hover 1.015 only on fine pointers; active .98 | tiles, preset cards |
| `.vx-rise` | 300 ms, stagger `--vx-i × 50 ms` | hero feature cards |
| `.vx-print` | 900 ms `cubic-bezier(.32,.72,0,1)`, 150 ms delay; clip-path reveal from the slot plus `rotateX(7deg → 2deg → 0)` pivoted at the top edge | PriceSlip only — the one authored entrance |
| `.vx-tick` | 220 ms rise + unblur, re-keyed on change | prices on the slip |
| `.vx-shimmer` | 1.6 s linear loop | progress only (generating, loading) |
| `.vx-particle` | 0.6 s | Studio Generate burst |

Rules: continuous motion only for progress. `prefers-reduced-motion` kills
all animation and transition under `.vx-root` and disables smooth scroll;
JS-driven motion (`MediaTile`, back-to-top) checks `matchMedia` itself.
Print disables all motion and shadow.

## 7. Screens

| screen | layout |
|---|---|
| `/` landing | nav → hero (display h1 "The price is on the button." + ink-pill "Claim 10 credits" + "See every price" link; PriceSlip printing on the right) → 5 featured tiles → preset bento wall → `ModelShelf` price list with leaders → `LedgerExample` statement on paper → FAQ → closing CTA → footer |
| `/pricing` | display h1; Credit Packs as paper slips (amber mono credits, perforation, "N credits — $X + applicable tax"); per-kind model price tables with copyable ids |
| `/presets`, `/app` Explore | display h1 + `PresetGallery` (3 / 4 columns) |
| `/app/create` Studio | control room: canvas left with shimmer while generating; 360 px rail of panels (model list with amber costs, prompt, sources, duration, aspect); TOTAL COST in 36 px amber; `ParticleButton` |
| `/app/library` | display h1; sentence-case inverted filter pills; 1/2/3-column cards; dashed empty state → "Open the studio"; fixed selection bar; `EditSheet` |
| `/app/credits` | "Your balance" as a paper slip (72 px amber figure, free-credit and expiry leaders); billing explainer; `TopUpPacks`; `CreditStatement`; `TopUpHistory`; recent generations table |
| `/app/account` | 900 px column of bordered sections: 2FA, password, devices, data export/delete |
| `/app/publish` | 900 px: connected accounts grid, composer, scheduled posts |
| Cinema (`/social-cinema`, `/title/[id]`, `/watch/[id]`, `/pass`, `/creator`) | 1000–1100 px; mono accent kicker, large black h1, `Button`, aria-live notices; player page |
| `/app/admin/*` | danger chip "ADMIN · OPS"; metric tiles; scrolling mono tables |
| legal, 404 | display h1; legal 68ch with ink rule; 404 is a "voided slip" with leader links |

Not yet in the receipt language: Studio, Account, Publish, Cinema, admin,
`/design-system`, `loading.js`. Bringing them across is optional; mixing
the two materials *within* one screen is not.

## 8. Copy

Plain, specific, no exclamation marks. Say what happened and what to do next.

- Good: "That password has appeared in a data breach. Choose a different one."
- Bad: "Oops! Something went wrong 😔"

`AuthGate` translates Supabase messages (`AUTH_ERROR_COPY`); anything
unmapped falls back to "That didn't work. Try again." — when a real failure
shows the fallback, add a mapping. **Cost is shown in Credits before every
action that spends it.** Dollar amounts appear only where money changes hands:
Credit Packs (`/pricing`, `/app/credits`) and subscriptions (Cinema Pass,
Publish Plan). The model provider is never named to the user.

## 9. Accessibility

- 2 px accent `:focus-visible` ring, offset 2 px; text inputs use an accent
  border instead.
- Skip link `.vx-skip` → `<main id="main" tabIndex={-1}>` in `app/layout.js`.
  Pages must not render a second `<main>`.
- The sign-in modal and `Modal` trap focus, close on Escape, and return focus.
- Live regions: PriceSlip price (sr-only), PresetGallery count, CopyButton,
  TopUpPacks, AuthGate, Cinema notices. Toggles use `aria-pressed`.
- Leaders and perforations are `aria-hidden`; pricing tables carry an sr-only
  header row.
- Contrast holds in dark, light, paper and `prefers-contrast: more`.
- Nothing is conveyed by colour or motion alone (Chip glyphs).
