-- 0456 — Nano Banana Pro: kie becomes the active second route behind GrsAI (ADR-0256 decisions 3 and 5).
--
--   offer                   route 1 (own dispatch)         route 2 (this migration)
--   nano-banana-pro-grsai   grsai, $0.0271, 2 credits      kie market:nano-banana-pro, $0.0900
--
-- Why: the GrsAI account ran out of credits (probe 2026-11-10: HTTP 200, code -1, "insufficient credits"), and the
-- offer had no second route, so every job was refused and refunded. With this row, and the adapter rule that now
-- reports that refusal as provider_payment_required, a job GrsAI refuses on balance hops to kie once (0373).
--
-- Evidence (scripts/probe-image-models.mjs nano-banana-pro-kie, the owner's kie key, 2026-11-10):
--   task 26cba7722184e514a7373068284b82fa: success after 38 s, PNG 2048x2048, 8238810 bytes, from
--   tempfile.aiquickdraw.com (the `.aiquickdraw.com` suffix is already on the kie copy allowlist), image read by
--   Claude Code: a red paper boat on a misty lake, follows the prompt, no watermark or overlay.
-- NOT established: the charge in the kie dashboard (the owner reads it; $0.09 expected, the 0105 row cost).
--
-- Margin: at 2 credits the cap is 2 x $0.01796 = $0.0359 (ADR-0037); kie costs $0.09, so this route breaches the
-- floor and carries a margin waiver. The owner chose this on 2026-11-10 (chat: "kie only, capped"). fal ($0.15) is
-- left out on purpose.
--
-- The daily cap is enforced here, not just stored: daily_spend_cap_cents was a column nothing read (review of #2063).
-- job_route_failover (0376's body, otherwise unchanged) now locks the next route's row and refuses the hop with
-- route_daily_cap when today's reservations for that supplier and offer, plus this hop, would pass the cap. 500 cents
-- is $5 of kie spend a UTC day, about 55 hops. A refused hop refunds the customer as any other refusal does.
-- Any route with a NULL cap behaves exactly as before.
--
-- Priority 2, provenance licensed_reseller. Nothing else changes: no price, no catalog row, route 1 untouched.
-- Idempotent: ON CONFLICT DO NOTHING. Rollback: UPDATE state = 'disabled' on the row, or DELETE it.

BEGIN;

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
    spent BIGINT;
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

    SELECT * INTO nxt FROM public.model_routes WHERE id = p_next_route_id FOR UPDATE;
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

    -- A route's own daily cap (cents of wholesale spend, UTC day). Reservations are never released on refund, so the
    -- sum counts what the supplier may bill. The route row is locked above, so concurrent hops queue here.
    IF nxt.daily_spend_cap_cents IS NOT NULL THEN
        SELECT COALESCE(sum(r.estimated_cost_microusd), 0)::bigint INTO spent
          FROM public.provider_spend_reservations r
         WHERE r.provider = nxt.supplier AND r.model_id = j.model_id AND r.purpose = 'job'
           AND r.admitted_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');
        IF spent + GREATEST(1, CEIL(cost * 1000000)::bigint) > nxt.daily_spend_cap_cents::bigint * 10000 THEN
            RETURN jsonb_build_object('ok', false, 'code', 'route_daily_cap');
        END IF;
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

REVOKE ALL ON FUNCTION public.job_route_failover(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_route_failover(uuid, uuid, uuid) TO service_role;

DO $$
DECLARE n BIGINT;
BEGIN
    -- Route 1 must exist and be the GrsAI one, or there is nothing for a hop to start from.
    SELECT count(*) INTO n FROM public.model_routes r
      JOIN public.model_catalog c ON c.id = r.model_id AND c.active
     WHERE r.model_id = 'nano-banana-pro-grsai' AND r.supplier = 'grsai' AND r.priority = 1 AND r.state = 'active';
    IF n <> 1 THEN
        RAISE EXCEPTION 'Expected one active GrsAI route 1 for nano-banana-pro-grsai, found %', n;
    END IF;
END $$;

INSERT INTO public.model_routes
    (model_id, supplier, endpoint, cost_per_unit, cost_unit, priority, state, provenance,
     parity_record, margin_waiver_note, daily_spend_cap_cents)
VALUES
    ('nano-banana-pro-grsai', 'kie', 'market:nano-banana-pro', 0.0900, 'per_generation', 2, 'active', 'licensed_reseller',
     'probe 2026-11-10 (owner key): market:nano-banana-pro, task 26cba7722184e514a7373068284b82fa success after 38 s, PNG 2048x2048 8238810 bytes from tempfile.aiquickdraw.com, image read by Claude Code: coherent, follows the prompt, no watermark or overlay; kie dashboard charge not yet read',
     'owner decision 2026-11-10 (chat, "kie only, capped"): GrsAI outage standby at 2 credits; cost $0.0900 exceeds the $0.0359 cap (ADR-0037); bounded by the daily spend cap',
     500)
ON CONFLICT (model_id, priority) DO NOTHING;

DO $$
DECLARE n BIGINT;
BEGIN
    SELECT count(*) INTO n FROM public.model_routes
     WHERE model_id = 'nano-banana-pro-grsai' AND supplier = 'kie' AND endpoint = 'market:nano-banana-pro'
       AND priority = 2 AND state = 'active' AND parity_record IS NOT NULL AND margin_waiver_note IS NOT NULL
       AND daily_spend_cap_cents = 500;
    IF n <> 1 THEN
        RAISE EXCEPTION 'Expected the kie standby route for nano-banana-pro-grsai, found %', n;
    END IF;
END $$;

COMMIT;
