-- ADR-0318: roles apply to new admin surfaces only.
CREATE TABLE IF NOT EXISTS public.admin_roles (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE RESTRICT,
    role TEXT NOT NULL CHECK (role IN ('owner','finance','support','moderator','viewer')),
    granted_by UUID REFERENCES public.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.admin_roles_init (
    done BOOLEAN PRIMARY KEY CHECK (done),
    at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.admin_mutation_receipts (
    idem_key TEXT NOT NULL CHECK (idem_key ~ '^[A-Za-z0-9._-]{8,128}$'),
    actor_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    request JSONB NOT NULL,
    result JSONB NOT NULL,
    PRIMARY KEY (actor_user_id,idem_key),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_roles_granted_by_idx ON public.admin_roles(granted_by);
ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.admin_roles_init ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_roles_init FORCE ROW LEVEL SECURITY;
ALTER TABLE public.admin_mutation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_mutation_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_roles, public.admin_roles_init, public.admin_mutation_receipts
    FROM PUBLIC, anon, authenticated, service_role;
DO $$ BEGIN
    -- Same lock as role mutations; backfill and receipt are one atomic block.
    PERFORM pg_advisory_xact_lock(427,0);
    IF NOT EXISTS (SELECT 1 FROM public.admin_roles_init WHERE done) THEN
        INSERT INTO public.admin_roles(user_id,role) SELECT id,'owner' FROM public.users WHERE is_admin
            ON CONFLICT (user_id) DO NOTHING;
        INSERT INTO public.admin_roles_init(done) VALUES(true);
    END IF;
END $$;
DROP TRIGGER IF EXISTS admin_roles_init_immutable ON public.admin_roles_init;
CREATE TRIGGER admin_roles_init_immutable BEFORE UPDATE OR DELETE ON public.admin_roles_init
    FOR EACH ROW EXECUTE FUNCTION public.admin_change_log_append_only();
DROP TRIGGER IF EXISTS admin_roles_init_no_truncate ON public.admin_roles_init;
CREATE TRIGGER admin_roles_init_no_truncate BEFORE TRUNCATE ON public.admin_roles_init
    FOR EACH STATEMENT EXECUTE FUNCTION public.admin_change_log_append_only();
DROP TRIGGER IF EXISTS admin_mutation_receipts_immutable ON public.admin_mutation_receipts;
CREATE TRIGGER admin_mutation_receipts_immutable BEFORE UPDATE OR DELETE ON public.admin_mutation_receipts
    FOR EACH ROW EXECUTE FUNCTION public.admin_change_log_append_only();
DROP TRIGGER IF EXISTS admin_mutation_receipts_no_truncate ON public.admin_mutation_receipts;
CREATE TRIGGER admin_mutation_receipts_no_truncate BEFORE TRUNCATE ON public.admin_mutation_receipts
    FOR EACH STATEMENT EXECUTE FUNCTION public.admin_change_log_append_only();

-- One SQL matrix; the unit test compares this JSON with lib/adminPermissions.js.
CREATE OR REPLACE FUNCTION public.admin_role_permissions(p_role TEXT)
RETURNS TEXT[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT ARRAY(SELECT jsonb_array_elements_text(coalesce(
        '{"owner":["users.read","payments","changes.read","affiliates","endpoints","plans.read","plans.write","traffic","support","support.write","roles.write","switches.write","violations","appeals","reports","cinema","webhooks","security"],"finance":["payments","affiliates","plans.read"],"support":["users.read","support","support.write","changes.read"],"moderator":["violations","appeals","reports","cinema"],"viewer":["users.read","payments","changes.read","affiliates","endpoints","plans.read","traffic"]}'::jsonb -> p_role, '[]'::jsonb)));
$$;
REVOKE ALL ON FUNCTION public.admin_role_permissions(TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_role_permissions(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_has_permission(p_auth_id UUID,p_permission TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_role TEXT;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id::text AND is_admin;
    IF v_user IS NULL THEN RAISE EXCEPTION 'not_admin' USING ERRCODE='42501'; END IF;
    SELECT role INTO v_role FROM public.admin_roles WHERE user_id=v_user;
    RETURN coalesce(p_permission = ANY(public.admin_role_permissions(v_role)),false);
END $$;
REVOKE ALL ON FUNCTION public.admin_has_permission(UUID,TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_has_permission(UUID,TEXT) TO service_role;
CREATE OR REPLACE FUNCTION public.admin_require_permission(p_auth_id TEXT,p_permission TEXT)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE auth_id=p_auth_id AND is_admin) THEN
        RAISE EXCEPTION 'not_admin' USING ERRCODE='42501';
    END IF;
    IF NOT public.admin_has_permission(p_auth_id::uuid,p_permission) THEN
        RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
    END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_require_permission(TEXT,TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_require_permission(TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_permissions(p_auth_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_role TEXT;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id::text AND is_admin;
    IF v_user IS NULL THEN RAISE EXCEPTION 'not_admin' USING ERRCODE='42501'; END IF;
    SELECT role INTO v_role FROM public.admin_roles WHERE user_id=v_user;
    RETURN jsonb_build_object('ok',true,'user_id',v_user,'role',v_role,'permissions',public.admin_role_permissions(v_role));
END $$;
REVOKE ALL ON FUNCTION public.admin_permissions(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_permissions(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_roles_list(p_auth_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_rows JSONB;
BEGIN
    PERFORM public.admin_require_permission(p_auth_id::text,'roles.write');
    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.email,t.user_id),'[]'::jsonb) INTO v_rows FROM (
        SELECT u.id AS user_id,u.email,u.is_admin,r.role,r.created_at,r.granted_by
        FROM public.users u LEFT JOIN public.admin_roles r ON r.user_id=u.id
        WHERE u.is_admin OR r.user_id IS NOT NULL
    ) t;
    RETURN jsonb_build_object('ok',true,'roles',v_rows);
END $$;
REVOKE ALL ON FUNCTION public.admin_roles_list(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_roles_list(UUID) TO service_role;

-- All sensitive role/switch writes serialize here, including different keys.
-- Hold identity rows against concurrent erasure/demotion. Callers return exact
-- receipts first, then check freshness after their final target lock for new writes.
CREATE OR REPLACE FUNCTION public.admin_lock_mutation(p_auth_id UUID,p_permission TEXT,p_aal TEXT,p_mfa_at TIMESTAMPTZ)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor UUID;
BEGIN
    PERFORM public.admin_require_permission(p_auth_id::text,p_permission);
    PERFORM pg_advisory_xact_lock(427,0);
    PERFORM 1 FROM public.users WHERE auth_id=p_auth_id::text FOR SHARE;
    PERFORM 1 FROM auth.users WHERE id=p_auth_id FOR SHARE;
    PERFORM public.admin_require_permission(p_auth_id::text,p_permission);
    SELECT u.id INTO v_actor FROM public.users u JOIN auth.users a ON a.id::text=u.auth_id
        WHERE u.auth_id=p_auth_id::text AND u.is_admin AND u.deleted_at IS NULL AND u.frozen_at IS NULL;
    IF v_actor IS NULL THEN RAISE EXCEPTION 'not_admin' USING ERRCODE='42501'; END IF;
    RETURN v_actor;
END $$;
REVOKE ALL ON FUNCTION public.admin_lock_mutation(UUID,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated, service_role;
-- Internal transaction helper: entry-point RPCs below own its execution.

CREATE OR REPLACE FUNCTION public.admin_role_change(
    p_auth_id UUID,p_target_user UUID,p_role TEXT,p_reason TEXT,p_idem_key TEXT,p_aal TEXT,p_mfa_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor UUID; v_old TEXT; v_email TEXT; v_request JSONB; v_seen public.admin_mutation_receipts%ROWTYPE; v_id UUID; v_result JSONB;
BEGIN
    PERFORM public.admin_require_permission(p_auth_id::text,'roles.write');
    IF p_target_user IS NULL OR (p_role IS NOT NULL AND p_role NOT IN ('owner','finance','support','moderator','viewer'))
        OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 OR p_reason ~ '[[:cntrl:]]'
        OR p_idem_key IS NULL OR p_idem_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN
        RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023';
    END IF;
    v_actor := public.admin_lock_mutation(p_auth_id,'roles.write',p_aal,p_mfa_at);
    PERFORM 1 FROM public.users WHERE id=p_target_user FOR SHARE;
    -- A target-row lock may wait even after the global admin lock.
    v_request := jsonb_build_object('area','role','target',p_target_user,'role',p_role,'reason',btrim(p_reason));
    SELECT * INTO v_seen FROM public.admin_mutation_receipts WHERE actor_user_id=v_actor AND idem_key=p_idem_key;
    IF FOUND THEN
        IF v_seen.actor_user_id<>v_actor OR v_seen.request<>v_request THEN
            RETURN jsonb_build_object('ok',false,'code','idempotency_key_reused');
        END IF;
        RETURN v_seen.result;
    END IF;
    IF p_aal IS DISTINCT FROM 'aal2' OR p_mfa_at IS NULL OR NOT isfinite(p_mfa_at)
        OR p_mfa_at NOT BETWEEN clock_timestamp()-interval '300 seconds' AND clock_timestamp()+interval '5 seconds' THEN
        RAISE EXCEPTION 'mfa_required' USING ERRCODE='P0001';
    END IF;

    IF v_actor=p_target_user THEN RETURN jsonb_build_object('ok',false,'code','self_role_change'); END IF;
    SELECT role INTO v_old FROM public.admin_roles WHERE user_id=p_target_user;
    IF v_old='owner' AND p_role IS DISTINCT FROM 'owner' AND
        (SELECT count(*) FROM public.admin_roles r JOIN public.users u ON u.id=r.user_id
            WHERE r.role='owner' AND u.is_admin AND u.deleted_at IS NULL AND u.frozen_at IS NULL) <= 1 THEN
        RETURN jsonb_build_object('ok',false,'code','last_owner');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=p_target_user) THEN
        RETURN jsonb_build_object('ok',false,'code','user_not_found');
    END IF;
    IF p_role IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users WHERE id=p_target_user AND is_admin AND deleted_at IS NULL) THEN
        RETURN jsonb_build_object('ok',false,'code','target_not_admin');
    END IF;
    IF p_role IS NULL AND v_old IS NULL THEN RETURN jsonb_build_object('ok',false,'code','no_role'); END IF;
    SELECT email INTO v_email FROM public.users WHERE id=v_actor;
    IF p_role IS NULL THEN DELETE FROM public.admin_roles WHERE user_id=p_target_user;
    ELSE
        INSERT INTO public.admin_roles(user_id,role,granted_by) VALUES(p_target_user,p_role,v_actor)
            ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,granted_by=excluded.granted_by,created_at=now();
    END IF;
    INSERT INTO public.admin_change_log(actor_user_id,actor_email,area,action,subject,"before","after",reason)
        VALUES(v_actor,v_email,'role',CASE WHEN p_role IS NULL THEN 'revoke' ELSE 'set' END,p_target_user::text,
            jsonb_build_object('role',v_old),jsonb_build_object('role',p_role),btrim(p_reason)) RETURNING id INTO v_id;
    v_result := jsonb_build_object('ok',true,'change_id',v_id,'user_id',p_target_user,'role',p_role);
    INSERT INTO public.admin_mutation_receipts(idem_key,actor_user_id,request,result) VALUES(p_idem_key,v_actor,v_request,v_result);
    RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.admin_role_change(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_role_set(p_auth_id UUID,p_target_user UUID,p_role TEXT,p_reason TEXT,p_idem_key TEXT,p_aal TEXT,p_mfa_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM public.admin_require_permission(p_auth_id::text,'roles.write');
    IF p_role IS NULL THEN RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023'; END IF;
    RETURN public.admin_role_change(p_auth_id,p_target_user,p_role,p_reason,p_idem_key,p_aal,p_mfa_at);
END $$;
REVOKE ALL ON FUNCTION public.admin_role_set(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_role_set(UUID,UUID,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) TO service_role;
CREATE OR REPLACE FUNCTION public.admin_role_revoke(p_auth_id UUID,p_target_user UUID,p_reason TEXT,p_idem_key TEXT,p_aal TEXT,p_mfa_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM public.admin_require_permission(p_auth_id::text,'roles.write');
    RETURN public.admin_role_change(p_auth_id,p_target_user,NULL,p_reason,p_idem_key,p_aal,p_mfa_at);
END $$;
REVOKE ALL ON FUNCTION public.admin_role_revoke(UUID,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_role_revoke(UUID,UUID,TEXT,TEXT,TEXT,TIMESTAMPTZ) TO service_role;

-- Keep accepted S0 intact; place a role guard in front of its existing feed.
DO $$ BEGIN
    IF to_regprocedure('public.admin_changes_feed_base(text,text,jsonb,integer,text,timestamptz,timestamptz)') IS NULL THEN
        ALTER FUNCTION public.admin_changes_feed(TEXT,TEXT,JSONB,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) RENAME TO admin_changes_feed_base;
    END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_changes_feed_base(TEXT,TEXT,JSONB,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.admin_changes_feed(p_auth_id TEXT,p_area TEXT DEFAULT NULL,p_before JSONB DEFAULT NULL,
    p_limit INTEGER DEFAULT 50,p_actor TEXT DEFAULT NULL,p_from TIMESTAMPTZ DEFAULT NULL,p_to TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM public.admin_require_permission(p_auth_id,'changes.read');
    RETURN public.admin_changes_feed_base(p_auth_id,p_area,p_before,p_limit,p_actor,p_from,p_to);
END $$;
REVOKE ALL ON FUNCTION public.admin_changes_feed(TEXT,TEXT,JSONB,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_changes_feed(TEXT,TEXT,JSONB,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) TO service_role;
