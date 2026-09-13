# ADR-0023 — Production migrations are applied by one workflow

- **Status**: Proposed (2026-09-13). Takes effect when the owner configures the
  `production-database` environment and its `SUPABASE_ACCESS_TOKEN` secret.
- **Date**: 2026-09-13
- **Deciders**: Product owner (Al Jobson)
- **Related**: CLAUDE.md "Database", PR #61 (no service credentials in Actions),
  `.github/workflows/apply-migrations.yml`, `scripts/apply-migrations.mjs`

## Context

Until now any Claude session could apply a migration to production with the
Supabase MCP `apply_migration` tool, after the owner asked it to in chat. With
many sessions running in parallel, that caused:

- **Duplicate entries.** The same merged migration was applied by more than one
  session within seconds: `0058` and `0062` twice, `0065` three times,
  `credit_top_up` under both `0052_…` and `0054_…`. Migration names are
  permanent, so the ledger keeps every duplicate.
- **SQL that differs from the repository.** Several applies sent the file with
  comments or the trailing newline stripped.
- **Name drift.** `0067_veo_4s_clip_costs` was applied as `0066_…` a minute
  before main renumbered the file.

No single rule followed by sessions stopped this. Each session did what the
owner asked of it, but nothing checked what the other sessions had just done.

## Decision

1. **One path.** Production migrations are applied only by the
   `apply-migrations` workflow on `main`. It runs one at a time (concurrency
   group `production-migrations`), so two applies can never overlap.
2. **What it applies.** It applies files in `packages/db/schema/supabase/` that
   production has not applied, lowest number first.
   - **Counts as applied:** production has a migration with the file's
     descriptive name, the file's `-- Applied name:` header names an applied
     migration, or an applied batch name spans the file's number.
   - **Out of order:** a pending file numbered below an applied one stops the
     run for a human to decide.
3. **Approval.** The apply job runs in the `production-database` GitHub
   Environment. Its required reviewer is the owner, so every run waits for the
   owner's approval, as the per-migration approval in chat did before. The job
   also checks the environment still has a required reviewer, and refuses to
   run if not.
4. **How it applies.**
   - It uses the Supabase Management API
     (`POST /v1/projects/{ref}/database/migrations`), the same call the MCP tool
     makes.
   - Each file is sent byte for byte under its own name, with an
     `Idempotency-Key` derived from the name and the file's SHA-256.
   - The ledger is re-read before every file, and the first failure stops the
     run.
   - The `migration-ledger` check must pass afterwards.
5. **Credential.** A Supabase personal access token lives only as a secret of
   the `production-database` environment. This deliberately departs from
   PR #61's "no service credentials in Actions". The token is released only to
   a run the owner has approved, only on `main`, and only to the apply step.
6. **MCP `apply_migration` against production** is reserved for emergencies,
   where the owner says in chat that the workflow can't be used. Staging and
   local databases are unaffected.

## Considered options

- **Keep MCP applies, add stricter session rules.** Tried on 2026-09-13. Sessions
  agreed to re-check the ledger right before applying, and `0065` was still
  applied three times 45 seconds later.
- **`supabase db push`.** Expects timestamp-named files in `supabase/migrations`
  and its own history format. That would mean renaming 60+ files and rewriting
  the ledger.
- **A Postgres connection string in Actions.** The workflow would have to write
  `supabase_migrations.schema_migrations` itself, and the credential is broader
  than the Management API route needs.

## Consequences

- Merging a migration no longer puts it live. Its run waits for the owner's
  approval in the Actions tab, and until then the code that needs it must stay
  behind a flag or tolerate its absence.
- **Personal access token scope.** The token is account-wide: Supabase personal
  access tokens can't be limited to one project. The environment gate limits
  when it's usable, but not what it can do. Rotate it if it's ever exposed.
- Emergency hotfixes need the owner to either approve a run or explicitly
  authorise an MCP apply in chat.
