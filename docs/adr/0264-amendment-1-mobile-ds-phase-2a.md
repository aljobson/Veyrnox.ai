# ADR-0264 amendment 1: Mobile design system phase 2a, the creation path

Date: 2026-10-27
Status: Implemented; checked on the iOS simulator in light mode. Dark, OLED and Android not yet checked on a device.

Phase 2a moves the screens a new user reaches after onboarding onto the ADR-0264 tokens and primitives. It is
presentation only and is built on ADR-0265 (Vey is not a chat bot), which removed the floating Vey and its padding.

## Presentation migration

The five migrated routes under `apps/mobile/src/app/(app)` are
`(tabs)/create.tsx`, `create/[modelId].tsx`, `job/[id].tsx`,
`(tabs)/library.tsx`, and `credits.tsx`.

The thirteen migrated components under `apps/mobile/src/components` are
`FreeAllowanceCard`, `CameraPanel`, `CharacterPanel`, `CreateOptions`,
`AttachFromDevice`, `SourcePicker`, `TemplateBanner`, `VeyCardPeek`,
`JobProvenance`, `StemList`, `LibraryItem`, `StaleNote`, and `EmptyState`.

Module-scope themed sheets replace legacy static palettes and typography.
Text uses ramp variants; credit and price displays use warning color and tabular
figures. Create's modality tabs use SegmentedControl; option/tier filters use
Chip, fields use TextField, rights use Checkbox, actions use Button, and rows
use Card/ListRow. Generate and the subscription continuation are primary;
pack purchases and supporting actions remain secondary or tertiary. Pack
purchases still execute immediately, and subscription visibility is unchanged.

Library kinds use image/video/audio assets, favourites use star/starFill,
source ordering uses arrowUp/arrowDown, and stem actions use play/externalLink.
Expanded disclosures use caretDown/caretRight. Existing accessible labels and
selected/checked states are retained.

`components/create/FormHeader.tsx` extracts the model form's header and stage.
`components/create/SectionLabel.tsx` renders historical uppercase section keys
in sentence case with secondary footnote text. The two Create eyebrow elements
are removed. No translation keys or registry entries are changed.

## Backward-compatible primitive extensions

- Text: warning tone, including tabular figures.
- Button: icon-only rendering with an accessible label, rich children for pack
  purchase rows, outer container layout, caller hit slop, and preservation of
  explicitly supplied busy state. Existing defaults remain in place.
- Card: optional press handler and disabled prop, retaining its static View
  behavior by default and the original custom-style precedence.
- Chip: forwards native pressable accessibility/test/disabled props.
- SegmentedControl: per-option accessible labels and icons, plus container props.
- Checkbox: preserves supplied accessibility state alongside checked state and
  combines its minimum target size with caller styles.
- ListRow: rich title/subtitle and optional trailing content, caller styles and
  accessibility role. Its default trailing chevron remains unchanged.
- TextField: outer container style for a field beside an action. Multiline,
  keyboard type, length limits and trailing content were already supported.

`creationPrimitivesV2.test.tsx` exercises these extensions, action callbacks and
disabled gates, and light/dark/OLED price and selected-card styling.

## Guard and existing presentation tests

`designSystemV2.test.ts` includes all eighteen migrated files, both extracted
components and the UI directory. It rejects heavy font weights and parsed JSX,
string and template text containing the prohibited symbol ranges, including
escaped string literals. Regression fixtures retain ordinary punctuation.
Comments are not rendered icons. No phase-1 source file required correction.

Two existing presentation assertions change:

- `createWebParity.test.ts`: checks the extracted header/stage and removal of
  the eyebrow; submission, draft and option assertions remain.
- `dashboardParity.test.ts`: checks useAppearance/useThemedStyles and the
  resolved StatusBar scheme instead of removed legacy palette imports.

## Preserved behavior and deviations

Generation pricing, gating, submission, drafts, uploads, navigation, cancellation,
polling, billing purchase/restore/manage calls and their visibility conditions
remain unchanged. Store priceString and renewal terms remain authoritative.
Generation pricing, gating, submission, drafts, uploads, navigation, cancellation, polling, billing
purchase/restore/manage calls and their visibility conditions remain unchanged. Store priceString and renewal terms
remain authoritative. The job celebration and rating implementation is unchanged.

