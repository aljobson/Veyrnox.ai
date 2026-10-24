-- 0376 — Per-route circuit breaker (ADR-0256 phase 3a, decision 7).
--
-- A route that keeps failing stops being offered for a while, so the next job does not go
-- through the same refusal first. private.route_breaker_record(route, ok):
--   * ok      -> consecutive_failures = 0 and the breaker closes (breaker_opened_at = NULL);
--   * failure -> consecutive_failures + 1; from the fifth in a row the breaker is (re)opened at now().
-- An open breaker blocks a hop for ten minutes (cooldown). After that the route is eligible
-- again as a probe: a success closes the breaker, a failure re-opens it for another ten minutes.
--
-- What counts as a failure, and nothing else:
--   * job_route_failover closing an attempt as failed (a provable refusal at submit: auth, payment,
--     capacity), once per attempt;
--   * a supplier reporting a failed job: mark_job_attempt_outcome(.., 'failed'), once per attempt.
-- A success is mark_job_attempt_outcome(.., 'completed'). Ambiguous answers and refused prompts
-- never reach either function, so they cannot trip a breaker.
--
-- The two functions below are 0373 and 0372 restated with that one addition each (the hop now
-- honours the cooldown instead of any non-null breaker). Their behaviour is otherwise unchanged;
-- test-supplier-route-failover.mjs still passes. model_route_reorder keeps refusing any route with a
-- breaker timestamp, so the owner never orders a tripped route first.
--
-- Idempotent: CREATE OR REPLACE; REVOKE and GRANT re-run. Rollback: restore 0373 and 0372.

CREATE OR REPLACE FUNCTION private.route_breaker_record(p_route_id uuid, p_ok boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF p_ok THEN
        UPDATE public.model_routes SET consecutive_failures = 0, breaker_opened_at = NULL, updated_at = now()
         WHERE id = p_route_id AND (consecutive_failures <> 0 OR breaker_opened_at IS NOT NULL);
    ELSE
        UPDATE public.model_routes
           SET consecutive_failures = consecutive_failures + 1,
               breaker_opened_at = CASE WHEN consecutive_failures + 1 >= 5 THEN now() ELSE breaker_opened_at END,
               updated_at = now()
         WHERE id = p_route_id;
    END IF;
END $$;
REVOKE ALL ON FUNCTION private.route_breaker_record(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;

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
    closed BIGINT;
BEGIN
    SELECT * INTO j FROM public.jobs WHERE id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'job_not_found'); END IF;
    IF j.state::text <> 'DEBITED' THEN RETURN jsonb_build_object('ok', false, 'code', 'job_not_failable_over'); END IF;

    SELECT * INTO last_a FROM public.job_attempts WHERE job_id = p_job_id ORDER BY attempt_no DESC LIMIT 1;
    IF NOT FOUND THEN
        INSERT INTO public.job_attempts (job_id, attempt_no, route_id, outcome, cost_snapshot)
        VALUES (p_job_id, 1, p_failed_route_id, 'failed', 0)
        ON CONFLICT (job_id, attempt_no) DO NOTHING;
        GET DIAGNOSTICS closed = ROW_COUNT;
        IF closed = 1 THEN PERFORM private.route_breaker_record(p_failed_route_id, false); END IF;
        n := 1;
    ELSE
        IF last_a.supplier_job_id IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'attempt_was_accepted'); END IF;
        IF last_a.route_id <> p_failed_route_id THEN RETURN jsonb_build_object('ok', false, 'code', 'failed_route_mismatch'); END IF;
        UPDATE public.job_attempts SET outcome = 'failed', updated_at = now() WHERE id = last_a.id AND outcome IS DISTINCT FROM 'failed';
        GET DIAGNOSTICS closed = ROW_COUNT;
        IF closed = 1 THEN PERFORM private.route_breaker_record(p_failed_route_id, false); END IF;
        n := last_a.attempt_no;
    END IF;

    IF p_next_route_id IS NULL THEN RETURN jsonb_build_object('ok', true, 'attempt_no', NULL); END IF;
    IF n >= 3 THEN RETURN jsonb_build_object('ok', false, 'code', 'no_more_routes'); END IF;

    SELECT * INTO nxt FROM public.model_routes WHERE id = p_next_route_id;
    IF NOT FOUND OR nxt.model_id <> j.model_id THEN RETURN jsonb_build_object('ok', false, 'code', 'route_not_for_job'); END IF;
    -- An open breaker blocks a hop for ten minutes; after that the route is a probe.
    IF nxt.state <> 'active' OR nxt.parity_record IS NULL
       OR (nxt.breaker_opened_at IS NOT NULL AND nxt.breaker_opened_at > now() - interval '10 minutes') THEN
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

CREATE OR REPLACE FUNCTION public.mark_job_attempt_outcome(
    p_provider text, p_supplier_job_id text, p_outcome text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE a record; n integer := 0;
BEGIN
    IF p_outcome NOT IN ('completed', 'failed') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_outcome');
    END IF;
    FOR a IN
        UPDATE public.job_attempts x
           SET outcome = p_outcome, updated_at = now()
          FROM public.model_routes r
         WHERE r.id = x.route_id
           AND r.supplier = p_provider
           AND x.supplier_job_id = p_supplier_job_id
           AND x.outcome = 'submitted'
        RETURNING x.route_id
    LOOP
        n := n + 1;
        PERFORM private.route_breaker_record(a.route_id, p_outcome = 'completed');
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'updated', n);
END;
$$;

REVOKE ALL ON FUNCTION public.job_route_failover(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_route_failover(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mark_job_attempt_outcome(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_job_attempt_outcome(text, text, text) TO service_role;
