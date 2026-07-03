# packages/db

Database schema and migrations. Target: Neon Postgres (aws-eu-west-2).

## Migrations

- `0001_ledger.sql` — Append-only ledger, credit balances, job tracking, outbox, webhook deduplication

Run migrations via:
```bash
psql "$NEON_DB_URL" -f migrations/0001_ledger.sql
```

Source of truth for schema invariants: see `docs/architecture_v0.3.1.md` §25 (money path).
