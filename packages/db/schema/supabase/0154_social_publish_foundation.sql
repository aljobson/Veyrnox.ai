-- 0154_social_publish_foundation.sql — ADR-0061 Phase 1: Veyrnox Publish foundation.
--
-- A brand groups the social accounts a user connects (mirrors Metricool's
-- "blog"); accounts hold encrypted OAuth tokens, never exposed to a client.
-- No client policies (deny by default, per ADR-0048's own precedent) — every
-- read and write goes through a narrow SECURITY DEFINER RPC that resolves
-- the caller's own user id and never trusts a client-supplied one.
-- Additive and idempotent. This slice is data-layer only: no OAuth routes,
-- no platform adapters. Those are separate follow-up slices (technical spec
-- §2.1 "adapters, not SDKs"; §2.7 OAuth hardening).

-- ── Brands ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.social_brands (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    label         TEXT        NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 80),
    timezone      TEXT        NOT NULL DEFAULT 'UTC' CHECK (timezone ~ '^[A-Za-z0-9_+/-]{1,64}$'),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_brands_owner_idx ON public.social_brands (owner_user_id);
ALTER TABLE public.social_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_brands FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_brands FROM PUBLIC, anon, authenticated, service_role;

-- ── Accounts ─────────────────────────────────────────────────────────────
-- access_token_enc/refresh_token_enc are AES-GCM ciphertext (lib/social/tokenCrypto.js),
-- keyed by a dedicated Worker secret never reused from any other subsystem.
-- No RPC below ever returns these columns to a client.
CREATE TABLE IF NOT EXISTS public.social_accounts (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id             UUID        NOT NULL REFERENCES public.social_brands(id) ON DELETE CASCADE,
    network              TEXT        NOT NULL CHECK (network IN (
                             'instagram', 'facebook', 'twitter', 'linkedin', 'tiktok',
                             'youtube', 'pinterest', 'threads', 'bluesky', 'twitch', 'gmb')),
    external_account_id  TEXT        NOT NULL CHECK (char_length(external_account_id) BETWEEN 1 AND 128),
    display_name         TEXT        NULL,
    avatar_url           TEXT        NULL,
    scopes_granted       TEXT[]      NOT NULL DEFAULT '{}',
    access_token_enc     BYTEA       NOT NULL,
    refresh_token_enc    BYTEA       NULL,
    token_expires_at     TIMESTAMPTZ NULL,
    status               TEXT        NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'expired', 'revoked', 'error')),
    connected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    disconnected_at      TIMESTAMPTZ NULL,
    CONSTRAINT social_accounts_one_per_brand UNIQUE (brand_id, network, external_account_id),
    CONSTRAINT social_accounts_disconnected_pair CHECK ((status = 'revoked') = (disconnected_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS social_accounts_brand_idx ON public.social_accounts (brand_id);
ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_accounts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_accounts FROM PUBLIC, anon, authenticated, service_role;

-- ── Audit log ────────────────────────────────────────────────────────────
-- Append-only, mirrors account_actions / cinema_pass_events. actor_id is
-- NULL for system-initiated rows (e.g. a future cron token-refresh failure).
CREATE TABLE IF NOT EXISTS public.social_account_actions (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id   UUID        NULL REFERENCES public.users(id) ON DELETE SET NULL,
    -- RESTRICT, not CASCADE (matches cinema_pass_events.pass_id): an
    -- append-only audit log must never be deletable, including as a side
    -- effect of deleting its parent brand.
    brand_id   UUID        NOT NULL REFERENCES public.social_brands(id) ON DELETE RESTRICT,
    action     TEXT        NOT NULL CHECK (action ~ '^[a-z_]{1,32}$'),
    target_id  UUID        NULL,
    detail     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_account_actions_brand_idx ON public.social_account_actions (brand_id, created_at);
ALTER TABLE public.social_account_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_account_actions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_account_actions FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.social_account_actions_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'social_account_actions is append-only';
END $$;
DROP TRIGGER IF EXISTS social_account_actions_append_only ON public.social_account_actions;
CREATE TRIGGER social_account_actions_append_only
    BEFORE UPDATE OR DELETE ON public.social_account_actions
    FOR EACH ROW EXECUTE FUNCTION public.social_account_actions_append_only();

-- ── get_or_create_default_social_brand: the caller's brand, auto-created ──
-- v1 has no multi-brand UI yet; every user gets one brand on first touch.
-- {ok:true, idempotent, brand_id, label, timezone} or {ok:false, code} with
-- USER_NOT_FOUND.
CREATE OR REPLACE FUNCTION public.get_or_create_default_social_brand(p_auth_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user  UUID;
    v_brand public.social_brands%ROWTYPE;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    SELECT u.id INTO v_user FROM public.users u
    JOIN auth.users a ON a.id = p_auth_id::UUID
    WHERE u.auth_id = p_auth_id
    FOR UPDATE OF u;
    IF v_user IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;

    SELECT * INTO v_brand FROM public.social_brands b
    WHERE b.owner_user_id = v_user ORDER BY b.created_at LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object('ok', true, 'idempotent', true,
            'brand_id', v_brand.id, 'label', v_brand.label, 'timezone', v_brand.timezone);
    END IF;

    INSERT INTO public.social_brands (owner_user_id, label)
    VALUES (v_user, 'My Brand')
    RETURNING * INTO v_brand;
    RETURN jsonb_build_object('ok', true, 'idempotent', false,
        'brand_id', v_brand.id, 'label', v_brand.label, 'timezone', v_brand.timezone);
END $$;

-- ── list_social_accounts: connected accounts for one of the caller's own
-- brands. Never returns access_token_enc/refresh_token_enc. {ok:true,
-- accounts:[...]} or {ok:false, code} with USER_NOT_FOUND, BRAND_NOT_FOUND.
CREATE OR REPLACE FUNCTION public.list_social_accounts(p_auth_id TEXT, p_brand_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user UUID;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    SELECT u.id INTO v_user FROM public.users u
    JOIN auth.users a ON a.id = p_auth_id::UUID
    WHERE u.auth_id = p_auth_id;
    IF v_user IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.social_brands b WHERE b.id = p_brand_id AND b.owner_user_id = v_user) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BRAND_NOT_FOUND');
    END IF;

    RETURN jsonb_build_object('ok', true, 'accounts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', a.id, 'network', a.network, 'external_account_id', a.external_account_id,
            'display_name', a.display_name, 'avatar_url', a.avatar_url, 'status', a.status,
            'connected_at', a.connected_at, 'token_expires_at', a.token_expires_at)
            ORDER BY a.connected_at)
        FROM public.social_accounts a WHERE a.brand_id = p_brand_id
    ), '[]'::jsonb));
