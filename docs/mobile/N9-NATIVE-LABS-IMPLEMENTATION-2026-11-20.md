# N9 native beat editor implementation report

Advisory handoff for independent review, updated after host fix round 2 (final). Changes are uncommitted in `beat-native-n9-labs-97f738`.

Frozen plan verified: SHA256 `8ccf3972581ab2c9506f0749e168c8a7c29be7c7ae5ef4391fb8e186a7abf009`.
All source changes resolve within this checkout. No commit, staging, push, publish, dependency installation, paid request, or device run was performed.

Implemented the four-template picker, 12 starter sounds with search/category suggestions and native audition, undoable sound insertion, private-song seed route and song action, per-account coach cards, and capability-gated Controls sheet. The shared web modules remain authoritative through typed imports. Standalone Labs is P5; the editor's Labs instruments here are starter sound packs. Instruments is N4; Mine/takes/songs is N6/N7. No Beat AI or generate action was added.

Creation waits for `flushBeat` and then requires `getBeat(id)` to exist and `saveState(id) === 'saved'` before returning/navigating. Rejected puts and failed writes drop the half-created record and await cleanup, retaining the original failure if cleanup also fails. Song seeding uses `getSong`, the same authenticated `/api/v1/jobs/<jobId>/asset` signer used by `mediaApi(api).getAsset`/the music player, streaming `expo/fetch`, and the web `fetchAudioAsset` probe/frame-count/bounds/decode checks. Requests share the mount's abort signal. Strict-effect replay shares one creation promise; actual unmount cancels it. Account identity/generation is checked after loading and persistence.

The native decoder loads the N0 context lazily at the shared 48 kHz rate and closes it after decoding. Unit tests inject decode. Full song reads retain the web's 120 MB encoded-size bound; downloads are not streaming playback.

## Proof and limitations

Executed again after fix round 2 from `apps/mobile`:

```text
node scripts/check-app-i18n.mjs --write
exit 0

node scripts/check-app-i18n.mjs && node scripts/gen-en-registry.mjs --check && node scripts/sync-web-i18n.mjs --check
exit 0
ar: 368 strings exceed 1.6x English
de: 732 strings exceed 1.6x English
es: 661 strings exceed 1.6x English
fr: 1058 strings exceed 1.6x English
hi: 397 strings exceed 1.6x English
ja: 6 strings exceed 1.6x English
ko: 5 strings exceed 1.6x English
pt: 671 strings exceed 1.6x English
ru: 688 strings exceed 1.6x English
zh: 6 strings exceed 1.6x English
English registry is current.
Up to date.
```

The length counts are catalog-wide review entries, not failing checks. All ten length review files were regenerated; byte-identical files do not appear in the diff. Additional read-only inspection found 112 N9 keys (including seven supported touch instructions) with no missing translations, mismatched placeholders, unreviewed English equalities, or stale N9 equality entries. `git diff --check` passed.

Jest and `tsc` were deliberately **not run by this agent**, per the frozen work order. The host reported three prior test failures; those assertions/lifecycle calls are corrected in this revision and await host rerun (including `audioHub`). No claim of passing tests or TypeScript checks is made. The host must run its specified Jest selection and TypeScript check through its build-slot lock. New tests cover templates and durable failure cleanup; sounds, history, preview duration/release; all capability mappings and coach persistence; seed error mappings, success metadata, replay/unmount, account changes, ignored Range responses, Content-Length bounds, MP3 frame count, and decode checks; screen actions and MIDI template rendering.

In the initial implementation round, lint was attempted but blocked: `apps/mobile/node_modules/eslint/bin/eslint.js` is unavailable (`MODULE_NOT_FOUND`). At that time the supplied `node_modules` symlink to the N1 checkout was not usable here; lint was not retried in either fix round. No duplicate installation was created. No sandbox approval rejection occurred, and no action was denied or blocked in fix round 2.

**No device result.** No ARTEMIS exploration, simulator, native build, or native audio validation was performed because the frozen order explicitly prohibits device use. General mobile-test exploration requirements were therefore superseded by that task-specific instruction.

## Deviations and integration notes

