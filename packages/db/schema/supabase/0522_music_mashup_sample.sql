-- Mashup and "Sample this song" (Suno parity S-A1). No fal endpoint takes two
-- songs, so the Worker prepares one source from the person's own PCM WAV
-- versions and the provider transforms it:
--   mashup: two owned versions mixed at -6 dB each, up to 120 s, then
--           fal-ai/stable-audio-3/small/music/audio-to-audio (as Cover).
--   sample: one 5-30 s range of an owned version, then
--           fal-ai/stable-audio-3/small/music/audio-outpainting grows a new
--           song after it.
-- Both catalog rows are staged INACTIVE until a billed staging run records the
-- observed output and cost. The product switch (MUSIC_RUNTIME_FLAGS.remix)
-- ships false. Prices from the live fal pages on 2026-11-15: $0.0248 and
-- $0.0265 per audio, mapped to 2 credits each like Cover.

INSERT INTO public.model_catalog
    (id,name,provider,provider_endpoint,modality,credits_5s,provider_cost_per_unit,
     cost_unit,billing_seconds,gated_flag,active)
VALUES
    ('stable-audio-3-mashup','Stable Audio 3 Small Mashup','fal',
     'fal-ai/stable-audio-3/small/music/audio-to-audio','audio-to-audio',
     2,0.0248,'per_generation',NULL,false,false),
    ('stable-audio-3-sample','Stable Audio 3 Small Sample','fal',
     'fal-ai/stable-audio-3/small/music/audio-outpainting','audio-to-audio',
     2,0.0265,'per_generation',NULL,false,false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.music_prompt_specs
    ADD COLUMN IF NOT EXISTS second_source_song_id UUID,
    ADD COLUMN IF NOT EXISTS second_source_version_id UUID,
    ADD COLUMN IF NOT EXISTS sample_start_seconds NUMERIC(10,3),
    ADD COLUMN IF NOT EXISTS sample_end_seconds NUMERIC(10,3),
    ADD COLUMN IF NOT EXISTS sample_extend_seconds SMALLINT;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='music_prompt_specs_second_song_owner_fk') THEN
        ALTER TABLE public.music_prompt_specs ADD CONSTRAINT music_prompt_specs_second_song_owner_fk
            FOREIGN KEY (second_source_song_id,user_id) REFERENCES public.music_songs(id,user_id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='music_prompt_specs_second_version_owner_fk') THEN
        ALTER TABLE public.music_prompt_specs ADD CONSTRAINT music_prompt_specs_second_version_owner_fk
            FOREIGN KEY (second_source_version_id,user_id,second_source_song_id)
            REFERENCES public.music_song_versions(id,user_id,song_id) ON DELETE RESTRICT;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS music_prompt_specs_second_source_idx
    ON public.music_prompt_specs(second_source_song_id) WHERE second_source_song_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS music_prompt_specs_second_version_idx
    ON public.music_prompt_specs(second_source_version_id) WHERE second_source_version_id IS NOT NULL;

ALTER TABLE public.music_prompt_specs
    DROP CONSTRAINT IF EXISTS music_prompt_specs_mode_check,
    DROP CONSTRAINT IF EXISTS music_prompt_specs_schema_version_check,
    DROP CONSTRAINT IF EXISTS music_prompt_specs_remix_columns_check,
    DROP CONSTRAINT IF EXISTS music_prompt_specs_mode_shape_check;
