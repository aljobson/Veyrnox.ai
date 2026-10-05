-- Per-model free allowance (ADR-0069): a PRICE WAIVER, not Credits. A job inside the allowance is created at
-- 0 Credits and writes no ledger row, so the balance invariant, Free Credits (ADR-0013) and the three
-- reconcile functions are untouched. This migration is the data layer only: the catalog columns, the claims
-- table and the definer functions. Nothing calls them yet, and every row ships with allowance 0 (off).
-- The zero-price path in /api/v1/generations, the quote and the banner are later steps in ADR-0069's order.
--
--   model_catalog.free_allowance_per_day      free jobs per account per UTC day, 0 = none
--   model_catalog.free_allowance_daily_budget free jobs per UTC day across all accounts, 0 = none
--   model_free_allowance_claims               one row per taken job, keyed by the job's idempotency key
--
-- Bounds the table enforces itself (ADR-0069 item 6): only per_generation rows, provider cost per job at or
-- under $0.05, and a model's daily free spend (budget x cost) at or under $1.00. The $5-a-day total across
-- models is checked by reconcile_free_allowance().
--
-- Taking is serialised per model and UTC day by an advisory lock, so concurrent takes cannot overshoot the
-- global budget. A claim is idempotent on (user, key): a replay returns the same answer and takes nothing.
-- Returning a failed or canceled job's allowance is idempotent too, and a returned key is never retaken.
-- Eligibility: not Frozen, and already holding the one-time grant:signup entry (which lands only once the
-- email is confirmed, 0071).
--
-- Idempotent: IF NOT EXISTS, OR REPLACE, explicit revokes naming each full signature.

ALTER TABLE public.model_catalog
    ADD COLUMN IF NOT EXISTS free_allowance_per_day INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS free_allowance_daily_budget INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.model_catalog DROP CONSTRAINT IF EXISTS model_catalog_free_allowance_check;
ALTER TABLE public.model_catalog ADD CONSTRAINT model_catalog_free_allowance_check CHECK (
    free_allowance_per_day BETWEEN 0 AND 20
    AND free_allowance_daily_budget BETWEEN 0 AND 10000
    AND (free_allowance_per_day = 0) = (free_allowance_daily_budget = 0)
    AND (free_allowance_per_day = 0 OR (
        cost_unit = 'per_generation'
        AND provider_cost_per_unit <= 0.05
        AND free_allowance_daily_budget * provider_cost_per_unit <= 1.00))
);

