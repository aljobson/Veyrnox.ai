# Supabase Staging — deployment log

**Project**: `veyrnox-staging` (`yrqzwqywxfesmbvhzjgj`)
**Region**: us-east-2 — **NOT EU-compliant per ADR-0005 §3**. Fine for dev/staging with test-only data; **must migrate to Frankfurt before Slice 9 exit** (real user signups).
**URL**: `https://yrqzwqywxfesmbvhzjgj.supabase.co`
**Postgres**: 17.6.1.147
**Purpose**: Phase 1 gateway development. No real user data. Emptied and re-migrated freely.

## Migrations applied 2026-09-10

Via Supabase MCP `apply_migration`. All idempotent.

| Migration | Source | Status |
|---|---|---|
| `phase1_0001_initial` | `packages/db/schema/0001_initial.sql` | ✓ Applied |
| `phase1_0002_model_catalog_seed` | `packages/db/schema/0002_model_catalog_seed.sql` | ✓ Applied (11 rows) |
| `phase1_0003_rls_policies` | `packages/db/schema/supabase/0003_rls_policies.sql` | ✓ Applied |
| `phase1_0004_security_advisor_fixes` | `packages/db/schema/supabase/0004_security_advisor_fixes.sql` | ✓ Applied |

## Supabase security-advisor state (post-0004)

- **Our schema**: clean. Zero errors or warnings on any Phase-1 table or function.
- **Pre-existing on this project (not our code, not our responsibility here)**: `public.events`, `public.funnel_dropoff_alert_log` (RLS-enabled-no-policy INFO); `public.track_event(...)` SECURITY DEFINER function (WARN × 2).

## Publishable credentials

Retrieved via `get_publishable_keys`. Safe to commit — publishable keys are meant to be shipped.

- **anon (legacy JWT)**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlycXp3cXl3eGZlc21idmh6amdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzMDI5NjQsImV4cCI6MjEwMDg3ODk2NH0.PTwHQbTRiN4Lv0c8npWeAUQg0kX2jE1L11eQ_GoeN2I`
- **publishable (modern)**: `sb_publishable_bAxQiodzBhI6bV7lmo9gMQ_Hlg9_Ish`

## Secrets — NOT committed

Retrieve from the Supabase dashboard → Settings → API and put into `.env.local`:

- `SUPABASE_SERVICE_ROLE_KEY` — backend-only, bypasses RLS
- `SUPABASE_JWT_SECRET` — needed by `packages/auth/verify.ts` to verify tokens (also visible under Settings → API → JWT Settings)
- `SUPABASE_WEBHOOK_SIGNING_SECRET` — configured per-webhook when we wire the users.created handler in Slice 3b

## Next steps (Slice 3b)

- `middleware.ts` at repo root — Supabase JWT verification via `packages/auth/verify`, gates `/api/v1/*`, forwards `x-veyrnox-auth-id` header
- `app/api/webhook/supabase/route.js` — receives `user.created` events, inserts a `users` row, emits a 50-credit `grant:signup` via `Ledger.grant`
- Deprecation banner on `app/api/session/muapi/route.js`

## Migrating to Frankfurt later

Before Slice 9 (real users), migrate this project's schema to a Frankfurt project:

1. Create a fresh Frankfurt project (`get_cost` → `confirm_cost` → `create_project` with `region: "eu-central-1"`)
2. Apply the same 4 migrations
3. Point `.env.local` `DATABASE_URL` / `SUPABASE_URL` / keys at the new project
4. Delete this us-east-2 project once cut over