ALTER TABLE public.music_prompt_specs
    ADD CONSTRAINT music_prompt_specs_mode_check CHECK (mode IN
        ('simple','custom','cover','extend','replace_section','add_section','mashup','sample')),
    ADD CONSTRAINT music_prompt_specs_schema_version_check CHECK (schema_version IN
        ('music-simple-v1','music-custom-v1','music-cover-v1','music-extend-v1',
         'music-replace-section-v1','music-add-section-v1','music-mashup-v1','music-sample-v1')),
    -- Every earlier mode leaves the new columns empty.
    ADD CONSTRAINT music_prompt_specs_remix_columns_check CHECK (
        mode IN ('mashup','sample') OR (second_source_song_id IS NULL
            AND second_source_version_id IS NULL AND sample_start_seconds IS NULL
            AND sample_end_seconds IS NULL AND sample_extend_seconds IS NULL)),
    -- The first six branches are 0487's shape, unchanged.
    ADD CONSTRAINT music_prompt_specs_mode_shape_check CHECK (
        ((mode = 'simple'::text) AND instrumental AND (lyrics IS NULL) AND (styles IS NULL) AND (draft_revision IS NULL) AND (lyrics_rights_version IS NULL) AND (source_song_id IS NULL) AND (source_version_id IS NULL) AND (source_duration_seconds IS NULL) AND (source_influence IS NULL) AND (source_rights_version IS NULL) AND (extend_seconds_after IS NULL) AND (replace_start_seconds IS NULL) AND (replace_end_seconds IS NULL) AND (section_position IS NULL) AND (section_duration_seconds IS NULL) AND (schema_version = 'music-simple-v1'::text))
        OR ((mode = 'custom'::text) AND (model_id = 'ace-step-1.5'::text) AND (styles IS NOT NULL) AND (draft_revision IS NOT NULL) AND (source_song_id IS NULL) AND (source_version_id IS NULL) AND (source_duration_seconds IS NULL) AND (source_influence IS NULL) AND (source_rights_version IS NULL) AND (extend_seconds_after IS NULL) AND (replace_start_seconds IS NULL) AND (replace_end_seconds IS NULL) AND (section_position IS NULL) AND (section_duration_seconds IS NULL) AND (schema_version = 'music-custom-v1'::text) AND ((instrumental AND (lyrics IS NULL) AND (lyrics_rights_version IS NULL)) OR ((NOT instrumental) AND (lyrics IS NOT NULL) AND (lyrics_rights_version = 'music-lyrics-rights-v1'::text))))
        OR ((mode = 'cover'::text) AND (model_id = 'stable-audio-3-cover'::text) AND instrumental AND (lyrics IS NULL) AND (styles IS NULL) AND (draft_revision IS NULL) AND (lyrics_rights_version IS NULL) AND (source_song_id IS NOT NULL) AND (source_version_id IS NOT NULL) AND (source_duration_seconds IS NOT NULL) AND (source_influence IS NOT NULL) AND (source_rights_version = 'music-cover-source-rights-v1'::text) AND (extend_seconds_after IS NULL) AND (replace_start_seconds IS NULL) AND (replace_end_seconds IS NULL) AND (section_position IS NULL) AND (section_duration_seconds IS NULL) AND (schema_version = 'music-cover-v1'::text))
        OR ((mode = 'extend'::text) AND (model_id = 'ace-step-extend'::text) AND instrumental AND (lyrics IS NULL) AND (styles IS NULL) AND (draft_revision IS NULL) AND (lyrics_rights_version IS NULL) AND (source_song_id IS NOT NULL) AND (source_version_id IS NOT NULL) AND (source_duration_seconds IS NOT NULL) AND (source_influence IS NULL) AND (source_rights_version = 'music-extend-source-rights-v1'::text) AND (extend_seconds_after = 30) AND (replace_start_seconds IS NULL) AND (replace_end_seconds IS NULL) AND (section_position IS NULL) AND (section_duration_seconds IS NULL) AND (schema_version = 'music-extend-v1'::text))
        OR ((mode = 'replace_section'::text) AND (model_id = 'ace-step-replace-section'::text) AND instrumental AND (lyrics IS NULL) AND (styles IS NULL) AND (draft_revision IS NULL) AND (lyrics_rights_version IS NULL) AND (source_song_id IS NOT NULL) AND (source_version_id IS NOT NULL) AND ((source_duration_seconds >= (1)::numeric) AND (source_duration_seconds <= (60)::numeric)) AND (source_influence IS NULL) AND (source_rights_version = 'music-replace-source-rights-v1'::text) AND (extend_seconds_after IS NULL) AND (replace_start_seconds IS NOT NULL) AND (replace_end_seconds IS NOT NULL) AND (replace_end_seconds <= source_duration_seconds) AND (section_position IS NULL) AND (section_duration_seconds IS NULL) AND (schema_version = 'music-replace-section-v1'::text))
        OR ((mode = 'add_section'::text) AND (model_id = 'ace-step-add-section'::text) AND (styles IS NOT NULL) AND (draft_revision IS NULL) AND (source_song_id IS NOT NULL) AND (source_version_id IS NOT NULL) AND ((source_duration_seconds >= (1)::numeric) AND (source_duration_seconds <= (120)::numeric)) AND (source_influence IS NULL) AND (source_rights_version = 'music-add-section-source-rights-v1'::text) AND (extend_seconds_after IS NULL) AND (replace_start_seconds IS NULL) AND (replace_end_seconds IS NULL) AND (section_position = ANY (ARRAY['beginning'::text, 'end'::text])) AND (section_duration_seconds = ANY (ARRAY[10, 20, 30])) AND (schema_version = 'music-add-section-v1'::text) AND ((instrumental AND (lyrics IS NULL) AND (lyrics_rights_version IS NULL)) OR ((NOT instrumental) AND (lyrics IS NOT NULL) AND (lyrics_rights_version = 'music-lyrics-rights-v1'::text))))
        OR (mode='mashup' AND model_id='stable-audio-3-mashup' AND instrumental
            AND lyrics IS NULL AND styles IS NULL AND draft_revision IS NULL AND lyrics_rights_version IS NULL
            AND source_song_id IS NOT NULL AND source_version_id IS NOT NULL
            AND second_source_song_id IS NOT NULL AND second_source_version_id IS NOT NULL
            AND second_source_song_id<>source_song_id
            AND source_duration_seconds BETWEEN 5 AND 120 AND source_influence IS NOT NULL
            AND source_rights_version='music-mashup-source-rights-v1'
            AND extend_seconds_after IS NULL AND replace_start_seconds IS NULL AND replace_end_seconds IS NULL
            AND section_position IS NULL AND section_duration_seconds IS NULL
            AND sample_start_seconds IS NULL AND sample_end_seconds IS NULL AND sample_extend_seconds IS NULL
            AND schema_version='music-mashup-v1')
        OR (mode='sample' AND model_id='stable-audio-3-sample' AND instrumental
            AND lyrics IS NULL AND styles IS NULL AND draft_revision IS NULL AND lyrics_rights_version IS NULL
            AND source_song_id IS NOT NULL AND source_version_id IS NOT NULL
            AND second_source_song_id IS NULL AND second_source_version_id IS NULL
            AND source_influence IS NULL AND source_rights_version='music-sample-source-rights-v1'
            AND sample_start_seconds >= 0 AND sample_end_seconds > sample_start_seconds
            AND sample_end_seconds-sample_start_seconds BETWEEN 5 AND 30
            AND source_duration_seconds=sample_end_seconds-sample_start_seconds
            AND sample_extend_seconds BETWEEN 10 AND 90
            AND extend_seconds_after IS NULL AND replace_start_seconds IS NULL AND replace_end_seconds IS NULL
            AND section_position IS NULL AND section_duration_seconds IS NULL
            AND schema_version='music-sample-v1')
    );

ALTER TABLE public.music_generation_quotes
    DROP CONSTRAINT IF EXISTS music_generation_quotes_provider_endpoint_check;
