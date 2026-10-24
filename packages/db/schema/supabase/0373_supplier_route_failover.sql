-- 0373 — Supplier route failover at submit time (ADR-0256, phase 2a).
--
-- A job has been debited (state DEBITED) and the supplier its first route names has
-- refused it in a way that proves nothing was accepted (auth, payment, capacity).
-- job_route_failover records that attempt as failed and, when asked, opens the next
-- attempt on another route, in one transaction:
--
--   * the job row is locked FOR UPDATE and must still be DEBITED, so a job that any
--     supplier accepted (SUBMITTED onward) can never hop;
--   * a failed attempt that already holds a supplier job id is refused: that supplier
--     accepted the job, so it is not a submit failure;
--   * at most three attempts, no route used twice, and the next route must belong to
--     the job's offer, be `active`, carry a parity record and have a closed breaker;
--   * the margin floor holds for that route (cost x units <= credits x 0.01796) unless
--     the route carries a recorded margin waiver;
--   * the new supplier's wholesale budget is reserved under a new effect key
--     (idempotency_key || ':a' || n) through the same private.provider_spend_reserve
--     the debit used, so a hop can never spend past a supplier's hourly or daily limit.
--
-- A NULL next route only records the failed attempt (the caller then refunds as today).
-- The (job_id, attempt_no) unique key makes a second hop for the same number impossible.
-- record_attempt_supplier then stores the new supplier's job id after job_submitted.
--
-- Nothing calls these until the generation route does, and the route calls them only
-- when a second active route exists. 0369 left every Crun route on standby, and no other
-- offer has a second route, so this is inert on deploy.
--
-- Service-role only: explicit REVOKE, then GRANT EXECUTE (CLAUDE.md). SECURITY DEFINER
-- with search_path = ''. Idempotent: CREATE OR REPLACE; REVOKE and GRANT re-run.
-- Rollback: DROP FUNCTION both.

CREATE OR REPLACE FUNCTION public.job_route_failover(
    p_job_id uuid, p_failed_route_id uuid, p_next_route_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    j public.jobs%ROWTYPE;
    m public.model_catalog%ROWTYPE;
    nxt public.model_routes%ROWTYPE;
    last_a public.job_attempts%ROWTYPE;
    n integer;
    units integer;
    cost numeric;
    spend jsonb;
BEGIN
    SELECT * INTO j FROM public.jobs WHERE id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'job_not_found'); END IF;
    IF j.state::text <> 'DEBITED' THEN RETURN jsonb_build_object('ok', false, 'code', 'job_not_failable_over'); END IF;

    SELECT * INTO last_a FROM public.job_attempts WHERE job_id = p_job_id ORDER BY attempt_no DESC LIMIT 1;
    IF NOT FOUND THEN
        INSERT INTO public.job_attempts (job_id, attempt_no, route_id, outcome, cost_snapshot)
        VALUES (p_job_id, 1, p_failed_route_id, 'failed', 0)
        ON CONFLICT (job_id, attempt_no) DO NOTHING;
        n := 1;
    ELSE
        IF last_a.supplier_job_id IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'attempt_was_accepted'); END IF;
        IF last_a.route_id <> p_failed_route_id THEN RETURN jsonb_build_object('ok', false, 'code', 'failed_route_mismatch'); END IF;
        UPDATE public.job_attempts SET outcome = 'failed', updated_at = now() WHERE id = last_a.id AND outcome IS DISTINCT FROM 'failed';
        n := last_a.attempt_no;
    END IF;

    IF p_next_route_id IS NULL THEN RETURN jsonb_build_object('ok', true, 'attempt_no', NULL); END IF;
    IF n >= 3 THEN RETURN jsonb_build_object('ok', false, 'code', 'no_more_routes'); END IF;

    SELECT * INTO nxt FROM public.model_routes WHERE id = p_next_route_id;
    IF NOT FOUND OR nxt.model_id <> j.model_id THEN RETURN jsonb_build_object('ok', false, 'code', 'route_not_for_job'); END IF;
    IF nxt.state <> 'active' OR nxt.parity_record IS NULL OR nxt.breaker_opened_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'route_not_eligible');
    END IF;
    IF EXISTS (SELECT 1 FROM public.job_attempts WHERE job_id = p_job_id AND route_id = p_next_route_id) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'route_already_tried');
    END IF;

    SELECT * INTO m FROM public.model_catalog WHERE id = j.model_id;
    units := GREATEST(1, CEIL(GREATEST(1, j.credits)::numeric / m.credits_5s)::integer);
    -- The same arithmetic private.provider_spend_model_cost uses at the debit: unit cost x units.
    cost := nxt.cost_per_unit * units;
    IF nxt.margin_waiver_note IS NULL AND round(cost * 100000) > j.credits * 1796 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'route_below_margin_floor');
    END IF;

    spend := private.provider_spend_reserve(j.user_id, j.idempotency_key || ':a' || (n + 1), j.model_id,
        nxt.supplier, 'job', GREATEST(1, CEIL(cost * 1000000)::bigint));
    IF spend->>'ok' IS DISTINCT FROM 'true' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'spend_limit', 'scope', spend->>'scope');
    END IF;

    INSERT INTO public.job_attempts (job_id, attempt_no, route_id, cost_snapshot)
    VALUES (p_job_id, n + 1, p_next_route_id, nxt.cost_per_unit);
    RETURN jsonb_build_object('ok', true, 'attempt_no', n + 1,
        'route', jsonb_build_object('id', nxt.id, 'supplier', nxt.supplier, 'endpoint', nxt.endpoint));
END;
$$;

CREATE OR REPLACE FUNCTION public.record_attempt_supplier(
    p_job_id uuid, p_attempt_no integer, p_supplier_job_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE j public.jobs%ROWTYPE; n integer;
BEGIN
    SELECT * INTO j FROM public.jobs WHERE id = p_job_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'job_not_found'); END IF;
    IF j.provider_job_id IS DISTINCT FROM p_supplier_job_id THEN
        RETURN jsonb_build_object('ok', false, 'code', 'supplier_job_mismatch');
    END IF;
    UPDATE public.job_attempts
       SET supplier_job_id = p_supplier_job_id, outcome = 'submitted', updated_at = now()
     WHERE job_id = p_job_id AND attempt_no = p_attempt_no AND supplier_job_id IS NULL AND outcome IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'updated', n);
END;
$$;

REVOKE ALL ON FUNCTION public.job_route_failover(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_route_failover(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.record_attempt_supplier(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_attempt_supplier(uuid, integer, text) TO service_role;
