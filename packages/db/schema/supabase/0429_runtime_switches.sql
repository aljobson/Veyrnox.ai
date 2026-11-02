-- ADR-0319: absent kill rows preserve deploy gates; enable rows default off.
CREATE TABLE IF NOT EXISTS public.runtime_switches (
    key TEXT PRIMARY KEY CHECK (key IN ('generation','chat','publish','cinema','telemetry','support_intake')),
    state TEXT NOT NULL CHECK (state IN ('on','off')),
    reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500 AND reason !~ '[[:cntrl:]]'),
    updated_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runtime_switches_updated_by_idx ON public.runtime_switches(updated_by);
ALTER TABLE public.runtime_switches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.runtime_switches FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.runtime_switches FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.runtime_switches TO service_role;

CREATE OR REPLACE FUNCTION public.admin_switch_list(p_auth_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_rows JSONB;
BEGIN
    PERFORM public.admin_require_permission(p_auth_id::text,'switches.write');
    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.key),'[]'::jsonb) INTO v_rows FROM (
        SELECT k.key,k.kind,s.state,s.reason,s.updated_at,u.email AS updated_by
        FROM (VALUES ('generation','kill'),('chat','kill'),('publish','kill'),('cinema','kill'),
            ('telemetry','enable'),('support_intake','enable')) AS k(key,kind)
        LEFT JOIN public.runtime_switches s ON s.key=k.key LEFT JOIN public.users u ON u.id=s.updated_by
    ) t;
    RETURN jsonb_build_object('ok',true,'switches',v_rows);
