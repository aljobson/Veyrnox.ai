-- Security detection liveness heartbeat and an out-of-band status read (ADR-0310).
--
-- 0336/0342 built the detection engine: run_security_detection() upserts
-- alerts and is scheduled every 5 minutes by in-DB pg_cron. Nothing watches
-- that schedule. If pg_cron is absent or the job errors, detection stops and
-- the silence is invisible — the exact failure mode reconcile-watch.yml was
-- built to cure for the ledger ("that failure lived only in
-- cron.job_run_details, which nothing reads").
--
-- This records a heartbeat each time the engine completes a run, and adds a
-- service-role-only reader that returns the age of the last run and the count
-- of open high/critical alerts. An out-of-band GitHub Actions poller
-- (.github/workflows/detection-watch.yml) reads it and files an issue when the
-- engine has gone quiet or a high-severity alert is open and unacknowledged.
--
--   security_detection_runs    one row per completed detection run (ran_at,
--                              alerts_touched). Append-only; the engine's own
--                              liveness signal. Pruned at 30 days.
--
-- Touches only detection bookkeeping: never the ledger, the credit balances
-- or any user-facing table. Idempotent: IF NOT EXISTS, OR REPLACE,
-- REVOKE/GRANT re-run. No catalog UPDATE.

CREATE TABLE IF NOT EXISTS public.security_detection_runs (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ran_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    alerts_touched INTEGER     NOT NULL DEFAULT 0 CHECK (alerts_touched >= 0)
);
CREATE INDEX IF NOT EXISTS security_detection_runs_recent_idx ON public.security_detection_runs (ran_at DESC);
ALTER TABLE public.security_detection_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_detection_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_detection_runs FROM PUBLIC, anon, authenticated;

-- ── the engine, now leaving a heartbeat ──────────────────────────────────
-- Identical to 0342 except for the heartbeat INSERT and prune before RETURN.
-- The INSERT is the last statement, so a run that errors on any rule rolls
-- back the heartbeat too: a failed run must not read as a live one.
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

-- ── out-of-band liveness + open-alert read ───────────────────────────────
-- Counts and timings only, no event bodies. Service-role only, like every
-- other reader of the detection tables: the browser never calls this.
CREATE OR REPLACE FUNCTION public.security_detection_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_last   TIMESTAMPTZ;
    v_crit   INTEGER;
    v_high   INTEGER;
    v_alerts JSONB;
BEGIN
    SELECT max(ran_at) INTO v_last FROM public.security_detection_runs;

    SELECT count(*) FILTER (WHERE a.severity = 'critical'),
           count(*) FILTER (WHERE a.severity = 'high')
      INTO v_crit, v_high
      FROM public.security_alerts a
     WHERE a.status = 'open';

    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_alerts FROM (
        SELECT a.rule_id, a.severity, a.entity, a.event_count, a.last_seen
          FROM public.security_alerts a
         WHERE a.status = 'open' AND a.severity IN ('high', 'critical')
         ORDER BY (CASE a.severity WHEN 'critical' THEN 0 ELSE 1 END), a.last_seen DESC
         LIMIT 20
    ) t;

    RETURN jsonb_build_object(
        'ok', true,
        'last_run_at', v_last,
        'seconds_since_run', CASE WHEN v_last IS NULL THEN NULL
                                  ELSE floor(extract(epoch FROM (now() - v_last)))::bigint END,
        'open_critical', COALESCE(v_crit, 0),
        'open_high', COALESCE(v_high, 0),
        'open_high_or_critical', COALESCE(v_crit, 0) + COALESCE(v_high, 0),
        'open_alerts', v_alerts
    );
END $$;
REVOKE ALL ON FUNCTION public.security_detection_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_detection_status() TO service_role;
