-- Private-by-default Music sharing and MP3 allowance claims.
-- Raw share tokens and R2 keys never live in browser-readable tables. MP3
-- exports are enabled only when the immutable source asset is already MP3;
-- this migration does not pretend to provide a transcoder.

CREATE TABLE IF NOT EXISTS public.music_share_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    song_id UUID NOT NULL,
    song_version_id UUID NOT NULL,
    token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{8,120}$'),
    permissions JSONB NOT NULL DEFAULT '{"listen":true,"download":false}'::jsonb
        CHECK (permissions = '{"listen":true,"download":false}'::jsonb),
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, idempotency_key),
    CONSTRAINT music_share_links_version_owner_fk
        FOREIGN KEY (song_version_id, user_id, song_id)
        REFERENCES public.music_song_versions(id, user_id, song_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS music_share_links_user_song_idx
    ON public.music_share_links(user_id, song_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.music_download_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    period_key TEXT NOT NULL CHECK (char_length(period_key) BETWEEN 1 AND 160),
    kind TEXT NOT NULL CHECK (kind IN ('free_trial','paid_month')),
    allowance INTEGER NOT NULL CHECK (allowance BETWEEN 1 AND 1000),
    starts_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, period_key),
    CHECK (expires_at IS NULL OR expires_at > starts_at)
);

CREATE TABLE IF NOT EXISTS public.music_download_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    period_id UUID NOT NULL REFERENCES public.music_download_periods(id) ON DELETE RESTRICT,
    song_version_id UUID NOT NULL,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(period_id, song_version_id),
    CONSTRAINT music_download_claims_version_owner_fk
        FOREIGN KEY (song_version_id, user_id)
        REFERENCES public.music_song_versions(id, user_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS music_download_claims_user_period_idx
    ON public.music_download_claims(user_id, period_id, claimed_at);

CREATE OR REPLACE FUNCTION private.music_reject_download_claim_update()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'music download claims are append-only'
        USING ERRCODE = 'integrity_constraint_violation';
END $$;
REVOKE ALL ON FUNCTION private.music_reject_download_claim_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.music_reject_download_claim_update() TO service_role;
DROP TRIGGER IF EXISTS music_download_claims_immutable ON public.music_download_claims;
CREATE TRIGGER music_download_claims_immutable
BEFORE UPDATE OR DELETE ON public.music_download_claims
FOR EACH ROW EXECUTE FUNCTION private.music_reject_download_claim_update();

CREATE TABLE IF NOT EXISTS public.music_export_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    song_id UUID NOT NULL,
    song_version_id UUID NOT NULL,
    period_id UUID NOT NULL REFERENCES public.music_download_periods(id) ON DELETE RESTRICT,
    format TEXT NOT NULL CHECK (format = 'mp3'),
    consumes_allowance BOOLEAN NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at),
    CONSTRAINT music_export_quotes_version_owner_fk
        FOREIGN KEY (song_version_id, user_id, song_id)
        REFERENCES public.music_song_versions(id, user_id, song_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS music_export_quotes_user_created_idx
    ON public.music_export_quotes(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.music_export_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    quote_id UUID NOT NULL REFERENCES public.music_export_quotes(id) ON DELETE RESTRICT,
    song_version_id UUID NOT NULL,
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{8,120}$'),
    state TEXT NOT NULL DEFAULT 'ready' CHECK (state IN ('ready','failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, idempotency_key),
    CONSTRAINT music_export_attempts_version_owner_fk
        FOREIGN KEY (song_version_id, user_id)
        REFERENCES public.music_song_versions(id, user_id) ON DELETE RESTRICT
);

ALTER TABLE public.music_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_share_links FORCE ROW LEVEL SECURITY;
ALTER TABLE public.music_download_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_download_periods FORCE ROW LEVEL SECURITY;
ALTER TABLE public.music_download_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_download_claims FORCE ROW LEVEL SECURITY;
ALTER TABLE public.music_export_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_export_quotes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.music_export_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_export_attempts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS music_share_links_owner_read ON public.music_share_links;
CREATE POLICY music_share_links_owner_read ON public.music_share_links
    FOR SELECT TO authenticated USING (private.music_owns_user(user_id));
DROP POLICY IF EXISTS music_download_periods_owner_read ON public.music_download_periods;
CREATE POLICY music_download_periods_owner_read ON public.music_download_periods
    FOR SELECT TO authenticated USING (private.music_owns_user(user_id));
DROP POLICY IF EXISTS music_download_claims_owner_read ON public.music_download_claims;
CREATE POLICY music_download_claims_owner_read ON public.music_download_claims
    FOR SELECT TO authenticated USING (private.music_owns_user(user_id));
DROP POLICY IF EXISTS music_export_quotes_owner_read ON public.music_export_quotes;
CREATE POLICY music_export_quotes_owner_read ON public.music_export_quotes
    FOR SELECT TO authenticated USING (private.music_owns_user(user_id));
DROP POLICY IF EXISTS music_export_attempts_owner_read ON public.music_export_attempts;
CREATE POLICY music_export_attempts_owner_read ON public.music_export_attempts
    FOR SELECT TO authenticated USING (private.music_owns_user(user_id));

REVOKE ALL ON TABLE public.music_share_links, public.music_download_periods,
    public.music_download_claims, public.music_export_quotes, public.music_export_attempts
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.music_share_links, public.music_download_periods,
    public.music_download_claims, public.music_export_quotes, public.music_export_attempts
    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.music_share_links,
    public.music_download_periods, public.music_download_claims,
    public.music_export_quotes, public.music_export_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.music_list_share_links(p_auth_id TEXT, p_song_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_links JSONB;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.music_songs WHERE id = p_song_id AND user_id = v_user) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id, 'version_id', song_version_id, 'revoked_at', revoked_at,
        'created_at', created_at
    ) ORDER BY created_at DESC), '[]'::jsonb) INTO v_links
    FROM public.music_share_links
    WHERE user_id = v_user AND song_id = p_song_id;
    RETURN jsonb_build_object('ok', true, 'links', v_links);
