-- Music proof slice: an exact quote, one atomic two-job debit, independent
-- refunds through the existing ledger, and durable private Library rows.
--
-- This migration deliberately supports only the verified ACE-Step v1
-- instrumental contract. Custom lyrics and editing remain unavailable until
-- a provider capability has been verified and priced separately.

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.music_owns_user(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = p_user_id AND u.auth_id = auth.uid()::text
    );
$$;
REVOKE ALL ON FUNCTION private.music_owns_user(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.music_owns_user(UUID) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.music_prompt_specs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    mode TEXT NOT NULL DEFAULT 'simple' CHECK (mode = 'simple'),
    model_id TEXT NOT NULL REFERENCES public.model_catalog(id) ON DELETE RESTRICT,
    title TEXT CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 80),
    prompt TEXT NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 500),
    instrumental BOOLEAN NOT NULL DEFAULT true CHECK (instrumental),
    schema_version TEXT NOT NULL DEFAULT 'music-simple-v1' CHECK (schema_version = 'music-simple-v1'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS music_prompt_specs_user_created_idx
    ON public.music_prompt_specs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.music_generation_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    prompt_spec_id UUID NOT NULL REFERENCES public.music_prompt_specs(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL REFERENCES public.model_catalog(id) ON DELETE RESTRICT,
    provider_endpoint TEXT NOT NULL CHECK (provider_endpoint = 'fal-ai/ace-step'),
    unit_credits INTEGER NOT NULL CHECK (unit_credits > 0),
    output_count SMALLINT NOT NULL DEFAULT 2 CHECK (output_count = 2),
    total_credits INTEGER NOT NULL CHECK (total_credits = unit_credits * output_count),
    catalog_updated_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at),
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS music_generation_quotes_user_created_idx
    ON public.music_generation_quotes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS music_generation_quotes_expiry_idx
    ON public.music_generation_quotes(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.music_generation_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    quote_id UUID NOT NULL UNIQUE REFERENCES public.music_generation_quotes(id) ON DELETE RESTRICT,
    prompt_spec_id UUID NOT NULL REFERENCES public.music_prompt_specs(id) ON DELETE RESTRICT,
    model_id TEXT NOT NULL REFERENCES public.model_catalog(id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{8,128}$'),
    status TEXT NOT NULL DEFAULT 'debited'
        CHECK (status IN ('debited','running','partial','succeeded','failed','refunded')),
    credit_quote INTEGER NOT NULL CHECK (credit_quote > 0),
    output_count SMALLINT NOT NULL DEFAULT 2 CHECK (output_count = 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS music_generation_requests_user_created_idx
    ON public.music_generation_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS music_generation_requests_active_idx
    ON public.music_generation_requests(status, updated_at)
    WHERE status IN ('debited','running');

CREATE TABLE IF NOT EXISTS public.music_songs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
    current_version_id UUID,
    visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','link_only')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','trashed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS music_songs_user_created_idx
    ON public.music_songs(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.music_song_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    song_id UUID NOT NULL REFERENCES public.music_songs(id) ON DELETE CASCADE,
    generation_request_id UUID NOT NULL REFERENCES public.music_generation_requests(id) ON DELETE RESTRICT,
    job_id UUID NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE RESTRICT,
    audio_asset_id UUID NOT NULL UNIQUE REFERENCES public.assets(id) ON DELETE RESTRICT,
    version_number INTEGER NOT NULL DEFAULT 1 CHECK (version_number > 0),
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(song_id, version_number)
);
CREATE INDEX IF NOT EXISTS music_song_versions_user_created_idx
    ON public.music_song_versions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS music_song_versions_request_idx
    ON public.music_song_versions(generation_request_id);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'music_songs_current_version_fk') THEN
        ALTER TABLE public.music_songs ADD CONSTRAINT music_songs_current_version_fk
            FOREIGN KEY (current_version_id) REFERENCES public.music_song_versions(id) ON DELETE RESTRICT;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.music_generation_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    generation_request_id UUID NOT NULL REFERENCES public.music_generation_requests(id) ON DELETE CASCADE,
    ordinal SMALLINT NOT NULL CHECK (ordinal IN (1,2)),
    job_id UUID NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE RESTRICT,
    song_id UUID REFERENCES public.music_songs(id) ON DELETE RESTRICT,
    song_version_id UUID UNIQUE REFERENCES public.music_song_versions(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','running','ready','failed','refunded')),
    failure_code TEXT CHECK (failure_code IS NULL OR char_length(failure_code) <= 128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(generation_request_id, ordinal),
    CHECK ((status = 'ready') = (song_id IS NOT NULL AND song_version_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS music_generation_candidates_request_idx
    ON public.music_generation_candidates(generation_request_id, ordinal);
CREATE INDEX IF NOT EXISTS music_generation_candidates_user_status_idx
    ON public.music_generation_candidates(user_id, status, created_at DESC);

-- Browser sessions may read only their own rows through RLS. All mutation is
-- service-role-only through the RPCs below.
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'music_prompt_specs','music_generation_quotes','music_generation_requests',
        'music_generation_candidates','music_songs','music_song_versions'
    ] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_read', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (private.music_owns_user(user_id))', t || '_owner_read', t);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
        EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.music_create_quote(
    p_auth_id TEXT,
    p_prompt TEXT,
    p_title TEXT DEFAULT NULL,
    p_model_id TEXT DEFAULT 'ace-step'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID;
    v_model public.model_catalog%ROWTYPE;
    v_prompt UUID;
    v_quote public.music_generation_quotes%ROWTYPE;
    v_balance INTEGER;
BEGIN
    IF p_prompt IS NULL OR char_length(btrim(p_prompt)) NOT BETWEEN 1 AND 500
       OR (p_title IS NOT NULL AND char_length(btrim(p_title)) NOT BETWEEN 1 AND 80)
       OR p_model_id IS DISTINCT FROM 'ace-step' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;
    IF (SELECT count(*) FROM public.music_generation_quotes
        WHERE user_id = v_user AND created_at > now() - interval '60 seconds') >= 20 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED', 'retry_after_seconds', 60);
    END IF;

    SELECT * INTO v_model FROM public.model_catalog WHERE id = p_model_id;
    IF NOT FOUND OR NOT v_model.active OR v_model.gated_flag OR v_model.provider <> 'fal'
       OR v_model.modality <> 'text-to-audio' OR v_model.provider_endpoint <> 'fal-ai/ace-step'
       OR v_model.credits_5s IS NULL OR v_model.credits_5s <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'MODEL_UNAVAILABLE');
    END IF;

    SELECT balance - CASE WHEN subscription_expires_at > now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id = v_user;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NO_BALANCE_ROW'); END IF;

    INSERT INTO public.music_prompt_specs(user_id, model_id, title, prompt)
    VALUES (v_user, v_model.id, NULLIF(btrim(p_title), ''), btrim(p_prompt)) RETURNING id INTO v_prompt;
    INSERT INTO public.music_generation_quotes(
        user_id, prompt_spec_id, model_id, provider_endpoint, unit_credits,
        total_credits, catalog_updated_at, expires_at
    ) VALUES (
        v_user, v_prompt, v_model.id, v_model.provider_endpoint, v_model.credits_5s,
        v_model.credits_5s * 2, v_model.updated_at, now() + interval '5 minutes'
    ) RETURNING * INTO v_quote;
    RETURN jsonb_build_object('ok', true, 'quote_id', v_quote.id, 'model_id', v_quote.model_id,
        'unit_credits', v_quote.unit_credits, 'total_credits', v_quote.total_credits,
        'balance', v_balance, 'balance_after', v_balance - v_quote.total_credits,
        'affordable', v_balance >= v_quote.total_credits,
        'expires_at', v_quote.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.music_submit_pair(
    p_auth_id TEXT,
    p_quote_id UUID,
    p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID;
    v_balance INTEGER;
    v_recent INTEGER;
    v_quote public.music_generation_quotes%ROWTYPE;
    v_prompt public.music_prompt_specs%ROWTYPE;
    v_model public.model_catalog%ROWTYPE;
    v_request public.music_generation_requests%ROWTYPE;
    v_existing public.music_generation_requests%ROWTYPE;
    v_one JSONB;
    v_two JSONB;
    v_job_one UUID;
    v_job_two UUID;
    v_failure JSONB;
    v_payload JSONB;
BEGIN
    IF p_quote_id IS NULL OR p_idempotency_key IS NULL
       OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); END IF;

    SELECT * INTO v_existing FROM public.music_generation_requests
    WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_existing.quote_id IS DISTINCT FROM p_quote_id THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
        END IF;
        SELECT COALESCE(jsonb_agg(c.job_id ORDER BY c.ordinal), '[]'::jsonb)
        INTO v_payload FROM public.music_generation_candidates c
        WHERE c.generation_request_id = v_existing.id;
        SELECT balance - CASE WHEN subscription_expires_at > now() THEN 0 ELSE subscription_balance END
        INTO v_balance FROM public.credit_balances WHERE user_id = v_user;
        RETURN jsonb_build_object('ok', true, 'request_id', v_existing.id, 'state', v_existing.status,
            'job_ids', v_payload, 'balance_after', v_balance, 'idempotent', true);
    END IF;

    -- The balance row is the platform-wide money serialization boundary.
    SELECT balance - CASE WHEN subscription_expires_at > now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id = v_user FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NO_BALANCE_ROW'); END IF;
    IF EXISTS (SELECT 1 FROM public.users WHERE id = v_user AND frozen_at IS NOT NULL) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_FROZEN');
    END IF;

    SELECT * INTO v_quote FROM public.music_generation_quotes
    WHERE id = p_quote_id AND user_id = v_user FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    IF v_quote.consumed_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'QUOTE_ALREADY_USED'); END IF;
    IF v_quote.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'code', 'QUOTE_EXPIRED'); END IF;
    SELECT * INTO v_prompt FROM public.music_prompt_specs WHERE id = v_quote.prompt_spec_id AND user_id = v_user;
    SELECT * INTO v_model FROM public.model_catalog WHERE id = v_quote.model_id FOR SHARE;
    IF NOT FOUND OR NOT v_model.active OR v_model.gated_flag OR v_model.provider <> 'fal'
       OR v_model.modality <> 'text-to-audio' OR v_model.provider_endpoint <> v_quote.provider_endpoint
       OR v_model.provider_endpoint <> 'fal-ai/ace-step' OR v_model.credits_5s <> v_quote.unit_credits
       OR v_model.updated_at IS DISTINCT FROM v_quote.catalog_updated_at THEN
        RETURN jsonb_build_object('ok', false, 'code', 'QUOTE_STALE');
    END IF;
    IF v_balance < v_quote.total_credits THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_BALANCE');
    END IF;
    SELECT count(*) INTO v_recent FROM public.jobs
    WHERE user_id = v_user AND created_at > now() - interval '60 seconds';
    IF v_recent > 8 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED', 'retry_after_seconds', 60);
    END IF;

    -- A caught exception rolls this inner block back to its savepoint. Thus a
    -- refusal by either debit cannot leave a one-job/one-charge half-pair.
    BEGIN
        INSERT INTO public.music_generation_requests(
            user_id, quote_id, prompt_spec_id, model_id, idempotency_key, credit_quote
        ) VALUES (
            v_user, v_quote.id, v_prompt.id, v_model.id, p_idempotency_key, v_quote.total_credits
        ) RETURNING * INTO v_request;

        v_one := public.ledger_debit(v_user, p_idempotency_key || '.1', v_quote.unit_credits,
            'debit:music_generation', v_model.id,
            jsonb_build_object('prompt', v_prompt.prompt, 'music_request_id', v_request.id, 'music_candidate_ordinal', 1), 0, 60);
        IF v_one->>'ok' IS DISTINCT FROM 'true' THEN
            v_failure := v_one; RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'music pair debit one refused';
        END IF;
        v_two := public.ledger_debit(v_user, p_idempotency_key || '.2', v_quote.unit_credits,
            'debit:music_generation', v_model.id,
            jsonb_build_object('prompt', v_prompt.prompt, 'music_request_id', v_request.id, 'music_candidate_ordinal', 2), 0, 60);
        IF v_two->>'ok' IS DISTINCT FROM 'true' THEN
            v_failure := v_two; RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'music pair debit two refused';
        END IF;
        v_job_one := (v_one->>'job_id')::uuid;
        v_job_two := (v_two->>'job_id')::uuid;

        INSERT INTO public.music_generation_candidates(user_id, generation_request_id, ordinal, job_id)
        VALUES (v_user, v_request.id, 1, v_job_one), (v_user, v_request.id, 2, v_job_two);
        v_payload := jsonb_build_object('tags', v_prompt.prompt, 'duration', 60);
        INSERT INTO public.fal_dispatch(job_id, endpoint, payload)
        VALUES (v_job_one, v_quote.provider_endpoint, v_payload),
               (v_job_two, v_quote.provider_endpoint, v_payload);
        UPDATE public.music_generation_quotes SET consumed_at = now() WHERE id = v_quote.id;
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        RETURN COALESCE(v_failure, jsonb_build_object('ok', false, 'code', 'PAIR_DEBIT_FAILED'));
    END;

    SELECT balance - CASE WHEN subscription_expires_at > now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id = v_user;
    RETURN jsonb_build_object('ok', true, 'request_id', v_request.id, 'state', 'debited',
        'job_ids', jsonb_build_array(v_job_one, v_job_two), 'balance_after', v_balance,
        'idempotent', false);
END $$;

-- Project one existing platform job into music state. This function is called
-- by triggers after an asset insert or terminal refund, and by reads as a
-- repair path. Non-music jobs are a cheap no-op.
CREATE OR REPLACE FUNCTION public.music_project_candidate(p_job_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_candidate public.music_generation_candidates%ROWTYPE;
    v_job public.jobs%ROWTYPE;
    v_asset public.assets%ROWTYPE;
    v_prompt public.music_prompt_specs%ROWTYPE;
    v_song UUID;
    v_version UUID;
    v_ready INTEGER;
    v_terminal INTEGER;
    v_refunded INTEGER;
    v_running INTEGER;
    v_request_status TEXT;
BEGIN
    SELECT * INTO v_candidate FROM public.music_generation_candidates WHERE job_id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'projected', false); END IF;
    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;

    IF v_job.state = 'STORED' THEN
        SELECT * INTO v_asset FROM public.assets WHERE job_id = p_job_id ORDER BY created_at LIMIT 1;
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'projected', false, 'waiting_for', 'asset'); END IF;
        IF v_candidate.song_id IS NULL THEN
            SELECT p.* INTO v_prompt FROM public.music_prompt_specs p
            JOIN public.music_generation_requests r ON r.prompt_spec_id = p.id
            WHERE r.id = v_candidate.generation_request_id;
            INSERT INTO public.music_songs(user_id, title)
            VALUES (v_candidate.user_id, COALESCE(v_prompt.title, 'Music draft ' || CASE v_candidate.ordinal WHEN 1 THEN 'A' ELSE 'B' END))
            RETURNING id INTO v_song;
            INSERT INTO public.music_song_versions(
                user_id, song_id, generation_request_id, job_id, audio_asset_id, provenance
            ) VALUES (
                v_candidate.user_id, v_song, v_candidate.generation_request_id, p_job_id, v_asset.id,
                jsonb_build_object('model_id', v_job.model_id, 'provider', v_job.provider,
                    'provider_job_id', v_job.provider_job_id, 'asset_sha256', v_asset.sha256,
                    'schema_version', 'music-simple-v1')
            ) RETURNING id INTO v_version;
            UPDATE public.music_songs SET current_version_id = v_version, updated_at = now() WHERE id = v_song;
            UPDATE public.music_generation_candidates
            SET status = 'ready', song_id = v_song, song_version_id = v_version,
                failure_code = NULL, updated_at = now()
            WHERE id = v_candidate.id;
        END IF;
    ELSIF v_job.state = 'REFUNDED' THEN
        UPDATE public.music_generation_candidates SET status = 'refunded', failure_code = v_job.error_code,
            updated_at = now() WHERE id = v_candidate.id AND status <> 'ready';
    ELSIF v_job.state = 'FAILED' THEN
        UPDATE public.music_generation_candidates SET status = 'failed', failure_code = v_job.error_code,
            updated_at = now() WHERE id = v_candidate.id AND status <> 'ready';
    ELSIF v_job.state IN ('SUBMITTED','SUCCEEDED') THEN
        UPDATE public.music_generation_candidates SET status = 'running', updated_at = now()
        WHERE id = v_candidate.id AND status = 'queued';
    END IF;

    SELECT count(*) FILTER (WHERE status = 'ready'),
           count(*) FILTER (WHERE status IN ('ready','failed','refunded')),
           count(*) FILTER (WHERE status = 'refunded'),
           count(*) FILTER (WHERE status = 'running')
    INTO v_ready, v_terminal, v_refunded, v_running
    FROM public.music_generation_candidates WHERE generation_request_id = v_candidate.generation_request_id;
    v_request_status := CASE
        WHEN v_ready = 2 THEN 'succeeded'
        WHEN v_terminal = 2 AND v_ready > 0 THEN 'partial'
        WHEN v_terminal = 2 AND v_refunded = 2 THEN 'refunded'
        WHEN v_terminal = 2 THEN 'failed'
        WHEN v_running > 0 THEN 'running'
        ELSE 'debited'
    END;
    UPDATE public.music_generation_requests SET status = v_request_status, updated_at = now()
    WHERE id = v_candidate.generation_request_id;
    RETURN jsonb_build_object('ok', true, 'projected', true, 'status', v_request_status);
END $$;

CREATE OR REPLACE FUNCTION private.music_project_asset_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    PERFORM public.music_project_candidate(NEW.job_id);
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS music_project_after_asset ON public.assets;
CREATE TRIGGER music_project_after_asset AFTER INSERT ON public.assets
FOR EACH ROW EXECUTE FUNCTION private.music_project_asset_trigger();

CREATE OR REPLACE FUNCTION private.music_project_job_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF NEW.state IN ('SUBMITTED','FAILED','REFUNDED') AND NEW.state IS DISTINCT FROM OLD.state THEN
        PERFORM public.music_project_candidate(NEW.id);
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS music_project_after_job_state ON public.jobs;
CREATE TRIGGER music_project_after_job_state AFTER UPDATE OF state ON public.jobs
FOR EACH ROW EXECUTE FUNCTION private.music_project_job_trigger();

CREATE OR REPLACE FUNCTION public.music_get_generation(p_auth_id TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_row JSONB; v_job UUID;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    FOR v_job IN SELECT job_id FROM public.music_generation_candidates
        WHERE generation_request_id = p_request_id AND user_id = v_user LOOP
        PERFORM public.music_project_candidate(v_job);
    END LOOP;
    SELECT jsonb_build_object(
        'id', r.id, 'state', r.status, 'model_id', r.model_id,
        'prompt', p.prompt, 'title', p.title, 'total_credits', r.credit_quote,
        'created_at', r.created_at,
        'candidates', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'ordinal', c.ordinal, 'label', CASE c.ordinal WHEN 1 THEN 'A' ELSE 'B' END,
            'state', c.status, 'job_id', c.job_id, 'song_id', c.song_id,
            'error_code', c.failure_code,
            'audio_url', CASE WHEN c.status = 'ready' THEN '/api/v1/jobs/' || c.job_id || '/asset' END
        ) ORDER BY c.ordinal), '[]'::jsonb) FROM public.music_generation_candidates c WHERE c.generation_request_id = r.id)
    ) INTO v_row
    FROM public.music_generation_requests r JOIN public.music_prompt_specs p ON p.id = r.prompt_spec_id
    WHERE r.id = p_request_id AND r.user_id = v_user;
    IF v_row IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    RETURN jsonb_build_object('ok', true, 'generation', v_row);
