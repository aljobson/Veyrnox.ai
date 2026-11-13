-- Provider-independent, non-destructive crop metadata. A cropped version
-- reuses immutable bytes for preview but cannot be exported as a new master
-- until a renderer produces a distinct asset.

ALTER TABLE public.music_song_versions DROP CONSTRAINT IF EXISTS music_song_versions_job_id_key;
ALTER TABLE public.music_song_versions DROP CONSTRAINT IF EXISTS music_song_versions_audio_asset_id_key;
CREATE INDEX IF NOT EXISTS music_song_versions_job_idx ON public.music_song_versions(job_id);
CREATE INDEX IF NOT EXISTS music_song_versions_asset_idx ON public.music_song_versions(audio_asset_id);

CREATE TABLE IF NOT EXISTS public.music_version_operation_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    operation TEXT NOT NULL CHECK (operation='crop'),
    source_version_id UUID NOT NULL,
    output_version_id UUID NOT NULL,
    idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{8,120}$'),
    parameters JSONB NOT NULL CHECK (jsonb_typeof(parameters)='object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id,idempotency_key),
    FOREIGN KEY (source_version_id,user_id) REFERENCES public.music_song_versions(id,user_id) ON DELETE RESTRICT,
    FOREIGN KEY (output_version_id,user_id) REFERENCES public.music_song_versions(id,user_id) ON DELETE RESTRICT
);
ALTER TABLE public.music_version_operation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_version_operation_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.music_version_operation_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON TABLE public.music_version_operation_receipts TO service_role;

CREATE OR REPLACE FUNCTION public.music_get_crop_context(p_auth_id TEXT,p_song_id UUID,p_version_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row JSONB; BEGIN
    SELECT jsonb_build_object('ok',true,'r2_key',a.r2_key,'mime_type',a.mime_type,'size_bytes',a.size_bytes)
    INTO v_row FROM public.users u JOIN public.music_songs s ON s.user_id=u.id
    JOIN public.music_song_versions v ON v.id=p_version_id AND v.user_id=u.id AND v.song_id=s.id
    JOIN public.assets a ON a.id=v.audio_asset_id
    WHERE u.auth_id=p_auth_id AND s.id=p_song_id AND s.current_version_id=p_version_id AND s.status='active';
    RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','NOT_FOUND'));
END $$;

CREATE OR REPLACE FUNCTION public.music_crop_song(
    p_auth_id TEXT,p_song_id UUID,p_source_version_id UUID,p_output_version_id UUID,
    p_start_seconds NUMERIC,p_end_seconds NUMERIC,p_source_duration NUMERIC,p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    v_user UUID; v_source public.music_song_versions%ROWTYPE; v_receipt public.music_version_operation_receipts%ROWTYPE;
    v_number INTEGER; v_parameters JSONB;
BEGIN
    IF p_output_version_id IS NULL OR p_start_seconds<0 OR p_end_seconds<=p_start_seconds
       OR p_end_seconds-p_start_seconds<1 OR p_source_duration<=0 OR p_end_seconds>p_source_duration+0.05
       OR p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
        RETURN jsonb_build_object('ok',false,'code','CROP_RANGE_INVALID');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id FOR UPDATE;
    SELECT * INTO v_receipt FROM public.music_version_operation_receipts
        WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
    v_parameters:=jsonb_build_object('start_seconds',p_start_seconds,'end_seconds',p_end_seconds,'source_duration',p_source_duration);
    IF FOUND THEN
        IF v_receipt.source_version_id IS DISTINCT FROM p_source_version_id OR v_receipt.parameters IS DISTINCT FROM v_parameters THEN
            RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');
        END IF;
        RETURN jsonb_build_object('ok',true,'idempotent',true,'version_id',v_receipt.output_version_id);
    END IF;
    SELECT v.* INTO v_source FROM public.music_song_versions v JOIN public.music_songs s
        ON s.id=v.song_id AND s.user_id=v.user_id
        WHERE v.id=p_source_version_id AND v.user_id=v_user AND s.id=p_song_id
          AND s.current_version_id=p_source_version_id AND s.status='active' FOR UPDATE OF s;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); END IF;
    SELECT COALESCE(max(version_number),0)+1 INTO v_number FROM public.music_song_versions WHERE song_id=p_song_id;
    INSERT INTO public.music_song_versions(id,user_id,song_id,generation_request_id,job_id,audio_asset_id,
        version_number,provenance,operation,parent_version_id)
    VALUES(p_output_version_id,v_user,p_song_id,v_source.generation_request_id,v_source.job_id,v_source.audio_asset_id,
        v_number,jsonb_build_object('crop',v_parameters,'render_state','preview_only'),'crop',p_source_version_id);
    INSERT INTO public.music_version_sources(user_id,output_version_id,source_version_id,relation,ordinal,
        source_start_seconds,source_end_seconds,evidence)
    VALUES(v_user,p_output_version_id,p_source_version_id,'edit_source',1,p_start_seconds,p_end_seconds,
        jsonb_build_object('measured_duration',p_source_duration));
    INSERT INTO public.music_version_operation_receipts(user_id,operation,source_version_id,output_version_id,idempotency_key,parameters)
    VALUES(v_user,'crop',p_source_version_id,p_output_version_id,p_idempotency_key,v_parameters);
    UPDATE public.music_songs SET current_version_id=p_output_version_id,updated_at=now() WHERE id=p_song_id AND user_id=v_user;
    RETURN jsonb_build_object('ok',true,'idempotent',false,'version_id',p_output_version_id,'version_number',v_number);
END $$;

CREATE OR REPLACE FUNCTION public.music_get_version_exportability(p_auth_id TEXT,p_song_id UUID,p_version_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
    SELECT COALESCE((SELECT jsonb_build_object('ok',true,'rendered',v.operation='generation','operation',v.operation)
    FROM public.music_song_versions v JOIN public.music_songs s ON s.id=v.song_id AND s.user_id=v.user_id
    JOIN public.users u ON u.id=v.user_id WHERE u.auth_id=p_auth_id AND s.id=p_song_id AND v.id=p_version_id),
    jsonb_build_object('ok',false,'code','NOT_FOUND'));
$$;

REVOKE ALL ON FUNCTION public.music_get_crop_context(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_crop_song(TEXT,UUID,UUID,UUID,NUMERIC,NUMERIC,NUMERIC,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.music_get_version_exportability(TEXT,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_crop_context(TEXT,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_crop_song(TEXT,UUID,UUID,UUID,NUMERIC,NUMERIC,NUMERIC,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.music_get_version_exportability(TEXT,UUID,UUID) TO service_role;