END $$;

CREATE OR REPLACE FUNCTION public.music_create_share_link(
    p_auth_id TEXT, p_song_id UUID, p_version_id UUID,
    p_token_hash TEXT, p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_link public.music_share_links%ROWTYPE;
BEGIN
    IF p_token_hash !~ '^[0-9a-f]{64}$'
       OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id FOR UPDATE;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    SELECT * INTO v_link FROM public.music_share_links
    WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_link.song_id IS DISTINCT FROM p_song_id
           OR v_link.song_version_id IS DISTINCT FROM p_version_id
           OR v_link.token_hash IS DISTINCT FROM p_token_hash THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
        END IF;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'link', jsonb_build_object(
            'id', v_link.id, 'version_id', v_link.song_version_id,
            'revoked_at', v_link.revoked_at, 'created_at', v_link.created_at));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.music_song_versions
        WHERE id = p_version_id AND user_id = v_user AND song_id = p_song_id
    ) THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    INSERT INTO public.music_share_links(
        user_id, song_id, song_version_id, token_hash, idempotency_key
    ) VALUES (v_user, p_song_id, p_version_id, p_token_hash, p_idempotency_key)
    RETURNING * INTO v_link;
    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'link', jsonb_build_object(
        'id', v_link.id, 'version_id', v_link.song_version_id,
        'revoked_at', v_link.revoked_at, 'created_at', v_link.created_at));
END $$;

