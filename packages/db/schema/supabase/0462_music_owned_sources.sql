-- Private owned-audio sources with immutable, versioned rights evidence.
-- The browser may reserve bytes, but only the server can mark a source ready
-- after inspecting the stored object and measuring its playable duration.

CREATE TABLE IF NOT EXISTS public.music_rights_attestations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    scope TEXT NOT NULL CHECK (scope = 'owned_audio_source'),
    statement_version TEXT NOT NULL CHECK (statement_version = 'music-source-rights-v1'),
    claims JSONB NOT NULL CHECK (claims = '{"recording_use":true,"composition_use":true}'::jsonb),
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS music_rights_attestations_id_user_unique_idx
    ON public.music_rights_attestations(id, user_id);
CREATE INDEX IF NOT EXISTS music_rights_attestations_user_created_idx
    ON public.music_rights_attestations(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.music_source_assets (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    rights_attestation_id UUID NOT NULL,
    r2_key TEXT NOT NULL UNIQUE CHECK (r2_key ~ '^music-sources/[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp3|wav)$'),
    filename TEXT NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 180),
    mime_type TEXT NOT NULL CHECK (mime_type IN ('audio/mpeg','audio/wav')),
    size_bytes BIGINT NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
    duration_seconds NUMERIC(10,3) CHECK (duration_seconds IS NULL OR duration_seconds > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','deleting','deleted')),
    idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{8,120}$'),
    put_expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '15 minutes',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, idempotency_key),
    CONSTRAINT music_source_assets_rights_owner_fk
        FOREIGN KEY (rights_attestation_id, user_id)
        REFERENCES public.music_rights_attestations(id, user_id) ON DELETE RESTRICT,
    CHECK ((status = 'ready') = (duration_seconds IS NOT NULL) OR status IN ('deleting','deleted'))
);
CREATE INDEX IF NOT EXISTS music_source_assets_user_created_idx
    ON public.music_source_assets(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS music_source_assets_cleanup_idx
    ON public.music_source_assets(status, put_expires_at);

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['music_rights_attestations','music_source_assets'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_read', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (private.music_owns_user(user_id))', t || '_owner_read', t);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
        EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION private.music_reject_rights_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'music rights evidence is immutable'
        USING ERRCODE = 'integrity_constraint_violation';
END $$;
REVOKE ALL ON FUNCTION private.music_reject_rights_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.music_reject_rights_mutation() TO service_role;
DROP TRIGGER IF EXISTS music_rights_attestations_immutable ON public.music_rights_attestations;
CREATE TRIGGER music_rights_attestations_immutable
BEFORE UPDATE OR DELETE ON public.music_rights_attestations
FOR EACH ROW EXECUTE FUNCTION private.music_reject_rights_mutation();

CREATE OR REPLACE FUNCTION public.music_reserve_source(
    p_auth_id TEXT, p_id UUID, p_filename TEXT, p_mime_type TEXT,
    p_size BIGINT, p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user UUID; v_existing public.music_source_assets%ROWTYPE;
    v_rights UUID; v_key TEXT; v_ext TEXT; v_count INTEGER; v_bytes BIGINT;
BEGIN
    IF p_id IS NULL OR p_filename IS NULL OR char_length(btrim(p_filename)) NOT BETWEEN 1 AND 180
       OR p_mime_type NOT IN ('audio/mpeg','audio/wav') OR p_size NOT BETWEEN 1 AND 20971520
       OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id = p_auth_id FOR UPDATE;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
    SELECT * INTO v_existing FROM public.music_source_assets
    WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_existing.filename IS DISTINCT FROM btrim(p_filename)
           OR v_existing.mime_type IS DISTINCT FROM p_mime_type
           OR v_existing.size_bytes IS DISTINCT FROM p_size THEN
            RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');
        END IF;
        IF v_existing.status IN ('deleting','deleted') THEN
            RETURN jsonb_build_object('ok',false,'code','SOURCE_REMOVED');
        END IF;
        RETURN jsonb_build_object('ok',true,'id',v_existing.id,'r2_key',v_existing.r2_key,
            'status',v_existing.status,'idempotent',true);
    END IF;
    SELECT count(*), coalesce(sum(size_bytes),0) INTO v_count,v_bytes
    FROM public.music_source_assets WHERE user_id = v_user AND status <> 'deleted';
    IF v_count >= 25 OR v_bytes + p_size > 209715200 THEN
        RETURN jsonb_build_object('ok',false,'code','UPLOAD_BUDGET_EXCEEDED');
    END IF;
    INSERT INTO public.music_rights_attestations(user_id,scope,statement_version,claims)
    VALUES (v_user,'owned_audio_source','music-source-rights-v1',
        '{"recording_use":true,"composition_use":true}'::jsonb)
    RETURNING id INTO v_rights;
    v_ext := CASE p_mime_type WHEN 'audio/mpeg' THEN 'mp3' ELSE 'wav' END;
    v_key := 'music-sources/' || lower(p_auth_id) || '/' || p_id::text || '.' || v_ext;
    INSERT INTO public.music_source_assets(
        id,user_id,rights_attestation_id,r2_key,filename,mime_type,size_bytes,idempotency_key
    ) VALUES (p_id,v_user,v_rights,v_key,btrim(p_filename),p_mime_type,p_size,p_idempotency_key);
    RETURN jsonb_build_object('ok',true,'id',p_id,'r2_key',v_key,'status','pending','idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.music_read_sources(p_auth_id TEXT, p_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT jsonb_build_object('ok',true,'sources',coalesce(jsonb_agg(
        jsonb_build_object('id',s.id,'r2_key',s.r2_key,'filename',s.filename,
        'mime_type',s.mime_type,'size_bytes',s.size_bytes,'duration_seconds',s.duration_seconds,
        'status',s.status,'created_at',s.created_at,'rights_statement_version',r.statement_version)
        ORDER BY s.created_at DESC),'[]'::jsonb))
    FROM public.music_source_assets s
    JOIN public.users u ON u.id = s.user_id
    JOIN public.music_rights_attestations r ON r.id = s.rights_attestation_id AND r.user_id = s.user_id
    WHERE u.auth_id = p_auth_id AND r.revoked_at IS NULL
      AND ((p_id IS NULL AND s.status = 'ready') OR (p_id IS NOT NULL AND s.id = p_id AND s.status IN ('pending','ready')));
