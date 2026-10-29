# ADR-0299: Phone brand kit edits text styles and brand assets

Status: Proposed

Amends mobile parity P7: the phone brand kit now drafts text styles and project
asset attachments as well as its name, palette and fonts. Only Save writes the
kit, with the existing version and idempotency key. The host assigns this ADR's
number. No server, package, flag, schema or RPC changes are included.

The validation port follows `lib/editorShared.js:9-14`,
`app/veyrnox/_lib/editorSequenceValidation.mjs:25,79`,
`app/veyrnox/_lib/editorTextStyle.mjs:2-10`, and
`packages/db/schema/supabase/0280_editor_brand_and_review.sql:44-63`:
12 styles, names of at most 80 characters, integer size 2–40 (default 6), exact
required style keys and bounded optional extras, and only the ten system fonts.
Form colours are normalised; opacity percentages become fractions with two
decimal places for changed values. Unchanged displayed opacity preserves the
original stored value, including fractional precision such as 0.295. Web-made shadow and spacing extras survive edits unchanged.
Italic and underline are added only when enabled or previously present.

Assets have six exact fields, UUID identifiers, bounded text without control
characters, and empty or HTTPS licence links without credentials. Links satisfy
both SQL's host regex and URL parsing. They remain plain editable text, never
navigation. The kit retains its 8192-byte client limit, checked before style and
asset problems, to leave room under SQL's 12288-byte jsonb limit. Save-time 404
means an attached file may be missing or no longer inspected; read-time 404
retains the feature-unavailable message (`0280:107-108`).

Remove means detach: no project-asset delete route exists. Every stored asset,
including duplicates and malformed entries, receives a local, unserialised row
key. SQL checks each attachment independently and does not require unique asset
IDs (`0280:61-62,108`). Row edits and removals therefore use the local key. New
attachments still deduplicate by asset ID. `parseAssets` remains unchanged:
non-UUID catalog entries are shown but cannot be attached.

Upload follows `apps/mobile/src/lib/editorDeviceMedia.ts:115-122`: reserve with
an idempotency key, PUT bytes from disk to an HTTPS grant, then inspect. Grant
asset IDs must be UUIDs and content types must match the validated picked file.
Every fresh pick is a new attempt; the API's transport retry reuses its request
key. No separate picked-file retry UI is introduced. Only inspected files are
attached. Nested server error codes are decoded locally because the shared API
client intentionally keeps its string-only code rule
(`packages/security/errors.js:14`, `apps/mobile/src/lib/api.ts:126-129`).

Uploads require `PROJECT_MEDIA_UPLOADS_ENABLED` and CSAM admission
(`app/api/v1/projects/[id]/assets/route.js:31-41`). Per owner decision, production
remains off (`wrangler.jsonc:79`); staging is on (`:323`). A reservation 404 explains the
unavailability and hides upload buttons for that project; project chips remain
available. An inspection 404 is a rejected file, not feature unavailability.
Workspace attachment remains available. A 503 reports the admission pause.

ADR-0291's session task is captured before opening the native picker, not when
it returns. Every request carries that task and an abort signal. Picker,
transfer and inspection continuations check the task, mounted state, workspace,
and continued membership of the selected project before effects. Unmount or
workspace change aborts the transfer; account switches remount the authenticated
screen tree. Reads use sequence counters as well as session guards, including
workspace A → B → A and catalog refresh ordering. Existing project/workspace
read helpers receive an API adapter that passes the captured task, without
changing those helpers.

The editor holds a synchronous latest-draft ref, mirrored into React state.
Every draft change commits through it. Asset mutations receive the current
rows and return both new rows and an outcome synchronously. No outcome is
computed inside a queued state updater. Thus edits, removals, duplicate checks
and capacity checks remain correct when an upload finishes while a render is
pending, including Strict Mode. Upload status is selected from the returned
outcome. A file inspected after its fence fails, or after the kit fills to 24,
remains an unattached project file. A current full-kit completion refreshes the
catalog so the file can be attached after another row is removed.

The development mock exposes two UUID assets and refuses unknown attachment
IDs with a nested NOT_FOUND 404. It does not mock uploads: an HTTP grant would
be refused. Staging must prove the real storage and inspection gates.

Non-goals: deleting project files, creating projects, inserting styles/assets
into a timeline, applying palette colours to a canvas, custom fonts, editing
shadow or spacing controls, changing flags or save limits, and removing unused
`brand.kept*` catalog entries. Simulator integration must not modify the original
or consolidated checkout for this isolated work order.

The frozen work order's blanket 500-line limit conflicts with its ten existing
locale catalogs and G8-only mock restriction: those files already exceed the
limit. Proposed exception: retain their existing structure and limit edits to
the requested entries and mock behavior. Generated length-review files likewise
retain their generator's format. New implementation and test files remain below
500 lines and the tighter per-module limits.
