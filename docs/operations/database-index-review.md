# Foreign-key index review — 24 September 2026

Migration 0130 adds the five referencing-side indexes identified by the
production advisor. Production read-only metadata before preparation:

| Table | Estimated rows | Total size |
| --- | ---: | ---: |
| account_actions | 2 | 48 KiB |
| top_up_flagged_orders | 0 | 24 KiB |
| top_up_order_collisions | 0 | 24 KiB |
| top_ups | 9 | 160 KiB |

These support parent-key checks and bounded operator joins as data grows.
There is no present latency emergency. Ordinary CREATE INDEX is appropriate
for these sizes and stays atomic in the protected migration transaction;
a five-second lock timeout refuses unexpected contention rather than waiting
indefinitely. Reassess table size if application is delayed materially.

Local replay-database validation applied the migration twice and used EXPLAIN
with enable_seqscan=off to prove all five predicates can use the intended
indexes. This verifies index eligibility, not a measured production speedup.
Existing integrity and infrequently used indexes are retained.

The Auth connection allocation remains unchanged at the previously observed
absolute ten connections. Review utilization and change to a suitable proportional
allocation before resizing compute; no production capacity change is justified
by this tiny dataset alone. Dashboard entitlement/configuration verification
remains an operator task.

Production DDL requires explicit owner approval of 0130 in apply-migrations.
