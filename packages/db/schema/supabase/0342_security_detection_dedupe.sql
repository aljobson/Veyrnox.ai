-- Security alerts, two fixes found on production the day 0336 went live (ADR-0104).
--
-- 1. One event, two alerts. The alert key used the hour the run happened in,
--    but a rule looks back over its whole window, so an event at 10:50 was
--    counted again by the 11:00 hour's run and raised a second alert. The key
--    now uses the hour of the newest event in the group: the same event keeps
--    one alert however many runs see it, and fresh activity in a later hour
--    still raises a new one.
-- 2. A missing second factor is not an intrusion. SEC-003 fired as a high
--    alert whenever an administrator opened a dashboard page before unlocking
--    their authenticator (action admin.mfa_required). SEC-003 now reads only
--    admin.access_refused; the missing-second-factor refusals have their own
--    low-severity rule, SEC-007, which needs a run of them.
--
-- Alerts already raised are history and are left as they are; close them on
-- the page. Idempotent: OR REPLACE, ON CONFLICT DO NOTHING, REVOKE/GRANT re-run.

INSERT INTO public.security_rules (rule_id, title, level, tags, window_minutes, threshold) VALUES
    ('SEC-007', 'Repeated admin requests without a second factor', 'low', ARRAY['attack.initial_access', 'attack.t1078'], 60, 10)
ON CONFLICT (rule_id) DO NOTHING;

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
    RETURN jsonb_build_object('ok', true, 'alerts_touched', v_touched);
END $$;
REVOKE ALL ON FUNCTION public.run_security_detection() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_security_detection() TO service_role;
