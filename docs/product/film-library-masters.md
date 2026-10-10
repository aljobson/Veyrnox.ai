# Film Studio masters in the Library

Film Studio browser exports are separate files from their generated source.
An operator can save an owner-authorized, verified 1920×1080/24 fps MP4 master
under its own immutable storage key. The Library shows these in “Saved Film
Studio masters”, with playback, download, measured duration, digest, source take
and the source-aligned retention deadline. The account asset count includes
these copies. Signing out or switching accounts clears the master cards.

This release supplies a private read surface and a service-only import RPC.
There is no public file upload route or new generation/credit operation.
`FILM_LIBRARY_MASTERS_ENABLED` remains false until migration 0279 is approved
and applied through the production migration workflow.

## Operator procedure

1. Confirm the owner requested this exact generated master. Read the original
   stored job’s owner, digest, video type and retention deadline.
2. Probe the master, decode every frame, verify 1920×1080, 24 fps, exact shot
   duration and MP4 type, then hash the actual bytes (maximum 25 MiB).
3. Check for an existing saved record for this owner/source/digest. Reuse it
   on replay. Otherwise generate a new UUID and copy the file to the production
   EU media bucket at `film-masters/<public user UUID>/<master UUID>.mp4`.
4. Read the storage copy back and compare size and SHA-256. Only then invoke
   `store_film_library_master` with the verified auth identity, master UUID,
   source job and digest, label, master digest, size and measured seconds.
5. Open the signed-in Library, play the saved master and download it through
   its native control. Verify that downloaded bytes still match the master.
   Confirm the original take and the credit balance/ledger remain unchanged.
6. Retain the operation evidence privately. If import fails, remove the new
   unregistered copy or retry the same id; do not register different bytes or
   overwrite an existing key. Database insertion alone does not prove delivery.

## Validation

`node --test tests/filmLibrary.test.mjs tests/filmLibraryAccount.test.mjs`
checks authenticated owner arguments, denied lookups, rate limits, no-store
responses, signing lifetime, download headers, digest/expiry preservation,
account counts and failure behavior with an unchanged zero Credit balance.

The SQL replay check executes migration 0279 twice in PostgreSQL, exercises
import/replay, owner/source/digest/bounds checks, private table/RPC privileges,
unchanged jobs/assets/ledger/balances, expiry and the R2 reap queue. The local
PGlite run uses a recording stub for `cron.schedule`; it does not simulate cron:

```sh
npm install --prefix /tmp/film-library-sql-check @electric-sql/pglite@0.5.8 --ignore-scripts --no-audit --no-fund
PGLITE_MODULE=/tmp/film-library-sql-check/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-film-library-masters.mjs
```

Reticle verified the actual Library component in an excluded local fixture:
file details expose the master digest and source take, and a controlled failed
download displays retry feedback. Both verdicts were `verified: yes` over clean
captures. These component checks do not establish production playback or a
completed Library save; step 5 is required after production activation.
