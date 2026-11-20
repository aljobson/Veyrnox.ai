# ADR-0354: Music song actions on the phone (P3a framework)

Status: Proposed; number reserved for assignment by the host.

## Context

P2 already uses one idempotency key per prepared music quote. Song actions have different quote and result shapes: stem acceptance may replay without a balance, and crop creates a version without spending credits. Native configuration and the beat editor are outside this change.

## Decision

Add typed song-action boundaries, an ActionSpec-driven attempt/flow layer, bounded foreground polling, and Stems/Crop screens. Share P2's definitive rejection list without changing its behavior. Unknown acceptance retains the original key and permits recovery after quote expiry; local consent/paywall rejection restores the exact previous attempt. Account changes dispose flows, attempts, timers and results. Server action lists and unavailable responses gate visibility.

Register only stem confirm with the central consent and paid-action guards. Stem quotes remain free; crop belongs to neither guard. Use the existing connectivity gate before paid confirmation. Fetch ZIP URLs on tap and immediately hand them to Linking; no local file, URL cache or log is created.

Crop uses the shared pure server parser and one key per range attempt, with an explicit confirmation alert. A known response is final even if the following refresh fails. The player can supply measured duration; a server range error can supply missing duration. Both preview and canonical crop RPCs were inspected and move no credits; canonical rendering inserts a zero-credit local job.

The host’s P3a amendment uses `musicActions.*` keys in `en/musicActions.ts`, so the area name matches the key prefix without changing the locale-sync script. The new strings are machine translated for all ten non-English app catalogs (ar, de, es, fr, hi, ja, ko, pt, ru, zh), following P2 commit `7270d7835`; native review is pending. Placeholder slots remain unchanged, with equality explanations and expanded-copy review entries recorded where required.

## Consequences

The action framework can serve later P3 slices without changing P2. Polling stops automatically after five minutes and exposes manual refresh. Transient read errors never imply provider failure. UI uses shared accessible controls, status announcements and no new animation (shared controls retain reduced-motion behavior).

Stem request IDs and attempts are memory-only for the mounted screen. Leaving the screen or restarting loses tracking, because the API has no stem-request list. This must be stated in the eventual PR. Crop preview-only output is not a new rendered master. Future export work must respect exportability and distribution gates. See `docs/mobile/MUSIC-P3-SLICES-2026-11-18.md` for the remaining scope and proof requirements.
