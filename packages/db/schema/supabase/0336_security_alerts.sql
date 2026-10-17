-- Security alerts: a small detection layer for the admin dashboard (ADR-0104).
--
-- Borrows formats, not software: ECS-style event fields, Sigma-style rules
-- (a catalogue row with a level, a window, a threshold and ATT&CK tags),
-- and a triage lifecycle. No SIEM runs inside a Worker, so the engine is one
-- SQL function on a schedule.
--
--   security_events          what the Worker saw at the door (auth rejects,
--                            admin access refusals). Append-only, no payloads,
--                            no tokens, no addresses: the source is a keyed
--                            hash made in the Worker. Pruned at 90 days.
--   security_rules           the rule catalogue (id, level, tags, window,
--                            threshold, enabled). Rules read this table and
--                            the signal tables that already exist.
--   security_alerts          one row per rule + entity + hour bucket
--                            (dedup_key UNIQUE). Replays update, never repeat.
--   security_alert_actions   append-only triage trail (who, from, to, note).
--
-- Idempotent: IF NOT EXISTS, OR REPLACE, REVOKE/GRANT re-run.

CREATE TABLE IF NOT EXISTS public.security_events (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    category    TEXT        NOT NULL CHECK (category IN ('auth', 'access', 'webhook', 'billing', 'abuse', 'system')),
    action      TEXT        NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.-]{1,60}$'),
    outcome     TEXT        NOT NULL CHECK (outcome IN ('success', 'failure')),
    source_key  TEXT        NULL CHECK (source_key IS NULL OR source_key ~ '^[A-Za-z0-9_-]{8,64}$'),
    path        TEXT        NULL CHECK (path IS NULL OR (length(path) <= 120 AND path ~ '^/[A-Za-z0-9/_.\-\[\]]*$')),
    status      INTEGER     NULL CHECK (status IS NULL OR status BETWEEN 100 AND 599),
    reason      TEXT        NULL CHECK (reason IS NULL OR reason ~ '^[a-z0-9_:. -]{1,80}$'),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS security_events_recent_idx ON public.security_events (created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_rule_idx ON public.security_events (category, action, created_at);
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.security_events_no_update()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'security_events is append-only (attempted %)', TG_OP;
END $$;
REVOKE ALL ON FUNCTION public.security_events_no_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS security_events_no_update ON public.security_events;
CREATE TRIGGER security_events_no_update BEFORE UPDATE ON public.security_events
    FOR EACH ROW EXECUTE FUNCTION public.security_events_no_update();
DROP TRIGGER IF EXISTS security_events_no_truncate ON public.security_events;
CREATE TRIGGER security_events_no_truncate BEFORE TRUNCATE ON public.security_events
    FOR EACH STATEMENT EXECUTE FUNCTION public.security_events_no_update();

CREATE TABLE IF NOT EXISTS public.security_rules (
    rule_id         TEXT        PRIMARY KEY CHECK (rule_id ~ '^SEC-[0-9]{3}$'),
    title           TEXT        NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
    level           TEXT        NOT NULL CHECK (level IN ('informational', 'low', 'medium', 'high', 'critical')),
    tags            TEXT[]      NOT NULL DEFAULT '{}',
    window_minutes  INTEGER     NOT NULL CHECK (window_minutes BETWEEN 1 AND 1440),
    threshold       INTEGER     NOT NULL CHECK (threshold >= 1),
    enabled         BOOLEAN     NOT NULL DEFAULT true,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.security_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_rules FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_rules FROM PUBLIC, anon, authenticated;

INSERT INTO public.security_rules (rule_id, title, level, tags, window_minutes, threshold) VALUES
    ('SEC-001', 'Webhook signature failures from one provider', 'high',          ARRAY['attack.initial_access', 'attack.t1190'], 15, 5),
    ('SEC-002', 'Burst of refused sign-ins from one source',    'medium',        ARRAY['attack.credential_access', 'attack.t1110'], 10, 20),
    ('SEC-003', 'Admin dashboard access refused',               'high',          ARRAY['attack.initial_access', 'attack.t1078'], 60, 1),
    ('SEC-004', 'Account frozen',                               'high',          ARRAY['attack.impact', 'attack.t1657'], 60, 1),
    ('SEC-005', 'CSAM escalation recorded',                     'critical',      ARRAY['attack.impact'], 1440, 1),
    ('SEC-006', 'Webhook accepted but never processed',         'medium',        ARRAY['attack.impact'], 60, 1)
ON CONFLICT (rule_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.security_alerts (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id      TEXT        NOT NULL REFERENCES public.security_rules(rule_id) ON DELETE RESTRICT,
    dedup_key    TEXT        NOT NULL UNIQUE CHECK (length(dedup_key) BETWEEN 8 AND 200),
    severity     TEXT        NOT NULL CHECK (severity IN ('informational', 'low', 'medium', 'high', 'critical')),
    title        TEXT        NOT NULL,
    entity       TEXT        NOT NULL CHECK (length(entity) BETWEEN 1 AND 120),
    tags         TEXT[]      NOT NULL DEFAULT '{}',
    event_count  INTEGER     NOT NULL CHECK (event_count >= 1),
    status       TEXT        NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'acknowledged', 'investigating', 'resolved', 'false_positive')),
    first_seen   TIMESTAMPTZ NOT NULL,
    last_seen    TIMESTAMPTZ NOT NULL,
    updated_by   TEXT        NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS security_alerts_list_idx ON public.security_alerts (status, last_seen DESC);
CREATE INDEX IF NOT EXISTS security_alerts_rule_idx ON public.security_alerts (rule_id);
ALTER TABLE public.security_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_alerts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_alerts FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.security_alert_actions (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id    UUID        NOT NULL REFERENCES public.security_alerts(id) ON DELETE RESTRICT,
    actor       TEXT        NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 120),
    from_status TEXT        NOT NULL,
    to_status   TEXT        NOT NULL,
    note        TEXT        NULL CHECK (note IS NULL OR length(note) <= 500),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS security_alert_actions_alert_idx ON public.security_alert_actions (alert_id, created_at);
ALTER TABLE public.security_alert_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_alert_actions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_alert_actions FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.security_alert_actions_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'security_alert_actions is append-only (attempted %)', TG_OP;
END $$;
REVOKE ALL ON FUNCTION public.security_alert_actions_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS security_alert_actions_append_only ON public.security_alert_actions;
CREATE TRIGGER security_alert_actions_append_only BEFORE UPDATE OR DELETE ON public.security_alert_actions
    FOR EACH ROW EXECUTE FUNCTION public.security_alert_actions_append_only();
DROP TRIGGER IF EXISTS security_alert_actions_no_truncate ON public.security_alert_actions;
CREATE TRIGGER security_alert_actions_no_truncate BEFORE TRUNCATE ON public.security_alert_actions
    FOR EACH STATEMENT EXECUTE FUNCTION public.security_alert_actions_append_only();

-- ── writer, called from the Worker ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_security_event(
    p_category TEXT,
    p_action TEXT,
    p_outcome TEXT,
    p_source_key TEXT DEFAULT NULL,
    p_path TEXT DEFAULT NULL,
    p_status INTEGER DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_category IS NULL OR p_category NOT IN ('auth', 'access', 'webhook', 'billing', 'abuse', 'system') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'CATEGORY_INVALID');
    END IF;
    IF p_action IS NULL OR p_action !~ '^[a-z][a-z0-9_.-]{1,60}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACTION_INVALID');
    END IF;
    IF p_outcome IS NULL OR p_outcome NOT IN ('success', 'failure') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'OUTCOME_INVALID');
    END IF;
    INSERT INTO public.security_events (category, action, outcome, source_key, path, status, reason)
    VALUES (
        p_category, p_action, p_outcome,
        CASE WHEN p_source_key ~ '^[A-Za-z0-9_-]{8,64}$' THEN p_source_key END,
        CASE WHEN length(p_path) <= 120 AND p_path ~ '^/[A-Za-z0-9/_.\-\[\]]*$' THEN p_path END,
        CASE WHEN p_status BETWEEN 100 AND 599 THEN p_status END,
        CASE WHEN p_reason ~ '^[a-z0-9_:. -]{1,80}$' THEN p_reason END
    );
    -- Ninety days is enough to see a pattern; about one call in two hundred prunes.
    IF random() < 0.005 THEN
        DELETE FROM public.security_events WHERE created_at < now() - interval '90 days';
    END IF;
    RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.record_security_event(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_security_event(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT) TO service_role;

-- ── the engine ───────────────────────────────────────────────────────────
-- One statement per rule. Each groups a signal by entity inside the rule's
-- window and upserts an alert keyed rule|entity|hour. A resolved or
-- false-positive alert keeps its status when the same hour sees more events.
CREATE OR REPLACE FUNCTION public.run_security_detection()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bucket TEXT := to_char(date_trunc('hour', now()), 'YYYYMMDDHH24');
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
                 WHERE e.category = 'access' AND e.outcome = 'failure'
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
            ) s
            WHERE rid = v_rule.rule_id AND at >= now() - make_interval(mins => v_rule.window_minutes)
            GROUP BY entity
            HAVING count(*) >= v_rule.threshold
        )
        INSERT INTO public.security_alerts (rule_id, dedup_key, severity, title, entity, tags, event_count, first_seen, last_seen)
        SELECT v_rule.rule_id, v_rule.rule_id || '|' || left(h.entity, 80) || '|' || v_bucket,
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

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RETURN;
    END IF;
    PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'veyrnox-security-detection';
    PERFORM cron.schedule('veyrnox-security-detection', '*/5 * * * *', $cmd$ SELECT public.run_security_detection(); $cmd$);
