# @veyrnox/db

Datastore access for the Veyrnox gateway: ledger, jobs, catalog, R2 URLs.
Production is Supabase Postgres (ADR-0006); the Worker reaches it through
PostgREST and RPCs via `supabase-client.js` (and `tenant-client.js` for
tenant project routes, ADR-0051).

## Schema

`schema/0001_initial.sql` and `schema/0002_model_catalog_seed.sql` build a
local/test database. Everything after that lives in `schema/supabase/`
(`NNNN_<name>.sql`, Supabase-only: RLS, `auth.*` triggers, RPCs). See
`schema/supabase/README.md` for numbering and apply rules.

`0001_initial.sql` creates:

- `users` (shadow row per Supabase identity, `auth_id` unique)
- `credit_balances` (materialised `SUM(delta)`, `CHECK (balance >= 0)`)
- `ledger_entries` (append-only, enforced by trigger)
- `jobs` (with `job_state` enum: PRICED → DEBITED → SUBMITTED → SUCCEEDED / FAILOVER / FAILED / REFUNDED / STORED)
- `model_catalog`, `assets`, `webhook_events`

**No outbox table.** The provider webhook plus `webhook_events` dedupe replaced it.

## Run migrations

```bash
DATABASE_URL=postgres://veyrnox:veyrnox_dev@localhost:54329/veyrnox \
  node scripts/migrate.mjs
```

For local development, `docker compose up -d postgres` spins up a matching Postgres 16 on port 54329.

Production migrations are not run with this script: the `apply-migrations`
workflow applies `schema/supabase/` on `main` after the owner approves
(`scripts/apply-migrations.mjs`, ADR-0023).

## Runtime API

Production writes to the ledger go only through the RPCs (`ledger_debit`,
`ledger_refund`, `ledger_grant`, `signup_grant`, `credit_top_up`, and the
others listed in `CLAUDE.md`), never a raw INSERT.

The `Ledger` class in `ledger.ts` is the legacy gateway-v1 writer and is a
**test harness only**: it predates Free Credits and writes no `free_delta`.
Nothing under `app/` or `lib/` may import it (`tests/ledgerNotWired.test.mjs`).
It survives so `ledger.acceptance.test.ts` can prove the schema's constraints
and triggers against a real Postgres via any `PgLikePool` (see `types.ts`).


## Test dependencies

`pg` and `tsx` are **not** in the root `package.json` devDependencies — they trip
Cloudflare Workers Builds when included there (tsx's native binaries specifically).
They are installed ad-hoc:

- CI: the `ledger-tests` workflow runs `npm install --no-save pg tsx`.
- Local: run the same command before `npm run test:ledger`.

## Tests

```bash
docker compose up -d postgres
DATABASE_URL=postgres://veyrnox:veyrnox_dev@localhost:54329/veyrnox \
  npm run migrate
DATABASE_URL=postgres://veyrnox:veyrnox_dev@localhost:54329/veyrnox \
  npm run test:ledger
```

`ledger.acceptance.test.ts` covers §6 gates: concurrent debits, idempotency, insufficient balance, refund, append-only trigger, reconciliation.

Tests skip silently when `DATABASE_URL` is unset.
