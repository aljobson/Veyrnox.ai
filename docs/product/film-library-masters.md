# Film Studio masters in the Library

Film Studio browser exports are separate files from their generated source.
An accepted 16:9 Library take offers **Prepare 16:9 master**, then a rights
confirmation and **Save to Library**. The server verifies the immutable upload's
size, SHA-256, 1920×1080 H.264 frame, 24 fps packet timing and duration before
registering it. **View saved video** opens its Library card. Retrying the same
source/master returns one saved card. Saving costs no Credits.

The Library shows these in “Saved Film
Studio masters”, with playback, download, measured duration, digest, source take
and the source-aligned retention deadline. The account asset count includes
these copies. Signing out or switching accounts clears the master cards.

`FILM_LIBRARY_SAVE_ENABLED` gates new authenticated saves;
`FILM_LIBRARY_MASTERS_ENABLED` gates reads. Migrations 0129 and 0279 are already
applied. There is no new generation/credit operation or migration. Uploads use
the existing 10-object/200-MiB pending budget; temporary receipts and orphaned
copies are cleaned after 24 hours. Each master is at most 25 MiB and each
account can hold 100. Server inspection is structural, not a malware scan,
moderation verdict or proof of the browser-rendered pixels' provenance.
Local-file masters remain downloadable and do not offer direct Library save.

## Historical operator procedure

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

`node --test tests/filmMasterSaveApi.test.mjs tests/filmMasterSaveClient.test.mjs`
also exercises real synthetic MP4 inspection, owner/consent/expiry/budget checks,
ticket integrity, bad or missing uploads, immutable copy/replay, a lost writer
reply, client transfer failures and fail-closed orphan cleanup. Reticle verified
the actual save component's confirmation, error and retry states using controlled
responses in an excluded local fixture. Production acceptance must independently
prove a real transfer, Library playback/download and unchanged Credits.

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