ALTER TABLE public.music_generation_quotes
    ADD CONSTRAINT music_generation_quotes_provider_endpoint_check CHECK (provider_endpoint IN (
        'fal-ai/ace-step','fal-ai/ace-step-1.5','fal-ai/stable-audio-3/small/music/audio-to-audio',
        'fal-ai/ace-step/audio-outpaint','fal-ai/ace-step/audio-inpaint',
        'fal-ai/stable-audio-3/small/music/audio-outpainting'));

ALTER TABLE public.music_song_versions
    DROP CONSTRAINT IF EXISTS music_song_versions_operation_check;
ALTER TABLE public.music_song_versions
    ADD CONSTRAINT music_song_versions_operation_check CHECK (operation IN (
        'generation','cover','extend','speed','fade','reorder','reuse','crop',
        'replace_section','add_section','remaster','lyric_edit','mashup','sample'));

-- The Worker-prepared source sent to the provider. It is not a song version;
-- the row is the deletion handle and the key is queued for reaping once the
-- pair settles.
CREATE TABLE IF NOT EXISTS public.music_remix_sources (
    generation_request_id UUID PRIMARY KEY REFERENCES public.music_generation_requests(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    r2_key TEXT NOT NULL UNIQUE CHECK (r2_key ~ '^music-remix-sources/[0-9a-f-]{36}/[0-9a-f-]{36}\.wav$'),
    duration_seconds NUMERIC(10,3) NOT NULL CHECK (duration_seconds BETWEEN 5 AND 120),
    reap_queued_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS music_remix_sources_user_idx ON public.music_remix_sources(user_id);
ALTER TABLE public.music_remix_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_remix_sources FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.music_remix_sources FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.music_remix_sources TO service_role;
DROP POLICY IF EXISTS music_remix_sources_service_all ON public.music_remix_sources;
CREATE POLICY music_remix_sources_service_all ON public.music_remix_sources
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Erasure (ADR-0111): the prepared mix of an erased account is reaped at once.
CREATE OR REPLACE FUNCTION private.music_remix_sources_forget_erased()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        INSERT INTO public.asset_reap_queue(r2_key)
        SELECT r2_key FROM public.music_remix_sources WHERE user_id=NEW.id
        ON CONFLICT (r2_key) DO NOTHING;
        DELETE FROM public.music_remix_sources WHERE user_id=NEW.id;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.music_remix_sources_forget_erased() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS users_music_remix_sources_forget_erased ON public.users;
CREATE TRIGGER users_music_remix_sources_forget_erased AFTER UPDATE OF deleted_at ON public.users
    FOR EACH ROW EXECUTE FUNCTION private.music_remix_sources_forget_erased();

-- One owned, active, current PCM WAV version (two for a mashup).
CREATE OR REPLACE FUNCTION public.music_get_remix_source_context(
    p_auth_id TEXT,p_song_id UUID,p_version_id UUID,p_second_song_id UUID,p_second_version_id UUID
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_one JSONB; v_two JSONB;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF (p_second_song_id IS NULL) <> (p_second_version_id IS NULL) OR p_second_song_id=p_song_id THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
    END IF;
    SELECT jsonb_build_object('r2_key',a.r2_key,'mime_type',a.mime_type,'size_bytes',a.size_bytes,'title',s.title)
    INTO v_one FROM public.music_songs s
    JOIN public.music_song_versions v ON v.id=p_version_id AND v.user_id=v_user AND v.song_id=s.id
    JOIN public.assets a ON a.id=v.audio_asset_id
    WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active' AND s.current_version_id=p_version_id;
    IF v_one IS NULL THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); END IF;
    IF p_second_song_id IS NOT NULL THEN
        SELECT jsonb_build_object('r2_key',a.r2_key,'mime_type',a.mime_type,'size_bytes',a.size_bytes,'title',s.title)
        INTO v_two FROM public.music_songs s
        JOIN public.music_song_versions v ON v.id=p_second_version_id AND v.user_id=v_user AND v.song_id=s.id
        JOIN public.assets a ON a.id=v.audio_asset_id
        WHERE s.id=p_second_song_id AND s.user_id=v_user AND s.status='active'
          AND s.current_version_id=p_second_version_id;
        IF v_two IS NULL THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); END IF;
    END IF;
    IF v_one->>'mime_type'<>'audio/wav' OR (v_two IS NOT NULL AND v_two->>'mime_type'<>'audio/wav') THEN
        RETURN jsonb_build_object('ok',false,'code','FORMAT_UNAVAILABLE');
    END IF;
    RETURN jsonb_build_object('ok',true,'user_id',v_user,'sources',
        CASE WHEN v_two IS NULL THEN jsonb_build_array(v_one) ELSE jsonb_build_array(v_one,v_two) END);
END $$;

CREATE OR REPLACE FUNCTION public.music_create_remix_quote(
    p_auth_id TEXT,p_kind TEXT,p_song_id UUID,p_version_id UUID,
    p_second_song_id UUID,p_second_version_id UUID,p_prompt TEXT,p_source_influence INTEGER,
    p_sample_start NUMERIC,p_sample_end NUMERIC,p_sample_extend INTEGER,
    p_rights_confirmed BOOLEAN,p_source_duration_seconds NUMERIC
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    v_user UUID; v_model public.model_catalog%ROWTYPE; v_title TEXT; v_second TEXT;
    v_prompt UUID; v_quote public.music_generation_quotes%ROWTYPE; v_balance INTEGER;
    v_model_id TEXT; v_endpoint TEXT; v_cost NUMERIC;
BEGIN
    IF p_kind NOT IN ('mashup','sample') OR p_song_id IS NULL OR p_version_id IS NULL
       OR p_rights_confirmed IS DISTINCT FROM true
       OR p_prompt IS NULL OR char_length(btrim(p_prompt)) NOT BETWEEN 1 AND 500 THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
    END IF;
    IF p_kind='mashup' AND (p_second_song_id IS NULL OR p_second_version_id IS NULL
        OR p_second_song_id=p_song_id OR p_source_influence IS NULL
        OR p_source_influence NOT BETWEEN 10 AND 90
        OR p_source_duration_seconds IS NULL OR p_source_duration_seconds NOT BETWEEN 5 AND 120
        OR p_sample_start IS NOT NULL OR p_sample_end IS NOT NULL OR p_sample_extend IS NOT NULL) THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
    END IF;
    IF p_kind='sample' AND (p_second_song_id IS NOT NULL OR p_second_version_id IS NOT NULL
        OR p_source_influence IS NOT NULL OR p_sample_start IS NULL OR p_sample_end IS NULL
        OR p_sample_start<0 OR p_sample_end-p_sample_start NOT BETWEEN 5 AND 30
        OR p_sample_end>p_source_duration_seconds+0.001
        OR p_sample_extend IS NULL OR p_sample_extend NOT BETWEEN 10 AND 90) THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
    IF NOT private.music_paid_plan_active(v_user) THEN
        RETURN jsonb_build_object('ok',false,'code','PLAN_UNAVAILABLE');
    END IF;
    SELECT s.title INTO v_title FROM public.music_songs s
    JOIN public.music_song_versions v ON v.id=p_version_id AND v.user_id=v_user AND v.song_id=s.id
    WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active'
      AND s.current_version_id=p_version_id FOR SHARE OF s,v;
    IF v_title IS NULL THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); END IF;
    IF p_kind='mashup' THEN
        SELECT s.title INTO v_second FROM public.music_songs s
        JOIN public.music_song_versions v ON v.id=p_second_version_id AND v.user_id=v_user AND v.song_id=s.id
        WHERE s.id=p_second_song_id AND s.user_id=v_user AND s.status='active'
          AND s.current_version_id=p_second_version_id FOR SHARE OF s,v;
        IF v_second IS NULL THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); END IF;
    END IF;
    IF (SELECT count(*) FROM public.music_generation_quotes
        WHERE user_id=v_user AND created_at>now()-interval '60 seconds')>=20 THEN
        RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','retry_after_seconds',60);
    END IF;
    v_model_id:=CASE p_kind WHEN 'mashup' THEN 'stable-audio-3-mashup' ELSE 'stable-audio-3-sample' END;
    v_endpoint:=CASE p_kind WHEN 'mashup' THEN 'fal-ai/stable-audio-3/small/music/audio-to-audio'
        ELSE 'fal-ai/stable-audio-3/small/music/audio-outpainting' END;
    v_cost:=CASE p_kind WHEN 'mashup' THEN 0.0248 ELSE 0.0265 END;
    SELECT * INTO v_model FROM public.model_catalog WHERE id=v_model_id;
    IF NOT FOUND OR NOT v_model.active OR v_model.gated_flag OR v_model.provider<>'fal'
       OR v_model.modality<>'audio-to-audio' OR v_model.provider_endpoint<>v_endpoint
       OR v_model.credits_5s<>2 OR v_model.provider_cost_per_unit<>v_cost
       OR v_model.cost_unit<>'per_generation' OR v_model.billing_seconds IS NOT NULL THEN
        RETURN jsonb_build_object('ok',false,'code','MODEL_UNAVAILABLE');
    END IF;
    SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NO_BALANCE_ROW'); END IF;
    INSERT INTO public.music_prompt_specs(user_id,mode,model_id,title,prompt,instrumental,
        schema_version,source_song_id,source_version_id,source_duration_seconds,source_influence,
        source_rights_version,second_source_song_id,second_source_version_id,
        sample_start_seconds,sample_end_seconds,sample_extend_seconds)
    VALUES(v_user,p_kind,v_model.id,
        left(CASE p_kind WHEN 'mashup' THEN v_title||' × '||v_second ELSE v_title||' (sampled)' END,80),
        btrim(p_prompt),true,'music-'||p_kind||'-v1',p_song_id,p_version_id,
        CASE p_kind WHEN 'mashup' THEN p_source_duration_seconds ELSE p_sample_end-p_sample_start END,
        CASE p_kind WHEN 'mashup' THEN p_source_influence END,
        'music-'||p_kind||'-source-rights-v1',
        CASE p_kind WHEN 'mashup' THEN p_second_song_id END,
        CASE p_kind WHEN 'mashup' THEN p_second_version_id END,
        CASE p_kind WHEN 'sample' THEN p_sample_start END,
        CASE p_kind WHEN 'sample' THEN p_sample_end END,
        CASE p_kind WHEN 'sample' THEN p_sample_extend END)
    RETURNING id INTO v_prompt;
    INSERT INTO public.music_generation_quotes(user_id,prompt_spec_id,model_id,provider_endpoint,
        unit_credits,total_credits,catalog_updated_at,expires_at)
    VALUES(v_user,v_prompt,v_model.id,v_model.provider_endpoint,v_model.credits_5s,
        v_model.credits_5s*2,v_model.updated_at,now()+interval '5 minutes')
    RETURNING * INTO v_quote;
    RETURN jsonb_build_object('ok',true,'quote_id',v_quote.id,'model_id',v_quote.model_id,'kind',p_kind,
        'unit_credits',v_quote.unit_credits,'total_credits',v_quote.total_credits,
        'balance',v_balance,'balance_after',v_balance-v_quote.total_credits,
        'affordable',v_balance>=v_quote.total_credits,'expires_at',v_quote.expires_at,
        'source_duration_seconds',CASE p_kind WHEN 'mashup' THEN p_source_duration_seconds
            ELSE p_sample_end-p_sample_start END);
