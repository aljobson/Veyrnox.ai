# Supabase-only migrations

Files here run **only against Supabase Postgres**, not against local Postgres.

`scripts/migrate.mjs` reads `packages/db/schema/*.sql` non-recursively — it does not descend into subdirectories. To apply Supabase-only migrations, use `scripts/migrate.mjs --dir=packages/db/schema/supabase` (Slice 4 will add the flag).

## Why separate

- `auth.uid()` and `auth.role()` are Supabase's built-in helpers used inside every RLS policy. Local Postgres does not have them.
- Row-Level Security only meaningfully applies when the Postgres connection carries a JWT with an `auth.uid()` claim, which Supabase's PostgREST / connection-pooler wires up per request.
- Running these on local Postgres would either fail (function missing) or silently no-op (auth.uid() returns NULL), neither of which is useful for the ledger acceptance tests.

## Ordering

Filenames still follow the `NNNN_*.sql` convention. When a deploy applies both dirs, the intended order is:

1. `packages/db/schema/*.sql` — canonical schema (users, ledger, jobs, ...)
2. `packages/db/schema/supabase/*.sql` — Supabase-specific overlays (RLS, triggers using auth.*)

If a Supabase file depends on a base migration, prefix accordingly.
