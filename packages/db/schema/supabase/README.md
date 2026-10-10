# Supabase-only migrations

Files here run **only against Supabase Postgres**, not against local Postgres.

`scripts/migrate.mjs` reads `packages/db/schema/*.sql` non-recursively — it does not descend into subdirectories. To apply Supabase-only migrations, use `scripts/migrate.mjs --dir=packages/db/schema/supabase` (Slice 4 will add the flag).

## Why separate

- `auth.uid()` and `auth.role()` are Supabase's built-in helpers used inside every RLS policy. Local Postgres does not have them.
- Row-Level Security only meaningfully applies when the Postgres connection carries a JWT with an `auth.uid()` claim, which Supabase's PostgREST / connection-pooler wires up per request.
- Running these on local Postgres would either fail (function missing) or silently no-op (auth.uid() returns NULL), neither of which is useful for the ledger acceptance tests.

## New catalog UPDATEs must assert their row count

From migration **0111** onward, every direct `UPDATE public.model_catalog` must
immediately capture `ROW_COUNT` and raise an exception unless it equals the
expected positive number of rows. CI runs `node scripts/check-catalog-update-guards.mjs`.
This catches misspelled IDs and missing prerequisites instead of reporting a
successful migration that changed nothing. Applied files through 0110 stay
unchanged; fix an old migration with a new forward migration.

Use this pattern inside a `DO` block (replace the ID and intended value):

```sql
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET credits_5s = 28, updated_at = now()
     WHERE id = 'seedance-2.0-fast' AND provider = 'openrouter';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one seedance-2.0-fast/openrouter row, updated %', affected;
    END IF;
END $$;
```

Use an exact count for multi-row changes, and repeat the guard immediately after
**each** UPDATE. No intervening statement may replace ROW_COUNT. Assign absolute
values; do not filter on the old value or `IS DISTINCT FROM` the new value, since
that would match zero rows on replay. PostgreSQL counts matched rows even when
the assigned value is unchanged. An exception rolls back the containing DO
block, so partial changes within that block cannot be mistaken for success.

The checker enforces this narrow syntax (also accepting `!=` and `:=`), strips
comments and string literals, and inspects dollar-quoted bodies. It is a style
gate, not a SQL interpreter or proof of the predicate's correctness. Use direct,
schema-qualified UPDATEs for catalog data migrations; do not hide them in dynamic
SQL, helper functions, or exception handlers that swallow the assertion. Such
alternatives need explicit review. Insert/upsert migrations and non-catalog
updates are outside this check; migration replay and database acceptance tests
remain required. No generic waiver comment bypasses the guard.

## Ordering

Filenames follow the `NNNN_*.sql` convention. When a deploy applies both dirs, the intended order is:

1. `packages/db/schema/*.sql` — canonical schema (users, ledger, jobs, ...)
2. `packages/db/schema/supabase/*.sql` — Supabase-specific overlays (RLS, triggers using auth.*)

If a Supabase file depends on a base migration, prefix accordingly.

### The number is the apply order

`scripts/migrate.mjs` applies files in filename order, so the prefix *is*
the replay order. Two rules follow:

- **Never reuse a number.** Take the next free one. `scripts/check-migration-numbers.sh`
  fails CI on a duplicate.
- **Never renumber a file that has already been applied** anywhere, unless you
  are correcting the order to match what the database actually ran.

Check the Supabase migration list before picking a number, not the commit
dates: a migration authored last week can be applied after one written today,
and the applied order is what a fresh database has to reproduce.

On 2026-09-12 two sessions numbered migrations independently and produced
five collisions at 0018 through 0022. Because the database's own list showed
one file of each pair as applied, the four unapplied security migrations from
PR #57 looked like they had landed. They had not. The files from 0018 up were
renumbered to the order the database ran them:

| was | now |
|-----|-----|
| `0022_reconcile_and_sweep` | `0018_reconcile_and_sweep` |
| `0023_sweep_succeeded_without_asset` | `0019_sweep_succeeded_without_asset` |
| `0018_floor_pricing_and_veo_fast` | `0020_floor_pricing_and_veo_fast` |
| `0019_fix_dead_minimax_endpoint` | `0021_fix_dead_minimax_endpoint` |
| `0020_lock_model_catalog_from_anon` | `0022_lock_model_catalog_from_anon` |
| `0018_rate_limit_lock` | `0023_rate_limit_lock` |
| `0019_catalog_column_grants` | `0024_catalog_column_grants` |
| `0020_ledger_rpc_hardening` | `0025_ledger_rpc_hardening` |
| `0021_signup_grant_skip_anonymous` | `0026_signup_grant_skip_anonymous` |
| `0021_correct_fal_costs_from_watcher` | `0027_correct_fal_costs_from_watcher` |
| `0024_relock_model_catalog_from_anon` | `0028_relock_model_catalog_from_anon` |

