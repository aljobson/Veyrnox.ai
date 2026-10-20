# UI/UX Brief — Face Filters

**Status:** Updated 2026-10-20 against local `origin/main` at `4ccfbd2a1d4b39c8e20db9a0c5269ddab8f908bd`; the Face Filters sources are identical in this checkout (`cf1573bf`). Activation is **merged; production application not verified from the repo**.
**Reads with:** [APP-FLOW.md](APP-FLOW.md)

*Status 2026-10-08: the three new components below (`ModeToggle`, `UploadZone`, `BeforeAfter`) are not built; no such file exists under `app/`. The Studio's own upload field, `SourcePickers`, plays the `UploadZone` role in a simpler form. The colour table is still right except that a thirteenth token, `--vx-warn` (blue, for warnings and notices; amber stays Credits only), was added after the audit. Palette values below were not re-measured.*

Veyrnox already has a design language. This brief records it so an agent extends
it instead of inventing a second one, then specifies only the new surfaces.

**Current catalog state (2026-10-20, `4ccfbd2a`):** 0356 stages A1-A5;
0357 activates A1 `face-retouch`, A2 `face-enhance`, A4 `face-makeup` and A5
`face-age`, each at 3 credits / $0.0400 recorded provider cost. A3 `face-relight`
stays inactive at 7 credits / $0.1000: the unpinned probe billed 2 MP ($0.20);
a run with the pinned 1000×1000 canvas is still required. A6 is not staged;
A7/A8 are absent and blocked by PRD §6. These are migration states, not a
production read. The web uses Studio models and the per-slot `SourcePickers`
upload field; **a Transform mode does not exist**. Web and phone Tools entries
come from the active catalog. The dedicated phone flow is
[planned until the build PR merges](../mobile/spec/FACE-FILTERS.md).

**Upload admission:** `lib/uploadAdmission.js` has no enrolled matching provider.
`UPLOAD_HASH_MATCH_REQUIRED` is absent from the production vars in the checked-in
`wrangler.jsonc` (default off), while `UPLOAD_INTEGRITY_ENABLED` and
`UPLOAD_REQUEST_RATE_LIMIT_ENABLED` are `"true"`. These are repository settings,
not verified deployed values. Requiring hash matching now fails closed:
`upload_admission_unavailable` at upload issuance, `source_not_admitted` when
resolving an uploaded source for a generation. This seam is not a scanner and
catalog activation does not establish that the public-upload admission gate is met.

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

*2026-10-08: the folder has grown (`SourcePickers`, `LibraryPicker`, `PriceSlip`, `EditSheet`, `JobAssetPreview`, among others). Check it before building any of the three below.*

The following are the original proposed components, **not shipped UI**.
Current web filters use Studio models and its per-slot `SourcePickers` upload
field, not a Transform mode. The Face filters Tools entries do not establish
that dedicated selector or comparison controls exist.

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
touch. Both images visible at once is the proposed comparison.

The [phone specification](../mobile/spec/FACE-FILTERS.md) scopes comparison to a
temporary local original in the immediate result view; Library/restart views
show output only. Actions are “Open in Library” and optional “Save to Photos”,
not a second Library-save request. Persistent source thumbnails are unresolved.

## 6. Motion

Restrained. 150–200ms ease-out on hover, focus, and state change. The only
continuous motion is the upload progress bar and the existing job spinner.
Respect `prefers-reduced-motion`: progress becomes a static percentage.

## 7. Screens

### Studio — Transform mode *(unbuilt proposal)*

Rail top to bottom: mode toggle · upload zone · model picker (filtered to
transform modalities) · model controls · cost row in amber · submit.

Canvas: empty state before submit shows the uploaded source at full size. During
the job, the source stays visible with a progress overlay — the user keeps
something to look at. On success it becomes the before/after.

### Library

Current behaviour: stored outputs appear automatically; no additional save
request is required. Originals are not returned by job/asset reads. The source
thumbnail below remains an unbuilt proposal requiring a retention/API decision.

Proposed grid: a Transform card carries a small source thumbnail inset at the
corner of its result thumbnail, marking it as a transform without a badge or a
second colour.

## 8. Copy

Plain, specific, no exclamation marks. Say what happened and what to do.

- Good: "Over 20 MB. Try a smaller file."
- Bad: "Oops! Something went wrong 😔"

Describe only the active A1/A2/A4/A5 set; do not promise A3 or video filters.
Show the rights attestation matching `aup-2026-09-26` before sending
`consent: true`; the server supplies that version, not a client field.
Upload admission unavailable means the upload cannot proceed; do not suggest
a bypass. Provider moderation/refusal copy must not imply guaranteed acceptance
on retry. Refund copy requires `refunded: true`, not merely a failed job.

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
