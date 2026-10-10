# Historical staging migration statements

These files are an archival copy of the recorded statements in AI staging
`yrqzwqywxfesmbvhzjgj`, captured on 10 October 2026. They are not new
migrations and must never be replayed. The abandoned Stripe branch and its
rollback contain obsolete money functions and destructive SQL. Current
numbered migrations reproduce the supported state.

`receipts.json` records each original version and the SHA-256 of the UTF-8
statements joined with a newline, exactly as returned by the migration ledger.
No migration history row was deleted or relabelled.

The six numbered Stripe files came from the unmerged #108 branch. The
`revert_pr108_stripe_objects_0035_0041` receipt rolled those objects back.
The later `drop_wallet_residue_staging` removed empty objects from the
separate product. Readback confirms their tables, functions, views and cron
job are absent. Modern Credit Pack tables and money RPCs remain in place.

`staging_publish_append_only_no_truncate` replayed 0177 after Publish tables
were installed; this is also recorded in the 4 October follow-up in
`docs/social-publisher/HANDOVER-analytics-2026-10-03.md`. Readback confirms
all seventeen current append-only tables have enabled truncate guards.
