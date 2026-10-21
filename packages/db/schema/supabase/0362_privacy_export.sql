-- ADR-0250. Request metadata only; personal data is streamed to the phone.
CREATE TABLE IF NOT EXISTS public.privacy_export_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    as_of timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    aal text NOT NULL CHECK (aal IN ('aal1', 'aal2')),
    created_at timestamptz NOT NULL DEFAULT now(),
    cursor_salt uuid NOT NULL DEFAULT gen_random_uuid()
);
CREATE INDEX IF NOT EXISTS privacy_export_requests_user_idx ON public.privacy_export_requests(user_id, created_at);
ALTER TABLE public.privacy_export_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_export_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.privacy_export_requests FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION private.privacy_export_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'privacy_export_requests is append-only'; END $$;
REVOKE ALL ON FUNCTION private.privacy_export_append_only() FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.privacy_export_requests'::regclass AND tgname = 'privacy_export_requests_append_only') THEN
        CREATE TRIGGER privacy_export_requests_append_only BEFORE UPDATE OR DELETE ON public.privacy_export_requests
            FOR EACH ROW EXECUTE FUNCTION private.privacy_export_append_only();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.privacy_export_requests'::regclass AND tgname = 'privacy_export_requests_no_truncate') THEN
        CREATE TRIGGER privacy_export_requests_no_truncate BEFORE TRUNCATE ON public.privacy_export_requests
            FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_no_truncate();
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.start_privacy_export(p_auth_id text, p_aal text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.users%ROWTYPE; r public.privacy_export_requests%ROWTYPE; resumed boolean := false;
BEGIN
    SELECT * INTO u FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'account_not_found'); END IF;
    IF private.account_deletion_blockers(u.id, p_auth_id) && ARRAY['account_frozen','account_on_hold']::text[] THEN
        RETURN jsonb_build_object('ok', false, 'error', 'account_restricted');
    END IF;
    IF COALESCE(p_aal, '') <> 'aal2' AND EXISTS (SELECT 1 FROM auth.mfa_factors WHERE user_id = p_auth_id::uuid AND factor_type = 'totp' AND status = 'verified') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'mfa_required');
    END IF;
    SELECT * INTO r FROM public.privacy_export_requests WHERE user_id = u.id ORDER BY created_at DESC, id DESC LIMIT 1;
    IF FOUND AND r.created_at > now() - interval '24 hours' THEN
        IF r.expires_at <= now() THEN
            RETURN jsonb_build_object('ok', false, 'error', 'rate_limited', 'retry_after_seconds',
                greatest(1, least(86400, ceil(extract(epoch FROM r.created_at + interval '24 hours' - now()))::integer)));
        END IF;
        resumed := true;
    ELSE
        INSERT INTO public.privacy_export_requests(user_id, expires_at, aal)
        VALUES (u.id, now() + interval '60 minutes', CASE WHEN p_aal = 'aal2' THEN 'aal2' ELSE 'aal1' END) RETURNING * INTO r;
    END IF;
    RETURN jsonb_build_object('ok', true, 'export_id', r.id, 'as_of', r.as_of, 'expires_at', r.expires_at, 'resumed', resumed);
