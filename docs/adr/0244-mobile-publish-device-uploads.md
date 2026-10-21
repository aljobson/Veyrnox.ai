# ADR-0244: Publish device uploads on the phone

Status: Implemented; host device verification pending.

This amends ADR-0122's device-upload non-goal. Compose and approval creation share a controlled upload panel, visible only when social accounts returns `uploadsEnabled: true`. A route response of `503 uploads_not_open` quietly closes it. Uploads remain outside AI consent: these files are for social publishing.

The phone reads the exact size from `new File(uri).size`, after any conversion, because the signed PUT binds Content-Length. Native UploadTask streams the file without loading it into JavaScript memory and supplies Content-Length. The phone sends a neutral local-date filename, never the device filename. HTTPS upload hosts must end in `.r2.cloudflarestorage.com`; development additionally accepts the HTTP API origin for the mock server.

HEIC/HEIF is rendered once as full-size JPEG. Other unsupported types, including iPhone `.mov`, are refused. The camera captures photos only and never requests microphone permission. Picked and converted cache copies are discarded on completion, failure, cancellation, account change and unmount, including late picker/conversion results. Remote image previews disable disk caching and transitions.

Rights wording is binding from `lib/i18n/messages/app/en/publish.mjs`, key `app.publish.uploads.rights`: “I own this content or have permission to store and publish it.” Each attempt requires a fresh checkbox tick. Uploading selects media; only the existing confirmed post/approval path sends a post. Preparing a file blocks those send paths, including previously opened confirmation callbacks.

Every retry reserves a new URL; no automatic retry or foreground retry occurs. Failure and same-account cancellation attempt one DELETE. A deleted reservation holds a slot until the PUT window ends; allow 20 minutes before storage is freed. The quota is 10 files / 200 MB. An account fence prevents later requests, including DELETE, under another account. Such pending reservations are swept by the server after 24 hours.

An iOS background session can finish the PUT while the app is suspended. If the runtime survives, completion continues when JavaScript resumes. A killed runtime is never resumed by the phone. GET lists ready uploads only. Account, cancellation and mounted signals remain independent: unmount aborts and cleans up without state updates or parent callbacks, per frozen-plan Revision 3.

The existing packages suffice. Updated camera and photo permission wording requires a new native development build before the host's staging tests (large HEIC, 90 MB MP4 progress/cancel, network drop, 60-second suspension, MOV refusal, approval and flag off). No native build or publishing is part of this source change.

## Decisions for the owner

- **Photo and video metadata is not stripped.** `exif:false` keeps EXIF out of the JavaScript picker result; it does not strip metadata from file bytes. The upload flow sends library JPEG/PNG/MP4 files byte-for-byte, so embedded GPS and camera metadata reaches the social networks. HEIC/HEIF re-encoding to JPEG likely loses that metadata, so behavior differs by type; this is not a verified stripping guarantee. A follow-up option is to strip metadata consistently before uploading, with explicit format and quality decisions and device verification. This work does not introduce stripping.
- **Staging gate only.** The owner must set `PUBLISH_UPLOADS_ENABLED="true"` on staging only for the planned device checks. Production stays off. This change does not set either environment's flag.
- **Camera permission wording.** `app.json` now says “Veyrnox.ai uses the camera when you take a photo to post with Publish.” The photo-library permission also mentions Publish. The owner must include these strings in a new development build; the camera remains photos-only and microphone permission remains false.
- **Neutral filenames.** Keep the type-and-local-date filename, such as `Photo 2026-10-21 14.05.jpg`, instead of the device filename. This hides the original filename but does not remove metadata embedded in the file.

The mock handler is additive: it handles every `POST /api/v1/social/approvals`, including bodies without an upload ID. Upload-backed approvals validate a ready upload; creation-backed approval bodies also receive mock review links. This behavior is confined to the development mock server and does not change the real approvals route.