CREATE OR REPLACE FUNCTION public.music_revoke_share_link(
    p_auth_id TEXT, p_link_id UUID, p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_link public.music_share_links%ROWTYPE; v_was_revoked BOOLEAN;
BEGIN
    IF p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    SELECT * INTO v_link FROM public.music_share_links
    WHERE id = p_link_id AND user_id = v_user FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    v_was_revoked := v_link.revoked_at IS NOT NULL;
    UPDATE public.music_share_links SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
    WHERE id = v_link.id RETURNING * INTO v_link;
    RETURN jsonb_build_object('ok', true, 'idempotent', v_was_revoked, 'link', jsonb_build_object(
        'id', v_link.id, 'revoked_at', v_link.revoked_at));
END $$;

CREATE OR REPLACE FUNCTION public.music_resolve_share_link(p_token_hash TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row JSONB;
BEGIN
    IF p_token_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    END IF;
    SELECT jsonb_build_object(
        'title', s.title, 'version_number', v.version_number, 'created_at', v.created_at
    ) INTO v_row
    FROM public.music_share_links l
    JOIN public.music_songs s ON s.id = l.song_id AND s.user_id = l.user_id
    JOIN public.music_song_versions v ON v.id = l.song_version_id AND v.user_id = l.user_id
    WHERE l.token_hash = p_token_hash AND l.revoked_at IS NULL AND s.status = 'active';
    IF v_row IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    RETURN jsonb_build_object('ok', true, 'song', v_row);
END $$;

CREATE OR REPLACE FUNCTION public.music_resolve_shared_asset(p_token_hash TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_asset public.assets%ROWTYPE;
BEGIN
    SELECT a.* INTO v_asset
    FROM public.music_share_links l
    JOIN public.music_songs s ON s.id = l.song_id AND s.user_id = l.user_id
    JOIN public.music_song_versions v ON v.id = l.song_version_id AND v.user_id = l.user_id
    JOIN public.assets a ON a.id = v.audio_asset_id
    WHERE l.token_hash = p_token_hash AND l.revoked_at IS NULL AND s.status = 'active';
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    RETURN jsonb_build_object('ok', true, 'r2_key', v_asset.r2_key,
        'mime_type', v_asset.mime_type, 'size_bytes', v_asset.size_bytes);
END $$;

CREATE OR REPLACE FUNCTION public.music_quote_mp3_export(
    p_auth_id TEXT, p_song_id UUID, p_version_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID; v_asset public.assets%ROWTYPE; v_sub public.credit_subscriptions%ROWTYPE;
    v_period public.music_download_periods%ROWTYPE; v_quote public.music_export_quotes%ROWTYPE;
    v_period_key TEXT; v_kind TEXT; v_allowance INTEGER; v_used INTEGER; v_claimed BOOLEAN;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    SELECT a.* INTO v_asset
    FROM public.music_song_versions v JOIN public.assets a ON a.id = v.audio_asset_id
    WHERE v.id = p_version_id AND v.user_id = v_user AND v.song_id = p_song_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF lower(v_asset.mime_type) NOT IN ('audio/mpeg','audio/mp3') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FORMAT_UNAVAILABLE');
    END IF;

    SELECT * INTO v_sub FROM public.credit_subscriptions
    WHERE user_id = v_user AND status = 'active' AND current_period_end > now()
    ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
        v_period_key := 'subscription:' || v_sub.id::text || ':' || extract(epoch from v_sub.current_period_end)::bigint::text;
        v_kind := 'paid_month';
        v_allowance := CASE v_sub.plan_id
            WHEN 'starter-monthly' THEN 20
            WHEN 'plus-monthly' THEN 60
            WHEN 'ultra-monthly' THEN 60
            ELSE 0
        END;
        IF v_allowance = 0 THEN
            RETURN jsonb_build_object('ok', false, 'code', 'PLAN_UNAVAILABLE');
        END IF;
        INSERT INTO public.music_download_periods(user_id, period_key, kind, allowance, starts_at, expires_at)
        VALUES (v_user, v_period_key, v_kind, v_allowance,
            COALESCE(v_sub.started_at, v_sub.created_at), v_sub.current_period_end)
        ON CONFLICT (user_id, period_key) DO NOTHING;
    ELSE
        v_period_key := 'free-trial'; v_kind := 'free_trial'; v_allowance := 7;
        INSERT INTO public.music_download_periods(user_id, period_key, kind, allowance, starts_at, expires_at)
        VALUES (v_user, v_period_key, v_kind, v_allowance, now(), NULL)
        ON CONFLICT (user_id, period_key) DO NOTHING;
    END IF;
    SELECT * INTO v_period FROM public.music_download_periods
    WHERE user_id = v_user AND period_key = v_period_key FOR UPDATE;
    SELECT count(*) INTO v_used FROM public.music_download_claims WHERE period_id = v_period.id;
    SELECT EXISTS(SELECT 1 FROM public.music_download_claims
        WHERE period_id = v_period.id AND song_version_id = p_version_id) INTO v_claimed;
    IF NOT v_claimed AND v_used >= v_period.allowance THEN
        RETURN jsonb_build_object('ok', false, 'code', 'DOWNLOAD_ALLOWANCE_EXHAUSTED');
    END IF;
    INSERT INTO public.music_export_quotes(
        user_id, song_id, song_version_id, period_id, format, consumes_allowance, expires_at
    ) VALUES (v_user, p_song_id, p_version_id, v_period.id, 'mp3', NOT v_claimed, now() + interval '5 minutes')
    RETURNING * INTO v_quote;
    RETURN jsonb_build_object('ok', true, 'quote', jsonb_build_object(
        'id', v_quote.id, 'format', 'mp3', 'consumes_allowance', v_quote.consumes_allowance,
        'allowance', v_period.allowance, 'used', v_used,
        'remaining_after', v_period.allowance - v_used - CASE WHEN v_claimed THEN 0 ELSE 1 END,
        'expires_at', v_quote.expires_at));
END $$;

CREATE OR REPLACE FUNCTION public.music_start_mp3_export(
    p_auth_id TEXT, p_quote_id UUID, p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID; v_quote public.music_export_quotes%ROWTYPE;
    v_attempt public.music_export_attempts%ROWTYPE; v_period public.music_download_periods%ROWTYPE;
    v_version public.music_song_versions%ROWTYPE; v_used INTEGER; v_claimed BOOLEAN;
BEGIN
    IF p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id FOR UPDATE;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    SELECT * INTO v_attempt FROM public.music_export_attempts
    WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_attempt.quote_id IS DISTINCT FROM p_quote_id THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
        END IF;
        RETURN jsonb_build_object('ok', true, 'idempotent', true, 'export_id', v_attempt.id,
            'state', v_attempt.state);
    END IF;
    SELECT * INTO v_quote FROM public.music_export_quotes
    WHERE id = p_quote_id AND user_id = v_user;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF v_quote.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'code', 'QUOTE_EXPIRED'); END IF;
    SELECT * INTO v_period FROM public.music_download_periods WHERE id = v_quote.period_id FOR UPDATE;
    IF v_period.expires_at IS NOT NULL AND v_period.expires_at <= now() THEN
        RETURN jsonb_build_object('ok', false, 'code', 'QUOTE_EXPIRED');
    END IF;
    SELECT EXISTS(SELECT 1 FROM public.music_download_claims
        WHERE period_id = v_period.id AND song_version_id = v_quote.song_version_id) INTO v_claimed;
    SELECT count(*) INTO v_used FROM public.music_download_claims WHERE period_id = v_period.id;
    IF NOT v_claimed AND v_used >= v_period.allowance THEN
        RETURN jsonb_build_object('ok', false, 'code', 'DOWNLOAD_ALLOWANCE_EXHAUSTED');
    END IF;
    IF NOT v_claimed THEN
        INSERT INTO public.music_download_claims(user_id, period_id, song_version_id)
        VALUES (v_user, v_period.id, v_quote.song_version_id);
        v_used := v_used + 1;
    END IF;
    SELECT * INTO v_version FROM public.music_song_versions
    WHERE id = v_quote.song_version_id AND user_id = v_user;
    INSERT INTO public.music_export_attempts(
        user_id, quote_id, song_version_id, job_id, idempotency_key, state
    ) VALUES (v_user, v_quote.id, v_quote.song_version_id, v_version.job_id, p_idempotency_key, 'ready')
    RETURNING * INTO v_attempt;
    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'export_id', v_attempt.id,
        'state', v_attempt.state, 'allowance', v_period.allowance,
        'used', v_used, 'remaining', v_period.allowance - v_used);
END $$;

CREATE OR REPLACE FUNCTION public.music_get_export(p_auth_id TEXT, p_export_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_row RECORD;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    SELECT e.id, e.state, e.job_id, a.r2_key, a.mime_type, a.size_bytes
    INTO v_row
    FROM public.music_export_attempts e
    JOIN public.music_song_versions v ON v.id = e.song_version_id AND v.user_id = e.user_id
    JOIN public.assets a ON a.id = v.audio_asset_id
    WHERE e.id = p_export_id AND e.user_id = v_user;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    RETURN jsonb_build_object('ok', true, 'export', jsonb_build_object(
        'id', v_row.id, 'state', v_row.state, 'job_id', v_row.job_id,
        'r2_key', v_row.r2_key, 'mime_type', v_row.mime_type, 'size_bytes', v_row.size_bytes));
END $$;

REVOKE ALL ON FUNCTION public.music_list_share_links(TEXT,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_create_share_link(TEXT,UUID,UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_revoke_share_link(TEXT,UUID,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_resolve_share_link(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_resolve_shared_asset(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_quote_mp3_export(TEXT,UUID,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_start_mp3_export(TEXT,UUID,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_get_export(TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_list_share_links(TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_create_share_link(TEXT,UUID,UUID,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_revoke_share_link(TEXT,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_resolve_share_link(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_resolve_shared_asset(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_quote_mp3_export(TEXT,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_start_mp3_export(TEXT,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_get_export(TEXT,UUID) TO service_role;
