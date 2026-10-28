# ADR-0282: Social Cinema viewer parity on the phone

Status: Proposed; implemented for independent review under the frozen viewer work order.

The phone supports the database-backed discovery, title and Watch experience while preserving the editorial series experience and the server's feature switches. This change makes no server, flag, deployment or purchase changes.

Discovery accepts EPISODE only with a UUID root_id. An episode opens Watch with its root as the series parameter; it never opens the root-only title endpoint using the episode ID. Details retain the flat episode array and add server-ordered seasons, language, declared AI use, synopsis and raw access information. Existing free-only episode eligibility remains authoritative on the phone.

Posters use a full-width 16:9 image. The four curated web poster paths are pinned in cinemaViewer.ts and checked against the web map by a drift test. A curated URL is tried first, then the poster API. Failure of every source removes the image without a placeholder. Editorial rows are unchanged.

Creator analytics has an independent entry after the creator upload shell. A query-less creator-analytics GET is a switch probe: only 400 invalid_query means open. This depends on the server checking its feature switch before query validation and before the read quota. If that ordering changes, the probe must be revisited. The picker lists only the caller's PUBLISHED, PUBLIC, top-level content in server order.

Comments previews hide on 403, 404 or 503, including comments_not_open. Other failures remain retryable with the existing mapped error text. Previews clear and reload on each focus, ignoring answers from an earlier focus, so withdraw and Block are reflected when the viewer returns. Every own nonwithdrawn comment can be withdrawn, including public own rows.

The next episode is the immediate successor in season/position order; locked episodes are never skipped. Detail entitlement is unmetered, so a candidate is confirmed with the metered entitlement endpoint when detail loads and on focus. Next remains hidden while checking or after refusal. A heartbeat block for free_ceiling, pass_ceiling or locked removes Next immediately and suppresses further checks until refocus, even if the detail arrives later. Pressing Next rechecks entitlement before replacing the Watch route. Existing All episodes stack removal and resume position behavior are retained.

Watch pauses on blur while preserving its grant and position. The old lifecycle assertion that blur does not pause is reversed: a mounted Watch underneath Comments must not play, meter or report audience. Focus and AppState jointly control visibility. Refocus does not play automatically. Session visibility clears first-load auto-play and pending renewal resume intent, so a delayed source load cannot restart video after blur, including a blur/refocus during loading. Hidden ticks do not send progress, heartbeats or audience retries. Final progress and accrued time are flushed at suspension; repeated hidden visibility signals do not write again.

Voting and story choices use a key per request body. Network and server failures keep the same key; success or a definite client refusal clears it. Poll options only select a radio value; the explicit submit button sends the choice. Closed features render nothing. All new text uses the shared web catalogs or the new app-only cinemaViewer area and its ten translations.

Verification includes helper, rendered-screen, navigation, deferred-load and metering regressions, followed by the frozen mobile proof command. One existing series-test fixture additionally sets AppState to active because its previously unspecified state cannot satisfy the new visibility rule; its existing entitlement, order and heartbeat assertions remain intact. No native environment or preview server is created.
