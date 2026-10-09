-- 0178: remove two dead items on public.users (docs/product/ISSUES.md S14).
--
--   * users_auth_id_idx (0001) duplicates the index behind auth_id's UNIQUE
--     constraint: every write maintains two identical btrees.
--   * users.plan (0001, DEFAULT 'free') was never read or written by any
--     function, route or test; plans/subscriptions live elsewhere (ADR-0064).
--     No view depends on it (a dependent view would make this DROP fail).
--
-- The LemonSqueezy-only constraints and functions S14 also lists are still
-- reachable from the deployed LemonSqueezy webhook; they go with its removal
-- (ISSUES I1), not here.

DROP INDEX IF EXISTS public.users_auth_id_idx;
ALTER TABLE public.users DROP COLUMN IF EXISTS plan;
