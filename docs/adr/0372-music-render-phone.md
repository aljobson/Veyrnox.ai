# Music master rendering on the phone (P3e2)

Status: Implemented in source; advisory proof, host numbering and independent review pending.

The phone exposes Edit master for an active song advertising `render`. The five operations are fade, speed, reorder, remaster and reverse. Reverse additionally requires the advertised `reverse` action. Speed follows the web dialog: the POST only requires editing, even though the song GET also advertises a separate `speed` action under the reverse flag.

The contract was read from `app/api/v1/music/songs/[id]/render/route.js`, `lib/musicEditing.js`, `lib/musicWavRender.js`, the song route, the web dialog, and migrations 0485/0486/0510/0534. Rendering makes a new canonical PCM WAV version with a zero-credit local job. It neither calls an AI provider nor consumes download allowance, so neither central guard gains a render pattern. Tests call the real `guardedBeforeSend` through the API client with consent declined and the paywall locked.

## Input and playback

The form uses 0.5-second fade and split steps, 0.05 speed steps, and −3/−2/−1 dBFS ceilings. The real pure server parser supplies request shape and parameter validation; client validation additionally bounds fade and reorder against measured duration. The source limit is 26,214,400 bytes (25 MiB), not the web dialog's outdated 20 MB copy.

The normal song response has no measured duration. A source-version-keyed MusicPlayer plays the underlying asset from zero, including preview-only crop sources, matching the asset the render route reads. Its callback captures that source version. Loading another source clears the measurement and drops old callbacks. Fade and reorder remain disabled until measurement; speed, remaster and reverse do not require a phone-side duration. A range error's finite positive `duration_seconds` can update only the submitted source version.

Both full commit responses and the minimal early idempotent response are accepted. The saved version number always comes from that response. Success notifies the existing song/library refresh subscriptions and reads the song again. Result playback is offered only after the refreshed current version matches the returned version ID. A mismatch preserves success, describes the changed current version, omits playback, and labels navigation Open current version. A failed refresh preserves success and offers a read-only retry.

## Retry and lifecycle

One `render.<uuid>` key belongs to the captured operation, source version and parameters. A synchronous busy lock covers connectivity checks and submission. After an ambiguous error, edits and source reload are blocked; retry sends the identical body and key. Known pre-commit refusals from the route, parser, renderer and RPCs clear the attempt; unknown errors, malformed success responses and transport failures retain it. Offline checks occur before creating a new ambiguous attempt. Every route error maps to bounded localized copy, never server text.

Account change and disposal permanently invalidate the flow and ignore late responses. StrictMode creates a fresh flow after cleanup. Call-time editing unavailability hides Edit master until account change; reverse unavailability hides only the Reverse option. These are learned availability states, not locally evaluated feature flags.

Retry state is screen-local, following the existing action flows. Leaving the screen or restarting loses recovery; the screen explicitly warns to remain until confirmation. The server request may continue after leaving. No persistent attempt store or new listing endpoint is introduced.

## Work-order exceptions and validation

- No music export flow exists in this checkout. The implementation follows `useSongActionScreen`, the crop flow and existing song/library notifications instead.
- Existing locale catalogs and review data already exceed 500 lines. Their format is preserved; every new source/test file remains below 500 lines. English registry changes are exactly the area import and spread. All ten non-English app catalogs have machine translations; equality and expanded-copy review lists are updated where required. Native-language review remains pending.
- The frozen plan explicitly reserves ADR `0000` for host numbering, overriding the ordinary next-free-number workflow.
- The owner waived device, simulator, ADB and ARTEMIS validation for mocked Jest. None is used here.
- The shared build-slot wrapper cannot open its lock file under this sandbox (`PermissionError: Operation not permitted`). Focused two-worker Jest runs directly; no full Jest, Metro or native build is claimed. Existing dependencies are reused without installation or changes to their original checkout.

The agreed proof is `npx tsc --noEmit; npx jest --ci --maxWorkers=2 musicRender; node scripts/gen-en-registry.mjs --check` from `apps/mobile`. Focused proof passes 5 suites / 178 mocked tests and the English registry check. TypeScript reports the same 33 diagnostics as the pre-edit baseline, with no new diagnostics. Changed-file lint is blocked by the shared installation missing `eslint-config-expo/flat`. The advisory work report includes full output and any integration-check results. Host full Jest, Metro bundles and fresh inspection remain required. No commit, push or publication is authorized.
