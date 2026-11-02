-- Abuse and cost guards: per-user in-flight job cap, spend policy for the two
-- providers that had none, reservation pruning, a job-burst alert rule and a
-- spend-utilisation read.
--
-- 1. user_inflight_policy + jobs_inflight_guard. The generation limiter allows
--    10 jobs a minute, and long video jobs stay DEBITED/SUBMITTED for up to two
--    hours, so one account could queue several hundred pieces of supplier work.
--    The trigger counts the account's live jobs under a per-user advisory lock
--    (parallel inserts serialise) and refuses past the cap with the same
--    PROVIDER_SPEND_LIMIT:<scope>:<retry> shape 0327 raises, so the Worker's
--    providerSpendError() turns it into a 429. It fires before
--    jobs_provider_spend_guard (trigger names fire alphabetically), so a refusal
--    never takes the global spend lock. A replay returns the existing job before
--    any INSERT, so replays are unaffected. Only DEBITED inserts are counted.
--    A job holds its slot until it leaves DEBITED/SUBMITTED (no age cut-off). The
--    switch is the table's `enabled` column; a missing row means no cap, and
--    the spend caps in 0327/0329 still apply.
-- 2. provider_spend_provider_policy rows for byteplus and crun (0329 seeded
--    only grsai, fal, kie and openrouter*), so they no longer ride on the
--    global cap alone.
-- 3. prune_provider_spend_reservations: the spend check sums this table inside
--    the global lock, and nothing ever deleted from it. Seven days is kept,
--    far longer than the UTC-day window the limits read. Reservations of jobs still
--    DEBITED or SUBMITTED are kept (0414 reconciliation needs them). Scheduled daily.
-- 4. SEC-008: one account creating many jobs in an hour (run_security_detection
--    is 0418's body plus one branch).
-- 5. provider_spend_utilization(): hour/day use against each cap, for an
--    out-of-band poller that warns before a cap is hit.
--
-- Idempotent throughout (IF NOT EXISTS, OR REPLACE, ON CONFLICT DO NOTHING).
-- No catalog UPDATE, no ledger or credit_balances write. It can only refuse a
-- new job, never withhold a refund, so the Worker-only rollback stays safe.

CREATE TABLE IF NOT EXISTS public.user_inflight_policy (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
    enabled BOOLEAN NOT NULL DEFAULT true,
    max_inflight INTEGER NOT NULL CHECK (max_inflight BETWEEN 1 AND 1000),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.user_inflight_policy (singleton, enabled, max_inflight)
VALUES (true, true, 30)
ON CONFLICT (singleton) DO NOTHING;
ALTER TABLE public.user_inflight_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_inflight_policy FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_inflight_policy FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX IF NOT EXISTS jobs_user_inflight_idx ON public.jobs (user_id)
    WHERE state IN ('DEBITED'::public.job_state, 'SUBMITTED'::public.job_state);

CREATE OR REPLACE FUNCTION private.enforce_user_inflight_on_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_policy public.user_inflight_policy%ROWTYPE; v_live INTEGER;
BEGIN
    IF NEW.state::text IS DISTINCT FROM 'DEBITED' THEN RETURN NEW; END IF;
    SELECT * INTO v_policy FROM public.user_inflight_policy WHERE singleton;
    IF NOT FOUND OR NOT v_policy.enabled THEN RETURN NEW; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('inflight:' || NEW.user_id::text, 0));
    -- No age cut-off: a job holds its slot until its state changes. 0414 deliberately keeps
    -- DEBITED jobs marked provider_outcome_unknown until service reconciliation, and an age
    -- window would free their slots while the supplier may still be working. The partial
    -- index below keeps this count to the account's live rows.
    SELECT count(*) INTO v_live FROM public.jobs
     WHERE user_id = NEW.user_id
       AND state IN ('DEBITED'::public.job_state, 'SUBMITTED'::public.job_state);
    IF v_live >= v_policy.max_inflight THEN
        RAISE EXCEPTION 'PROVIDER_SPEND_LIMIT:user_inflight:30' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.enforce_user_inflight_on_job() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS jobs_inflight_guard ON public.jobs;
CREATE TRIGGER jobs_inflight_guard
BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION private.enforce_user_inflight_on_job();

INSERT INTO public.provider_spend_provider_policy (provider, admission_open, hour_microusd, day_microusd)
VALUES ('byteplus', true, 10000000, 25000000),
       ('crun', true, 10000000, 25000000)
ON CONFLICT (provider) DO NOTHING;

CREATE OR REPLACE FUNCTION public.prune_provider_spend_reservations(p_keep_days INTEGER DEFAULT 7)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_deleted INTEGER;
BEGIN
    IF p_keep_days IS NULL OR p_keep_days < 3 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'KEEP_DAYS_INVALID');
    END IF;
    -- A reservation is also the evidence 0414 uses to hold and reconcile an ambiguous
    -- supplier submission, so keep every reservation that belongs to a job still DEBITED or
    -- SUBMITTED: its own key and its failover attempts (key || ':a' || n, 0373).
    DELETE FROM public.provider_spend_reservations
     WHERE id IN (SELECT r.id FROM public.provider_spend_reservations r
                   WHERE r.admitted_at < now() - make_interval(days => p_keep_days)
                     AND NOT EXISTS (
                         SELECT 1 FROM public.jobs j
                          WHERE j.user_id = r.user_id
                            AND j.state IN ('DEBITED'::public.job_state, 'SUBMITTED'::public.job_state)
                            AND j.idempotency_key IS NOT NULL
                            AND (r.effect_key = j.idempotency_key
                                 OR left(r.effect_key, length(j.idempotency_key) + 2) = j.idempotency_key || ':a'))
                   ORDER BY r.admitted_at LIMIT 50000);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'deleted', v_deleted);
