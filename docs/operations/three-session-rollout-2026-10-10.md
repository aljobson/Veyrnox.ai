# Three Claude sessions: rollout continuation, 10 October 2026

The owner asked Codex to continue all three stopped sessions, then asked for the editor to be visible in Studio navigation and said they would handle Stripe acceptance for Cinema.

## Cinema

The production and staging databases have the monthly-only Cinema Pass at $9.99, a 1,500-minute Pass ceiling and a 300-minute free ceiling. Production weekly and yearly plans are inactive. Production `CINEMA_FREE_CEILING_ENABLED` is true; Unlocks and Pass subscriptions remain false.

The staging RPC acceptance exercised real database functions with disposable users, content and ready-upload stand-ins inside a subtransaction which was rolled back:

- Free playback grants access and records its minute.
- At 300 minutes, metered entitlement and playback both refuse further free viewing with `free_ceiling`.
- A paid episode Unlock spends six credits; replay returns the same Unlock, and exactly one debit exists.
- All five reconciliation counts stay zero. No fixture or ledger change persists.

This establishes database behavior. A signed-in staging player journey, including the ceiling message and real Stream playback, remains required by P6 before production playback activation. Reticle verification was skipped for these database checks because they introduced no UI change.

Production migration 0245 was applied at **2026-10-10 13:08:22 UTC**. The ordinary 24-hour clean reconciliation gate therefore cannot finish before **2026-10-11 13:08:22 UTC (14:08:22 BST)**. The current production snapshot has all five counts at zero; a single snapshot does not establish that whole window. Stripe acceptance and the invoice-backed Stream/payment rates remain owner items in the paywall plan. Production currently has no published Cinema titles or ready Cinema videos.

## Audit and Stripe webhooks

The audit PRs #830, #837, #839, #840, #841 and #842 had already merged and deployed. Production has migrations 0257–0260. This continuation applied the committed, unchanged 0257, 0258, 0259 and 0260 files to AI staging (`yrqzwqywxfesmbvhzjgj`). Readback confirms the refund shortfall column, both cost-abuse count RPCs, core-network submission marking and X token rotation. The four social/count routines retain service-role-only execution grants. Read-only smoke calls return zero counts for an absent account and `ORDER_NOT_FOUND` for an absent refund order.

Missing asynchronous payment events were added to the existing Stripe destinations while preserving every prior event, endpoint URL and API version:

| Mode | Destination | Endpoint | Events after update |
|---|---|---|---|
| Live | `we_1UMb791lXjzff0PSdS7CtOOm` | `https://veyrnox.ai/api/webhook/stripe` | 11 |
| Sandbox | `we_1UMjoo0HgCFIUbChj0p96wTr` | `https://veyrnox-ai-staging.al-jobson.workers.dev/api/webhook/stripe` | 11 |
| Sandbox | `we_1UIj7P0HgCFIUbChND4lHYRn` | `https://veyrnox.ai/api/webhook/stripe` | 6 |

Each now includes `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`. The production-URL sandbox destination is still sandbox mode. No live payment, refund or webhook replay was initiated during this work. The live dashboard readback shows the destination Active and all 11 selected events.

## Browser editor

This change enables the server flag in both environment blocks, adds the Video editor entry to Studio navigation and removes the retired browser preview gate. A server-to-client context supplies the same request-time boolean to the navigation; disabling the server flag still hides the link and returns 404 for the route. Production `TENANT_PROJECTS_ENABLED` stays false.

Verification used an isolated local dev server with project writes disabled. A fresh Chrome page without the editor preview switch rendered the Studio link and editor. Importing a synthetic four-second MP4, splitting at two seconds, adding text and choosing portrait output produced a downloadable file. Reticle returned `verified: "yes"` for export completion and the navigation entry, with partial state coverage: the editor uses React local state and exposes no subscribable external store.

The actual downloaded file was inspected with ffprobe: H.264, 406×720, 30 fps, AAC audio, 4.074667 seconds, 496,839 bytes. A decoded frame at three seconds contains the test picture and the added words. Export issued no network requests or console errors in Reticle's captured action window. This local fixture does not establish every real-footage codec or cloud-save journey.

The temporary Reticle adapter, dependencies and development CSP wiring used for this check are excluded from the release. The existing root checkout's Reticle work is preserved. The focused editor/Cinema suite passed **59 tests**. Production deployment and final live browser verification are recorded after this PR lands.
