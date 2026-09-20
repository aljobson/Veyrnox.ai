# Supabase-only migrations

Files here run **only against Supabase Postgres**, not against local Postgres.

`scripts/migrate.mjs` reads `packages/db/schema/*.sql` non-recursively — it does not descend into subdirectories. To apply Supabase-only migrations, use `scripts/migrate.mjs --dir=packages/db/schema/supabase` (Slice 4 will add the flag).

## Why separate

- `auth.uid()` and `auth.role()` are Supabase's built-in helpers used inside every RLS policy. Local Postgres does not have them.
- Row-Level Security only meaningfully applies when the Postgres connection carries a JWT with an `auth.uid()` claim, which Supabase's PostgREST / connection-pooler wires up per request.
- Running these on local Postgres would either fail (function missing) or silently no-op (auth.uid() returns NULL), neither of which is useful for the ledger acceptance tests.

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
| 0033–0034 | see 0035's header |
| 0039–0040 | recorded in `0041_credit_packs_and_top_ups.sql:3` — unmerged branches already held 0035–0040 |
| 0061 | burned by an abandoned branch. Verified 2026-09-20 against the production ledger: never applied. |
| 0069 | burned by an abandoned branch. Verified 2026-09-20 against the production ledger: never applied. |

`check-migration-numbers.sh` only detects duplicates, so it cannot see a gap.
An unexplained one is the shape of "applied to production, never committed" —
`scripts/check-migration-ledger.mjs` is what actually rules that out, because
it reads the live `applied_migration_names()` ledger.
