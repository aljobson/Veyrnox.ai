# ADR-0246: Oddlings saved in Projects

Status: accepted design; slice 1 implemented behind a disabled flag. Slice 2 is a
separate work order after slice 1 merges. Amends ADR-0158 (storage) and ADR-0131
(phone Projects read-only), without editing either ADR.

## Context

A passport is character data, not an image. The phone currently stores one
installation-wide collection of up to 24 passports plus a draft. That file has no
account key, so another account using the installation can see it. The web has a
separate browser-local collection.

The phone's figure is an offline stylised stand-in. Create generates the actual
picture as a paid generation and already saves it in the person's Library. Assets
is a menu section containing Library, Projects, Brand kit and Credits, not a
separate passport store. Project media assets accept only uploaded media, are
immutable, and uploads are disabled in production. Save passport data to Projects;
do not invent a portrait upload or a separate Save to Assets action.

## Document and account boundary

A project holds one Oddlings collection in this document:

```js
{
  schema_version: 4,
  project_id,
  brief,
  canvas,
  oddlings: { version: 1, items, draft }
}
```

The collection retains the phone's serialization. The base brief and canvas have
v1 rules; v4 additionally refuses control characters and malformed Unicode in all
strings, including object keys. Top-level and nested record keys are exact.
Items have exactly `id`, `savedAt`, `name`, `picks`, `motionId`; at most 24 items,
with unique ids matching `[A-Za-z0-9._-]{1,80}`. Names occupy 1–40 UTF-16 units;
motion ids match `[a-z0-9-]{0,40}`. Picks have at most 64 keys, each matching
`[a-z_]{1,40}`, and string values of 1–160 UTF-16 units. A draft is null or exactly
`{savedAt, picks}`. Timestamps are integers from 0 through 100000000000000.
SQL counts supplementary characters as two units to match JavaScript. Options
are not validated against the catalogue; clients sanitize them on read.

The whole stored **jsonb text** must fit 32768 UTF-8 bytes, including PostgreSQL's
spaces after colons and commas. `jsonbTextBytes` computes that size for well-formed
documents with integer numbers; validation checks string well-formedness first.
PostgreSQL itself rejects lone surrogate escapes when parsing jsonb. No new SQL
Unicode-repair rule is needed. The brief and canvas remain for the base contract,
not as a place to encode passports.

The first revision fixes the project's kind permanently. Saving editor/brief
work onto a v4 head, or v4 onto an editor/brief head, returns `KIND_CONFLICT`
(PT409). The check runs after restore resolution and validation, under the
existing project lock. A restore of the same kind appends a new revision. Existing
v1–v3 transitions, idempotency, role checks, audit, and caps remain unchanged.

All API database calls retain the person's JWT. Existing Projects RLS enforces
workspace membership; there are no service-role reads. Today workspaces are
provisioned for their owner. A future shared workspace will share its Oddlings
with its members under the same Projects roles, rather than making this document
private to one member. ADR-0111 account deletion still refuses deletion while any
live project exists (`projects_present`); an Oddlings project counts.

## Slice 1: server and web guards

The new validator is separate from `validProjectDocument` and `withTimeline`;
editor project files still refuse v4. The document PUT accepts v4 only when
`PROJECT_ODDLINGS_ENABLED` resolves true via `oddlings` in `EDITOR_RUNTIME_FLAGS`.
Absent or disabled yields 404 `NOT_FOUND` before v4 validation or upstream calls.
The existing tenant Projects gate still applies. GET, restore, and v1–v3 API
behaviour remain unchanged.

The new grouped key is absent in both production and staging. No binding or
`wrangler.jsonc` value changes. After the owner-approved migration and 24 clean
hours, the owner can add `"oddlings":"true"`, staging first, then production.
Migration 0361 follows 0358 (store refund ordering, on main), 0359 (job cancel, open PR) and 0360 (Film Studio cloud saves); the host renumbers if one of them lands differently.
Deployment and migration application are outside this implementation work order.

Every specified editor adoption path refuses v4 using the existing
`app.editor.project.unavailable` message: open, attach, remote adoption, restore
response, and save. Remote/restore rejection detaches the project while keeping
the on-screen timeline. The web project page refuses v4 before showing any editing,
history or restore UI, including initial load, review of the remote head, and
accepting a remote document. An unavailable page cancels autosave. This checkout's
remote-head fetch is `reviewLatest`, not a polling effect. The existing app locale
bundle supplies the message; no new strings are introduced.

The new SQL bounds helpers revoke execute from PUBLIC, anon, authenticated, and
service_role. The existing authenticated invoker-wrapper exception for
`save_project_document` remains (ADR-0051); no privileges allowlist expansion.

## Slice 2: separate phone work order

The phone will choose or create an Oddlings project, load v4 collections, accept
revision-zero projects, and refuse projects containing other work. It will save
with the revision it read and an idempotency key reused only for identical intent.
On 409 it re-reads and reapplies one edit (add, update, or remove one id), never
resubmitting the entire stale collection against a newer revision.

The local file becomes an account-scoped cache of the server copy and pending
items. Account adoption/switch/sign-out sweeps other accounts' cache files and
resets Builder/Saved. An in-flight write must check the account again before
writing. Signing out removes unsaved local items, not saved server collections.
The UI labels items that remain only on the phone and never silently drops the
oldest item to fit a full project.

The proposed legacy policy claims the installation's old file once for the first
account adopted after update, offering Save to a project or Discard. If public
installs exist, the owner must decide whether to discard unread instead. This
choice and its two-account tests belong to slice 2.

The phone will make `oneLine` surrogate-safe, replace any remaining lone surrogate
with U+FFFD, and repair existing/legacy picks on read, re-deriving names. Hermes
uses an explicit code-unit well-formedness check. Shared fixtures/drift tests must
match the server validator and byte calculation, including emoji boundaries.

Revisions are append-only: 1000 per project, 30 tenant writes per minute, 2000
saves per person per day, and 200 projects per workspace. The 600 ms draft autosave
stays local. Server draft writes occur only on explicit Save, Create hand-off,
and once when leaving a changed builder. These rules conserve the permanent
revision budget. The phone must report a full project instead of truncating it.

## Deferred and verification

No mobile implementation is included in slice 1. Web Oddlings parity (studio
project picker, Film Studio, Create hand-off and every locale), media assets,
portraits, sharing features, a project kind column/filter, and catalogue option
validation are deferred or out of scope.

Node tests cover validation, flags, JWT forwarding, byte boundaries, Unicode and
source guards. The DB acceptance script runs in one rolled-back transaction on a
throwaway local database and tests malformed payloads, idempotency, both kind
conflicts, optimistic concurrency, restore, RLS read/write isolation, helper
privileges, exact size boundaries, and PostgreSQL surrogate rejection. CI runs it
next to the unchanged project/timeline/multitrack, organization and write-cap
scripts; the existing default-privilege check remains unchanged. `npm test` is
the agreed local proof command. DB execution remains a separate verification
requirement; writing the script is not evidence that it passed on PostgreSQL.