END $$;

-- ── record_social_account_connection: the write side of a completed OAuth
-- connect flow. Called only by server-side Worker code that already holds
-- the encrypted tokens — never by a client. Upserts on the network/external
-- id, so reconnecting the same platform account updates its tokens in
-- place. {ok:true, account_id, idempotent} or {ok:false, code} with
-- USER_NOT_FOUND, BRAND_NOT_FOUND.
CREATE OR REPLACE FUNCTION public.record_social_account_connection(
    p_auth_id TEXT,
    p_brand_id UUID,
    p_network TEXT,
    p_external_account_id TEXT,
    p_display_name TEXT,
    p_avatar_url TEXT,
    p_scopes TEXT[],
    p_access_token_enc BYTEA,
    p_refresh_token_enc BYTEA,
    p_token_expires_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user       UUID;
    v_account_id UUID;
    v_existed    BOOLEAN;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    SELECT u.id INTO v_user FROM public.users u
    JOIN auth.users a ON a.id = p_auth_id::UUID
    WHERE u.auth_id = p_auth_id;
    IF v_user IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.social_brands b WHERE b.id = p_brand_id AND b.owner_user_id = v_user) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'BRAND_NOT_FOUND');
    END IF;

    v_existed := EXISTS (
        SELECT 1 FROM public.social_accounts a
        WHERE a.brand_id = p_brand_id AND a.network = p_network AND a.external_account_id = p_external_account_id
    );

    INSERT INTO public.social_accounts (
        brand_id, network, external_account_id, display_name, avatar_url,
        scopes_granted, access_token_enc, refresh_token_enc, token_expires_at, status, disconnected_at
    ) VALUES (
        p_brand_id, p_network, p_external_account_id, p_display_name, p_avatar_url,
        COALESCE(p_scopes, '{}'), p_access_token_enc, p_refresh_token_enc, p_token_expires_at, 'active', NULL
    )
    ON CONFLICT (brand_id, network, external_account_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        avatar_url = EXCLUDED.avatar_url,
        scopes_granted = EXCLUDED.scopes_granted,
        access_token_enc = EXCLUDED.access_token_enc,
        refresh_token_enc = EXCLUDED.refresh_token_enc,
        token_expires_at = EXCLUDED.token_expires_at,
        status = 'active',
        disconnected_at = NULL
    RETURNING id INTO v_account_id;

    INSERT INTO public.social_account_actions (actor_id, brand_id, action, target_id, detail)
    VALUES (v_user, p_brand_id, CASE WHEN v_existed THEN 'reconnect' ELSE 'connect' END, v_account_id,
        jsonb_build_object('network', p_network));

    RETURN jsonb_build_object('ok', true, 'account_id', v_account_id, 'idempotent', v_existed);
END $$;

-- ── disconnect_social_account: soft-delete one of the caller's own accounts.
-- {ok:true} or {ok:false, code} with USER_NOT_FOUND, ACCOUNT_NOT_FOUND.
CREATE OR REPLACE FUNCTION public.disconnect_social_account(p_auth_id TEXT, p_account_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user    UUID;
    v_account public.social_accounts%ROWTYPE;
BEGIN
    IF p_auth_id IS NULL OR p_auth_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;
    SELECT u.id INTO v_user FROM public.users u
    JOIN auth.users a ON a.id = p_auth_id::UUID
    WHERE u.auth_id = p_auth_id;
    IF v_user IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
    END IF;

    SELECT a.* INTO v_account FROM public.social_accounts a
    JOIN public.social_brands b ON b.id = a.brand_id
    WHERE a.id = p_account_id AND b.owner_user_id = v_user
    FOR UPDATE OF a;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_NOT_FOUND');
    END IF;

    UPDATE public.social_accounts SET status = 'revoked', disconnected_at = now() WHERE id = v_account.id;
    INSERT INTO public.social_account_actions (actor_id, brand_id, action, target_id, detail)
    VALUES (v_user, v_account.brand_id, 'disconnect', v_account.id, jsonb_build_object('network', v_account.network));

    RETURN jsonb_build_object('ok', true);
END $$;

-- ── Grants ────────────────────────────────────────────────────────────────
DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.get_or_create_default_social_brand(TEXT)',
        'public.list_social_accounts(TEXT, UUID)',
        'public.record_social_account_connection(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], BYTEA, BYTEA, TIMESTAMPTZ)',
        'public.disconnect_social_account(TEXT, UUID)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
    REVOKE ALL ON FUNCTION public.social_account_actions_append_only() FROM PUBLIC, anon, authenticated;
END $$;
