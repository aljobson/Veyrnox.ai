# ADR-0349 — Beat editor microphone

Status: Proposed 2026-11-17. Owner-approved route header change.

## Context

The Studio page redirects to the beat editor since phase 6. Audio recording now
belongs to an armed audio track there. The global `microphone=()` policy denies
capture even after a browser permission grant. Permissions Policy belongs to the
loaded document, so entering Beats from another workspace requires a full document
navigation rather than a client-side transition.

## Decision

Add one rule for `/app/music/beats/:path*` with
`camera=(), microphone=(self), geolocation=()`. Request the microphone only after
the user arms an audio track / presses Record. The route remains behind
`beatEditor` in `MUSIC_RUNTIME_FLAGS`. Camera and geolocation stay denied.
No CSP host, Worker variable, server route, RPC, or dependency is added.
Rollback: delete this one header rule.

The capture worklet is served at `/audio-worklets/beat-capture-worklet.js` from
`public/audio-worklets/`. This path was chosen during the build because the
original `/music/` path is intercepted by a beforeFiles rewrite. No configured
rewrite or redirect matches `/audio-worklets`; loading remains same-origin.

## Consequences

The browser still owns microphone permission. A denied request explains site
settings → Microphone → Allow, then Arm again. An inherited restrictive document
policy asks for a reload before calling getUserMedia. Disarm, navigation and
pagehide close the stream. There is no software input monitoring.

Takes are mono PCM in the device's IndexedDB, with a 1 GB guard and no automatic
deletion. Completed passes and ten-second single-pass checkpoints are recoverable;
a hard close can lose the fraction since the last durable checkpoint. A take is
retired from recovery only after a local saved document references its immutable
ID, or the person explicitly discards it. Committed audio remains for undo/redo. The editor keeps no local version snapshots, so only the saved document is checked; audio loads per take on demand, and opening a beat reads only the small list of take records.
Calibration is per input and expires after 90 days. Simulated loopback is automated;
real hardware loopback remains an owner manual check.