END $$;

CREATE OR REPLACE FUNCTION public.music_get_remix_dispatch_context(
    p_auth_id TEXT,p_song_id UUID,p_quote_id UUID,p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
    v_user UUID; v_prompt public.music_prompt_specs%ROWTYPE;
    v_request public.music_generation_requests%ROWTYPE; v_jobs JSONB; v_balance INTEGER;
    v_sources JSONB; v_expected INTEGER;
BEGIN
    IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    SELECT * INTO v_request FROM public.music_generation_requests
    WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
    IF FOUND THEN
        IF v_request.quote_id IS DISTINCT FROM p_quote_id THEN
            RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');
        END IF;
        SELECT COALESCE(jsonb_agg(job_id ORDER BY ordinal),'[]'::jsonb) INTO v_jobs
        FROM public.music_generation_candidates WHERE generation_request_id=v_request.id;
        SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END
        INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
        RETURN jsonb_build_object('ok',true,'idempotent',true,'request_id',v_request.id,
            'state',v_request.status,'job_ids',v_jobs,'balance_after',v_balance);
    END IF;
    SELECT ps.* INTO v_prompt FROM public.music_generation_quotes q
    JOIN public.music_prompt_specs ps ON ps.id=q.prompt_spec_id AND ps.user_id=q.user_id
    WHERE q.id=p_quote_id AND q.user_id=v_user AND ps.mode IN ('mashup','sample')
      AND ps.source_song_id=p_song_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    SELECT jsonb_agg(jsonb_build_object('r2_key',a.r2_key,'mime_type',a.mime_type,'size_bytes',a.size_bytes)
        ORDER BY x.ordinal)
    INTO v_sources
    FROM (VALUES (1,v_prompt.source_song_id,v_prompt.source_version_id),
                 (2,v_prompt.second_source_song_id,v_prompt.second_source_version_id)) AS x(ordinal,song_id,version_id)
    JOIN public.music_songs s ON s.id=x.song_id AND s.user_id=v_user AND s.status='active'
        AND s.current_version_id=x.version_id
    JOIN public.music_song_versions v ON v.id=x.version_id AND v.user_id=v_user AND v.song_id=s.id
    JOIN public.assets a ON a.id=v.audio_asset_id AND a.mime_type='audio/wav';
    v_expected:=CASE v_prompt.mode WHEN 'mashup' THEN 2 ELSE 1 END;
    IF jsonb_array_length(COALESCE(v_sources,'[]'::jsonb))<>v_expected THEN
        RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT');
    END IF;
    RETURN jsonb_build_object('ok',true,'idempotent',false,'user_id',v_user,'kind',v_prompt.mode,
        'sources',v_sources,'source_duration_seconds',v_prompt.source_duration_seconds,
        'sample_start_seconds',v_prompt.sample_start_seconds,'sample_end_seconds',v_prompt.sample_end_seconds);
END $$;

CREATE OR REPLACE FUNCTION public.music_submit_remix_pair(
    p_auth_id TEXT,p_song_id UUID,p_quote_id UUID,p_idempotency_key TEXT,
    p_prepared_r2_key TEXT,p_prepared_audio_url TEXT,p_prepared_seconds NUMERIC
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    v_user UUID; v_balance INTEGER; v_active INTEGER; v_recent INTEGER;
    v_quote public.music_generation_quotes%ROWTYPE; v_prompt public.music_prompt_specs%ROWTYPE;
    v_model public.model_catalog%ROWTYPE; v_request public.music_generation_requests%ROWTYPE;
    v_existing public.music_generation_requests%ROWTYPE; v_one JSONB; v_two JSONB;
    v_job_one UUID; v_job_two UUID; v_failure JSONB; v_jobs JSONB; v_payload JSONB;
BEGIN
    IF p_song_id IS NULL OR p_quote_id IS NULL OR p_idempotency_key IS NULL
       OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$'
       OR p_prepared_r2_key IS NULL
       OR p_prepared_r2_key !~ '^music-remix-sources/[0-9a-f-]{36}/[0-9a-f-]{36}\.wav$'
       OR p_prepared_audio_url IS NULL OR length(p_prepared_audio_url)>2008
       OR p_prepared_audio_url !~ '^https://[^[:space:]]+$'
       OR p_prepared_seconds IS NULL OR p_prepared_seconds NOT BETWEEN 5 AND 120 THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id AND deleted_at IS NULL FOR UPDATE;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); END IF;
    IF split_part(p_prepared_r2_key,'/',2)<>v_user::text THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
    END IF;
    SELECT * INTO v_existing FROM public.music_generation_requests
    WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
    IF FOUND THEN
        IF v_existing.quote_id IS DISTINCT FROM p_quote_id THEN
            RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');
        END IF;
        SELECT COALESCE(jsonb_agg(job_id ORDER BY ordinal),'[]'::jsonb) INTO v_jobs
        FROM public.music_generation_candidates WHERE generation_request_id=v_existing.id;
        SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END
        INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
        RETURN jsonb_build_object('ok',true,'request_id',v_existing.id,'state',v_existing.status,
            'job_ids',v_jobs,'balance_after',v_balance,'idempotent',true);
    END IF;
    SELECT count(*) INTO v_active FROM public.music_generation_requests
    WHERE user_id=v_user AND status IN ('debited','running');
    IF v_active>=4 THEN RETURN jsonb_build_object('ok',false,'code','CONCURRENCY_LIMIT'); END IF;
    SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id=v_user FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NO_BALANCE_ROW'); END IF;
    IF EXISTS(SELECT 1 FROM public.users WHERE id=v_user AND frozen_at IS NOT NULL) THEN
        RETURN jsonb_build_object('ok',false,'code','ACCOUNT_FROZEN');
    END IF;
    SELECT * INTO v_quote FROM public.music_generation_quotes
    WHERE id=p_quote_id AND user_id=v_user FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF v_quote.consumed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_ALREADY_USED'); END IF;
    IF v_quote.expires_at<=now() THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_EXPIRED'); END IF;
    IF NOT private.music_paid_plan_active(v_user) THEN RETURN jsonb_build_object('ok',false,'code','PLAN_UNAVAILABLE'); END IF;
    SELECT * INTO v_prompt FROM public.music_prompt_specs
    WHERE id=v_quote.prompt_spec_id AND user_id=v_user AND mode IN ('mashup','sample')
      AND source_song_id=p_song_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','QUOTE_STALE'); END IF;
    IF abs(p_prepared_seconds-v_prompt.source_duration_seconds)>0.1 THEN
        RETURN jsonb_build_object('ok',false,'code','SOURCE_CHANGED');
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.music_songs s WHERE s.id=p_song_id AND s.user_id=v_user
        AND s.status='active' AND s.current_version_id=v_prompt.source_version_id FOR SHARE)
       OR (v_prompt.mode='mashup' AND NOT EXISTS(SELECT 1 FROM public.music_songs s
        WHERE s.id=v_prompt.second_source_song_id AND s.user_id=v_user AND s.status='active'
          AND s.current_version_id=v_prompt.second_source_version_id FOR SHARE)) THEN
        RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT');
    END IF;
    SELECT * INTO v_model FROM public.model_catalog WHERE id=v_quote.model_id FOR SHARE;
    IF NOT FOUND OR NOT v_model.active OR v_model.gated_flag OR v_model.provider<>'fal'
       OR v_model.modality<>'audio-to-audio' OR v_model.id<>v_prompt.model_id
       OR v_model.id NOT IN ('stable-audio-3-mashup','stable-audio-3-sample')
       OR v_model.provider_endpoint<>v_quote.provider_endpoint OR v_model.credits_5s<>v_quote.unit_credits
       OR v_model.cost_unit<>'per_generation'
       OR v_model.updated_at IS DISTINCT FROM v_quote.catalog_updated_at THEN
        RETURN jsonb_build_object('ok',false,'code','QUOTE_STALE');
    END IF;
    IF v_balance<v_quote.total_credits THEN RETURN jsonb_build_object('ok',false,'code','INSUFFICIENT_BALANCE'); END IF;
    SELECT count(*) INTO v_recent FROM public.jobs
    WHERE user_id=v_user AND created_at>now()-interval '60 seconds';
    IF v_recent>8 THEN RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','retry_after_seconds',60); END IF;
    BEGIN
        INSERT INTO public.music_generation_requests(user_id,quote_id,prompt_spec_id,model_id,idempotency_key,credit_quote)
        VALUES(v_user,v_quote.id,v_prompt.id,v_model.id,p_idempotency_key,v_quote.total_credits)
        RETURNING * INTO v_request;
        v_one:=public.ledger_debit(v_user,p_idempotency_key||'.1',v_quote.unit_credits,
            'debit:music_generation',v_model.id,jsonb_build_object('prompt',v_prompt.prompt,
            'music_request_id',v_request.id,'music_candidate_ordinal',1),0,120);
        IF v_one->>'ok' IS DISTINCT FROM 'true' THEN v_failure:=v_one;
            RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='music remix debit one refused'; END IF;
        v_two:=public.ledger_debit(v_user,p_idempotency_key||'.2',v_quote.unit_credits,
            'debit:music_generation',v_model.id,jsonb_build_object('prompt',v_prompt.prompt,
            'music_request_id',v_request.id,'music_candidate_ordinal',2),0,120);
        IF v_two->>'ok' IS DISTINCT FROM 'true' THEN v_failure:=v_two;
            RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='music remix debit two refused'; END IF;
        v_job_one:=(v_one->>'job_id')::uuid; v_job_two:=(v_two->>'job_id')::uuid;
        INSERT INTO public.music_generation_candidates(user_id,generation_request_id,ordinal,job_id)
        VALUES(v_user,v_request.id,1,v_job_one),(v_user,v_request.id,2,v_job_two);
        -- Field types follow the live fal schemas read on 2026-11-15.
        IF v_prompt.mode='mashup' THEN
            v_payload:=jsonb_build_object('prompt',v_prompt.prompt,'audio_url',p_prepared_audio_url,
                'duration',v_prompt.source_duration_seconds,
                'init_noise_level',round(1-v_prompt.source_influence::numeric/100,2),
                'num_inference_steps',8,'guidance_scale',1,'enable_safety_checker',true,
                'output_format','wav');
        ELSE
            v_payload:=jsonb_build_object('prompt',v_prompt.prompt,'audio_url',p_prepared_audio_url,
                'extend_seconds_before',0,'extend_seconds_after',v_prompt.sample_extend_seconds,
                'num_inference_steps',8,'guidance_scale',1,'enable_safety_checker',true,
                'output_format','wav');
        END IF;
        INSERT INTO public.fal_dispatch(job_id,endpoint,payload)
        VALUES(v_job_one,v_quote.provider_endpoint,v_payload),(v_job_two,v_quote.provider_endpoint,v_payload);
        INSERT INTO public.music_remix_sources(generation_request_id,user_id,r2_key,duration_seconds)
        VALUES(v_request.id,v_user,p_prepared_r2_key,p_prepared_seconds);
        UPDATE public.music_generation_quotes SET consumed_at=now() WHERE id=v_quote.id;
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        RETURN COALESCE(v_failure,jsonb_build_object('ok',false,'code','PAIR_DEBIT_FAILED'));
    END;
    SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END
    INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
    RETURN jsonb_build_object('ok',true,'request_id',v_request.id,'state','debited',
        'job_ids',jsonb_build_array(v_job_one,v_job_two),'balance_after',v_balance,'idempotent',false);
