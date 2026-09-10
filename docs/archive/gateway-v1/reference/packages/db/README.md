# @veyrnox/db

Datastore access for the Veyrnox gateway: ledger, jobs, catalog, R2 URLs.

## Schema

`schema/0001_initial.sql` — Postgres migration for:

- `users` (Clerk-shadow via `clerk_id` unique)
- `credit_balances` (materialised `SUM(delta)`, `CHECK (balance >= 0)`)
- `ledger_entries` (append-only, enforced by trigger)
- `jobs` (with `job_state` enum: PRICED → DEBITED → SUBMITTED → SUCCEEDED / FAILOVER / FAILED / REFUNDED / STORED)
- `model_catalog`, `assets`, `webhook_events`

**No outbox table.** Inngest's durable event log replaces the hand-rolled outbox+relay per target-architecture §25.7.

## Run migrations

```bash
DATABASE_URL=postgres://veyrnox:veyrnox_dev@localhost:54329/veyrnox \
  node scripts/migrate.mjs
```

For local development, `docker compose up -d postgres` spins up a matching Postgres 16 on port 54329.

For Neon, use the pooled connection string from the Neon console.

## Runtime API

The `Ledger` class in `ledger.ts` is the sole writer to `ledger_entries`. Every mutation goes through `debit()`, `refund()`, or `grant()` — never a raw INSERT — so the append-only invariant and the `balance = SUM(delta)` invariant both hold.

The class is driver-agnostic: it takes any `PgLikePool` (see `types.ts`). Tests wire `pg.Pool` against local Postgres; production wires `@neondatabase/serverless`'s `Pool` against Neon.

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
