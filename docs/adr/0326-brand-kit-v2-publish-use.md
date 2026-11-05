# ADR-0326 — Brand kit v2 and opt-in use in Publish

Status: Implemented in source; migrations 0441 and 0442 not applied.
Date: 2026-11-05.

## Decision

A workspace kit accepts schema versions 1 and 2. Optional v2 fields are an image
logo reference, a voice of up to 500 characters without control characters, and
up to 30 hashtags of 1–60 Unicode letters, numbers or underscores. A leading
`#` is accepted and removed on save. Existing v1 kits read with v2 defaults:
`logo: null`, `voice: ''`, `hashtags: []`. Migration 0442 replaces the validator,
reader and writer in place; no stored kit needs a bulk rewrite. SQL hashtag
validation uses explicit Unicode L/N ranges to avoid database-locale differences.
The class was generated from Unicode 17.0 data by enumerating code points with
JavaScript `/[\p{L}\p{N}]/u` in Node.js v26.7.0 (V8 14.6, ICU 78.3).
SQL's frozen class and JavaScript engines' Unicode data can drift. This is an
accepted risk: a tag accepted by the client but rejected by SQL surfaces as a
400 response at save time; the draft is kept for correction.

When a client omits `logo`, `voice` or `hashtags`, the writer preserves the stored
value under the workspace lock. This protects v2 fields when the mobile v1 client
saves its older kit shape. An omitted logo survives only when its asset remains
in the incoming assets; otherwise the logo is cleared. Explicit `logo: null`,
`voice: ''` and `hashtags: []` still clear those fields. The merged kit goes through
logo membership, asset permission and size checks. Idempotency receipts retain
the original incoming request, so a v1 retry remains a replay.

A logo must also be present in the kit's assets and resolve to an inspected image
in the same editable workspace. The writer checks it using the acting tenant
identity. Existing asset permission checks, optimistic versions, idempotency
receipts and 12288-byte database / 8192-byte client limits remain in place.
The authenticated editor RPC surface remains the ADR-0051 exception; Publish
functions remain service-role-only, with locked search paths and explicit ACLs.
Editor read/save wrappers and private functions are authenticated-only; the
internal validator has no anon, authenticated or service_role EXECUTE grant.
The explicit service_role revokes in 0442 are intentional: editor functions
serve only the tenant JWT path, not Publish’s service-role path.

The editor offers colour swatches and hex editing, image-logo selection from the
kit’s own inspected image assets (with the workspace catalog for adding assets), voice and hashtag editing, and saved text-style name
and size editing. Field errors appear before Save. Loading, retryable load
errors, a new-kit prompt, read-only permissions, saved status and version
conflicts with Reload are explicit states. Only VERSION_CONFLICT shows the newer-version
message; account_changed uses the existing account-change message. New copy and
validator diagnostics are translated into all eleven supported locales. The
round-7 English fixture’s brand entry is updated because the completed panel
intentionally replaces the comma-separated palette input and adds new fields.

Publish reads the selected brand's linked workspace kit. Every read rechecks
that the person who linked it still has OWNER, ADMIN, CREATOR or EDITOR access.
Removed membership, a downgrade to VIEWER/REVIEWER, or a deleted workspace,
organisation or linking actor makes the link stale and returns no workspace data.
A member sees presentation data only: voice, hashtags and `hasLogo`, never asset,
project or workspace IDs, or the workspace name. The kit name remains visible.
Only the owner receives the workspace name and ID.

The card and composer capture a brand snapshot for each load and subscribe to
brand revisions. Reads and link writes carry that snapshot; old completions are
discarded and old kit state is hidden immediately on a brand change.

The composer displays voice as a read-only hint and offers **Add brand hashtags**.
Only a click appends missing whole tags, deduplicated case-insensitively. Before
changing the caption, it checks the existing 4000-character input bound and each
selected destination's existing caption-length logic (including Bluesky graphemes
and network overrides). The button is disabled when the main caption would not
change. If a selected destination has a separate platform caption, a one-line
hint states that it is unchanged. It never truncates tags or applies them automatically.

## Scope and validation

No posting backend, mobile code, deployment flag or ADR index change.
The host’s round-2 disposition authorizes all-locale translations, superseding
the original English-only scope. Telemetry’s allowlist is replaced in unapplied
0442 to include the new route without editing applied migration 0431.
Existing picker components are extracted from Composer to keep touched components
under 500 lines. Route and editor tests cover contracts, malformed array input,
projection, authorization and hashtag insertion. The local PostgreSQL acceptance
suite covers link authority, stale states, v1/v2 data, image validation,
idempotency, optimistic conflicts and denied browser-role access.
