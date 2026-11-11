-- Canonical provider-independent two-section PCM WAV reorder.
-- One exact split creates two sections and stores them as [2,1] in a new
-- immutable WAV version. The source remains available through lineage.

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_credits_check;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_credits_check CHECK (
    credits > 0 OR free_allowance OR (
        credits = 0 AND model_id IN ('music-local-crop','music-local-fade','music-local-speed','music-local-reorder')
        AND provider = 'local' AND state = 'STORED'
    )
);

ALTER TABLE public.music_song_versions DROP CONSTRAINT IF EXISTS music_song_versions_operation_check;
ALTER TABLE public.music_song_versions ADD CONSTRAINT music_song_versions_operation_check
    CHECK (operation IN (
        'generation','cover','extend','speed','fade','reorder','reuse','crop','replace_section',
        'add_section','remaster','lyric_edit'
    ));

ALTER TABLE public.music_version_operation_receipts
    DROP CONSTRAINT IF EXISTS music_version_operation_receipts_operation_check;
ALTER TABLE public.music_version_operation_receipts
    ADD CONSTRAINT music_version_operation_receipts_operation_check
    CHECK (operation IN ('crop','fade','speed','reorder'));

CREATE OR REPLACE FUNCTION public.music_get_reorder_render_context(
    p_auth_id TEXT,p_song_id UUID,p_version_id UUID,p_operation TEXT,
    p_parameters JSONB,p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
    v_user UUID; v_receipt public.music_version_operation_receipts%ROWTYPE;
    v_version public.music_song_versions%ROWTYPE; v_row JSONB; v_split NUMERIC;
BEGIN
    IF p_operation IS DISTINCT FROM 'reorder' OR jsonb_typeof(p_parameters) IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_parameters->'split_seconds') IS DISTINCT FROM 'number'
       OR p_parameters->'order' IS DISTINCT FROM '[2,1]'::jsonb
       OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
    END IF;
    v_split:=(p_parameters->>'split_seconds')::numeric;
    IF p_parameters IS DISTINCT FROM jsonb_build_object('split_seconds',v_split,'order','[2,1]'::jsonb)
       OR v_split<1 OR v_split>86399 THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;

    SELECT * INTO v_receipt FROM public.music_version_operation_receipts
    WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
    IF FOUND THEN
        IF v_receipt.operation IS DISTINCT FROM 'reorder'
           OR v_receipt.source_version_id IS DISTINCT FROM p_version_id
           OR v_receipt.parameters IS DISTINCT FROM p_parameters THEN
            RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');
        END IF;
        SELECT * INTO v_version FROM public.music_song_versions
        WHERE id=v_receipt.output_version_id AND user_id=v_user;
        RETURN jsonb_build_object('ok',true,'idempotent',true,
            'version_id',v_version.id,'version_number',v_version.version_number,
            'render_state',COALESCE(v_version.provenance->>'render_state','canonical'));
    END IF;

    SELECT jsonb_build_object('ok',true,'idempotent',false,'user_id',v_user,
        'r2_key',a.r2_key,'mime_type',a.mime_type,'size_bytes',a.size_bytes)
    INTO v_row FROM public.music_songs s
    JOIN public.music_song_versions v ON v.id=p_version_id AND v.user_id=v_user AND v.song_id=s.id
    JOIN public.assets a ON a.id=v.audio_asset_id
    WHERE s.id=p_song_id AND s.user_id=v_user AND s.current_version_id=p_version_id AND s.status='active';
    RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','REVISION_CONFLICT'));
END $$;