The grant-then-revoke chain on `model_catalog` survives the renumbering:
0024 grants the non-margin columns to `anon`, 0022 and 0028 revoke, and 0028
is last, so a fresh replay ends locked — the state the live database is in.

`0022_cost_unit_and_deactivate_seedance` was applied at 14:56 UTC, after
`0028`, and was still uncommitted when this landed. It belongs at `0029`.

### Every applied migration must be accounted for

`check-migration-numbers.sh` compares this directory's files with each
other, so it cannot see a migration applied straight to the database and
never committed. `scripts/check-migration-ledger.mjs` closes that gap: feed it the
names from `supabase_migrations.schema_migrations` and it reports any with no
trace here.

The `migration-ledger` workflow runs it on every pull request, on every push
to main, and hourly. The hourly run on main opens a single
`migration-drift` issue when something is missing. Run it locally too:

```bash
node scripts/check-migration-ledger.mjs
```

With no argument it reads the live ledger through the anon-callable
`applied_migration_names()` function (0034), using the URL and publishable
key from `wrangler.jsonc`. PostgREST does not expose `supabase_migrations`,
and CI deliberately holds no service-role key since PR #61, so that function
is the only ledger read the anon role has. It returns names only. Pass a JSON
file of names instead to check offline.

It exits 0 when everything is accounted for, 1 on drift, and 2 when the
ledger could not be read, so an outage never reads as a pass.

A migration is accounted for when a file carries its descriptive name — the
number is ignored, because files were renumbered to apply order while the
database kept its original names — or when its **full applied name** is
written in a schema file or here. That second rule is how a deliberate fold is
recorded. Two exist:

- `phase1_0006_ledger_rpc_functions_perm_fix` is folded into
  `0006_ledger_rpc_functions.sql`, which revokes `read_user_balance` from
  `authenticated`.
- `0032_ops_metrics_p95_stored_only` is folded into
  `0032_admin_flag_and_ops_metrics.sql`, which measures p95 on `STORED` jobs
  only.

Both were confirmed against the ledger's recorded statements on 2026-09-12:
the file already contains the effect, so a replay reaches the same end state.

Folding is fine. Folding silently is how the first of those went unrecorded
for a day.

### The eu-central-1 project applies the same files in batches

The production database moved to `veyrnox-ai-production-eu`
(`xdxdzmsztyzbnzeforxx`) on 2026-09-12. It was built by replaying this
directory, but several files were applied together under one name each, so its
ledger records these batch names instead of one name per file:

| Applied name | Files it covers |
| --- | --- |
| `0001_initial` | `../0001_initial.sql` |
| `0002_0005_seed_rls_advisor_signup_grant` | `../0002_model_catalog_seed.sql`, `0003`–`0005` |
| `0006_0009_ledger_rpcs_job_transitions_rate_limit_stored` | `0006`–`0009` |
| `0010_0017_auth_trigger_catalog_jobs_rls_retention` | `0010`–`0017` |
| `0018_0024_reconcile_sweep_pricing_catalog_locks` | `0018`–`0024` |
| `0025_0029_ledger_hardening_catalog_costs_units` | `0025`–`0029` |
| `0030_0032_debit_rate_limit_watch_definer_revoke_admin_metrics` | `0030`–`0032`, minus the `track_event()` revokes in `0031` |
| `0033_nano_banana_endpoint` | `0033` |
| `0034_applied_migration_names_for_ci` | `0034` |

The `0031` revokes on `public.track_event()` were not replayed because that
function belongs to the wallet product and was never created in this project.

After the replay the new database was diffed against `us-east-2` and matched on
functions, execute grants, table grants, RLS and FORCE flags, policies,
triggers, cron jobs and a hash of every model catalog row.

New migrations go in one file per change and are applied under their own
name, as everywhere else in this directory.

## Numbering gaps

Migration numbers are permanent once applied, so a number burned by an
abandoned branch is never reused.

