-- Security audit 2026-09-11, M4: RLS is row-level, so the anon/authenticated
-- SELECT policy on model_catalog exposed every column — including
-- provider_cost_per_unit (our margin) and provider_endpoint — to anyone
-- holding the public anon key. Narrow the table grant to the columns the
-- public price list actually needs. The RLS policy (active = true) stays.
--
-- Idempotent: REVOKE/GRANT are safe to re-run.

REVOKE SELECT ON public.model_catalog FROM anon;
REVOKE SELECT ON public.model_catalog FROM authenticated;
GRANT SELECT (id, name, modality, credits_5s, gated_flag, active, updated_at)
    ON public.model_catalog TO anon, authenticated;