- Literal persisted-template equality is impossible through the unchanged N2 `putBeat`: it advances `updatedAt`. The helper returns the exact shared template for its id/title/creation time; persisted content matches apart from that required save timestamp. The store was not changed.
- The under-500-line rule is met by every new code/test file. Existing monolithic locale catalogs and some review data already exceed it; they were updated in place as required rather than refactored.
- FX sweep filtering is not reproduced in audition. Preview renders the sound's actual notes directly through `renderTakeSamples`/`encodeWav`, retaining the full Warm pad note durations, including 24 seconds at 40 BPM.
- Added audio regions are persisted and undoable. Hearing them depends on the engine slices; neither audio-region playback nor MIDI playback is claimed here. `audio.ts` and `src/lib/music/**` remain unchanged. The minimal mixer guard hides kit controls when the editor omits `onKit` for MIDI/audio tracks; host-render assertions cover hip-hop/lo-fi MIDI and added audio tracks alongside drum rows.
- The logical seen key keeps `beatTipsSeenKey(userId)` intact. Only the SecureStore adapter escapes unsupported characters injectively, including the colon, as allowed by the plan. See [Expo SDK 58 SecureStore](https://docs.expo.dev/versions/v58.0.0/sdk/securestore/) for its key constraints.
- Empty/whitespace song titles also use the localized fallback for the asset name. Otherwise an empty name would make the shared document invalid even though the beat-title fallback succeeded. Ordinary source asset names remain web-shaped.
- Extra additive edits outside the plan's short shared-file list: the existing beats-home test selects a template; dynamic-i18n fixtures enumerate new families; six equality-review files document unchanged established music terms; the song detail's non-trashed branch renders Make a beat next to the unchanged `MusicSongActions`. Trashed songs have no Make a beat action, per host disposition F1/F2.
- Native decode wiring is in `songSeedNative.ts`, separate from the injectable pure seed logic, to keep native imports out of host unit tests.
- Editor integration adds three imports (bar, capabilities, targets), one labs-bar element, and the drum-only `onKit` guard. Inspection 1 F4 changed A8: enabling a capability requires both its `PHONE_CAPABILITIES` set entry and real `beatLabs.touch.<id>` copy in English and all ten app catalogs. The shortcut test enforces that enabled actions have real copy and rejects placeholders. A set-only edit is insufficient.
- Coach-card placement deviates from the planned bottom of the editor: the card sits inside the labs bar near the top, beside the save controls, because `BeatLabsBar` remains the single added editor element.
- `_order.ts` remains frozen; the registry was regenerated with `gen-en-registry.mjs`. No no-web-breakout exception was needed.

## Fix round 1 dispositions

- T1: replaced both `root.render(null)` calls with renderer unmounts; fresh roots are created before reuse/teardown.
- T2: undo still compares the complete restored document, normalizing only the shared history's `updatedAt`, and separately validates it.
- F1/F2: restored `MusicSongActions.tsx` completely; Make a beat lives directly beside it in the non-trashed song-detail branch. Regression coverage checks both active and trashed detail screens. The seven-icon `audioHub` contract is unchanged; its host check remains pending.
- F3: added `unsupported` / `beatLabs.seed.error.unsupported` in all eleven catalogs. Size, duration, decode-reservation, changed-size and decode failures use it. Fetch/signing rejection and stream-read rejection retain the connection error; HTTP song lookup mappings remain as specified. Tests cover each boundary without allocating oversized audio buffers.
- F4: removed 25 placeholder touch keys from every catalog. Every shared shortcut still needs a capability mapping; only the seven currently available shortcut actions need touch keys. Tests reject placeholder copy and keys for absent capabilities. This supersedes the original A8 requirement for a touch key for every unavailable action.
- F5: previews subscribe to `playbackStatusUpdate`; natural finish releases the subscription, player and cache file, then clears the sheet's playing state. A translated preparing state is set before synthesis (which yields to the event loop). Fake-player and sheet tests cover finish and preparing state.
- F6: superseded by fix round 2 N9-1, which authorizes the minimal mixer guard.
- F7: added explicit dynamic-i18n error and supported-touch domains; the route and Controls sheet now call `t()` directly with their dynamic key expressions.
- F8: creation rechecks record existence and saved state after flushing. Tests cover a reset between put/flush and saving/busy/error states. Failed creation drops the record and never navigates.
- Additional requests: the beats-home picker callback catches creation failure and shows `beatLabs.createFailed`; the song-seed route uses themed background and `ds.space` tokens.

Files changed during this fix round (relative to `apps/mobile` unless otherwise stated): `src/app/(app)/beats/{index,new}.tsx`, `src/app/(app)/music/[id].tsx`, restored `src/components/music/MusicSongActions.tsx`, `src/components/beats/{BeatSoundsSheet,BeatControlsSheet}.tsx`, `src/lib/beatNative/{templates,soundPreview,songSeed}.ts`, `src/lib/i18n/messages/en/beatLabs.ts`, all ten `src/lib/i18n/messages/app/*.ts` catalogs, `__tests__/beatNative{Labs,LabsScreens,SongSeed}.test.*`, `__tests__/dynamicI18n.test.ts`, and this report. All ten length reports were regenerated; this round's changes do not alter their previous counts/content. The full final diff inventory follows.

## Fix round 2 dispositions

- N9-1: `MixerStrip.onKit` is optional, and its kit selector renders only when the callback is supplied. The editor omits it for `audio`/`midi` tracks. The mixer diff changes only the optional prop and conditional rendering. Screen tests verify hip-hop/lo-fi MIDI tracks and sound-added audio tracks have no kit selector, while the drum row retains it.
- N9-2: inspected all ten locales for Sounds, Controls, Play/Stop and step-grid label/tip agreement. Changed Sounds to German “Klänge”, Hindi “ध्वनियाँ”, and Chinese “声音”; Chinese FX remains “音效”. Corrected Play/Stop references in German, French and Russian to match the existing buttons. Controls and step-grid terms were already consistent in all ten locales. Added a catalog regression test and removed the obsolete German Sounds equality justification. All ten length reports were regenerated; review counts remain unchanged.
- N9-3: documented the F4/A8 change above: enabling a capability also requires real localized touch copy, enforced by the shortcut test.
- N9-4: the coach hook exposes `canReplay` from the resolved current user; the labs bar passes it to Controls, which hides replay while signed out or before identity resolves. Signed-out screen coverage checks the absent replay button. Signed-in replay coverage remains. The near-top card placement is explicitly documented above.

Files changed in this round (relative to `apps/mobile`): `src/components/beats/MixerStrip.tsx`, `src/app/(app)/beats/[id].tsx`, `src/components/beats/{BeatControlsSheet,BeatLabsBar}.tsx`, `src/components/beats/useBeatCoachMarks.ts`, `__tests__/beatNativeLabs.test.ts`, `__tests__/beatNativeLabsScreens.test.tsx`, `src/lib/i18n/messages/app/{de,fr,hi,ru,zh}.ts`, and `src/lib/i18n/review/de-equal.json`; also this report. Regenerated length reports were byte-identical to the prior round. No Jest, TypeScript, device, build, commit, push or publish command was run in this round. No new deviation beyond the explicitly documented placement and host-directed A8/mixer changes was needed.

## Changed files

New implementation files, all under `apps/mobile/`:

- `src/app/(app)/beats/new.tsx`
- `src/components/beats/BeatTemplatePicker.tsx`
- `src/components/beats/BeatSoundsSheet.tsx`
- `src/components/beats/BeatControlsSheet.tsx`
- `src/components/beats/BeatCoachCard.tsx`
- `src/components/beats/useBeatCoachMarks.ts`
- `src/components/beats/BeatLabsBar.tsx`
- `src/lib/beatNative/labs.ts`
- `src/lib/beatNative/templates.ts`
- `src/lib/beatNative/controls.ts`
- `src/lib/beatNative/coachMarks.ts`
- `src/lib/beatNative/soundPreview.ts`
- `src/lib/beatNative/songSeed.ts`
- `src/lib/beatNative/songSeedNative.ts`
- `src/lib/i18n/messages/en/beatLabs.ts`

Updated implementation files, all under `apps/mobile/`:

- `src/components/beats/MixerStrip.tsx`

- `src/app/(app)/beats/[id].tsx`
- `src/app/(app)/beats/index.tsx`
- `src/app/(app)/music/[id].tsx`
- `src/lib/i18n/messages/en.ts`
- `src/lib/i18n/messages/app/{ar,de,es,fr,hi,ja,ko,pt,ru,zh}.ts`
- `src/lib/i18n/review/{ar,de,es,fr,hi,pt,ru}-length.json`
- `src/lib/i18n/review/{de,es,fr,hi,ja,pt}-equal.json`

Tests, all under `apps/mobile/__tests__/`:

- New: `beatNativeLabs.test.ts`, `beatNativeSongSeed.test.ts`, `beatNativeLabsScreens.test.tsx`
- Updated: `beatNativeScreens.test.tsx`, `dynamicI18n.test.ts`

This report: `docs/mobile/N9-NATIVE-LABS-IMPLEMENTATION-2026-11-20.md`.

No files under `app/veyrnox/**`, `apps/mobile/src/lib/music/**`, or `.reticle/**` were edited. `MusicSongActions.tsx` was restored byte-for-byte to HEAD and has no final diff. No new worktrees, dependency trees, servers or build caches were created. No other checkout was edited or retired; no unused worktree was identified as safe to archive.
