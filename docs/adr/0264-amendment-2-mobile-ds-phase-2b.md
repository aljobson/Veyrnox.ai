# ADR-0264 amendment 2: Mobile design system phase 2b, Chat and Video from a brief

Date: 2026-10-27
Status: Implemented; independently reviewed; checked on the iOS simulator in light mode.

Phase 2b moves the LLM Chat area and Video from a brief onto the ADR-0264 tokens and primitives. The scope is
presentation only. ADR-0265's assistant identity remains “Assistant”.

## Presentation and file inventory

Changed routes, relative to `apps/mobile/src/app/(app)`:

- `chat/[id].tsx`
- `chat/index.tsx`
- `chat/new.tsx`
- `chat/folders.tsx`
- `chat/move.tsx`
- `chat/personas.tsx`
- `chat/persona/[id].tsx`
- `chat/skills.tsx`
- `create/agent.tsx`

Changed existing components, relative to `apps/mobile/src/components/chat`:

- `AttachStrip.tsx`
- `ChatComposerDeck.tsx`
- `ChatLibraryScreen.tsx`
- `ChatSettings.tsx`
- `DraftCards.tsx`
- `LibraryImagePicker.tsx`
- `MakePanel.tsx`
- `ModelPicker.tsx`
- `ReplyOptionsBar.tsx`

New components in that same directory:

- `ConversationEmpty.tsx`: specialist cards and the Film Studio navigation action.
- `MessageBubble.tsx`: message text, draft cards and the charged reply price.
- `ReplyOptionChip.tsx`: shared presentation of standard/thinking/web choices.

The unchanged `chat/library.tsx` re-export is included in the migration guard.
The conversation route is 445 lines. All changed and new files are under 500.

All static sheets are module-scope `themedStyles`, consumed with
`useThemedStyles`. Text uses ramp variants. Button, TextField, Card and Chip
replace hand-built actions, fields, cards and choices. Native persona switches
keep their values and handlers. The composer modes use chat/image/video/audio,
its model selector uses cpu/caretDown, thinking uses brain, and web uses globe.
Back and Film Studio use arrowLeft and arrowRight. All icons are decorative;
control labels continue to describe the actions without reading icon glyphs.

In light mode, user bubbles use surface and assistant bubbles use bgElevated1
with a hairline borderSubtle. Dark and OLED retain bgElevated1 and bgElevated2
respectively. Both bubbles differ from the page background in every scheme.
Price text uses warning with tabular figures, except the priced approval label
described below. The existing `splitSlots`
helper renders the Video Agent credit-price slot in warning and its balance slot
in secondary, preserving the translated template and placeholder order.

Send is the conversation's filled primary. Its price remains directly below the
button and in its unchanged accessible label; the visible price now follows
Send's disabled opacity. Video Agent's primary is Make a
plan before a plan exists, then Approve; re-planning remains available as a
secondary action. Approval's visible and accessible labels both use the original
`videoAgent.approve` template (“Approve · N Credits”). The filled action uses
the primitive's contrasting onAccent label ink and tabular figures; the quoted
price immediately above it remains warning-toned. MakePanel and other supporting actions
are secondary or tertiary. Sheet animations respect Reduce Motion.

## Review fixes

The host's seven presentation findings are addressed without changing handlers,
requests, gates, testIDs, navigation, or accessible names and selection states:

- Library, folder and persona deletes are tertiary Buttons with danger text.
  Their existing native confirmation alerts retain the destructive action.
- Approval restores the priced visible label and keeps its accessibilityLabel.
- AttachStrip library/photos, ChatSettings save, folder add/rename, persona save,
  and MakePanel go rely on Button's single disabled opacity. A slice-wide scan
  found no other Button caller applying a second fade. Card-only disabled fades
  remain because Card does not supply disabled opacity.
- Attachment removal is a 24pt circle with a 16pt close icon, bgElevated2 and a
  hairline borderSubtle. Its 44pt corner wrapper contains 20pt left/bottom hit
  slop, keeping the entire 44pt hit area inside both wrapper and thumbnail.
- Brief and narration margins move to TextField containerStyle; input heights
  and vertical alignment remain on the input. Other TextFields in the slice
  have no misplaced layout margins.
- The separate Send price follows Send's disabled opacity. Film Studio's arrow
  trails its label; Back retains its leading arrow. ModelPicker's backdrop is
  a plain Pressable with static scrim styling, retaining its close action/name.
- Light-mode bubble surfaces and the assistant border change as described above;
  dark/OLED tone steps and the Assistant accessible label are unchanged.

