# ADR-0369: Music publication takedowns survive republishing

Status: Proposed (frozen work order; migration not applied)
Date: 2026-11-21

## Context

Music publications can be published, unpublished or blocked. A blocked row is
an operator takedown, but publishing previously looked only for a published
row. The owner could publish again with a fresh key and receive a new public
slug, bypassing the takedown.

## Decision

Migration `0576_music_publish_respects_takedown.sql` changes the publish body only in
`private.music_publish_song_pre_0570`, preserving the 0504 implementation renamed
by 0570 except for the new lock and refusal. The public wrapper from ADR-0367
must remain: it mints opaque actor ids after successful writes. The private
function retains SECURITY DEFINER and an empty search path; its full-signature
REVOKE includes PUBLIC, anon, authenticated and service_role. Public execution
remains service_role only, and its grants are untouched.

After ownership/current-version validation and the existing key-replay branch,
publish locks every existing publication row for the song with FOR UPDATE,
regardless of status. A separate statement checks for any blocked row. If one
exists, it returns `PUBLICATION_BLOCKED` before the creator-profile upsert,
attestation insert or publication insert. The wrapper sees a failure and does
not mint an actor. HTTP maps this to 403 `publication_blocked`: the operation is
forbidden by a moderation decision, rather than a retryable version conflict.
The existing POST route already applies both mapping helpers and exposes no
DB text or stack trace.

The restriction is per song, independent of version, permissions or fresh
idempotency keys. Other songs and other owners remain unaffected. A matching
old key, with the song's current version unchanged, still returns `ok:true`,
`idempotent:true`, the same slug and the row's CURRENT status (`blocked` after
takedown). It does not reconstruct the original receipt or make the song
public. If the current version has changed, validation still returns
`NOT_FOUND` before replay. The successful-replay actor-minting behavior of the
wrapper is unchanged. Unpublish remains a harmless no-op for blocked rows;
public track reads remain not found.

The same migration installs `music_block_publication_siblings`, an idempotent
AFTER INSERT OR UPDATE OF status trigger, firing only when NEW.status is blocked.
Its private SECURITY DEFINER function has an empty search path and no caller
grants (PUBLIC, anon, authenticated and service_role are explicitly revoked).
It sets all published rows for NEW.song_id to blocked with updated_at=now().
This closes the case where an old unpublished slug is taken down while a newer
slug is live. Recursive calls terminate because only published rows are updated;
unpublished siblings and other songs are unchanged. No existing data is changed
when the migration is applied.

## Concurrent moderation

Moderation tooling must UPDATE an existing publication row to blocked, taking
the same row lock. When targeting an unpublished slug it must also set
`unpublished_at=NULL`: the existing CHECK constraint requires that timestamp
only for unpublished rows. If that UPDATE is in flight, publish waits; the subsequent
blocked check sees the committed status under READ COMMITTED. If publish gets
the lock and commits first, moderation waits and then takes the row down. The
trigger's UPDATE sees and blocks the newly committed live sibling even if the
moderation statement began before that sibling was inserted. This includes
publishing a new slug while holding the lock on an older unpublished row.
INSERTing a separate blocked row fires the trigger for already visible live
siblings, but does not participate in the existing-row locking protocol and
is outside this concurrency guarantee. A committed blocked row is checked
regardless of how it was originally created. Moderation must use the UPDATE
protocol for concurrent safety; the trigger is not a general constraint against
arbitrary direct SQL writes that later introduce published rows.

## Clients and scope

The web publication dialog already maps error codes to copy. Its new message,
“This track was taken down and cannot be published again.”, uses useI18n and
`musicEnglish.mjs`, the existing Music English fallback for every locale.
An HTTP-successful replay with publication.status='blocked' clears the attempt
key and stores the returned publication, but shows that same error message and
does not announce Published. Ordinary successful publication is unchanged.
The phone already hides Publish for a blocked row; a stale client now receives
the typed refusal. No mobile code changes.