END $$;
REVOKE ALL ON FUNCTION public.admin_switch_list(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_switch_list(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_switch_set(
    p_auth_id UUID,p_key TEXT,p_state TEXT,p_reason TEXT,p_idem_key TEXT,p_aal TEXT,p_mfa_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor UUID; v_email TEXT; v_old public.runtime_switches%ROWTYPE; v_seen public.admin_mutation_receipts%ROWTYPE;
    v_request JSONB; v_result JSONB; v_id UUID;
BEGIN
    PERFORM public.admin_require_permission(p_auth_id::text,'switches.write');
    IF p_key IS NULL OR p_key NOT IN ('generation','chat','publish','cinema','telemetry','support_intake')
        OR p_state IS NULL OR p_state NOT IN ('on','off')
        OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 OR p_reason ~ '[[:cntrl:]]'
        OR p_idem_key IS NULL OR p_idem_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN
        RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023';
    END IF;
    v_actor := public.admin_lock_mutation(p_auth_id,'switches.write',p_aal,p_mfa_at);
    SELECT * INTO v_old FROM public.runtime_switches WHERE key=p_key FOR UPDATE;
    -- SQL, not the service-role JWT, enforces freshness after every possible wait.
    v_request := jsonb_build_object('area','switch','key',p_key,'state',p_state,'reason',btrim(p_reason));
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

    SELECT email INTO v_email FROM public.users WHERE id=v_actor;
    INSERT INTO public.runtime_switches(key,state,reason,updated_by) VALUES(p_key,p_state,btrim(p_reason),v_actor)
        ON CONFLICT(key) DO UPDATE SET state=excluded.state,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now();
    INSERT INTO public.admin_change_log(actor_user_id,actor_email,area,action,subject,"before","after",reason)
        VALUES(v_actor,v_email,'switch','set',p_key,jsonb_build_object('state',v_old.state),jsonb_build_object('state',p_state),btrim(p_reason)) RETURNING id INTO v_id;
    v_result := jsonb_build_object('ok',true,'change_id',v_id,'key',p_key,'state',p_state);
    INSERT INTO public.admin_mutation_receipts(idem_key,actor_user_id,request,result) VALUES(p_idem_key,v_actor,v_request,v_result);
    RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.admin_switch_set(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_switch_set(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) TO service_role;

-- Machine operation, not an admin RPC. Mirrors the claim restoration in 0350.
-- It cannot dispatch, change content or settle anything; it only gives back a
-- matching, not-yet-started claim for a cached pause verdict.
CREATE OR REPLACE FUNCTION public.runtime_defer_publish(p_target_id UUID,p_claim_key UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.social_post_targets%ROWTYPE;
BEGIN
    IF p_claim_key IS NULL THEN RETURN jsonb_build_object('ok',false,'code','claim_lost'); END IF;
    SELECT * INTO v FROM public.social_post_targets WHERE id=p_target_id FOR UPDATE;
    IF v.id IS NULL OR v.publish_status<>'publishing' OR v.claim_key IS DISTINCT FROM p_claim_key
        OR coalesce(v.provider_state,'{}'::jsonb)<>'{}'::jsonb THEN
        RETURN jsonb_build_object('ok',false,'code','claim_lost');
    END IF;
    -- A cached pause may outlive a resume by up to 15 s. Restoring that claim
    -- remains safe and avoids an unnecessary publish retry or failure.
    UPDATE public.social_post_targets SET
        publish_status=CASE WHEN claimed_from_status='publishing' THEN 'pending' ELSE coalesce(claimed_from_status,'pending') END,
        attempts=coalesce(claimed_attempts,greatest(attempts-1,0)),
        provider_state=coalesce(claimed_provider_state,provider_state),next_attempt_at=now()+interval '15 seconds',
        claim_key=NULL,claimed_from_status=NULL,claimed_attempts=NULL,claimed_provider_state=NULL
        WHERE id=p_target_id;
    RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.runtime_defer_publish(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.runtime_defer_publish(UUID,UUID) TO service_role;

-- Preserve 0395's claim semantics; only exclude fresh work while paused.
CREATE OR REPLACE FUNCTION public.claim_due_social_post_targets_v2(p_limit INTEGER)
RETURNS TABLE (
    target_id UUID, post_id UUID, account_id UUID, network TEXT,
    text_override TEXT, global_text TEXT, brand_id UUID, attempts INTEGER,
    access_token_enc BYTEA, refresh_token_enc BYTEA, token_expires_at TIMESTAMPTZ,
    external_account_id TEXT, media_type TEXT, r2_key TEXT,
    mime_type TEXT, size_bytes BIGINT, provider_state JSONB, claim_key UUID, media JSONB
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
BEGIN
    PERFORM public.social_fail_inactive_targets(NULL);
    RETURN QUERY
    WITH due AS (
        SELECT t.id, t.publish_status AS prior_status FROM public.social_post_targets t JOIN public.social_posts p ON p.id = t.post_id JOIN public.social_accounts a ON a.id = t.account_id WHERE p.status = 'scheduled'
          AND p.scheduled_at <= now()
          AND a.status = 'active'
          -- Paused fresh work must not occupy slots needed by continuations.
          AND (NOT EXISTS (SELECT 1 FROM public.runtime_switches s WHERE s.key='publish' AND s.state='off')
               OR coalesce(t.provider_state,'{}'::jsonb)<>'{}'::jsonb)
          AND (
              ((t.publish_status = 'pending' AND (t.next_attempt_at IS NULL OR t.next_attempt_at <= now()))
              OR (t.publish_status = 'publishing' AND t.claimed_at <= now() - interval '15 minutes'))
               AND NOT EXISTS (SELECT 1 FROM public.social_post_media m JOIN public.assets ast ON ast.job_id=m.source_job_id WHERE m.post_id=t.post_id AND ast.held_at IS NOT NULL)
               AND NOT public.social_post_media_unscanned(t.post_id)
              OR (t.publish_status = 'submitted' AND t.next_attempt_at IS NOT NULL AND t.next_attempt_at <= now())
          ) ORDER BY p.scheduled_at LIMIT least(greatest(COALESCE(p_limit, 1), 1), 50)
        FOR UPDATE OF t SKIP LOCKED
    ),
    claimed AS (
        UPDATE public.social_post_targets t
        SET publish_status = 'publishing',
            claimed_from_status = due.prior_status, claimed_attempts = t.attempts, claimed_provider_state = t.provider_state,
            claimed_at = now(),
            claim_key = gen_random_uuid(),
            attempts = CASE WHEN due.prior_status = 'submitted' THEN t.attempts ELSE t.attempts + 1 END FROM due WHERE t.id = due.id
        RETURNING t.id, t.post_id, t.account_id, t.network, t.text_override, t.attempts, t.provider_state, t.claim_key
    )
    SELECT c.id, c.post_id, c.account_id, c.network, c.text_override, p.global_text, p.brand_id, c.attempts,
        a.access_token_enc, a.refresh_token_enc, a.token_expires_at, a.external_account_id,
        ordered.media->0->>'media_type', ordered.media->0->>'r2_key',
        ordered.media->0->>'mime_type', (ordered.media->0->>'size_bytes')::BIGINT,
        c.provider_state, c.claim_key, ordered.media
    FROM claimed c JOIN public.social_posts p ON p.id = c.post_id
    JOIN public.social_accounts a ON a.id = c.account_id
    CROSS JOIN LATERAL (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
            'position', pm.position, 'media_type', pm.media_type,
            'r2_key', coalesce(src.r2_key, upload.r2_key),
            'mime_type', coalesce(src.mime_type, upload.mime_type),
            'size_bytes', coalesce(src.size_bytes, upload.size_bytes)
        ) ORDER BY pm.position), '[]'::jsonb) AS media
        FROM public.social_post_media pm
        LEFT JOIN LATERAL (
            SELECT x.r2_key, x.mime_type, x.size_bytes FROM public.assets x
            JOIN public.jobs j ON j.id=x.job_id AND j.user_id=p.created_by_user_id
            WHERE x.job_id=pm.source_job_id AND j.deleted_at IS NULL ORDER BY x.created_at LIMIT 1
        ) src ON true
        LEFT JOIN public.social_uploads upload ON upload.id=pm.source_upload_id
            AND upload.user_id=p.created_by_user_id AND upload.status='ready'
        WHERE pm.post_id=c.post_id
    ) ordered;
END $$;
REVOKE ALL ON FUNCTION public.claim_due_social_post_targets_v2(INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_social_post_targets_v2(INTEGER) TO service_role;