END $$;

-- ── admin reads and triage ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_security_alerts(
    p_auth_id TEXT,
    p_status TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 50
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_admin BOOLEAN;
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
    v_alerts JSONB;
    v_counts JSONB;
    v_events JSONB;
BEGIN
    SELECT u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    IF p_status IS NOT NULL AND p_status NOT IN ('open', 'acknowledged', 'investigating', 'resolved', 'false_positive') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'STATUS_INVALID');
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_alerts FROM (
        SELECT a.id, a.rule_id, a.severity, a.title, a.entity, a.tags, a.event_count, a.status,
               a.first_seen, a.last_seen, a.updated_by, a.updated_at
          FROM public.security_alerts a
         WHERE p_status IS NULL OR a.status = p_status
         ORDER BY (CASE a.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END), a.last_seen DESC
         LIMIT v_limit
    ) t;

    SELECT COALESCE(jsonb_object_agg(k, n), '{}'::jsonb) INTO v_counts FROM (
        SELECT a.severity AS k, count(*) AS n FROM public.security_alerts a
         WHERE a.status IN ('open', 'acknowledged', 'investigating') GROUP BY a.severity
    ) c;

    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_events FROM (
        SELECT e.category, e.action, e.outcome, e.path, e.status, e.reason, e.created_at
          FROM public.security_events e ORDER BY e.created_at DESC LIMIT 25
    ) t;

    RETURN jsonb_build_object('ok', true, 'alerts', v_alerts, 'open_by_severity', v_counts, 'recent_events', v_events);