The strict stylesheet-only requirement conflicts with preserving VeyCardPeek's
width-dependent geometry and Animated transforms. These existing dynamic styles
remain inline; only static paw colors and crop styling move into a themed sheet.
The animation effects, timing, easing, interpolation and reduced-motion handling
are unchanged. This is the only source implementation deviation.

## Review fixes

An independent review found behaviour unchanged and five presentation defects. They are fixed as follows:

- CreateOptions and the model prompt leave their borders, backgrounds, radii
  and padding to TextField. The existing seed/audio validation predicates now
  reach the shell through `error`. TextField backward-compatibly accepts a
  boolean error for callers that already render their help/error text; string
  errors still render the original alert. Help copy and live regions stay put.
- Library list entries override Card's outer border, shadow, radius and
  horizontal padding, leaving only the hairline bottom divider. The inner
  pressable card has no shadow, border, radius or background fill. Grid entries
  retain their card treatment. Favourite is an icon-only tertiary action with
  its original label, selected state and target size.
- VeyCardPeek uses fixed `VEY_PAW` / `VEY_PAW_EDGE` character-art constants
  (`#dbe8ea` / `#789b9f`) from `src/lib/veyCharacter.ts`, explicitly added to
  the allowed scope by the host. Its motion and width-dependent geometry are
  unchanged. These constants are intentionally independent of theme tokens.
- Credits legal actions use secondary footnote text with an underline and
  6-point hit slop around a 32-point control (44-point target). Existing legal
  entries, URLs and visibility are preserved; no new EULA entry is added.
  Restore, manage subscription and history remain tertiary, with accent text.
  Library's unchanged load-error copy is danger text, with a separate tertiary
  retry action using the existing `recovery.retry` key and the original
  accessible label and load callback.
- Tier chips each receive `flex: 1`. Chip's optional `fullWidth` stretches its
  inner pill to the allocated width; the default chip layout is unchanged.
- SectionLabel renders translation text verbatim. Create's empty-model text
  also stops lowercasing its translated goal. Model rows use the existing
  Images / Video / Audio keys without case conversion. Credits' existing
  planName capitalization acts on catalog identifiers, not translations, and
  remains unchanged to preserve store plan presentation.
- Only used, app-only uppercase English Create values become sentence case:
  `startFrom`, `pickPreset`, `what`, `freeChoice`, `model`, `livePrices`,
  `videoAgent`, `freeLeft.one/other`, and `workspace.saved`, `.references`,
  `.referencesMeta`, `.prompt`, `.settings`, `.settingsMeta`, `.total`,
  `.refund` (all prefixed `create.`). None appear in `webKeys.json`.
  No web-shared value changes or uppercase web-shared exceptions were needed.
  Retired eyebrow keys and `_order.ts` are untouched. Registry generation runs;
  its bytes are unchanged because the set of keys/areas is unchanged.
- Free allowance lines and form/purchase balance text use textSecondary;
  the Create row's free count uses accent. Tabular figures remain. Prices and
  credit costs retain warning tone.

`creationPresentationFixes.test.tsx` adds regression coverage for caller field
styles, boolean and string TextField errors, existing validation help, optional
chip stretching, list/grid presentation, favourite states and callback, fixed
paw colors in light/dark/OLED, and preservation of translated casing. No existing
test assertions change in this round. The design-system and Link-asChild guards
remain unchanged.

## Deviations

- VeyCardPeek keeps its width-dependent geometry and Animated transforms inline; only static styling moved to a
  themed sheet. Its paws use fixed character colours (`VEY_PAW`, `VEY_PAW_EDGE` in `src/lib/veyCharacter.ts`), not
  theme tokens, because Vey is character art.
- Uppercase English Create labels became sentence case in the English catalog (app-only keys only); no runtime case
  conversion of translated text remains. `_order.ts` is untouched.

## Verification

`cd apps/mobile && npx tsc --noEmit && npx jest --ci && node scripts/gen-en-registry.mjs --check` passes
(218 suites, 3,970 tests). Every changed file is under 500 lines. On the iOS simulator against the local mock server,
in light mode: the Create tab, the model form (image and video), Library and Credits.

Not yet verified: dark and OLED on a device, Android, and a finished result screen with real media.

## Follow-ups

- The model form shows its title twice (navigation header and an in-page heading); this predates phase 2a.
- Library rows show no thumbnail, only a kind icon; list mode has never rendered one.
- "Video files" on Library and "Retry subscription check" on Credits render as full-width secondary buttons where
  they were text links; consider tertiary.
