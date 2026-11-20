# ADR-0356: Target-stem instrument isolation on the phone

Status: Built; advisory implementation awaiting independent review and number assignment by the host.

## Context

Music P3b is stacked on the P3a song-action framework. The server advertises `target_stem` per song and exposes a free source-measuring quote, paid confirmation, request status and separate target/residual assets. It accepts the current MP3 or WAV and measures at most `MUSIC_TARGET_STEM_DURATION_MAX` seconds. The phone must use server prices and constants without calling server feature-flag helpers.

## Decision

Reuse P3a's attempts, action flow, connectivity guard and foreground polling through `targetStemsAction`, with `targetstems` keys. The shared typed seam exports the server's instrument list and duration limit. Validate every declared response field, the complete output pair, request identity, quoted instrument, audio MIME type and HTTPS asset URL. Instrument or rights edits invalidate an unsubmitted quote, including an in-flight quote response. Review refreshes the song version and advertised action before quoting.

Register only `/songs/:id/target-stems` POST in both central guards. Quotes and GETs remain free. Local consent or paywall refusal preserves the prior attempt and key, including ambiguous recovery. Unknown acceptance replays the same key even after expiry or lower balance. Definitive `revision_conflict` and `source_held` rejections clear the attempt. The held-source rule was checked against migration 0551 and the public error mapping: it precedes quote expiry and indicates no accepted spend for this attempt.

An opt-in `balanceOnReplay: 'omit'` policy prevents a replay without `balance_after` from presenting the earlier quote balance as an actual balance. P3a retains its existing fallback behavior. A shared screen lifecycle hook handles account changes, StrictMode and cleanup; existing P3a tests remain unchanged.

The native screen offers nine localized radio choices with at least 44-point targets, rights confirmation, measured duration, exact quote, attempt-charge disclosure, status announcements, and two separate asset buttons. Each tap fetches a fresh URL, locks both buttons during opening, verifies the account/flow is still current, and hands the validated URL directly to Linking. The exact browser exception is recorded in the existing allow-list test. No URLs are stored or logged, and no audio files are downloaded in-app. Shared controls honor reduced motion.

All new copy lives in `en/musicTargetStems.ts` with matching key prefixes and a generated English registry. The ten non-English app catalogs (ar, de, es, fr, hi, ja, ko, pt, ru, zh) are **machine translated**; native review remains pending. Placeholder slots, equality explanations and expanded-copy review entries follow P3a/P2. The locale-sync script is unchanged.

## Limits and verification

Request IDs and ambiguous attempts remain in memory for the mounted screen only. Leaving or restarting loses tracking because there is no request-list route. The provider may produce silent or limited results while still charging for the attempt. The server, not the phone, determines readiness, failure and refund. Polling pauses off-active and offers manual refresh after five foreground minutes; transient reads are not provider failures.

Mocked tests cover contracts, all instrument IDs, invalidation, replay/expiry, source holds, real API-client guards, polling states, fresh asset links, double taps, account changes, off states and localization. The agreed proof is TypeScript, full CI Jest and the English registry check. The frozen work order acknowledges missing-package baseline failures in the shared install; report actual results separately from implementation failures. No dependency install, device, simulator, ADB, native configuration, server changes or paid calls are part of this slice. Host Metro iOS/Android bundle checks and independent review remain external to this implementation.

The frozen <500-line convention cannot hold for the required existing locale catalogs and review JSON, which already exceed it. Preserve those data formats and keep new source/test files below 500 lines. This is the sole source-format deviation; no catalog splitting or native redesign is introduced.