CREATE OR REPLACE FUNCTION public.music_commit_reordered_wav(
    p_auth_id TEXT,p_song_id UUID,p_source_version_id UUID,
    p_output_version_id UUID,p_output_job_id UUID,p_output_asset_id UUID,
    p_r2_key TEXT,p_size_bytes BIGINT,p_sha256 TEXT,p_operation TEXT,p_parameters JSONB,
    p_source_duration NUMERIC,p_output_duration NUMERIC,p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    v_user UUID; v_source public.music_song_versions%ROWTYPE;
    v_receipt public.music_version_operation_receipts%ROWTYPE;
    v_existing public.music_song_versions%ROWTYPE; v_number INTEGER;
    v_expected_key TEXT; v_split NUMERIC;
BEGIN
    IF p_output_version_id IS NULL OR p_output_job_id IS NULL OR p_output_asset_id IS NULL
       OR p_operation IS DISTINCT FROM 'reorder' OR jsonb_typeof(p_parameters) IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_parameters->'split_seconds') IS DISTINCT FROM 'number'
       OR p_parameters->'order' IS DISTINCT FROM '[2,1]'::jsonb
       OR p_source_duration<2 OR p_output_duration<=0 OR p_size_bytes<44 OR p_size_bytes>26214400
       OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
    END IF;
    v_split:=(p_parameters->>'split_seconds')::numeric;
    IF p_parameters IS DISTINCT FROM jsonb_build_object('split_seconds',v_split,'order','[2,1]'::jsonb)
       OR v_split<1 OR v_split>p_source_duration-1
       OR abs(p_output_duration-p_source_duration)>0.05 THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
    END IF;

    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id FOR UPDATE;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    v_expected_key:='music-renders/'||v_user::text||'/'||p_output_version_id::text||'.wav';
    IF p_r2_key IS DISTINCT FROM v_expected_key THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
    END IF;

    SELECT * INTO v_receipt FROM public.music_version_operation_receipts
    WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
    IF FOUND THEN
        IF v_receipt.operation IS DISTINCT FROM 'reorder'
           OR v_receipt.source_version_id IS DISTINCT FROM p_source_version_id
           OR v_receipt.parameters IS DISTINCT FROM p_parameters THEN
            RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');
        END IF;
        SELECT * INTO v_existing FROM public.music_song_versions
        WHERE id=v_receipt.output_version_id AND user_id=v_user;
        RETURN jsonb_build_object('ok',true,'idempotent',true,'version_id',v_existing.id,
            'version_number',v_existing.version_number,'render_state',v_existing.provenance->>'render_state',
            'r2_key',(SELECT r2_key FROM public.assets WHERE id=v_existing.audio_asset_id));
    END IF;

    SELECT v.* INTO v_source FROM public.music_song_versions v JOIN public.music_songs s
        ON s.id=v.song_id AND s.user_id=v.user_id
        WHERE v.id=p_source_version_id AND v.user_id=v_user AND s.id=p_song_id
          AND s.current_version_id=p_source_version_id AND s.status='active' FOR UPDATE OF s;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); END IF;

    INSERT INTO public.jobs(id,user_id,idempotency_key,model_id,credits,state,provider,provider_job_id,inputs)
    VALUES(p_output_job_id,v_user,'music-reorder-'||md5(v_user::text||':'||p_idempotency_key),
        'music-local-reorder',0,'STORED','local',p_output_version_id::text,
        p_parameters||jsonb_build_object('source_duration',p_source_duration,'output_duration',p_output_duration));
    INSERT INTO public.assets(id,job_id,r2_key,mime_type,size_bytes,sha256)
    VALUES(p_output_asset_id,p_output_job_id,p_r2_key,'audio/wav',p_size_bytes,p_sha256);
    SELECT COALESCE(max(version_number),0)+1 INTO v_number FROM public.music_song_versions WHERE song_id=p_song_id;
    INSERT INTO public.music_song_versions(id,user_id,song_id,generation_request_id,job_id,audio_asset_id,
        version_number,provenance,operation,parent_version_id)
    VALUES(p_output_version_id,v_user,p_song_id,v_source.generation_request_id,p_output_job_id,p_output_asset_id,
        v_number,jsonb_build_object('reorder',p_parameters||jsonb_build_object('source_duration',p_source_duration,
        'output_duration',p_output_duration),'render_state','canonical','asset_sha256',p_sha256,
        'renderer','pcm-wav-v1'),'reorder',p_source_version_id);
    INSERT INTO public.music_version_sources(user_id,output_version_id,source_version_id,relation,ordinal,evidence)
    VALUES(v_user,p_output_version_id,p_source_version_id,'edit_source',1,
        jsonb_build_object('source_duration',p_source_duration,'output_duration',p_output_duration,
        'split_seconds',v_split,'order','[2,1]'::jsonb,'renderer','pcm-wav-v1'));
    INSERT INTO public.music_version_operation_receipts(user_id,operation,source_version_id,output_version_id,idempotency_key,parameters)
    VALUES(v_user,'reorder',p_source_version_id,p_output_version_id,p_idempotency_key,p_parameters);
    UPDATE public.music_songs SET current_version_id=p_output_version_id,updated_at=now()
    WHERE id=p_song_id AND user_id=v_user;
    RETURN jsonb_build_object('ok',true,'idempotent',false,'version_id',p_output_version_id,
        'version_number',v_number,'render_state','canonical','r2_key',p_r2_key);
END $$;

REVOKE ALL ON FUNCTION public.music_get_reorder_render_context(TEXT,UUID,UUID,TEXT,JSONB,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_commit_reordered_wav(TEXT,UUID,UUID,UUID,UUID,UUID,TEXT,BIGINT,TEXT,TEXT,JSONB,NUMERIC,NUMERIC,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_reorder_render_context(TEXT,UUID,UUID,TEXT,JSONB,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_commit_reordered_wav(TEXT,UUID,UUID,UUID,UUID,UUID,TEXT,BIGINT,TEXT,TEXT,JSONB,NUMERIC,NUMERIC,TEXT) TO service_role;
