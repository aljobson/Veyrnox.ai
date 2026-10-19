# UI/UX brief: Veyrnox.ai mobile app

**Status:** Proposed 2026-10-19. Tokens are copied from `apps/mobile/src/theme.ts` on `main` at `4768d535`, which records the web's `--vx-*` palette as hex. Screen shapes are the wireframes in the journey artifact.
**Reads with:** [APP-FLOW.md](APP-FLOW.md), [PRD.md](PRD.md), ADR-0133.

The product already has a design language (control room with receipt paper, in `docs/product/UI-UX.md`). This brief records what the phone inherits and what is new, so the app extends it and does not start a second one.

## 1. Tokens (dark, the only theme today)

| Token | Hex | Use |
|-------|-----|-----|
| `background` | `#0a0a0b` | Screens |
| `surface` | `#141416` | Cards, rows, inputs |
| `border` / `borderStrong` | `#26262a` / `#3e3e44` | Dividers, outlines |
| `text` / `body` / `muted` | `#f2f2f3` / `#c9c9cf` / `#9a9aa3` | Type hierarchy |
| `accent` / `accentInk` | `#3ee6c4` / `#06231f` | Primary actions and the active tab; text on accent |
| `money` | `#e4a93c` | Credits and prices only |
| `danger` | `#ff5c47` | Errors and destructive actions |

`userInterfaceStyle` is `dark`. The web has a light theme (`rgb(11 122 102)` accent); whether the app needs one is an open question in the PRD. Do not add one slice by slice.

Rule: amber means money. Nothing else is amber. Semantic status (built, partial, missing in planning documents) is separate from the accent.

## 2. Type

The web uses IBM Plex Sans and Plex Mono. Which faces the app loads is not verified; read `src/theme.ts` and the layout before assuming system fonts. Keep one scale across screens: 48 for the balance figure, 16 for body and buttons, 14 for labels and secondary text. Uppercase labels take letter spacing. Respect Dynamic Type: nothing clips or becomes unreachable at the largest size (ADR-0133).

## 3. Components that exist

`HeaderAction`, `OfflineBanner`, `StaleNote`, `SourcePicker`, `WhenPicker`, `FreeAllowanceCard`, `AiConsentHost` (a sheet), `Logo`, and for Cinema `CinemaPlayer` and `TitleCard`. Reuse these; do not fork them.

## 4. New components

| Component | Spec |
|-----------|------|
| Tab bar | Five tabs: Explore, Cinema, Create (centre, filled accent circle), Library, Publish. Icon over a short uppercase label. Active tab uses `accent`; others `muted`. 44 pt minimum target. Hidden during full-screen playback |
| Credits chip | In every tab header: `money` colour, tabular figures, opens Buy credits and Credit history. Shows a placeholder, not a stale number, while loading |
| Avatar | Opens Account. A neutral circle until a profile image exists |
| Vey mascot | A floating circular button on every signed-in screen; opens chat as a sheet; can be moved to the other side as on the web (`lib/veyPlacement`). Never covers the tab bar, keyboard, player controls, the composer's primary action, or Cinema comments. Hides while a video plays full screen |
| Intro cards | Three full-width cards with a looping preview, a dot indicator and Skip. One idea per card |
| Preset grid | Two columns, category chips above, the web's preset catalogue (`GET /api/presets`), price visible on each card |
| Next-step buttons | On the result screen: Edit, Publish, Make another as full-width buttons above Save and Share |
| Empty state | A sentence and one button; never a blank screen |

## 5. Screen shapes

- **Explore (home):** header (logo, Credits chip, avatar); a prompt box; category chips; the preset grid; the Oddlings banner; a "Pick up where you left off" row when something is unfinished.
- **Create:** model or template picker, price, prompt, source slots; the consent sheet on first send.
- **Result:** the media, next-step buttons, then Save and Share, then Report and Delete.
- **Cinema:** a vertical, paged feed; one active player; a title page with comments, report and block.
- **Publish:** plan paywall until subscribed; then accounts, compose, posts, calendar, analytics as segments.

## 6. Copy rules

- Name things as the person does: "Credits", not "ledger"; "Make", not "generate job".
- Controls say what happens: "Publish", then a confirmation that says "Published".
- Errors say what went wrong and what to do; no vendor payloads.
- New strings go through the translation key list; no wallet, chain or payout words anywhere.
- Prices and renewal terms follow ADR-0109 (price, period, auto-renew, cancel, Restore, Terms and Privacy).

## 7. Motion

Transitions under 250 ms; no motion that delays a paid action; honour Reduce Motion (cross-fade instead of slide, no looping previews on intro cards). The mascot idles with a single subtle movement, not a loop that competes with content.

## 8. Accessibility floor

44 pt targets on every control; a label and role on every interactive element; state announced on selectable rows; a live region for job status and streaming chat text; contrast of every token pair checked in the largest text size; VoiceOver and TalkBack read the sign-in, Create and Account flows. This is the bar from ADR-0133.