END $$;
REVOKE ALL ON FUNCTION public.start_privacy_export(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_privacy_export(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.read_privacy_export_page(
    p_auth_id text, p_aal text, p_export_id uuid, p_section text,
    p_thread_id uuid, p_after text, p_key text, p_page_size integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    u public.users%ROWTYPE; r public.privacy_export_requests%ROWTYPE;
    items jsonb; boundary jsonb; n integer;
BEGIN
    SELECT * INTO u FROM public.users WHERE auth_id = p_auth_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'export_not_found'); END IF;
    SELECT * INTO r FROM public.privacy_export_requests WHERE id = p_export_id AND user_id = u.id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'export_not_found'); END IF;
    IF r.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'error', 'export_expired'); END IF;
    IF private.account_deletion_blockers(u.id, p_auth_id) && ARRAY['account_frozen','account_on_hold']::text[] THEN
        RETURN jsonb_build_object('ok', false, 'error', 'account_restricted');
    END IF;
    IF COALESCE(p_aal, '') <> 'aal2' AND EXISTS (SELECT 1 FROM auth.mfa_factors WHERE user_id = p_auth_id::uuid AND factor_type = 'totp' AND status = 'verified') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'mfa_required');
    END IF;
    IF p_page_size IS NOT NULL AND p_page_size NOT BETWEEN 1 AND 200 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_section');
    END IF;
    n := least(COALESCE(p_page_size, 200), CASE WHEN p_section = 'chat_messages' THEN 50 ELSE 200 END);
    IF p_section = 'profile' THEN
        SELECT jsonb_build_object(
            'id', u.id, 'email', u.email, 'created_at', u.created_at,
            'preferred_locale', u.preferred_locale, 'rights_attested_at', u.rights_attested_at,
            'rights_attestation_version', u.rights_attestation_version,
            'balance', b.balance, 'free_balance', b.free_balance, 'subscription_balance', b.subscription_balance,
            'subscription_expires_at', b.subscription_expires_at,
            'cinema_profile', (SELECT jsonb_build_object('username', p.username, 'display_name', p.display_name, 'bio', p.bio, 'created_at', p.created_at) FROM public.cinema_profiles p WHERE p.user_id = u.id AND p.created_at <= r.as_of),
            'cinema_membership', (SELECT jsonb_build_object('role', m.role, 'account_status', m.account_status) FROM public.cinema_memberships m WHERE m.user_id = u.id),
            'referral_code', (SELECT jsonb_build_object('code', c.code, 'created_at', c.created_at) FROM public.referral_codes c WHERE c.user_id = u.id AND c.created_at <= r.as_of),
            'referred_at', (SELECT f.created_at FROM public.referrals f WHERE f.referee_user_id = u.id AND f.created_at <= r.as_of),
            'referrals_made', (SELECT count(*) FROM public.referrals f WHERE f.referrer_user_id = u.id AND f.created_at <= r.as_of),
            -- Capped: the 100 most recently seen devices, so the one unpaged list stays bounded.
            'push_devices', (SELECT COALESCE(jsonb_agg(jsonb_build_object('platform', d.platform, 'notify_jobs', d.notify_jobs, 'created_at', d.created_at, 'last_seen_at', d.last_seen_at, 'disabled_at', d.disabled_at) ORDER BY d.last_seen_at DESC NULLS LAST, d.created_at DESC, d.id), '[]'::jsonb)
                FROM (SELECT * FROM public.push_tokens t WHERE t.user_id = u.id AND t.created_at <= r.as_of
                      ORDER BY t.last_seen_at DESC NULLS LAST, t.created_at DESC, t.id LIMIT 100) d),
            'sanctions_hold_until', CASE WHEN u.hold_until > now() THEN u.hold_until END,
            'frozen', u.frozen_at IS NOT NULL
        ) INTO items FROM public.credit_balances b WHERE b.user_id = u.id;
        RETURN jsonb_build_object('ok', true, 'rows', jsonb_build_array(items), 'next', NULL);
    ELSIF p_section = 'chat_messages' THEN
        IF NOT EXISTS (SELECT 1 FROM public.chat_threads t WHERE t.id = p_thread_id AND t.user_id = u.id AND t.deleted_at IS NULL AND t.created_at <= r.as_of) THEN
            RETURN jsonb_build_object('ok', true, 'rows', '[]'::jsonb, 'next', NULL);
        END IF;
        WITH page AS (
            SELECT m.id, m.thread_id, m.seq::text AS seq, m.role, m.content, m.model_id, m.credits, m.status, m.created_at,
                   m.seq AS order_seq
              FROM public.chat_messages m WHERE m.thread_id = p_thread_id AND m.created_at <= r.as_of
               AND (p_after IS NULL OR m.seq > p_after::bigint) ORDER BY m.seq LIMIT n
        ) SELECT COALESCE(jsonb_agg(to_jsonb(page) - 'order_seq' ORDER BY order_seq), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', seq, 'key', NULL) FROM page ORDER BY order_seq DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSIF p_section = 'credit_history' THEN
        WITH page AS (
            SELECT jsonb_build_object('id', t.id, 'delta', t.delta, 'free_delta', t.free_delta, 'subscription_delta', t.subscription_delta, 'job_id', t.job_id, 'created_at', t.created_at, 'reason', t.reason) AS data, t.created_at AS ord, t.id AS tie
              FROM public.ledger_entries t 
             WHERE t.user_id = u.id AND t.created_at <= r.as_of
               AND (p_after IS NULL OR (t.created_at, t.id) > (p_after::timestamptz, p_key::uuid))
             ORDER BY t.created_at, t.id LIMIT n
        ) SELECT COALESCE(jsonb_agg(data ORDER BY ord, tie), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', ord, 'key', tie) FROM page ORDER BY ord DESC, tie DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSIF p_section = 'top_ups' THEN
        WITH page AS (
            SELECT jsonb_build_object('id', t.id, 'pack_id', t.pack_id, 'sales_channel', t.sales_channel, 'credits', t.credits, 'price_usd_cents', t.price_usd_cents, 'status', t.status, 'consent_at', t.consent_at, 'consent_version', t.consent_version, 'created_at', t.created_at, 'credited_at', t.credited_at, 'refunded_cents', t.refunded_cents, 'clawed_back_credits', t.clawed_back_credits, 'returned_at', t.returned_at) AS data, t.created_at AS ord, t.id AS tie
              FROM public.top_ups t 
             WHERE t.user_id = u.id AND t.created_at <= r.as_of
               AND (p_after IS NULL OR (t.created_at, t.id) > (p_after::timestamptz, p_key::uuid))
             ORDER BY t.created_at, t.id LIMIT n
        ) SELECT COALESCE(jsonb_agg(data ORDER BY ord, tie), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', ord, 'key', tie) FROM page ORDER BY ord DESC, tie DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSIF p_section = 'credit_subscriptions' THEN
        WITH page AS (
            SELECT jsonb_build_object('id', t.id, 'plan_id', t.plan_id, 'status', t.status, 'price_usd_cents', t.price_usd_cents, 'consent_version', t.consent_version, 'consent_at', t.consent_at, 'started_at', t.started_at, 'current_period_end', t.current_period_end, 'cancel_at_period_end', t.cancel_at_period_end, 'ended_at', t.ended_at, 'end_reason', t.end_reason, 'created_at', t.created_at, 'credits', t.credits) AS data, t.created_at AS ord, t.id AS tie
              FROM public.credit_subscriptions t 
             WHERE t.user_id = u.id AND t.created_at <= r.as_of
               AND (p_after IS NULL OR (t.created_at, t.id) > (p_after::timestamptz, p_key::uuid))
             ORDER BY t.created_at, t.id LIMIT n
        ) SELECT COALESCE(jsonb_agg(data ORDER BY ord, tie), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', ord, 'key', tie) FROM page ORDER BY ord DESC, tie DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSIF p_section = 'publish_subscriptions' THEN
        WITH page AS (
            SELECT jsonb_build_object('id', t.id, 'plan_id', t.plan_id, 'status', t.status, 'price_usd_cents', t.price_usd_cents, 'consent_version', t.consent_version, 'consent_at', t.consent_at, 'started_at', t.started_at, 'current_period_end', t.current_period_end, 'cancel_at_period_end', t.cancel_at_period_end, 'ended_at', t.ended_at, 'end_reason', t.end_reason, 'created_at', t.created_at) AS data, t.created_at AS ord, t.id AS tie
              FROM public.social_publish_subscriptions t 
             WHERE t.user_id = u.id AND t.created_at <= r.as_of
               AND (p_after IS NULL OR (t.created_at, t.id) > (p_after::timestamptz, p_key::uuid))
             ORDER BY t.created_at, t.id LIMIT n
        ) SELECT COALESCE(jsonb_agg(data ORDER BY ord, tie), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', ord, 'key', tie) FROM page ORDER BY ord DESC, tie DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSIF p_section = 'creations' THEN
        WITH page AS (
            SELECT jsonb_build_object('id', t.id, 'model_id', t.model_id, 'credits', t.credits, 'state', t.state, 'error_code', t.error_code, 'free_allowance', t.free_allowance, 'consent_attested_at', t.consent_attested_at, 'created_at', t.created_at, 'updated_at', t.updated_at, 'kind', t.inputs->>'kind', 'prompt', t.inputs->>'prompt', 'topic', t.inputs->>'topic') AS data, t.created_at AS ord, t.id AS tie
              FROM public.jobs t 
             WHERE t.user_id = u.id AND t.deleted_at IS NULL AND t.created_at <= r.as_of
               AND (p_after IS NULL OR (t.created_at, t.id) > (p_after::timestamptz, p_key::uuid))
             ORDER BY t.created_at, t.id LIMIT n
        ) SELECT COALESCE(jsonb_agg(data ORDER BY ord, tie), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', ord, 'key', tie) FROM page ORDER BY ord DESC, tie DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSIF p_section = 'chat_folders' THEN
        WITH page AS (
            SELECT jsonb_build_object('id', t.id, 'name', t.name, 'created_at', t.created_at) AS data, t.created_at AS ord, t.id AS tie
              FROM public.chat_folders t 
             WHERE t.user_id = u.id AND t.created_at <= r.as_of
               AND (p_after IS NULL OR (t.created_at, t.id) > (p_after::timestamptz, p_key::uuid))
             ORDER BY t.created_at, t.id LIMIT n
        ) SELECT COALESCE(jsonb_agg(data ORDER BY ord, tie), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', ord, 'key', tie) FROM page ORDER BY ord DESC, tie DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSIF p_section = 'chat_personas' THEN
        WITH page AS (
            SELECT jsonb_build_object('id', t.id, 'name', t.name, 'instructions', t.instructions, 'default_model_id', t.default_model_id, 'thinking', t.thinking, 'web', t.web, 'created_at', t.created_at) AS data, t.created_at AS ord, t.id AS tie
              FROM public.chat_personas t 
             WHERE t.user_id = u.id AND t.created_at <= r.as_of
               AND (p_after IS NULL OR (t.created_at, t.id) > (p_after::timestamptz, p_key::uuid))
             ORDER BY t.created_at, t.id LIMIT n
        ) SELECT COALESCE(jsonb_agg(data ORDER BY ord, tie), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', ord, 'key', tie) FROM page ORDER BY ord DESC, tie DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSIF p_section = 'chat_threads' THEN
        WITH page AS (
            SELECT jsonb_build_object('id', t.id, 'folder_id', t.folder_id, 'model_id', t.model_id, 'title', t.title, 'system_prompt', t.system_prompt, 'pinned', t.pinned, 'created_at', t.created_at, 'updated_at', t.updated_at) AS data, t.created_at AS ord, t.id AS tie
              FROM public.chat_threads t 
             WHERE t.user_id = u.id AND t.deleted_at IS NULL AND t.created_at <= r.as_of
               AND (p_after IS NULL OR (t.created_at, t.id) > (p_after::timestamptz, p_key::uuid))
             ORDER BY t.created_at, t.id LIMIT n
        ) SELECT COALESCE(jsonb_agg(data ORDER BY ord, tie), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', ord, 'key', tie) FROM page ORDER BY ord DESC, tie DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSIF p_section = 'publish_brands' THEN
        WITH page AS (
            SELECT jsonb_build_object('id', t.id, 'label', t.label, 'timezone', t.timezone, 'created_at', t.created_at) AS data, t.created_at AS ord, t.id AS tie
              FROM public.social_brands t 
             WHERE t.owner_user_id = u.id AND t.created_at <= r.as_of
               AND (p_after IS NULL OR (t.created_at, t.id) > (p_after::timestamptz, p_key::uuid))
             ORDER BY t.created_at, t.id LIMIT n
        ) SELECT COALESCE(jsonb_agg(data ORDER BY ord, tie), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', ord, 'key', tie) FROM page ORDER BY ord DESC, tie DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSIF p_section = 'publish_connections' THEN
        WITH page AS (
            SELECT jsonb_build_object('id', t.id, 'brand_id', t.brand_id, 'network', t.network, 'display_name', t.display_name, 'status', t.status, 'scopes_granted', t.scopes_granted, 'connected_at', t.connected_at, 'disconnected_at', t.disconnected_at) AS data, t.connected_at AS ord, t.id AS tie
              FROM public.social_accounts t JOIN public.social_brands b ON b.id = t.brand_id
             WHERE b.owner_user_id = u.id AND t.connected_at <= r.as_of
               AND (p_after IS NULL OR (t.connected_at, t.id) > (p_after::timestamptz, p_key::uuid))
             ORDER BY t.connected_at, t.id LIMIT n
        ) SELECT COALESCE(jsonb_agg(data ORDER BY ord, tie), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', ord, 'key', tie) FROM page ORDER BY ord DESC, tie DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSIF p_section = 'publish_posts' THEN
        WITH page AS (
            SELECT jsonb_build_object('id', t.id, 'brand_id', t.brand_id, 'status', t.status, 'scheduled_at', t.scheduled_at, 'global_text', t.global_text, 'created_at', t.created_at) AS data, t.created_at AS ord, t.id AS tie
              FROM public.social_posts t 
             WHERE t.created_by_user_id = u.id AND t.created_at <= r.as_of
               AND (p_after IS NULL OR (t.created_at, t.id) > (p_after::timestamptz, p_key::uuid))
             ORDER BY t.created_at, t.id LIMIT n
        ) SELECT COALESCE(jsonb_agg(data ORDER BY ord, tie), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', ord, 'key', tie) FROM page ORDER BY ord DESC, tie DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSIF p_section = 'saved_titles' THEN
        WITH page AS (
            SELECT jsonb_build_object('content_id', t.content_id, 'created_at', t.created_at) AS data, t.created_at AS ord, t.content_id AS tie
              FROM public.cinema_saved_titles t 
             WHERE t.user_id = u.id AND t.created_at <= r.as_of
               AND (p_after IS NULL OR (t.created_at, t.content_id) > (p_after::timestamptz, p_key::uuid))
             ORDER BY t.created_at, t.content_id LIMIT n
        ) SELECT COALESCE(jsonb_agg(data ORDER BY ord, tie), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', ord, 'key', tie) FROM page ORDER BY ord DESC, tie DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSIF p_section = 'series_follows' THEN
        WITH page AS (
            SELECT jsonb_build_object('series_id', t.series_id, 'created_at', t.created_at) AS data, t.created_at AS ord, t.series_id AS tie
              FROM public.cinema_series_follows t 
             WHERE t.user_id = u.id AND t.created_at <= r.as_of
               AND (p_after IS NULL OR (t.created_at, t.series_id) > (p_after::timestamptz, p_key::uuid))
             ORDER BY t.created_at, t.series_id LIMIT n
        ) SELECT COALESCE(jsonb_agg(data ORDER BY ord, tie), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', ord, 'key', tie) FROM page ORDER BY ord DESC, tie DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSIF p_section = 'creator_follows' THEN
        WITH page AS (
            SELECT jsonb_build_object('creator_username', p.username) AS data, t.created_at AS ord, encode(sha256(convert_to(r.cursor_salt::text || ':' || t.creator_id::text, 'UTF8')), 'hex') AS tie
              FROM public.cinema_creator_follows t LEFT JOIN public.cinema_profiles p ON p.user_id = t.creator_id
             WHERE t.user_id = u.id AND t.created_at <= r.as_of
               AND (p_after IS NULL OR (t.created_at, encode(sha256(convert_to(r.cursor_salt::text || ':' || t.creator_id::text, 'UTF8')), 'hex')) > (p_after::timestamptz, p_key::text))
             ORDER BY t.created_at, encode(sha256(convert_to(r.cursor_salt::text || ':' || t.creator_id::text, 'UTF8')), 'hex') LIMIT n
        ) SELECT COALESCE(jsonb_agg(data ORDER BY ord, tie), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', ord, 'key', tie) FROM page ORDER BY ord DESC, tie DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSIF p_section = 'watch_progress' THEN
        WITH page AS (
            SELECT jsonb_build_object('content_id', t.content_id, 'position_seconds', t.position_seconds, 'duration_seconds', t.duration_seconds, 'completed', t.completed, 'updated_at', t.updated_at) AS data, t.content_id AS ord, t.content_id AS tie
              FROM public.cinema_watch_resume t 
             WHERE t.user_id = u.id
               AND (p_after IS NULL OR (t.content_id, t.content_id) > (p_after::uuid, p_key::uuid))
             ORDER BY t.content_id, t.content_id LIMIT n
        ) SELECT COALESCE(jsonb_agg(data ORDER BY ord, tie), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', ord, 'key', tie) FROM page ORDER BY ord DESC, tie DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSIF p_section = 'votes' THEN
        WITH page AS (
            SELECT jsonb_build_object('content_id', t.content_id, 'competition_id', t.competition_id, 'status', t.status, 'created_at', t.created_at) AS data, t.created_at AS ord, t.id AS tie
              FROM public.cinema_votes t 
             WHERE t.voter_id = u.id AND t.created_at <= r.as_of
               AND (p_after IS NULL OR (t.created_at, t.id) > (p_after::timestamptz, p_key::uuid))
             ORDER BY t.created_at, t.id LIMIT n
        ) SELECT COALESCE(jsonb_agg(data ORDER BY ord, tie), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', ord, 'key', tie) FROM page ORDER BY ord DESC, tie DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSIF p_section = 'comments' THEN
        WITH page AS (
            SELECT jsonb_build_object('id', t.id, 'content_id', t.content_id, 'body', t.body, 'status', t.status, 'created_at', t.created_at) AS data, t.created_at AS ord, t.id AS tie
              FROM public.cinema_comments t 
             WHERE t.author_id = u.id AND t.created_at <= r.as_of
               AND (p_after IS NULL OR (t.created_at, t.id) > (p_after::timestamptz, p_key::uuid))
             ORDER BY t.created_at, t.id LIMIT n
        ) SELECT COALESCE(jsonb_agg(data ORDER BY ord, tie), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', ord, 'key', tie) FROM page ORDER BY ord DESC, tie DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSIF p_section = 'blocks' THEN
        WITH page AS (
            SELECT jsonb_build_object('created_at', t.created_at, 'blocked_username', p.username) AS data, t.created_at AS ord, encode(sha256(convert_to(r.cursor_salt::text || ':' || t.blocked_id::text, 'UTF8')), 'hex') AS tie
              FROM public.user_blocks t LEFT JOIN public.cinema_profiles p ON p.user_id = t.blocked_id
             WHERE t.blocker_id = u.id AND t.created_at <= r.as_of
               AND (p_after IS NULL OR (t.created_at, encode(sha256(convert_to(r.cursor_salt::text || ':' || t.blocked_id::text, 'UTF8')), 'hex')) > (p_after::timestamptz, p_key::text))
             ORDER BY t.created_at, encode(sha256(convert_to(r.cursor_salt::text || ':' || t.blocked_id::text, 'UTF8')), 'hex') LIMIT n
        ) SELECT COALESCE(jsonb_agg(data ORDER BY ord, tie), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', ord, 'key', tie) FROM page ORDER BY ord DESC, tie DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSIF p_section = 'sanctions' THEN
        WITH page AS (
            SELECT jsonb_build_object('action', t.action, 'created_at', t.created_at, 'job_id', t.job_id, 'hold_until', t.hold_until, 'action_id', t.id, 'model_id', j.model_id, 'appeal_status', a.status, 'appeal_submitted_at', a.submitted_at, 'appeal_decided_at', a.decided_at) AS data, t.created_at AS ord, t.id AS tie
              FROM public.account_actions t LEFT JOIN public.jobs j ON j.id = t.job_id LEFT JOIN public.content_appeals a ON a.action_id = t.id
             WHERE t.user_id = u.id AND (t.action IN ('warning', 'takedown') OR (t.action = 'freeze' AND t.reason LIKE 'content:%')) AND t.created_at <= r.as_of
               AND (p_after IS NULL OR (t.created_at, t.id) > (p_after::timestamptz, p_key::uuid))
             ORDER BY t.created_at, t.id LIMIT n
        ) SELECT COALESCE(jsonb_agg(data ORDER BY ord, tie), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', ord, 'key', tie) FROM page ORDER BY ord DESC, tie DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSIF p_section = 'appeals' THEN
        WITH page AS (
            SELECT jsonb_build_object('action_id', t.action_id, 'statement', t.statement, 'status', t.status, 'submitted_at', t.submitted_at, 'decided_at', t.decided_at) AS data, t.submitted_at AS ord, t.id AS tie
              FROM public.content_appeals t 
             WHERE t.user_id = u.id AND t.submitted_at <= r.as_of
               AND (p_after IS NULL OR (t.submitted_at, t.id) > (p_after::timestamptz, p_key::uuid))
             ORDER BY t.submitted_at, t.id LIMIT n
        ) SELECT COALESCE(jsonb_agg(data ORDER BY ord, tie), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', ord, 'key', tie) FROM page ORDER BY ord DESC, tie DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSIF p_section = 'reports' THEN
        WITH page AS (
            SELECT jsonb_build_object('category', t.category, 'subject_kind', t.subject_kind, 'details', t.details, 'status', t.status, 'created_at', t.created_at, 'resolved_at', t.resolved_at) AS data, t.created_at AS ord, t.id AS tie
              FROM public.content_reports t 
             WHERE t.reporter_id = u.id AND t.created_at <= r.as_of
               AND (p_after IS NULL OR (t.created_at, t.id) > (p_after::timestamptz, p_key::uuid))
             ORDER BY t.created_at, t.id LIMIT n
        ) SELECT COALESCE(jsonb_agg(data ORDER BY ord, tie), '[]'::jsonb),
                 (SELECT jsonb_build_object('after', ord, 'key', tie) FROM page ORDER BY ord DESC, tie DESC LIMIT 1)
            INTO items, boundary FROM page;
    ELSE RETURN jsonb_build_object('ok', false, 'error', 'invalid_section');
    END IF;
    RETURN jsonb_build_object('ok', true, 'rows', items, 'next', CASE WHEN jsonb_array_length(items) = n THEN boundary END);
END $$;
REVOKE ALL ON FUNCTION public.read_privacy_export_page(text, text, uuid, text, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_privacy_export_page(text, text, uuid, text, uuid, text, text, integer) TO service_role;