$$;

CREATE OR REPLACE FUNCTION public.music_complete_source(
    p_auth_id TEXT, p_id UUID, p_duration_seconds NUMERIC
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_source public.music_source_assets%ROWTYPE; v_paid BOOLEAN; v_limit INTEGER;
BEGIN
    SELECT s.* INTO v_source FROM public.music_source_assets s
    JOIN public.users u ON u.id = s.user_id
    WHERE u.auth_id = p_auth_id AND s.id = p_id FOR UPDATE OF s;
    IF NOT FOUND OR v_source.status IN ('deleting','deleted') THEN
        RETURN jsonb_build_object('ok',false,'code','SOURCE_NOT_FOUND');
    END IF;
    IF v_source.status = 'ready' THEN
        RETURN jsonb_build_object('ok',true,'id',v_source.id,'status','ready','idempotent',true);
    END IF;
    SELECT EXISTS(SELECT 1 FROM public.credit_subscriptions
        WHERE user_id = v_source.user_id AND status = 'active' AND current_period_end > now()) INTO v_paid;
    v_limit := CASE WHEN v_paid THEN 1800 ELSE 480 END;
    IF p_duration_seconds IS NULL OR p_duration_seconds <= 0 OR p_duration_seconds > v_limit THEN
        RETURN jsonb_build_object('ok',false,'code','SOURCE_DURATION_INVALID','max_seconds',v_limit);
    END IF;
    UPDATE public.music_source_assets SET status='ready', duration_seconds=p_duration_seconds, updated_at=now()
    WHERE id = p_id;
    RETURN jsonb_build_object('ok',true,'id',p_id,'status','ready','duration_seconds',p_duration_seconds,
        'max_seconds',v_limit,'idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.music_remove_source(p_auth_id TEXT, p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_source public.music_source_assets%ROWTYPE;
BEGIN
    SELECT s.* INTO v_source FROM public.music_source_assets s
    JOIN public.users u ON u.id = s.user_id
    WHERE u.auth_id = p_auth_id AND s.id = p_id FOR UPDATE OF s;
    IF NOT FOUND OR v_source.status = 'deleted' THEN
        RETURN jsonb_build_object('ok',false,'code','SOURCE_NOT_FOUND');
    END IF;
    IF v_source.status <> 'deleting' THEN
        UPDATE public.music_source_assets SET status='deleting', updated_at=now()
        WHERE id=v_source.id;
    END IF;
    RETURN jsonb_build_object('ok',true,'r2_key',v_source.r2_key,
        'idempotent',v_source.status = 'deleting');
END $$;

CREATE OR REPLACE FUNCTION public.music_finalize_source_removal(p_auth_id TEXT, p_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_source public.music_source_assets%ROWTYPE;
BEGIN
    SELECT s.* INTO v_source FROM public.music_source_assets s
    JOIN public.users u ON u.id = s.user_id
    WHERE u.auth_id = p_auth_id AND s.id = p_id FOR UPDATE OF s;
    IF NOT FOUND OR v_source.status NOT IN ('deleting','deleted') THEN
        RETURN jsonb_build_object('ok',false,'code','SOURCE_NOT_FOUND');
    END IF;
    IF v_source.status = 'deleted' THEN
        RETURN jsonb_build_object('ok',true,'idempotent',true);
    END IF;
    UPDATE public.music_source_assets SET status='deleted', updated_at=now()
    WHERE id=v_source.id;
    RETURN jsonb_build_object('ok',true,'idempotent',false);
END $$;

REVOKE ALL ON FUNCTION public.music_reserve_source(TEXT,UUID,TEXT,TEXT,BIGINT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_read_sources(TEXT,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_complete_source(TEXT,UUID,NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_remove_source(TEXT,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.music_finalize_source_removal(TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_reserve_source(TEXT,UUID,TEXT,TEXT,BIGINT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_read_sources(TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_complete_source(TEXT,UUID,NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_remove_source(TEXT,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_finalize_source_removal(TEXT,UUID) TO service_role;