END $$;

-- 0487's projection plus: mashup and sample candidates become NEW songs whose
-- first version links to every source, and a settled pair queues its prepared
-- source for reaping.
CREATE OR REPLACE FUNCTION public.music_project_candidate(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_candidate public.music_generation_candidates%ROWTYPE; v_job public.jobs%ROWTYPE; v_asset public.assets%ROWTYPE;
 v_prompt public.music_prompt_specs%ROWTYPE; v_song UUID; v_version UUID; v_number INTEGER;
 v_ready INTEGER; v_terminal INTEGER; v_refunded INTEGER; v_running INTEGER; v_request_status TEXT;
 v_operation TEXT; v_relation TEXT; v_schema TEXT; v_evidence JSONB;
BEGIN
 SELECT * INTO v_candidate FROM public.music_generation_candidates WHERE job_id=p_job_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'projected',false); END IF;
 SELECT * INTO v_job FROM public.jobs WHERE id=p_job_id;
 IF v_job.state='STORED' THEN
  SELECT * INTO v_asset FROM public.assets WHERE job_id=p_job_id ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'projected',false,'waiting_for','asset'); END IF;
  IF v_candidate.song_id IS NULL THEN
   SELECT p.* INTO v_prompt FROM public.music_prompt_specs p JOIN public.music_generation_requests r ON r.prompt_spec_id=p.id WHERE r.id=v_candidate.generation_request_id;
   IF v_prompt.mode IN ('cover','extend','replace_section','add_section') THEN
    SELECT id INTO v_song FROM public.music_songs WHERE id=v_prompt.source_song_id AND user_id=v_candidate.user_id FOR UPDATE;
    IF v_song IS NULL THEN RETURN jsonb_build_object('ok',true,'projected',false,'waiting_for','source_song'); END IF;
    SELECT COALESCE(max(version_number),0)+1 INTO v_number FROM public.music_song_versions WHERE song_id=v_song;
    v_operation:=CASE v_prompt.mode WHEN 'cover' THEN 'cover' WHEN 'extend' THEN 'extend' WHEN 'replace_section' THEN 'replace_section' ELSE 'add_section' END;
    v_relation:=CASE v_prompt.mode WHEN 'cover' THEN 'cover_source' WHEN 'extend' THEN 'extend_source' ELSE 'edit_source' END;
    v_schema:=CASE v_prompt.mode WHEN 'cover' THEN 'music-cover-v1' WHEN 'extend' THEN 'music-extend-v1' WHEN 'replace_section' THEN 'music-replace-section-v1' ELSE 'music-add-section-v1' END;
    v_evidence:=jsonb_strip_nulls(jsonb_build_object('source_duration_seconds',v_prompt.source_duration_seconds,
     'source_influence',v_prompt.source_influence,'extend_seconds_after',v_prompt.extend_seconds_after,
     'start_seconds',v_prompt.replace_start_seconds,'end_seconds',v_prompt.replace_end_seconds,
     'section_position',v_prompt.section_position,'section_duration_seconds',v_prompt.section_duration_seconds,
     'rights_version',v_prompt.source_rights_version));
    INSERT INTO public.music_song_versions(user_id,song_id,generation_request_id,job_id,audio_asset_id,version_number,provenance,operation,parent_version_id)
    VALUES(v_candidate.user_id,v_song,v_candidate.generation_request_id,p_job_id,v_asset.id,v_number,
     jsonb_build_object('model_id',v_job.model_id,'provider',v_job.provider,'provider_job_id',v_job.provider_job_id,
      'asset_sha256',v_asset.sha256,'schema_version',v_schema)||v_evidence,v_operation,v_prompt.source_version_id)
    RETURNING id INTO v_version;
    INSERT INTO public.music_version_sources(user_id,output_version_id,source_version_id,relation,ordinal,evidence)
    VALUES(v_candidate.user_id,v_version,v_prompt.source_version_id,v_relation,1,v_evidence);
   ELSIF v_prompt.mode IN ('mashup','sample') THEN
    v_evidence:=jsonb_strip_nulls(jsonb_build_object('source_duration_seconds',v_prompt.source_duration_seconds,
     'source_influence',v_prompt.source_influence,'sample_start_seconds',v_prompt.sample_start_seconds,
     'sample_end_seconds',v_prompt.sample_end_seconds,'sample_extend_seconds',v_prompt.sample_extend_seconds,
     'rights_version',v_prompt.source_rights_version));
    INSERT INTO public.music_songs(user_id,title) VALUES(v_candidate.user_id,
     left(COALESCE(v_prompt.title,'Music draft')||' '||CASE v_candidate.ordinal WHEN 1 THEN 'A' ELSE 'B' END,80))
     RETURNING id INTO v_song;
    INSERT INTO public.music_song_versions(user_id,song_id,generation_request_id,job_id,audio_asset_id,provenance,operation)
    VALUES(v_candidate.user_id,v_song,v_candidate.generation_request_id,p_job_id,v_asset.id,
     jsonb_build_object('model_id',v_job.model_id,'provider',v_job.provider,'provider_job_id',v_job.provider_job_id,
      'asset_sha256',v_asset.sha256,'schema_version',v_prompt.schema_version)||v_evidence,v_prompt.mode)
     RETURNING id INTO v_version;
    INSERT INTO public.music_version_sources(user_id,output_version_id,source_version_id,relation,ordinal,
     source_start_seconds,source_end_seconds,evidence)
    VALUES(v_candidate.user_id,v_version,v_prompt.source_version_id,v_prompt.mode||'_source',1,
     v_prompt.sample_start_seconds,v_prompt.sample_end_seconds,v_evidence);
    IF v_prompt.mode='mashup' THEN
     INSERT INTO public.music_version_sources(user_id,output_version_id,source_version_id,relation,ordinal,evidence)
     VALUES(v_candidate.user_id,v_version,v_prompt.second_source_version_id,'mashup_source',2,v_evidence);
    END IF;
   ELSE
    INSERT INTO public.music_songs(user_id,title) VALUES(v_candidate.user_id,
     COALESCE(v_prompt.title,'Music draft '||CASE v_candidate.ordinal WHEN 1 THEN 'A' ELSE 'B' END)) RETURNING id INTO v_song;
    INSERT INTO public.music_song_versions(user_id,song_id,generation_request_id,job_id,audio_asset_id,provenance)
    VALUES(v_candidate.user_id,v_song,v_candidate.generation_request_id,p_job_id,v_asset.id,
     jsonb_build_object('model_id',v_job.model_id,'provider',v_job.provider,'provider_job_id',v_job.provider_job_id,
      'asset_sha256',v_asset.sha256,'schema_version','music-simple-v1')) RETURNING id INTO v_version;
   END IF;
   IF v_prompt.mode<>'replace_section' THEN UPDATE public.music_songs SET current_version_id=v_version,updated_at=now() WHERE id=v_song; END IF;
   UPDATE public.music_generation_candidates SET status='ready',song_id=v_song,song_version_id=v_version,
    failure_code=NULL,updated_at=now() WHERE id=v_candidate.id;
  END IF;
 ELSIF v_job.state='REFUNDED' THEN UPDATE public.music_generation_candidates SET status='refunded',failure_code=v_job.error_code,updated_at=now() WHERE id=v_candidate.id AND status<>'ready';
 ELSIF v_job.state='FAILED' THEN UPDATE public.music_generation_candidates SET status='failed',failure_code=v_job.error_code,updated_at=now() WHERE id=v_candidate.id AND status<>'ready';
 ELSIF v_job.state IN ('SUBMITTED','SUCCEEDED') THEN UPDATE public.music_generation_candidates SET status='running',updated_at=now() WHERE id=v_candidate.id AND status='queued'; END IF;
 SELECT count(*) FILTER(WHERE status='ready'),count(*) FILTER(WHERE status IN ('ready','failed','refunded')),
 count(*) FILTER(WHERE status='refunded'),count(*) FILTER(WHERE status='running') INTO v_ready,v_terminal,v_refunded,v_running
 FROM public.music_generation_candidates WHERE generation_request_id=v_candidate.generation_request_id;
 v_request_status:=CASE WHEN v_ready=2 THEN 'succeeded' WHEN v_terminal=2 AND v_ready>0 THEN 'partial'
 WHEN v_terminal=2 AND v_refunded=2 THEN 'refunded' WHEN v_terminal=2 THEN 'failed' WHEN v_running>0 THEN 'running' ELSE 'debited' END;
 UPDATE public.music_generation_requests SET status=v_request_status,updated_at=now() WHERE id=v_candidate.generation_request_id;
 IF v_terminal=2 THEN
  INSERT INTO public.asset_reap_queue(r2_key)
  SELECT r2_key FROM public.music_remix_sources
  WHERE generation_request_id=v_candidate.generation_request_id AND reap_queued_at IS NULL
  ON CONFLICT (r2_key) DO NOTHING;
  UPDATE public.music_remix_sources SET reap_queued_at=now()
  WHERE generation_request_id=v_candidate.generation_request_id AND reap_queued_at IS NULL;
 END IF;
 RETURN jsonb_build_object('ok',true,'projected',true,'status',v_request_status);
