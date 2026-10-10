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
