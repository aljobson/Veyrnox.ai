-- ADR-0327: per-user AI kill switch and DB-tunable per-user generation limit.
-- Overrides can only LOWER the code's limit (LEAST), never raise it: the
-- authoritative limit inside ledger_debit still uses the Worker's constant.
-- No row = no change in behaviour.
CREATE TABLE IF NOT EXISTS public.ai_limit_policy (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
    gen_limit_per_window INTEGER CHECK (gen_limit_per_window BETWEEN 1 AND 10),
    reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500 AND reason !~ '[[:cntrl:]]'),
    updated_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_limit_policy_updated_by_idx ON public.ai_limit_policy(updated_by);

CREATE TABLE IF NOT EXISTS public.user_ai_controls (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    ai_disabled BOOLEAN NOT NULL DEFAULT false,
    gen_limit_per_window INTEGER CHECK (gen_limit_per_window BETWEEN 1 AND 10),
    reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500 AND reason !~ '[[:cntrl:]]'),
    updated_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_ai_controls_updated_by_idx ON public.user_ai_controls(updated_by);
ALTER TABLE public.ai_limit_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_limit_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_ai_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_ai_controls FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_limit_policy FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.user_ai_controls FROM PUBLIC, anon, authenticated, service_role;

-- Same body as 0113 plus the two lookups before the attempt counter, so a
-- disabled account is refused before it consumes quota or touches any media.
CREATE OR REPLACE FUNCTION public.check_generation_rate_limit(
    p_auth_id TEXT,
    p_limit_per_window INTEGER,
    p_window_seconds INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_count INTEGER;
    v_reset_seconds INTEGER;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_attempt_count INTEGER;
    v_start TIMESTAMPTZ;
    v_disabled BOOLEAN;
    v_user_limit INTEGER;
    v_global_limit INTEGER;
BEGIN
    IF p_limit_per_window IS NULL OR p_limit_per_window <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_LIMIT');
    END IF;
    IF p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BAD_WINDOW');
    END IF;
    SELECT id INTO v_user_id FROM public.users WHERE auth_id = p_auth_id;
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    SELECT c.ai_disabled, c.gen_limit_per_window INTO v_disabled, v_user_limit
    FROM public.user_ai_controls c WHERE c.user_id = v_user_id;
    IF coalesce(v_disabled, false) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'AI_DISABLED');
    END IF;
    SELECT gen_limit_per_window INTO v_global_limit FROM public.ai_limit_policy;
    p_limit_per_window := LEAST(p_limit_per_window,
        coalesce(v_user_limit, p_limit_per_window), coalesce(v_global_limit, p_limit_per_window));

    INSERT INTO public.generation_attempt_rate_limits AS r (user_id, window_started_at, request_count)
    VALUES (v_user_id, v_now, 1)
    ON CONFLICT (user_id) DO UPDATE SET
        window_started_at = CASE WHEN r.window_started_at <= v_now - interval '60 seconds'
            THEN v_now ELSE r.window_started_at END,
        request_count = CASE WHEN r.window_started_at <= v_now - interval '60 seconds'
            THEN 1 ELSE LEAST(r.request_count + 1, 21) END
    RETURNING window_started_at, request_count INTO v_start, v_attempt_count;
    IF v_attempt_count > 20 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED',
            'count', v_attempt_count, 'limit', 20,
            'retry_after_seconds', LEAST(60, GREATEST(1,
                ceil(extract(epoch FROM (v_start + interval '60 seconds' - v_now)))::INTEGER)));
    END IF;

    SELECT count(*) INTO v_count FROM public.jobs
    WHERE user_id = v_user_id
      AND created_at > now() - make_interval(secs => p_window_seconds);
    IF v_count >= p_limit_per_window THEN
        SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
            MIN(created_at) + make_interval(secs => p_window_seconds) - now()
        ))))::int INTO v_reset_seconds
        FROM public.jobs
        WHERE user_id = v_user_id
          AND created_at > now() - make_interval(secs => p_window_seconds);
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED',
                                   'count', v_count, 'limit', p_limit_per_window,
                                   'retry_after_seconds', COALESCE(v_reset_seconds, p_window_seconds));
    END IF;
    RETURN jsonb_build_object('ok', true, 'count', v_count, 'limit', p_limit_per_window);