END $$;

CREATE OR REPLACE FUNCTION public.music_list_songs(p_auth_id TEXT, p_limit INTEGER DEFAULT 24)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_rows JSONB; v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit,24),1),50);
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', true, 'songs', '[]'::jsonb); END IF;
    SELECT COALESCE(jsonb_agg(x.song ORDER BY x.created_at DESC, x.id DESC), '[]'::jsonb) INTO v_rows
    FROM (
        SELECT s.id, s.created_at, jsonb_build_object(
            'id', s.id, 'title', s.title, 'visibility', s.visibility, 'created_at', s.created_at,
            'version_id', v.id, 'job_id', v.job_id,
            'audio_url', '/api/v1/jobs/' || v.job_id || '/asset'
        ) AS song
        FROM public.music_songs s JOIN public.music_song_versions v ON v.id = s.current_version_id
        WHERE s.user_id = v_user AND s.status = 'active'
        ORDER BY s.created_at DESC, s.id DESC LIMIT v_limit
    ) x;
    RETURN jsonb_build_object('ok', true, 'songs', v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.music_get_song(p_auth_id TEXT, p_song_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user UUID; v_row JSONB;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id;
    SELECT jsonb_build_object(
        'id', s.id, 'title', s.title, 'visibility', s.visibility, 'created_at', s.created_at,
        'version_id', v.id, 'job_id', v.job_id, 'generation_id', v.generation_request_id,
        'audio_url', '/api/v1/jobs/' || v.job_id || '/asset', 'provenance', v.provenance
    ) INTO v_row FROM public.music_songs s
    JOIN public.music_song_versions v ON v.id = s.current_version_id
    WHERE s.id = p_song_id AND s.user_id = v_user AND s.status = 'active';
    IF v_row IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
    RETURN jsonb_build_object('ok', true, 'song', v_row);
END $$;

DO $$
DECLARE fn TEXT;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.music_create_quote(TEXT,TEXT,TEXT,TEXT)',
        'public.music_submit_pair(TEXT,UUID,TEXT)',
        'public.music_project_candidate(UUID)',
        'public.music_get_generation(TEXT,UUID)',
        'public.music_list_songs(TEXT,INTEGER)',
        'public.music_get_song(TEXT,UUID)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
END $$;
