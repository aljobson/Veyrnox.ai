# Editor completion staging qualification — 11 October 2026

This records staging preparation for PR #885. It does not establish full CapCut parity, production activation, provider acceptance or a clean production observation window.

## Database and deployed configuration

The canonical files were applied to staging project `yrqzwqywxfesmbvhzjgj`:

| Migration | Application receipt |
|---|---|
| `0285_editor_library_renders` | `20261011091553` |
| `0286_editor_folders_and_fonts` | `20261011091558` |
| `0287_tiktok_submission_fence` | `20261011091604` |

Production has not received these migrations. Its owner-approved migration workflow and subsequent complete clean observation windows remain required.

Worker version `e10f3299-cc95-4a32-b795-abd60d66feff` was deployed at 100% on staging at `2026-10-11T09:23:29.656384Z`, from head `0248ab543e93ef2036194a9ea7f52bd2e89843bf`. Readback confirmed staging identity, `EDITOR_ORGANIZATION_ENABLED=true`, `EDITOR_LIBRARY_EXPORTS_ENABLED=true`, `EDITOR_LOCAL_INFERENCE_ENABLED=true` and `PUBLISH_VIDEO_DESTINATIONS_ENABLED=false`. Existing remote `WEBHOOK_DELIVERY_LOG_ENABLED=false` was preserved. Production was not deployed.

Hosted ACL checks confirmed browser table writes and anonymous reads are denied, public render wrappers remain invokers, inspection/submission fencing are service-only and the organization validator remains private. Fresh direct checks at `09:27:06 UTC` returned zero for all seven reconciliation counts. The nightly reconciliation cron succeeded at `03:17 UTC`; the new 15-minute render-expiry cron succeeded at `09:30 UTC`. These isolated samples do not establish a 24-hour window.

## Signed-in cloud project journey

The owner signed into staging through its normal Google flow. A disposable project `df6ad7bc-5334-47a1-b0b3-c8045eef6750` was created through Save to a project. The editor imported the original synthetic `tests/fixtures/editor-render-360p30.mp4`, created `Qualification/Source`, assigned that folder, added a title and loaded the repository's Archivo OFL font. No footage identifying a person was uploaded.

Saved revision 7 survived a real page reload. The UI restored the folder, clip and title and requested the local source/font again. The hosted `project_document_versions` row independently contained the two explicit folder paths, the title's selected custom family, 34,928-byte WOFF2 declaration, SHA-256 `8f704806dbedeaaeca334b11ec348bc3ac3a439d6431544b3afb54f534ee4967` and OFL/source metadata.

Relinking the original video succeeded. Export explicitly refused the missing Archivo font; relinking its exact bytes changed it to Loaded. The reopened edit then exported a real 20,999-byte MP4 containing 90 H.264 pictures at 640×360/30 fps and AAC audio. The MP4 container duration was 3.072 seconds; the video contains three seconds of pictures. This is bounded font/save/reopen evidence, not larger export qualification.

## Delivery finding and remaining checks

The first actual Save edit to Library action failed before reservation. Browser network logs showed the page's restrictive `connect-src` rejected fetching the export's `blob:` URL. The fix retains the already-created immutable Blob in the export result and passes those bytes directly to delivery; the page CSP is unchanged. A regression requires delivery to succeed when blob fetching is forbidden. The corrected staging deployment and Library reservation/inspection/readback/Publish-draft journey remain pending at this checkpoint.

The earlier feature journeys have positive local Reticle verdicts and decoded-output evidence. Hosted staging carries no development SDK, and a Reticle lease returned `sdk_never_dialled`; that connection limitation was reported and the lease released. Hosted journeys use the native browser and real backend evidence; no hosted Reticle verdict is claimed. Command-line HTTP smoke requests encountered Cloudflare 1010 protection and were not treated as application checks or bypassed.

The font-removal browser guard remains unverified following the earlier automatic approval-review rejection. No paid generation, publication or production flag activation was performed. Provider/licensing, translation, lyrics, semantic relight/reshape/generative movement, TikTok Ads and broader quality gaps remain in [the inventory](CAPCUT-GAP-2026-10-10.md).
