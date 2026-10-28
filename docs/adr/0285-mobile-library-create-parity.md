# ADR-0285: Mobile Library media, Create results and Templates

Status: Proposed

The phone Library, Create canvas and Templates gallery need the same useful media and completion states as the website. This decision covers parts A and B without changing server pricing or generation behavior.

Library defaults to a media grid. Signed links are requested lazily for visible completed rows and for jobs that finish while polling, including older loaded pages. A shared memory-only cache deduplicates requests, limits concurrent requests to three and refreshes links after twelve minutes. The account quota is 120 signed links per minute; a 429 pauses all queued and new requests until Retry-After (sixty seconds by default). Neither links nor generated media are persisted. Video posters use native thumbnails, with two concurrent players, a timeout and deterministic release. Account changes clear media and invalidate pending callbacks.

While focused and active, Library polls up to 24 in-flight jobs every three seconds. Completion metadata is resolved independently through the asset endpoint, without refreshing the list. Missing metadata is retried; cooldown is not a failure. Twenty consecutive ticks where every sent call fails stop polling and present Retry. Held files have an explicit Under review state on Library, Create and the job page. Visible outputs carry an AI generated label and the job page shows the server's expiry.

Create keeps single and batch results on its canvas. A failed or partial submission retains its idempotency keys and accepted tiles. Retry prices cover only unconfirmed items. New generation resets the batch without posting or charging and preserves form settings. Free allowance is re-read after every run; catalog prices are shown and Generate is disabled during the read. Balance reads are guarded by account, batch and a screen-wide sequence so old responses cannot overwrite newer refund reads. Failed jobs only say refunded after the job confirms it, with a bounded delayed refund recheck. In-place success celebrates; the store review ask stays on the job screen only.

The optional generated sound step is available after any single successful video within the live MMAudio source limit. This generalizes the web's Faceless Reel-only step by owner decision. The result becomes an asset reference; the next form requires a fresh rights statement and shows its own price.

Templates use search, conditional New and Popular filters, categories, a collage, paginated cards and a dedicated editable template page. Popular preserves server ranking. Valid template ids travel through Create and are submitted for server-validated attribution. Prices remain catalog/feed values. In accordance with ADR-0266, previews start only after a deliberate action, begin muted, stop on blur/background and never autoplay. Gallery previews have one active player.

Part B adds the model page, Premium labels, project document editing, home invite and home chips. It reuses template filters and templatePageHref. Those changes require no expansion of this decision and do not include template steps or server/web changes.

Inspection 1 permits one necessary test whitelist exception: `apps/mobile/__tests__/explore.test.ts` retains only the two route expectation updates adding `tid: 'a'`. These exact-object assertions exercise `presetHref`, whose new template attribution parameter is required by this work order; reverting them would fail the existing tests for the intended behavior. No Explore production behavior is changed by this exception.
