-- Webhook delivery log and its admin read (ADR-0083).
--
-- webhook_events records the deliveries that got past the signature check
-- and were deduplicated; a delivery refused at the door (bad signature, bad
-- body, provider unreachable on the re-read, a 500 in the handler) left only
-- a console line. Stripe's own dashboard shows an operator each attempt's
-- status and response so a failure class points at a fix; this gives the
-- inbound side the same view.
--
--   webhook_deliveries         one row per inbound delivery: source, the
--                              outcome class, the HTTP status we answered,
--                              the typed error code if any. No payload, no
--                              headers, no secrets. Written by
--                              record_webhook_delivery from the Worker
--                              (lib/webhookDelivery.js), which also prunes
--                              rows older than 30 days now and then.
--   admin_webhook_deliveries   admin read: per-source counts by outcome for
--                              a window, the latest refusals and failures,
--                              and webhook_events rows accepted but never
--                              marked processed after ten minutes.
--
-- Idempotent: IF NOT EXISTS, OR REPLACE, REVOKE/GRANT re-run.

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    source      TEXT        NOT NULL CHECK (source ~ '^[a-z][a-z0-9_-]{1,40}$'),
    outcome     TEXT        NOT NULL CHECK (outcome IN ('accepted', 'duplicate', 'pending', 'ignored', 'warned',
                                                       'rejected_signature', 'rejected', 'unavailable', 'failed')),
    http_status INTEGER     NOT NULL CHECK (http_status BETWEEN 100 AND 599),
    error       TEXT        NULL CHECK (error IS NULL OR error ~ '^[a-z0-9_:. -]{1,80}$'),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_source_idx ON public.webhook_deliveries (source, created_at);
CREATE INDEX IF NOT EXISTS webhook_deliveries_bad_idx ON public.webhook_deliveries (created_at) WHERE http_status >= 400;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_deliveries FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_webhook_delivery(
    p_source TEXT,
    p_outcome TEXT,
    p_http_status INTEGER,
    p_error TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_source IS NULL OR p_source !~ '^[a-z][a-z0-9_-]{1,40}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'SOURCE_INVALID');
    END IF;
    IF p_outcome IS NULL OR p_outcome NOT IN ('accepted', 'duplicate', 'pending', 'ignored', 'warned', 'rejected_signature', 'rejected', 'unavailable', 'failed') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'OUTCOME_INVALID');
    END IF;
    IF p_http_status IS NULL OR p_http_status NOT BETWEEN 100 AND 599 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'STATUS_INVALID');
    END IF;
    INSERT INTO public.webhook_deliveries (source, outcome, http_status, error)
    VALUES (p_source, p_outcome, p_http_status, CASE WHEN p_error ~ '^[a-z0-9_:. -]{1,80}$' THEN p_error END);
    -- Thirty days is enough to see a pattern; about one call in two hundred prunes.
    IF random() < 0.005 THEN
        DELETE FROM public.webhook_deliveries WHERE created_at < now() - interval '30 days';
    END IF;
    RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.record_webhook_delivery(TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_webhook_delivery(TEXT, TEXT, INTEGER, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_webhook_deliveries(
    p_auth_id TEXT,
    p_hours INTEGER DEFAULT 24,
    p_limit INTEGER DEFAULT 50
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_admin BOOLEAN;
    v_hours INTEGER := LEAST(GREATEST(COALESCE(p_hours, 24), 1), 24 * 30);
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
    v_since TIMESTAMPTZ := now() - make_interval(hours => v_hours);
    v_by_source JSONB;
    v_failures JSONB;
    v_stuck JSONB;
BEGIN
    SELECT u.is_admin INTO v_admin FROM public.users u WHERE u.auth_id = p_auth_id;
    IF v_admin IS NOT TRUE THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.source), '[]'::jsonb) INTO v_by_source
    FROM (
        SELECT d.source,
               count(*) AS total,
               count(*) FILTER (WHERE d.outcome = 'accepted') AS accepted,
               count(*) FILTER (WHERE d.outcome = 'duplicate') AS duplicate,
               count(*) FILTER (WHERE d.outcome IN ('pending', 'ignored', 'warned')) AS other_ok,
               count(*) FILTER (WHERE d.outcome = 'rejected_signature') AS rejected_signature,
               count(*) FILTER (WHERE d.outcome = 'rejected') AS rejected,
               count(*) FILTER (WHERE d.outcome = 'unavailable') AS unavailable,
               count(*) FILTER (WHERE d.outcome = 'failed') AS failed,
               max(d.created_at) AS last_at,
               max(d.created_at) FILTER (WHERE d.http_status >= 400) AS last_bad_at
          FROM public.webhook_deliveries d
         WHERE d.created_at >= v_since
         GROUP BY d.source
    ) t;

    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_failures
    FROM (
        SELECT d.id, d.source, d.outcome, d.http_status, d.error, d.created_at
          FROM public.webhook_deliveries d
         WHERE d.created_at >= v_since AND d.http_status >= 400
         ORDER BY d.created_at DESC
         LIMIT v_limit
    ) t;

    -- Accepted into webhook_events but never marked processed: the handler
    -- died after the dedupe insert, or the provider must redeliver.
    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.created_at), '[]'::jsonb) INTO v_stuck
    FROM (
        SELECT e.source, e.external_id, e.created_at
          FROM public.webhook_events e
         WHERE e.processed_at IS NULL AND e.created_at < now() - interval '10 minutes' AND e.created_at >= v_since
         ORDER BY e.created_at
         LIMIT v_limit
    ) t;

    RETURN jsonb_build_object('ok', true, 'since', v_since, 'hours', v_hours,
                               'by_source', v_by_source, 'failures', v_failures, 'stuck_events', v_stuck);
END $$;
REVOKE ALL ON FUNCTION public.admin_webhook_deliveries(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_webhook_deliveries(TEXT, INTEGER, INTEGER) TO service_role;