No additional primitive extension is needed for this round. Button's existing
style, containerStyle and hitSlop props support the compact attachment badge.

Round 1 changes 14 files: the three routes `chat/folders.tsx`,
`chat/persona/[id].tsx`, `create/agent.tsx`; eight Chat components `AttachStrip`,
`ChatComposerDeck`, `ChatLibraryScreen`, `ChatSettings`, `ConversationEmpty`,
`MakePanel`, `MessageBubble`, `ModelPicker`; `chatPresentationV2.test.tsx`, new
`chatFixRound1V2.test.tsx`, and this ADR. Paths use the inventory roots above.

## Backward-compatible primitive extension

`apps/mobile/src/components/ui/Chip.tsx` accepts optional leading and trailing
MENU_ICONS keys and rich children. Its required label remains the fallback
accessible name. Existing text-only chips and fullWidth centering remain intact.
It preserves explicitly supplied accessibility state when selected is omitted;
switches use checked without acquiring a radio's selected state. Disabled chips
retain their native disabled gate and gain disabled presentation.

## English labels

Only these app-owned uppercase values become sentence case, in the existing
`apps/mobile/src/lib/i18n/messages/en/chat.ts` and `videoAgent.ts` areas:
`chat.workspace.skillsEyebrow`, `videoAgent.eyebrow`, `videoAgent.step`,
`videoAgent.brief`, and `videoAgent.planEyebrow`. None is in `webKeys.json`.
There are no new keys or runtime case conversions. The registry's area/key set
is unchanged. `_order.ts`, ADR README and index-baseline are untouched.

## Tests and preserved behavior

New `apps/mobile/__tests__/chatPresentationV2.test.tsx` covers Chip rich content,
decorative icons, switch/disabled semantics, composer media callbacks, options,
Send/Stop gates, multiline constraints, attachment limits/removal, and neutral
bubbles/charged prices in light, dark and OLED.

New `apps/mobile/__tests__/videoAgentPresentationV2.test.tsx` covers planning
without approval, the single-primary transition, field limits, narration and
aspect arguments, price versus balance tones, approval navigation, expiration,
insufficient balance, and the form lock while approval is pending.

New `apps/mobile/__tests__/chatFixRound1V2.test.tsx` renders all three delete
callers in light/dark/OLED and checks label contrast against their actual and
pressed backgrounds (at least 4.5:1), plus the filled destructive primitive's
label. It also covers confirmation entry, single effective disabled opacity,
attachment badge and hit-area geometry, priced approval and outer field margins,
Send price dimming, icon order/names and static backdrop close behavior.

Existing test edits are limited to:

- `chatPresentationV2.test.tsx` (round 1): replace the superseded light bubble
  surface assertions and assert both bubbles differ from bg in all three schemes,
  including the light assistant hairline border. No behavior assertions changed.
- `designSystemV2.test.ts`: add all Chat routes (including persona and library),
  all Chat components, and Video Agent to the migrated list.
- `chatWebParity.test.ts`: locate the extracted empty-state presentation,
  replace the removed raw target-size assertion with Chip usage, and assert
  Icon props instead of direct MENU_ICONS image sources. Navigation and
  composer wiring assertions remain.

Sending, streaming, stopping, retry keys, charging, attachment upload, model and
persona selection, folder operations, API calls, polling and approval gates
remain in their original owners. The FlatList props, keys, keyboard behavior,
keyboard offsets and composer docking are preserved. No dependencies, native
builds, development servers, commits, pushes or publication are part of this work.

## Deviations

The existing composer padding `Math.max(insets.bottom, 8)` remains an inline
runtime style. A fixed module-scope value cannot preserve the device-dependent
safe-area inset. All other static presentation moved into themed sheets or
primitive props. This is the source-styling deviation from the plan.

The host requires the price inside the filled Approve label. Warning ink cannot
retain readable contrast against every accent fill, so the restored priced label
uses onAccent with tabular figures. This is an explicit narrow deviation from
the original all-prices-use-warning rule; the separate price quote keeps warning.
The host-requested plain ModelPicker backdrop is also an explicit exception to
the original all-actions-use-Button rule. Its role, label and handler stay intact.

## Verification

`cd apps/mobile && npx tsc --noEmit && npx jest --ci && node scripts/gen-en-registry.mjs --check` passes (221 suites,
4,026 tests). On the iOS simulator against the local mock server, in light mode: a conversation, a new chat, folders,
personas and Video from a brief. Dark, OLED and Android are not yet checked on a device.