END $$;
REVOKE ALL ON FUNCTION public.prune_provider_spend_reservations(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_provider_spend_reservations(INTEGER) TO service_role;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RETURN;
    END IF;
    PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'veyrnox-prune-provider-spend';
    PERFORM cron.schedule('veyrnox-prune-provider-spend', '17 3 * * *',
        $cmd$ SELECT public.prune_provider_spend_reservations(7); $cmd$);
END $$;

INSERT INTO public.security_rules (rule_id, title, level, tags, window_minutes, threshold) VALUES
    ('SEC-008', 'One account created an unusual number of jobs', 'medium', ARRAY['attack.impact', 'attack.t1496'], 60, 120)
ON CONFLICT (rule_id) DO NOTHING;

-- ── run_security_detection: 0418 plus the SEC-008 branch ─────────────────
CREATE OR REPLACE FUNCTION public.run_security_detection()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rule   RECORD;
    v_touched INTEGER := 0;
    v_n INTEGER;
BEGIN
    FOR v_rule IN SELECT * FROM public.security_rules WHERE enabled ORDER BY rule_id LOOP
        WITH hits AS (
            SELECT entity, count(*)::INTEGER AS n, min(at) AS first_at, max(at) AS last_at FROM (
                SELECT 'SEC-001' AS rid, d.source AS entity, d.created_at AS at
                  FROM public.webhook_deliveries d
                 WHERE d.outcome = 'rejected_signature'
                UNION ALL
                SELECT 'SEC-002', e.source_key, e.created_at
                  FROM public.security_events e
                 WHERE e.category = 'auth' AND e.action = 'request.reject' AND e.source_key IS NOT NULL
                UNION ALL
                SELECT 'SEC-003', e.action, e.created_at
                  FROM public.security_events e
                 WHERE e.category = 'access' AND e.outcome = 'failure' AND e.action <> 'admin.mfa_required'
                UNION ALL
                SELECT 'SEC-004', a.user_id::text, a.created_at
                  FROM public.account_actions a
                 WHERE a.action = 'freeze'
                UNION ALL
                SELECT 'SEC-005', a.user_id::text, a.created_at
                  FROM public.account_actions a
                 WHERE a.action = 'csam_escalation'
                UNION ALL
                SELECT 'SEC-006', w.source, w.created_at
                  FROM public.webhook_events w
                 WHERE w.processed_at IS NULL AND w.created_at < now() - interval '10 minutes'
                UNION ALL
                SELECT 'SEC-007', e.action, e.created_at
                  FROM public.security_events e
                 WHERE e.category = 'access' AND e.outcome = 'failure' AND e.action = 'admin.mfa_required'
                UNION ALL
                SELECT 'SEC-008', j.user_id::text, j.created_at
                  FROM public.jobs j
                 WHERE j.created_at >= now() - interval '1 day'
            ) s
            WHERE rid = v_rule.rule_id AND at >= now() - make_interval(mins => v_rule.window_minutes)
            GROUP BY entity
            HAVING count(*) >= v_rule.threshold
        )
        INSERT INTO public.security_alerts (rule_id, dedup_key, severity, title, entity, tags, event_count, first_seen, last_seen)
        SELECT v_rule.rule_id,
               v_rule.rule_id || '|' || left(h.entity, 80) || '|' || to_char(date_trunc('hour', h.last_at AT TIME ZONE 'UTC'), 'YYYYMMDDHH24'),
               v_rule.level, v_rule.title, left(h.entity, 120), v_rule.tags, h.n, h.first_at, h.last_at
          FROM hits h
        ON CONFLICT (dedup_key) DO UPDATE
           SET event_count = EXCLUDED.event_count, last_seen = EXCLUDED.last_seen, updated_at = now();
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_touched := v_touched + v_n;
    END LOOP;
    -- Heartbeat: proof this run completed. The out-of-band watcher reads the
    -- newest ran_at; no heartbeat in ~15 minutes means the engine is silent.
    INSERT INTO public.security_detection_runs (alerts_touched) VALUES (v_touched);
    -- Thirty days of liveness history is plenty; about one run in a hundred prunes.
    IF random() < 0.01 THEN
        DELETE FROM public.security_detection_runs WHERE ran_at < now() - interval '30 days';
    END IF;
    RETURN jsonb_build_object('ok', true, 'alerts_touched', v_touched);
END $$;
REVOKE ALL ON FUNCTION public.run_security_detection() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_security_detection() TO service_role;

-- ── spend utilisation, for a poller that warns before a cap is hit ───────
-- Reservations are worst-case estimates, so this reads "how close to refusing",
-- not what was billed. Percentages only; no user is named.
CREATE OR REPLACE FUNCTION public.provider_spend_utilization()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_policy public.provider_spend_policy%ROWTYPE;
    v_day_start TIMESTAMPTZ := date_trunc('day', statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    v_hour BIGINT; v_day BIGINT; v_top_hour BIGINT; v_top_day BIGINT; v_providers JSONB;
BEGIN
    SELECT * INTO v_policy FROM public.provider_spend_policy WHERE singleton;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'POLICY_MISSING'); END IF;
    SELECT COALESCE(sum(estimated_cost_microusd), 0) INTO v_hour
      FROM public.provider_spend_reservations WHERE admitted_at > now() - interval '1 hour';
    SELECT COALESCE(sum(estimated_cost_microusd), 0) INTO v_day
      FROM public.provider_spend_reservations WHERE admitted_at >= v_day_start;
    SELECT COALESCE(max(s), 0) INTO v_top_hour FROM (
        SELECT sum(estimated_cost_microusd) AS s FROM public.provider_spend_reservations
         WHERE admitted_at > now() - interval '1 hour' GROUP BY user_id) t;
    SELECT COALESCE(max(s), 0) INTO v_top_day FROM (
        SELECT sum(estimated_cost_microusd) AS s FROM public.provider_spend_reservations
         WHERE admitted_at >= v_day_start GROUP BY user_id) t;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'provider', p.provider,
               'hour_pct', round(100.0 * COALESCE(h.s, 0) / p.hour_microusd, 1),
               'day_pct', round(100.0 * COALESCE(d.s, 0) / p.day_microusd, 1))), '[]'::jsonb)
      INTO v_providers
      FROM public.provider_spend_provider_policy p
      LEFT JOIN (SELECT provider, sum(estimated_cost_microusd) s FROM public.provider_spend_reservations
                  WHERE admitted_at > now() - interval '1 hour' GROUP BY provider) h ON h.provider = p.provider
      LEFT JOIN (SELECT provider, sum(estimated_cost_microusd) s FROM public.provider_spend_reservations
                  WHERE admitted_at >= v_day_start GROUP BY provider) d ON d.provider = p.provider;
    RETURN jsonb_build_object('ok', true,
        'admission_open', v_policy.admission_open,
        'global_hour_pct', round(100.0 * v_hour / v_policy.global_hour_microusd, 1),
        'global_day_pct', round(100.0 * v_day / v_policy.global_day_microusd, 1),
        'busiest_user_hour_pct', round(100.0 * v_top_hour / v_policy.user_hour_microusd, 1),
        'busiest_user_day_pct', round(100.0 * v_top_day / v_policy.user_day_microusd, 1),
        'providers', v_providers);
END $$;
REVOKE ALL ON FUNCTION public.provider_spend_utilization() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_spend_utilization() TO service_role;
