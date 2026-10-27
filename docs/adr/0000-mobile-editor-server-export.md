# ADR-0000: Phone editor export and device clips

Status: Implemented behind an opt-in phone flag; host acceptance pending.

The frozen work order is `phone-export`, SHA256
`015abbd6b4411e8b5c4e3da41c6dc57884428e2f90a6d52dd4ab108b39c1ae47`,
based on commit `8924dc917`. Implementation paths are relative to the builder checkout.

## Admission and confirmation

`EXPO_PUBLIC_EDITOR_SERVER_EXPORT_ENABLED` is off by default and is not enabled in
an environment or EAS configuration. With it off, Export retains save-and-compose.
With it on, the phone checks connectivity, saves, checks that the document is clean,
and opens the sheet. Quote probes admission; 501, 404, `not_enabled`, and 403
`preview_only` quietly return to compose. The unavailable account is remembered only
in memory; account changes reset that decision.

Quote sends exactly document and resolution. Credits and duration limits come from
the server. An optional quote for the other resolution supplies its limit without
changing the selected quote. The document, resolution and sanitized project label
form a frozen snapshot. Edits invalidate it. Confirmation names credits, resolution,
upload count and size, and the fidelity caveat: “The server render can look slightly
different from the preview.”

## Export translation and duration

The saved document is never rewritten for export. A deep copy drops unused bin media,
clip/text groups, clips' unit rates, and text style only when it deeply equals the
shared phone default. Other unsupported edits remain intact for server validation.
Used local media lose assetSource only in the export copy and require a durable
device file. `p-` project assets are blocked: the server source resolver does not
support them even if they can be previewed. Missing files, unsupported source IDs,
unknown durations and clips longer than their files prevent quotes and uploads.
Publishing without export remains available.

Durations use verified picker metadata or an Expo Video probe. Generated audio/video
resolve through the job asset endpoint; renders and masters use the Library parser.
Only HTTPS links with matching MIME kinds are probed; stem IDs are refused. Export
frames are floor(seconds × 30).

[SDK 58 docs](https://docs.expo.dev/versions/v58.0.0/sdk/video/#sourceloadeventpayload)
specify sourceLoad duration in seconds, but do not explicitly promise MP3/WAV loading.
The installed iOS VideoPlayer.onLoadedPlayerItem and Android track-change handler
emit sourceLoad without requiring a video track. The probe attempts audio, returns
null on error, invalid duration or timeout, and releases its player. Real MP3, MP4
and remote-video validation remains host acceptance; source inspection is not a
claim of simulator verification.

## Uploads and paid attempts

Only MP4, MP3 and WAV, with the existing aliases and server byte limits, are accepted
for temporary upload. Sizes come from durable files. After consent and confirmation,
uploads run sequentially with validated owner-scoped grants. Local IDs are remapped
to temporary `u-` IDs only in the export copy. Retries reuse an unexpired grant,
accept 412 as possibly stored, and renew after an expired 403. Cancellation aborts
the active transfer. Completed files remain reusable in the sheet until reserved_until,
or 22 hours from the grant request.

Temporary uploads are “scheduled for deletion after 24 hours; cleanup may take longer.”
They do not provide persistence. The existing API consent gate is unchanged.

Before paid create, the immutable key, body, owner, project, credits and send time
are written to userDocStorage. Bodies over 40,000 UTF-8 bytes are refused. A transport
failure retries the identical body and key once. A job-bearing 503 or refunded/
price-changed replay retires the attempt. Acceptance refreshes balance. Restart resumes
polling by validated UUID or replays a mid-send record once. Records expire after six
hours and are removed after displaying a terminal result. Cache wipe and user-document
sweep already cover these owner-tagged records.

Polling runs while active with bounded backoff. Access/not-found responses or five
consecutive failures expose Check again while retaining Cancel. Cancellation confirms
the refund amount. Success offers sharing, Library and compose's job selection.
Raw server codes and links are never displayed as messages.

## Durable media and backup

Device picks are copied into owner/project folders in Paths.document. userDocStorage
metadata includes verified seconds when available. Copy failure silently retains the
existing in-memory preview. Hydration never prunes IDs absent from the current document:
older revisions must still find those files.

Only confirmed deletion, tombstone recovery, owner change or sign-out removes files.
Project deletion writes a tombstone before deleting its folder and metadata; owner
adoption finishes interrupted tombstones. Project/document 404s never imply permission
to delete. Cleanup failures never block navigation.

Supported files receive best-effort project-asset backup through an `edm-<media UUID>`
key, presigned PUT and inspection. A 404 disables backup for that account's app run;
other failures remain quiet and local-only. No failed backup retries across launches.
Completed backup metadata patches current, past and future documents only where the
media already exists. It is not an undo step. Undo/redo merge the backup map again,
and normal saving persists it.

## Review constraints and open acceptance

The literal 500-line limit conflicts with the required locale catalogs and length-review
JSON, which already exceed it. The proposed deviation preserves their required data-only/
generated format and applies the limit to implementation and test files. FullEditorScreen
remains below 500 lines with a small net increase. All ten catalogs contain machine
translations with unchanged slots. Equal-review files are untouched; length reviews
are refreshed only by the designated script.

The local origin/main reference differs from the frozen base, so its diff includes
pre-existing committed changes. The implementation whitelist audit uses HEAD
(`8924dc917`) plus untracked additions and reports that discrepancy.

Host acceptance remains open: with an allow-listed account and enabled server admission
(the planned staging flag is off), complete a device MP4 render, cancel one, relaunch
mid-render, share the result and open it in Library. Verify MP4, Library video and MP3
probe durations. No server, deployment, publishing or simulator action is included.

### Builder validation limitations

The exact proof command was attempted through the required with-build-slot wrapper.
The sandbox denied opening its shared lock at
`~/.local/share/storage-guard/build-slot.lock`, so the full chained proof did not start.
The safeguard was not bypassed. Standalone TypeScript reports missing installed
`@expo-google-fonts/inter`, `instrument-serif` and `space-grotesk` modules in existing
FontCatalog imports. Expo lint is blocked by the installed ESLint version. Dependencies
were not installed into the shared native environment.

Focused feature tests pass, and both registry/check-app-i18n script checks pass. A
separate appTranslations run exposes three incompatible length-review expectations
for ar/es/fr: the required generator only includes literal English keys, whereas the
existing test falls back to English `.other` for locale-only plural forms. Running
`--write` therefore removes rows that the test requires. The proposed deviation is to
add that fallback to check-app-i18n.mjs and regenerate. That script is outside the
frozen whitelist; it remains unchanged. Existing translations were not rewritten to
hide this discrepancy. This prevents a claim that all agreed proof checks pass.
