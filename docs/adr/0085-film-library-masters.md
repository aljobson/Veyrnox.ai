# ADR-0085: save verified Film Studio masters in the account Library

The owner requested saving the exact 16:9 empty-room master to their Library.
The Library lists provider generation jobs. Film Studio's browser export changes
those bytes and only downloads them locally. A derived file must not replace the
source asset or pretend to be a new paid/free-allowance generation.

Store derived master metadata in `film_library_masters`, with the original job
and its digest, its own digest, random object key, measured dimensions and length.
The Library reads these through authenticated, owner-scoped endpoints. No jobs,
ledger entries, balances, allowances, provider calls or prices are changed.
Retries use the owner/source/digest unique key and return the first saved record.
Each account is capped at 100 masters of at most 25 MiB. Retention ends with the
source or at 90 days, whichever comes first. Expired copies enter the existing
R2 reap queue through a separate 15-minute pg_cron task.

This delivery permits an operator import of the already generated, decoded and
reviewed empty-room file the owner specifically asked to save. The operation
must verify the source job's owner and stored digest, probe the master and hash
its actual bytes, upload the copy under a fresh UUID and verify storage before
calling the service-role-only import RPC. Record the evidence and confirm a
Library download still matches the digest. The source take remains unchanged.
There is **no public upload endpoint**, no arbitrary-file acceptance or general
exception to the scanner/moderation gate in ADR-0080.

Deploy the read surface with `FILM_LIBRARY_MASTERS_ENABLED=false`, apply 0279 only
through the owner-approved migration workflow, and enable reads afterwards.
The 24-hour credit reconciliation rollout delay is unnecessary for this read
surface: no money spine writer or job transition is added or modified. Existing
upload and project rollout gates remain as configured. This is an explicit,
narrow exception to the general new-path delay; validate owner isolation, exact
bytes, retention and replay before claiming the save is complete.

## Direct private saves — 2026-10-11

The owner now requests a Save to Library button and production deployment.
An accepted 16:9 take prepared from an owned Library generation can save its
browser-rendered master after rights confirmation. Local-file exports retain
Download and cannot use this control. This request opens this bounded private
master path; it does not open project uploads or Cinema publication.

Use the already-applied 0129 upload reservations and 0279 master writer.
There is no new migration, provider request or credit operation. A stable upload
UUID reserves the existing 10-object/200-MiB account budget before a 15-minute,
size-bound, write-once PUT. An HMAC ticket binds the owner, source/digest,
label, master digest, size and expiry; retries never extend its original window.
The service checks the owner and frozen state again, reads the capped bytes,
hashes them and inspects the MP4 and all video packets for 1920×1080 H.264 at
24 fps, up to 60 seconds. It writes an immutable final copy, reads its digest
back and only then invokes the existing owner/source/digest-idempotent writer.
Save confirmation links to the native Library card. Retention and the 100-master,
25-MiB-per-master cap are unchanged. Saving also works at zero Credits.

This is structural media inspection, **not malware scanning, content moderation
or proof that browser-uploaded pixels derive from the named source**. The
browser probes the decoded export; the server authenticates the source and
the exact uploaded bytes. Private saves require rights confirmation and remain
under Acceptable Use. Existing arbitrary project-upload and publication gates
remain off. Do not describe this private path as a scanner-qualified upload.

The reservation survives a lost finalization reply. After 24 hours, when every
ticket has expired, its sweeper preserves registered masters and deletes
unregistered final copies before releasing storage budget. It fails closed on
an unavailable Library lookup or deletion. This also cleans the losing copy of
concurrent identical saves. Immutable applied migration 0279 is not edited.

`FILM_LIBRARY_SAVE_ENABLED` is a fail-closed server switch. The owner-requested
production release enables it after local media/API tests, Reticle component
verdicts and CI. Run real browser/R2 transfer, retry and Library
playback/download acceptance immediately after deployment; disable the switch
if acceptance fails before reporting the feature live. This non-money path uses
already-applied migrations and shares the prior narrow reconciliation-delay
exception. No protected migration workflow is needed for this amendment.
