# UI/UX Brief — Veyrnox.ai

**Status:** Current · 2026-09-21
**Source of truth:** the code. Tokens in `app/globals.css`, type in
`tailwind.config.js`, components in `app/veyrnox/_components/` and
`components/`. This brief records the language so new work extends it rather
than starting a second one.

## 1. Look and feel

A control room, not a toy. Near-black ground, one teal accent, one amber that
only ever means money. Flat surfaces and hairline borders; almost no shadow.
Dense monospaced metadata carries the character. Every click spends Credits,
so the interface reads as an instrument with honest numbers.

## 2. Colour

Space-separated RGB channels in `app/globals.css`, consumed through Tailwind
with `<alpha-value>`. **Never hard-code a colour.** Dark is the default; the
nav's theme toggle writes `data-theme="light"` on `<html>` and remembers it.

| token | dark | light | use |
|---|---|---|---|
| `--vx-base` | `10 10 11` | `255 255 255` | page ground |
| `--vx-panel` | `20 20 22` | `246 246 247` | cards, rails, modals |
| `--vx-border` | `38 38 42` | `220 220 224` | hairlines |
| `--vx-border-boost` | `62 62 68` | `168 168 176` | high-contrast borders |
| `--vx-fg` | `242 242 243` | `10 10 11` | headings |
| `--vx-fg-body` | `201 201 207` | `63 63 70` | body |
| `--vx-fg-muted` | `154 154 163` | `82 82 91` | labels, metadata |
| `--vx-fg-faint` | `130 130 137` | `107 107 115` | hints, disabled |
| `--vx-accent` | `62 230 196` | `11 122 102` | primary action, focus ring |
| `--vx-accent-hover` | `111 242 216` | `9 95 80` | accent hover |
| `--vx-accent-ink` | `6 35 31` | `255 255 255` | text on accent |
| `--vx-money` | `228 169 60` | `138 90 0` | Credit costs and balances **only** |
| `--vx-danger` | `255 92 71` | `196 36 26` | errors, destructive |

Rules:
- **Amber means Credits.** If a number is amber it is a quantity of money;
  nothing else is amber.
- **One accent.** A second accent colour is a regression.
- A new colour need becomes a token first, in both themes.
- `prefers-contrast: more` swaps borders and text up a step
  (`app/veyrnox/veyrnox.css`); every component must survive it.

## 3. Type

| role | face | Tailwind |
|---|---|---|
| body | Inter | `font-sans` |
| display, headings | Archivo (`--font-archivo`) | `font-vx` |
| metadata, costs, ids, labels | JetBrains Mono (`--font-jetbrains`) | `font-vx-mono` |

- Headings heavy, tight tracking (`-0.02em`), sentence case.
- Labels: mono, ~10px, uppercase, wide tracking — the signature. Every state
  label, Credit cost and model id uses it.
- Numbers that change (balance, cost, progress) are monospaced so they don't
  jitter.

## 4. Layout

- Max content width ~1500px; gutters 16px mobile, 32px from `sm`.
- Studio: canvas left, control rail right, one column below `lg`.
- Radii: `xl` 1rem, `2xl` 1.5rem, `3xl` 2rem — cards `2xl`, the primary
  button fully rounded.
- `/m/*` is a separate mobile prototype in an `IOSFrame`; the main app is
  responsive on its own and does not route phones there.

## 5. Components — reuse before building

`app/veyrnox/_components/`: `Button`, `Chip`, `BalancePill`, `ConfirmDialog`,
`CopyButton`, `PresetCard`, `NavBar`, `NavAuthButtons`, `MobileMenu`,
`SiteChrome`, `SiteSearch`, `ThemeToggle`, `TopUpPacks`, `TopUpHistory`,
`MfaPanel`, `Logo`, `IOSFrame`.
`components/`: `AuthGate` (the one sign-in modal), `Turnstile`,
`ToasterMount`.

A new surface starts from these. A new component is justified only when none
of them fits, and it uses tokens, not literals.

## 6. Motion

Restrained: 150–200ms ease-out on hover, focus and state change. Continuous
motion only for progress (job spinner, upload bar). Respect
`prefers-reduced-motion`.

## 7. Copy

Plain, specific, no exclamation marks. Say what happened and what to do next.

- Good: "That password has appeared in a data breach. Choose a different one."
- Bad: "Oops! Something went wrong 😔"

Never show a raw error code: `AuthGate` translates Supabase's messages
(`AUTH_ERROR_COPY`) and anything unmapped falls back to "That didn't work.
Try again." — so when a real failure shows the fallback, add a mapping
(see #197). Cost is always shown, in amber, in Credits, before the action
that spends it; currency appears only on the Credits page.

## 8. Accessibility

- 2px accent focus ring on every interactive element.
- The sign-in modal traps focus, closes on Escape, and returns focus to where
  it came from.
- Field hints are linked with `aria-describedby`; status messages sit in an
  always-mounted `aria-live` region.
- Contrast holds in both themes and under `prefers-contrast: more`.
- Nothing is conveyed by colour or motion alone.
