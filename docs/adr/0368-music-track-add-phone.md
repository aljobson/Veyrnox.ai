# ADR-0368: Add a vocal or instrumental part on the phone

Status: Source implementation and mocked P3d2 tests written; proof and independent review pending. Number to be assigned by the host.

## Contract and reuse

Track add uses P3's action flow, attempt storage, confirmation lock, quote card and foreground poller. A new generic `MusicActionQuoteBase` contains only the six common quote fields. The generic flows through `ActionSpec`, attempts, flow, screen hook and quote card. Existing actions retain their model requirement and validators. The existing generic start-result contract already supports the two-job track-add acknowledgement; no result adapter or second generation framework is needed.

The quote, confirm, status and audio handlers, the parser in `lib/musicBackend.js`, migration 0489, and the web dialog were inspected locally. All four routes set `Cache-Control: no-store`. The quote has upload, part and total credits, measured source duration and no model or candidate count. The client checks all response fields, closed state/stage/mode lists, a finite acknowledgement balance for first acceptance, and optional finite balance on replay. Only a response's own finite balance reaches the accepted screen. No quote projection is substituted on replay.

Vocals require trimmed lyrics, a description, source rights and lyrics rights. Omitted vocal gender normalizes to auto. Instrumental uses empty lyrics, false lyrics rights and auto gender. Every form edit invalidates an unsubmitted quote. Switching either way clears lyrics, gender and lyrics rights. Review refreshes the current song version. One `trackadd` key belongs to each quote; unknown acceptance retains it, including after expiry. Source conflict and the specified validation rejections clear the attempt. Local guards preserve it. Only confirmation spends.

The server-advertised `add_track` action on a non-trashed song exposes the entry. A call-time feature-off response also removes that entry for the current account session. Account change resets this memory.

## Guards and visible results

Both the new quote and confirmation POST paths require AI consent. Only `/track-adds` is a paid action. Each path has an anchored, separate pattern; neither matches a nested or similarly named endpoint. Before confirmation, guards run before a connectivity probe, followed by the normal real-client guard on the POST.

Accepted requests are separate parts, not song versions or two-candidate generations. Nothing is adopted into the P2 generation queue, candidate cards or song-change notifier. The shared poller starts at 1.5 seconds, backs off to 5 seconds, pauses off-active and has a five-minute foreground ceiling. Account change and disposal stop reads and ignore late results. `ready` and `refunded` end polling. `failed` continues settlement polling within that same ceiling, and offers Check again. At the ceiling the copy says the refund is being processed. Manual refresh remains one read.

Refund copy is deliberately neutral: “A refund has been recorded for this request.” Both upload-failure and part-failure refunds have the same public state/stage, and charges are not refund amounts. The UI does not infer an amount or which charge returned.

No request-list or persistent recovery route was found. The web dialog likewise holds the request only in component state. The phone discloses that leaving stops live updates, an accepted server request still completes, and access to the part or pending acknowledgement recovery is lost when leaving. Inputs, request and attempt state are memory-only.

## Playback

The existing MusicPlayer remains the only audio engine. Its input can optionally name a track-add request ID. A resolver calls the audio endpoint on explicit Play, every time, and validates HTTPS, audio/mpeg or audio/wav and the full asset shape before creating a native player. Load alone does not fetch a part asset. URLs are never component input, logged or persisted. Native handles are released on screen blur/disposal/account change, and late audio responses cannot create a player. Background pausing, explicit retry and bounded native URL recovery reuse the existing controller. Track-part playback does not record a listen for the source song.

## Localization and scope

`musicTrackAdd.*` lives in a new English area with a regenerated registry. All ten app catalogs receive machine translations with exact placeholders and equality/expanded-copy review data. Native language review remains pending. The form uses radio groups, explicit checkbox states, header roles and existing controls; it adds no animation. No dependencies, native configuration, server routes, flags, migrations, beat editor, ADR index, paid calls or real server calls are changed.

## Frozen-plan discrepancies and environment

- The frozen PLAN.md was read in this follow-up. The host explicitly waived SHA verification and authorized mocked Jest-only tests on 2026-11-20.
- P3c and P3d1 ADRs explicitly keep quote routes outside consent, contrary to the frozen plan's description of their policy. This slice follows its explicit requirement to guard track-add quotes; prior slices remain unchanged.
- The route accepts a positive measured duration up to 120 seconds, and the RPC accepts 0.001–120, rather than the frozen facts' one-second minimum. Response validation follows the actual positive-duration contract without inventing a phone restriction.
- Existing catalogs and some review data already exceed 500 lines. Their established format is retained; new implementation files stay below 500 lines.
- The owner build-slot wrapper cannot open its existing lock for writing under this sandbox. A temporary adapter first acquires an exclusive flock read-only on that exact existing lock inode, then invokes the unchanged wrapper with a temporary inner lock. The outer lock is held for the entire command, preserving serialization with other builds. It changes no owner script, existing lock, safeguard, checkout or other session.
- The host supplied the owner ARTEMIS waiver for mocked Jest-only tests. No device, simulator, ADB or ARTEMIS exploration has been used.

The advisory implementation report supplies actual command output and remaining limitations. This ADR does not claim native validation or independent approval.

## Advisory proof

Seven new mocked suites cover field-by-field response validation, exact request bodies and server-parser parity, quote invalidation, ambiguous replay, guards through the real API client, settlement polling, screen states and entry gating, both indistinguishable refund outcomes, on-demand playback through the real hook with mocked native audio, and all ten translation catalogs. New fixtures contain complete public responses. Earlier P2/P3a–P3d1 tests remain unchanged.

The seven P3d2 suites pass: 235 tests, zero failures. The final TypeScript output matches the initial baseline exactly: 24 existing dependency/type diagnostics, rather than the plan's stated 22. Neighbouring and full-suite proof are pending the shared build slot. One identifies the unchanged `expo-audio` import in the draft's `useMusicPlayer.ts`. Lint cannot resolve `eslint-config-expo/flat`. Dependencies are not installed to alter that baseline. No new dynamic translation family was introduced.
