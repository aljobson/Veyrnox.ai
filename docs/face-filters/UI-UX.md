# UI/UX Brief — Face Filters

**Status:** Draft · 2026-09-18
**Reads with:** [APP-FLOW.md](APP-FLOW.md)

Veyrnox already has a design language. This brief records it so an agent extends
it instead of inventing a second one, then specifies only the new surfaces.

## 1. Look and feel

Dark-first control room. Near-black ground, one teal accent, one amber reserved
for money. Dense, monospaced metadata. Flat surfaces, hairline borders, almost
no shadow. Type does the work, not decoration.

The tone is instrument, not toy. A user is spending money on every click, so the
interface reads as a console with honest numbers — not a playful filter app.

## 2. Colour

Defined in `app/globals.css` as space-separated RGB channels consumed through
Tailwind with `<alpha-value>`. **Never hard-code a hex.** Both themes ship; the
dark set is the default.

| Token | Dark | Light | Use |
|-------|------|-------|-----|
| `--vx-base` | `10 10 11` | `255 255 255` | page ground |
| `--vx-panel` | `20 20 22` | `246 246 247` | cards, rails, drop zone |
| `--vx-border` | `38 38 42` | `220 220 224` | hairlines |
| `--vx-border-boost` | `62 62 68` | `168 168 176` | high-contrast mode |
| `--vx-fg` | `242 242 243` | `10 10 11` | headings |
| `--vx-fg-body` | `201 201 207` | `63 63 70` | body |
| `--vx-fg-muted` | `154 154 163` | `82 82 91` | labels, metadata |
| `--vx-fg-faint` | `130 130 137` | `107 107 115` | disabled |
| `--vx-accent` | `62 230 196` | `11 122 102` | primary action, focus ring |
| `--vx-accent-ink` | `6 35 31` | `255 255 255` | text on accent |
| `--vx-money` | `228 169 60` | `138 90 0` | credit costs and balances only |
| `--vx-danger` | `255 92 71` | `196 36 26` | errors, destructive |

Rules:

- Amber (`--vx-money`) means credits. It never decorates. If a number is amber,
  it is a quantity of money.
- Teal is the single accent. A second accent colour is a regression.
- Every new colour need is a token in `globals.css` first, in both themes.
- High-contrast mode swaps borders and text up one step — see the
  `prefers-contrast` block in `app/veyrnox/veyrnox.css`. Any new component must
  survive it.

## 3. Typography

- **Headings** — heavy weight, tight tracking (`-0.02em`), sentence case.
- **Body** — regular weight, muted foreground.
- **Metadata and labels** — `font-vx-mono`, ~10px, uppercase, wide tracking
  (`0.14em`), muted. This is the signature. Every state label, credit cost, and
  model id uses it.
- Numbers that change (balance, cost, progress) are monospaced so they do not
  jitter.

## 4. Layout

The Studio is a two-column grid: canvas on the left, a fixed 360px control rail
on the right, collapsing to a single column below `lg`. Filters do not change
this. The upload zone lives in the rail with every other control; the canvas
stays the output surface.

Maximum content width 1500px, gutters 16px on mobile and 32px from `sm`.

## 5. Components — reuse before building

Already in `app/veyrnox/_components/`: `Button`, `Chip`, `BalancePill`,
`ConfirmDialog`, `PresetCard`, `CopyButton`, `NavBar`, `ThemeToggle`.

New components, and only these:

### `ModeToggle`

Two segments, Generate / Transform. Sits above the model picker. Selected
segment carries the accent; unselected is muted on panel. Reads as one control,
not two buttons.

### `UploadZone`

States, all in one component:

- **Empty** — dashed `--vx-border`, centred monospace label `DROP IMAGE OR VIDEO`,
  below it the accepted types and size cap in `--vx-fg-faint`. Hover and
  drag-over raise the border to accent.
- **Uploading** — the thumbnail at reduced opacity with a thin accent progress
  bar across the bottom and a percentage in monospace. A cancel affordance.
- **Ready** — thumbnail filling the zone, filename and size in monospace
  underneath, a remove control in the corner.
- **Rejected** — `--vx-danger` border and the specific reason in plain words
  ("Over 20 MB", "HEIC not supported"), not an error code.

Keyboard: the zone is a button. Enter or Space opens the file picker. Drag and
drop is an enhancement, never the only route.

### `BeforeAfter`

The result view for a Transform job. Source and result side by side above `sm`,
stacked below, each labelled in monospace (`SOURCE` / `RESULT`). Deliberately
not a drag slider — a slider hides half the image at all times and is awkward on
touch. Both images visible at once is the honest comparison.

## 6. Motion

Restrained. 150–200ms ease-out on hover, focus, and state change. The only
continuous motion is the upload progress bar and the existing job spinner.
Respect `prefers-reduced-motion`: progress becomes a static percentage.

## 7. Screens

### Studio — Transform mode

Rail top to bottom: mode toggle · upload zone · model picker (filtered to
transform modalities) · model controls · cost row in amber · submit.

Canvas: empty state before submit shows the uploaded source at full size. During
the job, the source stays visible with a progress overlay — the user keeps
something to look at. On success it becomes the before/after.

### Library

Unchanged grid. A Transform card carries a small source thumbnail inset at the
corner of its result thumbnail, marking it as a transform without a badge or a
second colour.

## 8. Copy

Plain, specific, no exclamation marks. Say what happened and what to do.

- Good: "Over 20 MB. Try a smaller file."
- Bad: "Oops! Something went wrong 😔"

Never show a raw error code to a user. `inputs_invalid:image_url` becomes
"That file could not be read."

Cost is always stated before an action that spends it, in amber, in credits —
never in currency. Currency appears only on the Credits page.

## 9. Accessibility

- Focus ring is a 2px accent outline, present on every interactive element.
- The drop zone is reachable and operable by keyboard alone.
- Every image has alt text; the before/after pair is labelled.
- Contrast holds in both themes and under `prefers-contrast: more`.
- Progress and job state changes are announced to assistive technology, not
  conveyed by colour or motion alone.