Copies, reuse/remix descendants, re-uploads by another account, notifications
and operator tools are not covered. Operators set or clear blocked status
through SQL; clearing means changing status back through SQL while respecting
the publication constraints. Since the trigger can block multiple siblings,
operators must clear every blocked row for the song before publishing can
resume. This change provides no new moderation UI.

## Rollout and verification

Apply the migration only through the approved apply-migrations workflow after
owner approval. No new switch: behavior changes only for songs with a blocked
publication. This work does not apply the migration or publish any deployment.

Required read-only preflight, reviewed by the owner/operator before or right
after apply, identifies pre-existing blocked/live sibling pairs:

```sql
SELECT b.song_id, l.id, l.slug
FROM public.music_publications b
JOIN public.music_publications l ON l.song_id=b.song_id AND l.status='published'
WHERE b.status='blocked';
```

The trigger does not retroactively repair those pairs during installation.
Any corrective data operation is a separate owner/operator decision; there is
no data cleanup in this migration.

The disposable replay suite reuses `music-blocks-bootstrap.ts` and runs alongside
the Music blocks suite in CI, excluded from the migrate-base acceptance glob.
It checks normal publication, actor minting, full-row snapshots on refusal,
fresh keys and changed versions/permissions, exact replay semantics, unchanged
unpublish/public reads, independent songs/owners, both concurrent lock orders,
function grants and two migration reapplications. It also checks takedown of
an old unpublished slug with a live sibling, insertion of a blocked row beside
an already committed live sibling, and the two-connection publish INSERT race
against moderation of the old slug. Lock waits are observed via
`pg_blocking_pids` with bounded polling and statement timeouts. The bootstrap
creates and drops one isolated local database (about 100–300 MiB temporary
storage); it does not install dependencies. Run heavy validation through
`~/.local/bin/with-build-slot` with one test worker.

Node proof: `node --test tests/musicBlocks*.test.mjs`. This includes the existing
wrapper drift guard, the 403/code mapping, the POST response boundary, and an
exact-body comparison against 0504 with only the added block removed, trigger
structure/grants, and execution of the dialog submit handler for blocked replay
and ordinary success. The agreed focused command is
`node --test tests/musicBlocksTakedown.test.mjs`. The SQL
suite also checks the replayed pg_proc body against that baseline. Host checks
must include default privileges, account deletion, privacy export, route-gate,
ADR/docs checks and lint.

## Implementation environment and plan deviations

The initial implementation found 0576 and 0369 free across 1,906 local refs.
The fix-round recheck covered 1,910 locally available main/remote refs (1,063
distinct directory trees). No 0576 migration was found, but origin/main now
contains `0369-mobile-ota-app-version-runtime.md` (b757d1cc4). This work retains
ADR 0369 as explicitly requested by the frozen fix round; the host must resolve
that numeric collision before integration. GitHub DNS access failed, so current
remote branches and open PRs still require independent verification.

Local PostgreSQL TCP access was denied and no default Unix socket was present.
Consequently the implementation body was copied exactly from 0504's source as
renamed by 0570, rather than extracted from a database replay here. The host
must run the disposable acceptance suite and database audits; those results
are not implied by the Node proof.

The above database limitation records the initial implementation. The accepted
fix round explicitly prohibits running PostgreSQL here; only cheap Node checks
are run, with database replay, concurrency and privilege audits left to the host.
0576 and 0369 are retained as requested. The operator/test UPDATE of an old
unpublished slug includes unpublished_at=NULL to satisfy the existing constraint;
no constraint or applied migration is changed.

The requested ADR baseline update conflicts with the repository's frozen
historical index process (`scripts/adr-index.mjs` and `docs/adr/README.md`).
This ADR is discovered by the generated index; the historical README,
`index-baseline.txt` and `index-readme-lines.sha256` remain unchanged.

The optional dialog copy changes the generated Vey knowledge source hash.
`lib/generatedProductInventory.js` is refreshed with the repository generator
as an additional derived file, required by `sync-vey-knowledge.mjs --check`.
