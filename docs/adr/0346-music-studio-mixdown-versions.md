# ADR-0346 — Beat editor mixdowns in the Music library

Status: Implemented behind an absent flag; database and browser release qualification pending.

A beat mix is a new private song, with a `studio_mixdown` root version. It has no
paid generation request: requests require a paid quote. A zero-credit, STORED job
with provider `local` and model id `music-local-mixdown` owns its WAV asset. The
model id is an unconstrained text column, so there is no catalog row or price,
ledger insertion or balance write. Existing local edits copy the nullable request
and set their parent. A trigger requires that a non-mixdown version without a
request has a same-owner parent whose request is also NULL.

`mix_source` lineage identifies each distinct owned song version audible in the
selected range. The transaction rechecks source ownership and active status while
holding the user lock, then source-song share locks. Library and detail readers
already read versions directly; publication uses optional request/prompt joins.
Reuse of lyrics/styles explicitly refuses a mixdown (`REUSE_UNAVAILABLE`). Local
crop, fade, speed, reorder, remaster and reverse keep their existing writers.

D7's “uploaded audio” means `take`: the document supports `sound`, `take` and
`song`, but has no `upload` kind. Takes require the recorded attestation
`music-mixdown-rights-v1`. Library sounds and owned songs do not. This is a
client-declared source set; the server cannot infer a project from a WAV.

Save uses exactly the mix's download renderer at 16-bit, stereo, 48 kHz. Uploads
are capped at 25 MiB before upload and on the server. Each reservation binds title,
duration, size, sources, rights and SHA-256. PUT signs content length and
`If-None-Match: *`, so even an unexpired URL cannot overwrite a live asset. Commit
checks the stored WAV and its hash before a locked, idempotent transaction.

An upload refusal abandons the exact reservation version; it never deletes the
object inline. Tombstones bind the key until the 30-day sweep. The reaper waits
until the stored PUT expiry plus five minutes. Renewals extend that stored expiry
under lock and stop within 15 minutes of the one-hour reservation deadline. The
route shortens the signing TTL to account for RPC/signing latency. Expiry runs
every ten minutes via pg_cron. Erasure exempts reservations from the content
blocker, then expires and removes them under the existing user-row lock. Committed
assets retain the ordinary Music content deletion protections.

Privacy-export review: reservation receipts are classified as not exported, in
line with the existing Music tables (which the current privacy export does not
project). Uncommitted receipts are erased with the account; committed source and
rights provenance is in Music versions. This change does not claim to implement a
Music privacy-export projection. There are no new browser grants.

`beatLibrarySave` is a key in the existing runtime flag bundle and ships absent
from Wrangler. Enable only after the migration, the required acceptance checks,
and 24 hours of clean reconciliation. Studio redirects ride on `beatEditor`;
flag-off pages and navigation keep their old behavior.

Chunked export is implemented but gated by `CHUNKED_EXPORT = false` until the
real Web Audio boundary fixture measures at most 1/32768 absolute difference.
Phones use whole rendering only within the 300 MB estimate. Procedural sound
assets bypass the live unseeded cache on export, using the same project seed as
instrument voices. Pattern exports retain 44.1 kHz mono and their existing loop
semantics; only their noise is now repeatable.

The plan's “RPC refusal deletes the object” verification bullet conflicts with
its explicit shared-key/tombstone protocol. Verification instead asserts deferred
cleanup and no direct DELETE. The historical ADR index is frozen; the filename
index discovers this ADR automatically, as it does ADR-0345.