END $$;
REVOKE ALL ON FUNCTION public.admin_security_alerts(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_security_alerts(TEXT, TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_security_alert_set_status(
    p_auth_id TEXT,
    p_alert_id UUID,
    p_status TEXT,
    p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_admin RECORD;
    v_actor TEXT;
    v_alert RECORD;
BEGIN
    SELECT u.email, u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_admin.is_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    IF p_status IS NULL OR p_status NOT IN ('open', 'acknowledged', 'investigating', 'resolved', 'false_positive') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'STATUS_INVALID');
    END IF;
    IF p_note IS NOT NULL AND length(p_note) > 500 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOTE_INVALID');
    END IF;
    SELECT * INTO v_alert FROM public.security_alerts WHERE id = p_alert_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ALERT_NOT_FOUND');
    END IF;
    IF v_alert.status = p_status THEN
        RETURN jsonb_build_object('ok', true, 'status', p_status, 'unchanged', true);
    END IF;
    v_actor := left(replace(coalesce(v_admin.email, p_auth_id), '#', '_'), 120);
    UPDATE public.security_alerts SET status = p_status, updated_by = v_actor, updated_at = now() WHERE id = p_alert_id;
    INSERT INTO public.security_alert_actions (alert_id, actor, from_status, to_status, note)
    VALUES (p_alert_id, v_actor, v_alert.status, p_status, NULLIF(btrim(p_note), ''));
    RETURN jsonb_build_object('ok', true, 'status', p_status, 'unchanged', false);
END $$;
REVOKE ALL ON FUNCTION public.admin_security_alert_set_status(TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_security_alert_set_status(TEXT, UUID, TEXT, TEXT) TO service_role;