END $function$;

REVOKE ALL ON FUNCTION public.music_get_remix_source_context(TEXT,UUID,UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_create_remix_quote(TEXT,TEXT,UUID,UUID,UUID,UUID,TEXT,INTEGER,NUMERIC,NUMERIC,INTEGER,BOOLEAN,NUMERIC) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_get_remix_dispatch_context(TEXT,UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_submit_remix_pair(TEXT,UUID,UUID,TEXT,TEXT,TEXT,NUMERIC) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_project_candidate(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_remix_source_context(TEXT,UUID,UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_create_remix_quote(TEXT,TEXT,UUID,UUID,UUID,UUID,TEXT,INTEGER,NUMERIC,NUMERIC,INTEGER,BOOLEAN,NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_get_remix_dispatch_context(TEXT,UUID,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_submit_remix_pair(TEXT,UUID,UUID,TEXT,TEXT,TEXT,NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_project_candidate(UUID) TO service_role;

-- Admit the two new routes in the privacy-safe route telemetry allowlist.
DO $$
BEGIN
    IF to_regprocedure('public.telemetry_path_allowed_pre_0522(text)') IS NULL THEN
        ALTER FUNCTION public.telemetry_path_allowed(TEXT) RENAME TO telemetry_path_allowed_pre_0522;
    END IF;
END $$;
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT p_path IN ('/api/v1/music/songs/:id/remix-quotes', '/api/v1/music/songs/:id/remixes')
        OR public.telemetry_path_allowed_pre_0522(p_path)
$$;
REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT) FROM PUBLIC, anon, authenticated, service_role;