END $$;
REVOKE ALL ON FUNCTION public.check_generation_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_generation_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

-- Read: global policy plus the controls of one account (by email), or none.
CREATE OR REPLACE FUNCTION public.admin_ai_control_get(p_auth_id UUID, p_email TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_global JSONB; v_user JSONB;
BEGIN
    PERFORM public.admin_require_permission(p_auth_id::text,'switches.write');
    SELECT to_jsonb(g) - 'updated_by' INTO v_global FROM public.ai_limit_policy g;
    IF p_email IS NOT NULL THEN
        IF length(p_email) > 320 OR p_email ~ '[[:cntrl:]]' THEN
            RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023';
        END IF;
        SELECT jsonb_build_object('user_id',u.id,'email',u.email,'ai_disabled',coalesce(c.ai_disabled,false),
            'gen_limit_per_window',c.gen_limit_per_window,'reason',c.reason,'updated_at',c.updated_at)
        INTO v_user FROM public.users u LEFT JOIN public.user_ai_controls c ON c.user_id=u.id
        WHERE lower(u.email)=lower(btrim(p_email));
    END IF;
    RETURN jsonb_build_object('ok',true,'global',v_global,'user',v_user);
END $$;
REVOKE ALL ON FUNCTION public.admin_ai_control_get(UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_ai_control_get(UUID,TEXT) TO service_role;

-- Write: p_user_id NULL sets the global limit; otherwise that account's switch
-- and limit. Limit NULL clears the override. Needs a fresh second factor.
CREATE OR REPLACE FUNCTION public.admin_ai_control_set(
    p_auth_id UUID,p_user_id UUID,p_ai_disabled BOOLEAN,p_limit INTEGER,p_reason TEXT,
    p_idem_key TEXT,p_aal TEXT,p_mfa_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor UUID; v_email TEXT; v_seen public.admin_mutation_receipts%ROWTYPE;
    v_request JSONB; v_result JSONB; v_id UUID; v_before JSONB; v_subject TEXT;
BEGIN
    PERFORM public.admin_require_permission(p_auth_id::text,'switches.write');
    IF p_ai_disabled IS NULL OR (p_limit IS NOT NULL AND p_limit NOT BETWEEN 1 AND 10)
        OR (p_user_id IS NULL AND p_ai_disabled)
        OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 OR p_reason ~ '[[:cntrl:]]'
        OR p_idem_key IS NULL OR p_idem_key !~ '^[A-Za-z0-9._-]{8,128}$' THEN
        RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023';
    END IF;
    IF p_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users WHERE id=p_user_id) THEN
        RAISE EXCEPTION 'input_invalid' USING ERRCODE='22023';
    END IF;
    v_actor := public.admin_lock_mutation(p_auth_id,'switches.write',p_aal,p_mfa_at);
    v_request := jsonb_build_object('area','ai_control','user',p_user_id,'disabled',p_ai_disabled,
        'limit',p_limit,'reason',btrim(p_reason));
    SELECT * INTO v_seen FROM public.admin_mutation_receipts WHERE actor_user_id=v_actor AND idem_key=p_idem_key;
    IF FOUND THEN
        IF v_seen.request<>v_request THEN
            RETURN jsonb_build_object('ok',false,'code','idempotency_key_reused');
        END IF;
        RETURN v_seen.result;
    END IF;
    IF p_aal IS DISTINCT FROM 'aal2' OR p_mfa_at IS NULL OR NOT isfinite(p_mfa_at)
        OR p_mfa_at NOT BETWEEN clock_timestamp()-interval '300 seconds' AND clock_timestamp()+interval '5 seconds' THEN
        RAISE EXCEPTION 'mfa_required' USING ERRCODE='P0001';
    END IF;

    SELECT email INTO v_email FROM public.users WHERE id=v_actor;
    IF p_user_id IS NULL THEN
        v_subject := 'global';
        SELECT jsonb_build_object('limit',gen_limit_per_window) INTO v_before FROM public.ai_limit_policy;
        INSERT INTO public.ai_limit_policy(singleton,gen_limit_per_window,reason,updated_by)
            VALUES(true,p_limit,btrim(p_reason),v_actor)
            ON CONFLICT(singleton) DO UPDATE SET gen_limit_per_window=excluded.gen_limit_per_window,
                reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now();
    ELSE
        v_subject := p_user_id::text;
        SELECT jsonb_build_object('disabled',ai_disabled,'limit',gen_limit_per_window)
            INTO v_before FROM public.user_ai_controls WHERE user_id=p_user_id;
        INSERT INTO public.user_ai_controls(user_id,ai_disabled,gen_limit_per_window,reason,updated_by)
            VALUES(p_user_id,p_ai_disabled,p_limit,btrim(p_reason),v_actor)
            ON CONFLICT(user_id) DO UPDATE SET ai_disabled=excluded.ai_disabled,
                gen_limit_per_window=excluded.gen_limit_per_window,reason=excluded.reason,
                updated_by=excluded.updated_by,updated_at=now();
    END IF;
    INSERT INTO public.admin_change_log(actor_user_id,actor_email,area,action,subject,"before","after",reason)
        VALUES(v_actor,v_email,'other','ai_control_set',v_subject,coalesce(v_before,'{}'::jsonb),
            jsonb_build_object('disabled',p_ai_disabled,'limit',p_limit),btrim(p_reason)) RETURNING id INTO v_id;
    v_result := jsonb_build_object('ok',true,'change_id',v_id,'subject',v_subject,
        'ai_disabled',p_ai_disabled,'gen_limit_per_window',p_limit);
    INSERT INTO public.admin_mutation_receipts(idem_key,actor_user_id,request,result) VALUES(p_idem_key,v_actor,v_request,v_result);
    RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.admin_ai_control_set(UUID,UUID,BOOLEAN,INTEGER,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_ai_control_set(UUID,UUID,BOOLEAN,INTEGER,TEXT,TEXT,TEXT,TIMESTAMPTZ) TO service_role;

-- Keep telemetry normalization aligned with the new admin AI-control route (ADR-0327).
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_path = ANY (ARRAY['/','/.well-known/apple-app-site-association','/.well-known/assetlinks.json','/.well-known/oauth-protected-resource/api/v1/developer','/.well-known/oauth-protected-resource/api/v1/mcp','/about','/api/admin/reap-assets','/api/admin/top-up-backfill','/api/auth/session','/api/catalog','/api/cinema-pass-plans','/api/cinema/comments','/api/cinema/discovery','/api/cinema/posters/:id','/api/cinema/story-polls','/api/cinema/titles','/api/cinema/titles/:id','/api/cinema/voting','/api/cinema/winners','/api/credit-packs','/api/credit-subscription-plans','/api/developer/openapi','/api/popular-templates','/api/presets','/api/publish/v1/accounts','/api/publish/v1/posts','/api/social/approvals/:id','/api/social/team/:id','/api/status','/api/templates','/api/templates/:id','/api/turnstile-failure','/api/v1/account','/api/v1/account/age-confirmation','/api/v1/account/deletion','/api/v1/account/export','/api/v1/account/export/:id','/api/v1/account/language','/api/v1/admin/affiliates','/api/v1/admin/appeals','/api/v1/admin/changes','/api/v1/admin/cinema/comments','/api/v1/admin/cinema/creators','/api/v1/admin/cinema/earnings','/api/v1/admin/cinema/pass/refund','/api/v1/admin/cinema/rankings','/api/v1/admin/cinema/story-polls','/api/v1/admin/cinema/submissions','/api/v1/admin/cinema/suspend','/api/v1/admin/cinema/unlocks/reverse','/api/v1/admin/cinema/voting','/api/v1/admin/endpoints','/api/v1/admin/metrics','/api/v1/admin/permissions','/api/v1/admin/plans','/api/v1/admin/reports','/api/v1/admin/reports/asset','/api/v1/admin/revenue','/api/v1/admin/roles','/api/v1/admin/security','/api/v1/admin/support','/api/v1/admin/switches','/api/v1/admin/traffic','/api/v1/admin/users/ai-control','/api/v1/admin/users/ledger','/api/v1/admin/users/lookup','/api/v1/admin/violations','/api/v1/admin/webhooks','/api/v1/appeals','/api/v1/balance','/api/v1/chat/folders','/api/v1/chat/folders/:id','/api/v1/chat/models','/api/v1/chat/personas','/api/v1/chat/personas/:id','/api/v1/chat/sends/close','/api/v1/chat/threads','/api/v1/chat/threads/:id','/api/v1/chat/threads/:id/messages','/api/v1/checkin','/api/v1/cinema/audience','/api/v1/cinema/blocks','/api/v1/cinema/blocks/:id','/api/v1/cinema/comments','/api/v1/cinema/content','/api/v1/cinema/content/submit','/api/v1/cinema/content/withdraw','/api/v1/cinema/creator-analytics','/api/v1/cinema/entitlement','/api/v1/cinema/pass','/api/v1/cinema/pass/cancel','/api/v1/cinema/pass/plans','/api/v1/cinema/pass/portal','/api/v1/cinema/pass/return','/api/v1/cinema/play','/api/v1/cinema/play/heartbeat','/api/v1/cinema/posters/:id','/api/v1/cinema/progress','/api/v1/cinema/retention','/api/v1/cinema/story-choices','/api/v1/cinema/story-polls','/api/v1/cinema/titles/:id','/api/v1/cinema/unlocks','/api/v1/cinema/uploads','/api/v1/cinema/uploads/:id/transfer','/api/v1/cinema/uploads/from-library','/api/v1/cinema/uploads/refresh','/api/v1/cinema/uploads/remove','/api/v1/cinema/votes','/api/v1/cinema/voting','/api/v1/creator-profile','/api/v1/creator-profile/skip','/api/v1/creators/apply','/api/v1/credit-packs','/api/v1/developer/:id*','/api/v1/devices','/api/v1/editor/server-render','/api/v1/editor/server-render/quote','/api/v1/film-studio','/api/v1/film-studio/:id','/api/v1/free-allowance','/api/v1/generations','/api/v1/health','/api/v1/help','/api/v1/jobs','/api/v1/jobs/:id','/api/v1/jobs/:id/asset','/api/v1/jobs/:id/cancel','/api/v1/jobs/:id/media-info','/api/v1/jobs/:id/provenance','/api/v1/ledger','/api/v1/ledger/usage','/api/v1/library/editor-renders','/api/v1/library/editor-renders/:id/asset','/api/v1/library/editor-renders/:id/inspect','/api/v1/library/masters','/api/v1/library/masters/:id/asset','/api/v1/library/masters/upload','/api/v1/mcp','/api/v1/mfa/recovery','/api/v1/mfa/recovery/codes','/api/v1/montage/plan','/api/v1/projects','/api/v1/projects/:id','/api/v1/projects/:id/assets','/api/v1/projects/:id/assets/:id/download','/api/v1/projects/:id/assets/:id/inspect','/api/v1/projects/:id/document','/api/v1/projects/:id/history','/api/v1/projects/:id/review','/api/v1/referrals','/api/v1/referrals/attach','/api/v1/reports','/api/v1/session/me','/api/v1/social-cinema/profile','/api/v1/social/access','/api/v1/social/accounts','/api/v1/social/accounts/:id','/api/v1/social/accounts/bluesky/connect','/api/v1/social/accounts/facebook/callback','/api/v1/social/accounts/facebook/connect','/api/v1/social/accounts/gmb/callback','/api/v1/social/accounts/gmb/connect','/api/v1/social/accounts/instagram/callback','/api/v1/social/accounts/instagram/connect','/api/v1/social/accounts/linkedin/callback','/api/v1/social/accounts/linkedin/connect','/api/v1/social/accounts/pinterest/callback','/api/v1/social/accounts/pinterest/connect','/api/v1/social/accounts/threads/callback','/api/v1/social/accounts/threads/connect','/api/v1/social/accounts/tiktok/callback','/api/v1/social/accounts/tiktok/connect','/api/v1/social/accounts/twitch/callback','/api/v1/social/accounts/twitch/connect','/api/v1/social/accounts/twitter/callback','/api/v1/social/accounts/twitter/connect','/api/v1/social/accounts/youtube/callback','/api/v1/social/accounts/youtube/connect','/api/v1/social/activity','/api/v1/social/ads','/api/v1/social/analytics','/api/v1/social/approvals','/api/v1/social/autolists','/api/v1/social/best-time','/api/v1/social/brand-kit','/api/v1/social/brands','/api/v1/social/calendar','/api/v1/social/commerce/products','/api/v1/social/contacts','/api/v1/social/developer/keys','/api/v1/social/developer/logs','/api/v1/social/developer/webhooks','/api/v1/social/drafts','/api/v1/social/inbox','/api/v1/social/inbox/:id','/api/v1/social/inbox/:id/reply','/api/v1/social/inbox/:id/suggestions','/api/v1/social/inbox/analytics','/api/v1/social/plan','/api/v1/social/plan/cancel','/api/v1/social/plan/portal','/api/v1/social/plan/return','/api/v1/social/posts','/api/v1/social/posts/:id','/api/v1/social/posts/:id/schedule','/api/v1/social/presets','/api/v1/social/queues','/api/v1/social/queues/reserve','/api/v1/social/reports','/api/v1/social/reports/:id/export','/api/v1/social/smartlink','/api/v1/social/team','/api/v1/social/team/accept','/api/v1/social/uploads','/api/v1/social/workflows','/api/v1/store-purchases/customer','/api/v1/subscriptions','/api/v1/subscriptions/cancel','/api/v1/subscriptions/checkout','/api/v1/subscriptions/plans','/api/v1/subscriptions/return','/api/v1/support/tickets','/api/v1/top-ups','/api/v1/top-ups/:id','/api/v1/top-ups/:id/return','/api/v1/uploads','/api/v1/voice-profiles','/api/v1/voice-profiles/:id','/api/v1/voice-profiles/:id/captcha','/api/v1/voice-profiles/:id/samples','/api/v1/voice-profiles/:id/speech','/api/v1/wins','/api/v1/workspaces','/api/v1/workspaces/:id/brand-assets','/api/v1/workspaces/:id/brand-kit','/api/webhook/cinema-stream','/api/webhook/editor-render','/api/webhook/fal','/api/webhook/kie','/api/webhook/montage','/api/webhook/openrouter','/api/webhook/revenuecat','/api/webhook/social/meta','/api/webhook/stripe','/app','/app/account','/app/account/appeals','/app/account/report','/app/account/wins','/app/admin','/app/admin/affiliates','/app/admin/appeals','/app/admin/changes','/app/admin/cinema','/app/admin/cinema/comments','/app/admin/cinema/rankings','/app/admin/cinema/story-polls','/app/admin/cinema/submissions','/app/admin/cinema/voting','/app/admin/endpoints','/app/admin/payments','/app/admin/plans','/app/admin/reports','/app/admin/roles','/app/admin/security','/app/admin/support','/app/admin/switches','/app/admin/traffic','/app/admin/users','/app/admin/violations','/app/admin/webhooks','/app/chat','/app/create','/app/credits','/app/editor','/app/editor/review','/app/enhance','/app/faceless-reel','/app/features','/app/features/:id','/app/film-studio','/app/library','/app/oddlings','/app/projects','/app/projects/:id','/app/publish','/app/publish/activity','/app/publish/ads','/app/publish/analytics','/app/publish/autolists','/app/publish/calendar','/app/publish/commerce','/app/publish/contacts','/app/publish/developer','/app/publish/inbox','/app/publish/plan','/app/publish/queues','/app/publish/reports','/app/publish/smartlink','/app/publish/team','/app/publish/workflows','/app/skills','/app/vibe','/app/video-agent','/auth/callback','/auth/mobile','/auth/mobile/start','/compare/:id','/design-system','/developers','/guides','/guides/:id','/legal/aup','/legal/cinema-content','/legal/gdpr','/legal/privacy','/legal/refund','/legal/terms','/m','/m/create','/m/credits','/m/explore','/m/job','/m/library','/mcp','/media/social/:id','/models','/models/:id','/oauth/consent','/oddlings','/oddlings/:id','/presets','/presets/:id','/pricing','/publish','/s/:id','/s/:id/go/:id','/social-cinema','/social-cinema/creator','/social-cinema/pass','/social-cinema/series/:id','/social-cinema/title/:id','/social-cinema/watch/:id','/social/connect/callback/:id','/social/connect/mobile/:id','/social/review/:id','/social/team/invite/:id','/tools','other']::text[])
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC,anon,authenticated,service_role;
