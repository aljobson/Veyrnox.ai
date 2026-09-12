-- Point nano-banana at its real fal endpoint.
--
-- Applied to the database at 2026-09-12 18:23 UTC as
-- 0033_nano_banana_endpoint, but never committed. This file recovers the
-- statement verbatim from supabase_migrations.schema_migrations.
--
-- On the live database this was a no-op. The row already read
-- 'fal-ai/nano-banana' — its updated_at is 14:50, from the cost correction,
-- not 18:23 — so the WHERE guard matched nothing. Submits had been reaching
-- fal on that endpoint since 2026-09-11.
--
-- It matters for every database that is NOT the live one.
-- 0002_model_catalog_seed.sql seeds this row with provider_endpoint =
-- 'nano-banana', and nothing else in this directory corrects it. A database
-- built by replaying the repository — a Supabase branch, a fresh
-- environment, or the planned move to a Frankfurt project in
-- docs/supabase-staging.md — would submit to
-- https://queue.fal.run/nano-banana, which fal does not serve. Every
-- nano-banana generation there would debit, fail to submit, and refund.
--
-- 0015_reactivate_verified_fal_endpoints.sql says nano-banana "was already
-- active with the correct endpoint; no change". True of the live database,
-- not of the repository. How the live row was corrected is not recorded in
-- the migration ledger; this file is what makes a replay agree with it.
--
-- Idempotent: the WHERE guard makes it a no-op once the endpoint is right.

UPDATE public.model_catalog
   SET provider_endpoint = 'fal-ai/nano-banana', updated_at = now()
 WHERE id = 'nano-banana' AND provider_endpoint <> 'fal-ai/nano-banana';
