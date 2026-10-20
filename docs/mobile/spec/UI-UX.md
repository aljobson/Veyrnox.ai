# UI/UX brief: Veyrnox.ai mobile app

**Status:** Source refresh 2026-10-20 against local `origin/main` at `b5bdc1081bbc5876f0852dd7be9628d4ba5da154`; live deployment and device behaviour not verified.

**Evidence boundary:** Source and local merge history were read at that pinned revision. `gh pr list --state merged --limit 200` and the open-PR query could not connect to GitHub; remote freshness and what is currently in review are **not verified**. Paths beginning `src/` are relative to `apps/mobile/`; other repository paths are relative to the checkout. Configuration states are source values, not a live environment inspection; see [TRD section 3](TRD.md#3-configuration-and-flags).
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

The web uses IBM Plex Sans and Plex Mono. The phone theme currently declares colours only; a custom font loader is not established here, so actual device font rendering is **not verified**. Keep one scale across screens: 48 for the balance figure, 16 for body and buttons, 14 for labels and secondary text. Uppercase labels take letter spacing. Respect Dynamic Type: nothing clips or becomes unreachable at the largest size (ADR-0133).

## 3. Components that exist

`HeaderAction`, `OfflineBanner`, `StaleNote`, `SourcePicker`, `WhenPicker`, `FreeAllowanceCard`, `AiConsentHost`, `Logo`, `CinemaPlayer` and `TitleCard` remain. `HeaderChips`, `VeyMascot`, `CameraPanel` and `CharacterPanel` are also implemented under `src/components/`. The tab layout, welcome cards, result actions and empty/low-balance states now exist; reuse the current components.

## 4. New components

The table retains the original design brief. Current source differs where noted; these rows are not blanket completion claims.

| Component | Spec |
|-----------|------|
| Tab bar | Built with text-only tabs in order Explore, Create, Cinema, Library, Publish (`src/app/(app)/(tabs)/_layout.tsx`), `accent`/`muted`, 44 pt minimum. Centre-circle/icons remain design intent; stack playback is above tabs |
| Credits chip | Built in `HeaderChips.tsx`, with balance and Credits entry; current text uses `accent`, while money-coloured text remains the design brief. Device loading and number-format appearance **not verified** |
| Avatar | Opens Account. A neutral circle until a profile image exists |
| Vey mascot | Animated `VeyMascot` with placement support (`src/lib/veyPlacement.ts`) and sheet entry on four tabs. The layout excludes Cinema and does not install it on stack screens. Collision-free keyboard/large-text behaviour **not verified** on a device |
| Intro cards | Built welcome has three cards (hello, credits, start), step text and Skip; mascot introduction, no claimed looping media preview. Seen flag persists locally |
| Preset grid | Explore prompt collage has type/category/search and masonry-style cards; catalogue data comes from `GET /api/presets`. Real catalogue coverage **not verified** |
| Next-step buttons | Built output-appropriate actions via `src/lib/nextSteps.ts`; unsupported actions are omitted |
| Empty state | Built empty states and low-balance card (ADR-0191/0220); a complete device audit remains **not verified** |

## 5. Screen shapes

- **Explore (home):** header (logo, Credits chip, avatar); a prompt box; category chips; the preset grid; the Oddlings banner; a "Pick up where you left off" row when something is unfinished.
- **Create:** model/template picker, Library/device input, price/balance, supported options including resolution/audio, Character and camera prompt controls, consent on first send. Main adds explanatory text while the two controls are off (#1436). Draw mask remains unbuilt.
- **Result:** the media, next-step buttons, then Save and Share, then Report and Delete.
- **Cinema:** browse/category/social/profile surfaces, Saved/Following, locked entitlement states and read-only Pass; title/player/comments/report/block. Creator Upload is a Continue on web card. Continue watching phone UI is not built.
- **Publish:** plan entry and links to native accounts/composer, calendar, analytics, queues/autolists, contacts, reports, SmartLink, team, developer and ad/product screens. Inbox is read-only. Schedule is the pinned-main composer default (#1438).
- **Oddlings:** gallery, character sheets, builder, saved characters, animated preview and Create handoff.
- **Film Studio:** import/remove the web JSON copy; seven-stage summary, shot details and eligible Create handoff. Editing remains on the web; no server project browser exists.

## 6. Copy rules

- Name things as the person does: "Credits", not "ledger"; "Make", not "generate job".
- Controls say what happens: "Publish", then a confirmation that says "Published".
- Errors say what went wrong and what to do; no vendor payloads.
- New strings go through the translation key list; no wallet, chain or payout words anywhere.
- Prices and renewal terms follow ADR-0109 (price, period, auto-renew, cancel, Restore, Terms and Privacy).

## 7. Motion

Design requirements, not measured acceptance: transitions under 250 ms; no motion that delays a paid action; honour Reduce Motion (cross-fade instead of slide, no looping previews on intro cards). The mascot idles with a single subtle movement, not a loop that competes with content.

## 8. Accessibility floor

Acceptance floor, not a completed device audit: 44 pt targets on every control; a label and role on every interactive element; state announced on selectable rows; a live region for job status and streaming chat text; contrast of every token pair checked in the largest text size; VoiceOver and TalkBack read the sign-in, Create and Account flows. This is the bar from ADR-0133.
