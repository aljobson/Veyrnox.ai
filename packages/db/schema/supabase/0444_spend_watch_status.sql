-- ADR-0328: a verdict-only read of supplier spend for the spend-watch workflow.
-- provider_spend_utilization() (0434) stays service-role only. This wrapper
-- returns one word and where it came from, never a percentage or a user, so it
-- can be called with the public key like reconcile_status() (PR #61: no
-- service-role key in Actions). Thresholds are fixed here, not caller-supplied,
-- so the answer cannot be probed into a number.
CREATE OR REPLACE FUNCTION public.spend_watch_status()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    u JSONB := public.provider_spend_utilization();
    v_worst NUMERIC; v_scope TEXT; v_level TEXT; v_open BOOLEAN;
BEGIN
    IF u IS NULL OR (u->>'ok')::boolean IS DISTINCT FROM true THEN
        RETURN jsonb_build_object('ok', false, 'code', 'POLICY_MISSING');
    END IF;
    v_open := (u->>'admission_open')::boolean;
    SELECT x.pct, x.scope INTO v_worst, v_scope FROM (
        SELECT (u->>'global_hour_pct')::numeric AS pct, 'global' AS scope
        UNION ALL SELECT (u->>'global_day_pct')::numeric, 'global'
        UNION ALL SELECT (u->>'busiest_user_hour_pct')::numeric, 'user'
        UNION ALL SELECT (u->>'busiest_user_day_pct')::numeric, 'user'
        UNION ALL SELECT (p->>'hour_pct')::numeric, 'provider'
            FROM jsonb_array_elements(coalesce(u->'providers', '[]'::jsonb)) p
        UNION ALL SELECT (p->>'day_pct')::numeric, 'provider'
            FROM jsonb_array_elements(coalesce(u->'providers', '[]'::jsonb)) p
    ) x ORDER BY x.pct DESC NULLS LAST LIMIT 1;
    v_worst := coalesce(v_worst, 0);
    v_level := CASE
        WHEN v_open IS DISTINCT FROM true OR v_worst >= 100 THEN 'critical'
        WHEN v_worst >= 80 THEN 'warn'
        ELSE 'ok' END;
    RETURN jsonb_build_object('ok', true, 'level', v_level,
        'scope', CASE WHEN v_level = 'ok' THEN 'none' ELSE coalesce(v_scope, 'none') END,
        'admission_open', v_open);
END $$;
REVOKE ALL ON FUNCTION public.spend_watch_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spend_watch_status() TO anon, service_role;