CREATE TABLE IF NOT EXISTS public.model_free_allowance_claims (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{1,128}$'),
    model_id TEXT NOT NULL REFERENCES public.model_catalog(id),
    day DATE NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('TAKEN', 'RETURNED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    returned_at TIMESTAMPTZ NULL,
    PRIMARY KEY (user_id, idempotency_key),
    CHECK ((state = 'RETURNED') = (returned_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS model_free_allowance_claims_user_day_idx
    ON public.model_free_allowance_claims (user_id, model_id, day) WHERE state = 'TAKEN';
CREATE INDEX IF NOT EXISTS model_free_allowance_claims_model_day_idx
    ON public.model_free_allowance_claims (model_id, day) WHERE state = 'TAKEN';
CREATE INDEX IF NOT EXISTS model_free_allowance_claims_model_fk_idx
    ON public.model_free_allowance_claims (model_id);
ALTER TABLE public.model_free_allowance_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_free_allowance_claims FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.model_free_allowance_claims FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.free_allowance_take(p_user_id UUID, p_model_id TEXT, p_idempotency_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_day DATE := (now() AT TIME ZONE 'UTC')::date;
    v_cap INTEGER;
    v_budget INTEGER;
    v_claim public.model_free_allowance_claims%ROWTYPE;
    v_used INTEGER;
    v_global INTEGER;
BEGIN
    IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_KEY');
    END IF;
    SELECT free_allowance_per_day, free_allowance_daily_budget INTO v_cap, v_budget
      FROM public.model_catalog WHERE id = p_model_id AND active;
    IF NOT FOUND OR v_cap = 0 THEN
        RETURN jsonb_build_object('ok', true, 'taken', false, 'code', 'NO_ALLOWANCE');
    END IF;

    -- One lock per model and day: the count and the insert below cannot interleave across Workers.
    PERFORM pg_advisory_xact_lock(hashtextextended('free-allowance:' || p_model_id || ':' || v_day::text, 0));

    SELECT * INTO v_claim FROM public.model_free_allowance_claims
     WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        RETURN jsonb_build_object('ok', true, 'taken', v_claim.state = 'TAKEN', 'idempotent', true,
                                  'code', CASE WHEN v_claim.state = 'TAKEN' THEN NULL ELSE 'RETURNED' END);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.frozen_at IS NULL)
       OR NOT EXISTS (SELECT 1 FROM public.ledger_entries l WHERE l.user_id = p_user_id AND l.reason = 'grant:signup') THEN
        RETURN jsonb_build_object('ok', true, 'taken', false, 'code', 'NOT_ELIGIBLE');
    END IF;

    SELECT count(*) INTO v_used FROM public.model_free_allowance_claims
     WHERE user_id = p_user_id AND model_id = p_model_id AND day = v_day AND state = 'TAKEN';
    IF v_used >= v_cap THEN
        RETURN jsonb_build_object('ok', true, 'taken', false, 'code', 'ALLOWANCE_USED');
    END IF;
    SELECT count(*) INTO v_global FROM public.model_free_allowance_claims
     WHERE model_id = p_model_id AND day = v_day AND state = 'TAKEN';
    IF v_global >= v_budget THEN
        RETURN jsonb_build_object('ok', true, 'taken', false, 'code', 'BUDGET_SPENT');
    END IF;

    INSERT INTO public.model_free_allowance_claims (user_id, idempotency_key, model_id, day, state)
    VALUES (p_user_id, p_idempotency_key, p_model_id, v_day, 'TAKEN');
    RETURN jsonb_build_object('ok', true, 'taken', true, 'left', v_cap - v_used - 1);
END $$;

CREATE OR REPLACE FUNCTION public.free_allowance_return(p_user_id UUID, p_idempotency_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_changed INTEGER;
BEGIN
    UPDATE public.model_free_allowance_claims
       SET state = 'RETURNED', returned_at = now()
     WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key AND state = 'TAKEN';
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'returned', v_changed = 1);
END $$;

-- What the caller has left today, per model that offers an allowance: the smaller of the per-account
-- remainder and what the global budget has left. Zero for a Frozen or unconfirmed account.
CREATE OR REPLACE FUNCTION public.free_allowance_left(p_user_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH today AS (SELECT (now() AT TIME ZONE 'UTC')::date AS d),
    ok AS (
        SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.frozen_at IS NULL)
           AND EXISTS (SELECT 1 FROM public.ledger_entries l WHERE l.user_id = p_user_id AND l.reason = 'grant:signup') AS eligible
    )
    SELECT COALESCE(jsonb_object_agg(m.id, CASE WHEN ok.eligible THEN GREATEST(0, LEAST(
        m.free_allowance_per_day - (SELECT count(*) FROM public.model_free_allowance_claims c
            WHERE c.user_id = p_user_id AND c.model_id = m.id AND c.day = today.d AND c.state = 'TAKEN'),
        m.free_allowance_daily_budget - (SELECT count(*) FROM public.model_free_allowance_claims c
            WHERE c.model_id = m.id AND c.day = today.d AND c.state = 'TAKEN'))) ELSE 0 END), '{}'::jsonb)
      FROM public.model_catalog m, today, ok
     WHERE m.active AND m.free_allowance_per_day > 0
$$;

-- Zero rows when healthy. Mirrors the other reconcile functions; joins the nightly check in a later step.
CREATE OR REPLACE FUNCTION public.reconcile_free_allowance()
RETURNS TABLE (kind TEXT, ref TEXT, detail TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT 'user_over_cap', c.user_id::text || ' ' || c.model_id || ' ' || c.day::text,
           count(*)::text || ' taken, cap ' || m.free_allowance_per_day::text
      FROM public.model_free_allowance_claims c JOIN public.model_catalog m ON m.id = c.model_id
     WHERE c.state = 'TAKEN' AND c.day = (now() AT TIME ZONE 'UTC')::date
     GROUP BY c.user_id, c.model_id, c.day, m.free_allowance_per_day
    HAVING count(*) > m.free_allowance_per_day
    UNION ALL
    SELECT 'model_over_budget', c.model_id || ' ' || c.day::text,
           count(*)::text || ' taken, budget ' || m.free_allowance_daily_budget::text
      FROM public.model_free_allowance_claims c JOIN public.model_catalog m ON m.id = c.model_id
     WHERE c.state = 'TAKEN' AND c.day = (now() AT TIME ZONE 'UTC')::date
     GROUP BY c.model_id, c.day, m.free_allowance_daily_budget
    HAVING count(*) > m.free_allowance_daily_budget
    UNION ALL
    SELECT 'total_budget_over_5_dollars', 'all models',
           sum(free_allowance_daily_budget * provider_cost_per_unit)::text
      FROM public.model_catalog WHERE active AND free_allowance_per_day > 0
    HAVING sum(free_allowance_daily_budget * provider_cost_per_unit) > 5.00
$$;

REVOKE ALL ON FUNCTION public.free_allowance_take(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.free_allowance_take(UUID, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.free_allowance_return(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.free_allowance_return(UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.free_allowance_left(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.free_allowance_left(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.reconcile_free_allowance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_free_allowance() TO service_role;
