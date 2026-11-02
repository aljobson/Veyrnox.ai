-- ADR-0083: S0 of the admin expansion. No money writers or browser grants.
CREATE TABLE IF NOT EXISTS public.admin_change_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    actor_email TEXT NOT NULL,
    area TEXT NOT NULL CHECK (area IN ('role', 'switch', 'plan', 'support', 'other')),
    action TEXT NOT NULL CHECK (length(btrim(action)) BETWEEN 1 AND 100),
    subject TEXT NOT NULL CHECK (length(btrim(subject)) BETWEEN 1 AND 200),
    "before" JSONB,
    "after" JSONB,
    reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_change_log_feed_idx
    ON public.admin_change_log (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS account_actions_feed_idx
    ON public.account_actions (created_at DESC, id DESC);
ALTER TABLE public.admin_change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_change_log FORCE ROW LEVEL SECURITY;
-- Even service_role has no direct access. Later definer mutation RPCs append
-- in their own transaction; this slice exposes only the read RPC below.
REVOKE ALL ON TABLE public.admin_change_log FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_change_log_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'admin_change_log is append-only' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public.admin_change_log_append_only() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_change_log_append_only() TO service_role;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'public.admin_change_log'::regclass AND tgname = 'admin_change_log_no_update') THEN
        CREATE TRIGGER admin_change_log_no_update BEFORE UPDATE OR DELETE
            ON public.admin_change_log FOR EACH ROW EXECUTE FUNCTION public.admin_change_log_append_only();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'public.admin_change_log'::regclass AND tgname = 'admin_change_log_no_truncate') THEN
        CREATE TRIGGER admin_change_log_no_truncate BEFORE TRUNCATE
            ON public.admin_change_log FOR EACH STATEMENT EXECUTE FUNCTION public.admin_change_log_append_only();
    END IF;
END $$;

-- Optional filters extend the frozen four-argument contract: they must run
-- BEFORE LIMIT, otherwise an actor/date search silently misses matches.
CREATE OR REPLACE FUNCTION public.admin_changes_feed_base(
    p_auth_id TEXT, p_area TEXT DEFAULT NULL, p_before JSONB DEFAULT NULL,
    p_limit INTEGER DEFAULT 50, p_actor TEXT DEFAULT NULL,
    p_from TIMESTAMPTZ DEFAULT NULL, p_to TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_before_at TIMESTAMPTZ;
    v_before_id UUID;
    v_rows JSONB;
    v_page JSONB;
    v_last JSONB;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.auth_id = p_auth_id AND u.is_admin) THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
    END IF;
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
        OR (p_area IS NOT NULL AND p_area NOT IN ('account','role','switch','plan','support','other'))
        OR (p_actor IS NOT NULL AND (length(btrim(p_actor)) NOT BETWEEN 1 AND 320 OR p_actor ~ '[[:cntrl:]]'))
        OR (p_from IS NOT NULL AND NOT isfinite(p_from)) OR (p_to IS NOT NULL AND NOT isfinite(p_to))
        OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from >= p_to) THEN
        RAISE EXCEPTION 'filters_invalid' USING ERRCODE = '22023';
    END IF;
    IF p_before IS NOT NULL THEN
        IF jsonb_typeof(p_before) <> 'object'
            OR NOT (p_before ?& ARRAY['created_at','id'])
            OR (p_before - 'created_at' - 'id') <> '{}'::jsonb
            OR jsonb_typeof(p_before->'created_at') <> 'string'
            OR jsonb_typeof(p_before->'id') <> 'string' THEN
            RAISE EXCEPTION 'cursor_invalid' USING ERRCODE = '22023';
        END IF;
        BEGIN
            v_before_at := (p_before->>'created_at')::timestamptz;
            v_before_id := (p_before->>'id')::uuid;
        EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
            RAISE EXCEPTION 'cursor_invalid' USING ERRCODE = '22023';
        END;
        IF NOT isfinite(v_before_at) THEN
            RAISE EXCEPTION 'cursor_invalid' USING ERRCODE = '22023';
        END IF;
    END IF;
    WITH feed AS (
        SELECT c.id, c.created_at, c.area, c.actor_email AS actor, c.action,
            c.subject, NULL::text AS subject_email, c."before", c."after", c.reason
        FROM public.admin_change_log c
        UNION ALL
        SELECT a.id, a.created_at, 'account', a.actor, a.action,
            a.user_id::text, u.email, NULL::jsonb, NULL::jsonb, a.reason
        FROM public.account_actions a JOIN public.users u ON u.id = a.user_id
    ), page AS (
        SELECT * FROM feed f
        WHERE (p_area IS NULL OR f.area = p_area)
          AND (p_actor IS NULL OR lower(f.actor) = lower(btrim(p_actor)))
          AND (p_from IS NULL OR f.created_at >= p_from)
          AND (p_to IS NULL OR f.created_at < p_to)
          AND (p_before IS NULL OR (f.created_at, f.id) < (v_before_at, v_before_id))
        ORDER BY f.created_at DESC, f.id DESC LIMIT p_limit + 1
    ) SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC, p.id DESC), '[]'::jsonb)
        INTO v_rows FROM page p;
    SELECT coalesce(jsonb_agg(e.value ORDER BY e.ordinality), '[]'::jsonb) INTO v_page
        FROM jsonb_array_elements(v_rows) WITH ORDINALITY e(value, ordinality) WHERE e.ordinality <= p_limit;
    v_last := v_page->(jsonb_array_length(v_page) - 1);
    RETURN jsonb_build_object('ok', true, 'entries', v_page,
        'next_cursor', CASE WHEN jsonb_array_length(v_rows) > p_limit
            THEN jsonb_build_object('created_at', v_last->'created_at', 'id', v_last->'id') ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.admin_changes_feed_base(TEXT,TEXT,JSONB,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated, service_role;
DO $install$ BEGIN
 IF to_regprocedure('public.admin_changes_feed(text,text,jsonb,integer,text,timestamptz,timestamptz)') IS NULL THEN
  EXECUTE $wrapper$
   CREATE FUNCTION public.admin_changes_feed(p_auth_id TEXT,p_area TEXT DEFAULT NULL,p_before JSONB DEFAULT NULL,
      p_limit INTEGER DEFAULT 50,p_actor TEXT DEFAULT NULL,p_from TIMESTAMPTZ DEFAULT NULL,p_to TIMESTAMPTZ DEFAULT NULL)
   RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $body$
   BEGIN RETURN public.admin_changes_feed_base(p_auth_id,p_area,p_before,p_limit,p_actor,p_from,p_to); END $body$
  $wrapper$;
 END IF;
END $install$;
REVOKE ALL ON FUNCTION public.admin_changes_feed(TEXT,TEXT,JSONB,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_changes_feed(TEXT,TEXT,JSONB,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ)
    TO service_role;
