# ADR-0344: Music beat cloud saves and versions

Status: Implemented behind disabled `MUSIC_RUNTIME_FLAGS.beatCloud`, pending independent review and host acceptance.

The free web beat editor saves account-bound documents after local IndexedDB saves.
Both `beatEditor` and `beatCloud` must be enabled (and the existing Music UI and tenant gateway enabled).
No new Worker binding, job, ledger or credit-balance writer is introduced.
Documents remain exact JSON text, not jsonb: byte-preserving reads and idempotency
comparisons must not reorder keys or normalise whitespace. The Worker validates the
whole beat; SQL checks identity, format, version, title, track count and byte size.

Caps: 50 projects/account, 256 KiB/document, 20 versions/project, 64 takes/project,
1,000,000,000 take bytes/account, 20 successful writes/minute and 2,000/day.
Worst-case version storage is about 256 MB/account. Autosave versions are spaced
five minutes apart; checkpoints preserve the previous revision when needed.
Keep mine checkpoints both sides; Load theirs first uploads every local take and
stashes the latest local document, then replaces under a local write barrier.
Stash keys live only as long as their retained version, so a pruned retry preserves
the document again. Restore is one undoable edit. Copies with cloud-only takes are
refused until a future phase can copy media safely.

This deliberately widens ADR-0245's user-JWT surface: owner-only column SELECT on
`music_beat_projects`, `music_beat_project_versions`, `music_beat_project_takes`, plus
five public invoker/private definer pairs: save/remove project and reserve/confirm/read
take. All tables force RLS, and service_role has no grants. Keys, owner IDs and stash
request keys have no column grants. Functions use an empty search path and per-user
advisory locks. No feature route uses service-role credentials.

Take keys are server-generated UUID paths in private R2. Upload signatures bind size,
WAV content type and If-None-Match. Their TTL is below the reserved 15-minute deadline
(with a transport margin); ready objects never receive new PUT signatures. Confirmation
uses the existing R2 signer with HEAD and checks measured size. Mismatches delete the
pending object; lost PUT/confirm responses recover by confirming first and accepting
PUT 412. GET URLs last five minutes. Delete triggers enqueue keys after the last
recorded upload expiry plus five minutes, including project and Auth-user cascades.
Postgres cascading DELETE acquires the take row lock before its AFTER DELETE trigger;
reserve updates the same row under FOR UPDATE before a signature can be returned.

All four tables are WITH_AUTH_USER, like Film Studio. ADR-0111 erases the public user
then removes Auth; no earlier users.deleted_at trigger is added. ADR-0250 and its
current drift-guard list exclude Film saves from automated privacy export. Beat tables
follow that classification; before activation, add an export section for beat documents,
versions and take metadata (or obtain an explicit revised privacy-export decision).

Activation: independently review, run unit/lint and database proofs, apply 0542 by the
normal migration workflow, observe 24 hours of clean reconciliation, satisfy the
privacy-export prerequisite, then the owner adds `"beatCloud":true` to the staging
`MUSIC_RUNTIME_FLAGS` string
in `wrangler.jsonc`, updating the matching pin in `tests/runtimeSwitches.test.mjs` if required,
and verifies two browsers, media, keyboard access and both widths. Only the owner enables
production by adding the same key to its `MUSIC_RUNTIME_FLAGS` string and updating its
test pin if required. The absent key means off; no binding is added. Turning off
beatCloud hides the UI and refuses the routes.

Proof: `npm test && npm run lint`; local migration replay followed by
`scripts/test-music-beat-cloud.mjs`, default-privileges, account-deletion and privacy-export
acceptance; Worker build below 60,500 KiB; regenerated Vey inventory; host UI checks.
Builder evidence and any unavailable checks are reported separately. ADR-0344/0542
were free locally; the open-PR allocation check could not reach GitHub in the sandbox.

Security: a signed-in user can call reserve/read directly through PostgREST with their
own JWT and see their own object keys. Keys are not credentials: R2 access still
requires a Worker-signed URL. This owner-visible key surface is accepted. Gateway
responses and column grants continue to omit raw object keys.