| Gap | Why |
|-----|-----|
| 0039–0040 | recorded in `0041_credit_packs_and_top_ups.sql:3` — unmerged branches already held 0035–0040 |
| 0061 | burned by an abandoned branch |
| 0069 | burned by an abandoned branch |
| 0076 | held by the unmerged `feat/101-live-variant-ids` branch (its renumbered 0069) |
| 0118–0119 | renumbered to 0121–0122 before merge (commit `ba1a78a`) |
| 0151, 0158 | renumbered to 0163, 0164 after production advanced to 0162; staging's ledger keeps the original names (see each file's `Applied name:` header) |
| 0179 | renumbered to 0181 before merge: 0180 reached production first; never applied anywhere |
| 0195 | starter chat activation replaced by 0201 (`432762db`, #539); earlier draft `c896ef76` |
| 0204 | draft video-to-audio/upscale activation became MMAudio-only 0221; Topaz remained staged (`1b77c498`, #553) |
| 0209 | research pricing renumbered to 0214 (`f87acbe7`); device uploads independently used the number, then became 0223 (`c6efe755`, #611). The staging device-upload receipt keeps its Applied-name mapping |
| 0224 | video-agent steps renumbered to 0227 (`5eeda4a0`, #618) |
| 0246 | colliding Library-upload and violation-idempotency changes became 0248 (`23e2b8b9`) and 0253 (`699eefbc`) before apply |
| 0247 | catalog watcher narrowing renumbered to 0256 after production advanced to 0254 (`4c26bfba`, #848); 0255 was taken by the document timeline |
| 0249 | Top-up refund shortfall freeze renumbered to 0257 (`e42534ad`) after production advanced to 0254 |
| 0250 | chat stops before text renumbered to 0258 (`b998bfc6`) after production advanced to 0254 |
| 0251 | refunded-job ceiling renumbered to 0259 (`3d4da5bb`) after production advanced to 0254 |
| 0252 | social dispatch/rotation renumbered to 0260 (`5d01b8c4`) after production advanced to 0254 |

The original rows through 0179 were verified 2026-10-02 against the production
ledger. Rows 0195 onward were refreshed 2026-10-10 against tracked rename/replacement
history and current environment coverage. A staging Applied-name mapping is
not a missing migration; retain it. (0033–0034, listed here before, are real
migrations.)

`check-migration-numbers.sh` only detects duplicates, so it cannot see a gap.
An unexplained one is the shape of "applied to production, never committed" —
`scripts/check-migration-ledger.mjs` is what actually rules that out, because
it reads the live `applied_migration_names()` ledger.

## Reconciled historical staging receipts — 10 October 2026

The following AI staging receipts are historical, not pending production SQL.
Their recorded statements and checksums are preserved in
[the staging archive](../../../../docs/archive/staging-migrations-2026-10-10/README.md).
No receipt is removed and no obsolete SQL is replayed.

| Full applied name | Explanation |
| --- | --- |
| `0035_stripe_credit_packs` | Unmerged Stripe #108 branch; reverted before the current Credit Pack schema. |
| `0036_purchase_supply_consent` | Unmerged Stripe #108 branch; reverted before the current Credit Pack schema. |
| `0037_proportional_refund_clawback` | Unmerged Stripe #108 branch; reverted before the current Credit Pack schema. |
| `0039_sales_channel` | Unmerged Stripe #108 branch; reverted before the current Credit Pack schema. |
| `0040_pricing_floors` | Unmerged Stripe #108 branch; reverted before the current Credit Pack schema. |
| `0041_dispute_opened_freeze` | Unmerged Stripe #108 branch; reverted before the current Credit Pack schema. |
| `revert_pr108_stripe_objects_0035_0041` | Rollback of those six branch migrations; obsolete objects are absent. |
| `drop_wallet_residue_staging` | Separate-product cleanup; old tables, views, functions and cron are absent. |
| `staging_publish_append_only_no_truncate` | 0177 truncate guards replayed after the Publish tables existed; guards are present. |

Staging already held the complete intended catalog values of 0222 without its
receipt. Forward migration `0262_free_allowance_replay_safe_starting_values`
reassigns those exact values under the original provider/price/cost predicates
and exact positive row-count guards, then records its own receipt. The original
0222 file and missing receipt are preserved. Read-only coverage reports the
explicit forward reconciliation separately; the protected production apply
planner's original-receipt and ordering rules are unchanged.
