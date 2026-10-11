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

## Delivery correction and hosted result

The first actual Save edit to Library action failed before reservation. Browser network logs showed the page's restrictive `connect-src` rejected fetching the export's `blob:` URL. The fix retains the already-created immutable Blob in the export result and passes those bytes directly to delivery; the page CSP is unchanged. A regression requires delivery to succeed when blob fetching is forbidden.

The corrected head `3d2ccf02c832553da5d8011b81537a6595d1356f` passed CI and the Worker build, including pinned speech/person asset verification. It deployed to staging as version `4598a3dd-d463-4d9b-ad43-0f13add231a8`. Readback retained the same staging identity, gates and existing webhook-log setting. A real reload loaded that build, and the original video/font were relinked before exporting again.

Save edit to Library completed and the UI linked the private saved edit. The hosted row `b83ae3de-57a3-405f-bc0c-bbfa904080b3` was marked `stored` at `09:40:40 UTC`, with SHA-256 `b6ad321f4c78a0382ba02fd21d71e031c24ae5dd01444be5026fd1beb63dc22d`, 20,999 bytes, 640×360, three seconds and 30 fps. The actual Library listed those values; its player loaded the private object with `readyState=4`, 640×360 intrinsic dimensions, 3.072-second container duration and no media error.

Prepare video in Publish completed through the existing device-upload inspection. Hosted upload `94841f55-ec6d-425c-99eb-b15e6aac9476` was `ready`, with matching name/MIME/byte size. The composer opened from its opaque upload identifier with Video selected and the owned file already chosen. Post now and Schedule post were disabled without connected accounts; no post or schedule action was taken. The Library and Publish copies each contain the same synthetic test export.

The owner explicitly approved removal of this qualification project and both test copies. Normal browser controls removed only those items, and the UI reported Project deleted, no Publish uploads and no saved editor video. Hosted readback at `09:52:32 UTC` confirmed project `deleted_at` was set, the Library row was `removed` and the Publish upload was `deleting`. Their signed-upload safety periods end at `09:56:39 UTC` and `09:57:01 UTC` respectively; physical object deletion is deferred to the normal cleanup jobs after those periods. At readback neither object was queued yet. Existing generated assets remained visible, and the displayed credit balance stayed at 1,000.

The dedicated speech draft showed the existing live Fal speech catalog and quote; a two-speaker dialogue enabled its draft control without submitting a job. Avatar selection used the current actor's Library photo picker and exposed the consent statement; the owned speech picker reported no finished audio. Switching to LatentSync exposed required video/audio slots bounded to 40 seconds, and submitting with missing video was refused locally with “Choose the source video.” The captured network interval contained no generation request. KIE speech was not activated or added to the live catalog.

Normal staged person processing loaded the isolated runtime and completed on the one-second synthetic source, correctly reporting zero detected person frames and 30 frames without a person. This confirms hosted runtime execution; it does not qualify person edges or detection quality. Direct navigation to the Worker script was blocked by browser policy, so no raw hosted Worker-header readback is claimed. The page CSP remained restrictive, as the earlier blob-fetch finding demonstrated.

The earlier feature journeys have positive local Reticle verdicts and decoded-output evidence. Hosted staging carries no development SDK, and a Reticle lease returned `sdk_never_dialled`; that connection limitation was reported and the lease released. Hosted journeys use the native browser and real backend evidence; no hosted Reticle verdict is claimed. Command-line HTTP smoke requests encountered Cloudflare 1010 protection and were not treated as application checks or bypassed.

The font-removal browser guard remains unverified following the earlier automatic approval-review rejection. No paid generation, publication or production flag activation was performed. Provider/licensing, translation, lyrics, semantic relight/reshape/generative movement, TikTok Ads and broader quality gaps remain in [the inventory](CAPCUT-GAP-2026-10-10.md).
