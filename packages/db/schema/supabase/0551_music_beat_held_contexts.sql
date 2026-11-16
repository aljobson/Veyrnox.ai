-- Read-only ownership checks retain existing replay-first behavior.
CREATE OR REPLACE FUNCTION public.music_get_stem_source_context(
    p_auth_id TEXT,p_song_id UUID,p_version_id UUID
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row JSONB;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    SELECT CASE WHEN EXISTS (SELECT 1 FROM public.assets h WHERE h.job_id = a.job_id AND h.held_at IS NOT NULL) THEN jsonb_build_object('ok',false,'code','HELD') ELSE jsonb_build_object('ok',true,'r2_key',a.r2_key,'mime_type',a.mime_type,'size_bytes',a.size_bytes) END
    INTO v_row FROM public.music_songs s
    JOIN public.music_song_versions v ON v.id=p_version_id AND v.user_id=v_user AND v.song_id=s.id
    JOIN public.assets a ON a.id=v.audio_asset_id
    WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active'
      AND s.current_version_id=p_version_id AND a.mime_type IN ('audio/mpeg','audio/mp3')
      AND a.size_bytes<=10485760;
    RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','FORMAT_UNAVAILABLE'));
END $$;
REVOKE ALL ON FUNCTION public.music_get_stem_source_context(TEXT,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_stem_source_context(TEXT,UUID,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.music_get_stem_dispatch_context(
    p_auth_id TEXT,p_song_id UUID,p_quote_id UUID,p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_existing public.music_stem_requests%ROWTYPE; v_quote public.music_stem_quotes%ROWTYPE; v_row JSONB;
BEGIN
    IF p_idempotency_key!~'^[A-Za-z0-9._-]{8,120}$' THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    SELECT * INTO v_existing FROM public.music_stem_requests
    WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
    IF FOUND THEN
        IF v_existing.quote_id IS DISTINCT FROM p_quote_id THEN
            RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');
        END IF;
        RETURN jsonb_build_object('ok',true,'idempotent',true,'request_id',v_existing.id,'job_id',v_existing.job_id);
    END IF;
    SELECT * INTO v_quote FROM public.music_stem_quotes
    WHERE id=p_quote_id AND user_id=v_user AND song_id=p_song_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    SELECT CASE WHEN EXISTS (SELECT 1 FROM public.assets h WHERE h.job_id = a.job_id AND h.held_at IS NOT NULL) THEN jsonb_build_object('ok',false,'code','HELD') ELSE jsonb_build_object('ok',true,'idempotent',false,'r2_key',a.r2_key,'mime_type',a.mime_type) END
    INTO v_row FROM public.music_songs s
    JOIN public.music_song_versions v ON v.id=v_quote.source_version_id AND v.user_id=v_user AND v.song_id=s.id
    JOIN public.assets a ON a.id=v.audio_asset_id
    WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active'
      AND s.current_version_id=v_quote.source_version_id AND a.mime_type IN ('audio/mpeg','audio/mp3')
      AND a.size_bytes<=10485760;
    RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','REVISION_CONFLICT'));
END $$;
REVOKE ALL ON FUNCTION public.music_get_stem_dispatch_context(TEXT,UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_stem_dispatch_context(TEXT,UUID,UUID,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.music_get_target_stem_source_context(
  p_auth_id TEXT,p_song_id UUID,p_version_id UUID
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row JSONB;
BEGIN
  SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.assets h WHERE h.job_id = a.job_id AND h.held_at IS NOT NULL) THEN jsonb_build_object('ok',false,'code','HELD') ELSE jsonb_build_object('ok',true,'r2_key',a.r2_key,'mime_type',a.mime_type,'size_bytes',a.size_bytes) END
    INTO v_row FROM public.music_songs s
  JOIN public.music_song_versions v ON v.id=p_version_id AND v.user_id=v_user AND v.song_id=s.id
  JOIN public.assets a ON a.id=v.audio_asset_id
  WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active'
    AND s.current_version_id=p_version_id AND a.mime_type IN ('audio/mpeg','audio/wav');
  RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','FORMAT_UNAVAILABLE'));
END $$;
REVOKE ALL ON FUNCTION public.music_get_target_stem_source_context(TEXT,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_target_stem_source_context(TEXT,UUID,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.music_get_target_stem_dispatch_context(
  p_auth_id TEXT,p_song_id UUID,p_quote_id UUID,p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_existing public.music_target_stem_requests%ROWTYPE;
 v_quote public.music_target_stem_quotes%ROWTYPE; v_job public.jobs%ROWTYPE; v_row JSONB;
BEGIN
  IF p_idempotency_key!~'^[A-Za-z0-9._-]{8,120}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
  SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  SELECT * INTO v_existing FROM public.music_target_stem_requests WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.quote_id IS DISTINCT FROM p_quote_id THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
    SELECT * INTO v_job FROM public.jobs WHERE id=v_existing.job_id;
    RETURN jsonb_build_object('ok',true,'idempotent',true,'request_id',v_existing.id,
      'job_id',v_existing.job_id,'state',CASE WHEN v_job.state='STORED' THEN 'ready'
      WHEN v_job.state='REFUNDED' THEN 'refunded' WHEN v_job.state='FAILED' THEN 'failed'
      WHEN v_job.state IN ('SUBMITTED','SUCCEEDED') THEN 'running' ELSE 'queued' END);
  END IF;
  SELECT * INTO v_quote FROM public.music_target_stem_quotes
    WHERE id=p_quote_id AND user_id=v_user AND song_id=p_song_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.assets h WHERE h.job_id = a.job_id AND h.held_at IS NOT NULL) THEN jsonb_build_object('ok',false,'code','HELD') ELSE jsonb_build_object('ok',true,'idempotent',false,'r2_key',a.r2_key,'mime_type',a.mime_type,
    'source_duration_seconds',v_quote.source_duration_seconds) END
    INTO v_row
  FROM public.music_songs s JOIN public.music_song_versions v
    ON v.id=v_quote.source_version_id AND v.user_id=v_user AND v.song_id=s.id
  JOIN public.assets a ON a.id=v.audio_asset_id
  WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active'
    AND s.current_version_id=v_quote.source_version_id AND a.mime_type IN ('audio/mpeg','audio/wav');
  RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','REVISION_CONFLICT'));
END $$;
REVOKE ALL ON FUNCTION public.music_get_target_stem_dispatch_context(TEXT,UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_target_stem_dispatch_context(TEXT,UUID,UUID,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.music_get_extend_source_context(
    p_auth_id TEXT,p_song_id UUID,p_version_id UUID
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row JSONB;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    SELECT CASE WHEN EXISTS (SELECT 1 FROM public.assets h WHERE h.job_id = a.job_id AND h.held_at IS NOT NULL) THEN jsonb_build_object('ok',false,'code','HELD') ELSE jsonb_build_object('ok',true,'r2_key',a.r2_key,'mime_type',a.mime_type,
        'size_bytes',a.size_bytes) END
    INTO v_row FROM public.music_songs s
    JOIN public.music_song_versions v ON v.id=p_version_id AND v.user_id=v_user AND v.song_id=s.id
    JOIN public.assets a ON a.id=v.audio_asset_id
    WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active'
      AND s.current_version_id=p_version_id AND a.mime_type IN ('audio/mpeg','audio/wav');
    RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','REVISION_CONFLICT'));
END $$;
REVOKE ALL ON FUNCTION public.music_get_extend_source_context(TEXT,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_extend_source_context(TEXT,UUID,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.music_get_extend_dispatch_context(
    p_auth_id TEXT,p_song_id UUID,p_quote_id UUID,p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
    v_user UUID; v_prompt public.music_prompt_specs%ROWTYPE;
    v_request public.music_generation_requests%ROWTYPE; v_jobs JSONB; v_balance INTEGER; v_row JSONB;
BEGIN
    IF p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN
        RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS');
    END IF;
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
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
    WHERE q.id=p_quote_id AND q.user_id=v_user AND ps.mode='extend'
      AND ps.source_song_id=p_song_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    SELECT CASE WHEN EXISTS (SELECT 1 FROM public.assets h WHERE h.job_id = a.job_id AND h.held_at IS NOT NULL) THEN jsonb_build_object('ok',false,'code','HELD') ELSE jsonb_build_object('ok',true,'idempotent',false,'r2_key',a.r2_key,
        'mime_type',a.mime_type,'source_duration_seconds',v_prompt.source_duration_seconds) END
    INTO v_row FROM public.music_songs s
    JOIN public.music_song_versions v ON v.id=v_prompt.source_version_id
      AND v.user_id=v_user AND v.song_id=s.id
    JOIN public.assets a ON a.id=v.audio_asset_id
    WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active'
      AND s.current_version_id=v_prompt.source_version_id
      AND a.mime_type IN ('audio/mpeg','audio/wav');
    RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','REVISION_CONFLICT'));
END $$;
REVOKE ALL ON FUNCTION public.music_get_extend_dispatch_context(TEXT,UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_extend_dispatch_context(TEXT,UUID,UUID,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.music_get_replace_source_context(p_auth_id TEXT,p_song_id UUID,p_version_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row JSONB;
BEGIN
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 SELECT CASE WHEN EXISTS (SELECT 1 FROM public.assets h WHERE h.job_id = a.job_id AND h.held_at IS NOT NULL) THEN jsonb_build_object('ok',false,'code','HELD') ELSE jsonb_build_object('ok',true,'r2_key',a.r2_key,'mime_type',a.mime_type,'size_bytes',a.size_bytes) END
    INTO v_row
 FROM public.music_songs s JOIN public.music_song_versions v ON v.id=p_version_id AND v.user_id=v_user AND v.song_id=s.id
 JOIN public.assets a ON a.id=v.audio_asset_id WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active'
 AND s.current_version_id=p_version_id AND a.mime_type IN ('audio/mpeg','audio/wav');
 RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','REVISION_CONFLICT'));
END $$;
REVOKE ALL ON FUNCTION public.music_get_replace_source_context(TEXT,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_replace_source_context(TEXT,UUID,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.music_get_replace_dispatch_context(p_auth_id TEXT,p_song_id UUID,p_quote_id UUID,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_prompt public.music_prompt_specs%ROWTYPE; v_request public.music_generation_requests%ROWTYPE;
 v_jobs JSONB; v_balance INTEGER; v_row JSONB;
BEGIN
 IF p_idempotency_key !~ '^[A-Za-z0-9._-]{8,120}$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
 SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
 SELECT * INTO v_request FROM public.music_generation_requests WHERE user_id=v_user AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF v_request.quote_id IS DISTINCT FROM p_quote_id THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT'); END IF;
  SELECT COALESCE(jsonb_agg(job_id ORDER BY ordinal),'[]'::jsonb) INTO v_jobs FROM public.music_generation_candidates WHERE generation_request_id=v_request.id;
  SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END INTO v_balance FROM public.credit_balances WHERE user_id=v_user;
  RETURN jsonb_build_object('ok',true,'idempotent',true,'request_id',v_request.id,'state',v_request.status,'job_ids',v_jobs,'balance_after',v_balance);
 END IF;
 SELECT ps.* INTO v_prompt FROM public.music_generation_quotes q JOIN public.music_prompt_specs ps
 ON ps.id=q.prompt_spec_id AND ps.user_id=q.user_id WHERE q.id=p_quote_id AND q.user_id=v_user
 AND ps.mode='replace_section' AND ps.source_song_id=p_song_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
 SELECT CASE WHEN EXISTS (SELECT 1 FROM public.assets h WHERE h.job_id = a.job_id AND h.held_at IS NOT NULL) THEN jsonb_build_object('ok',false,'code','HELD') ELSE jsonb_build_object('ok',true,'idempotent',false,'r2_key',a.r2_key,'mime_type',a.mime_type,
  'source_duration_seconds',v_prompt.source_duration_seconds) END
    INTO v_row FROM public.music_songs s
 JOIN public.music_song_versions v ON v.id=v_prompt.source_version_id AND v.user_id=v_user AND v.song_id=s.id
 JOIN public.assets a ON a.id=v.audio_asset_id WHERE s.id=p_song_id AND s.user_id=v_user AND s.status='active'
 AND s.current_version_id=v_prompt.source_version_id AND a.mime_type IN ('audio/mpeg','audio/wav');
 RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','REVISION_CONFLICT'));
END $$;
REVOKE ALL ON FUNCTION public.music_get_replace_dispatch_context(TEXT,UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_replace_dispatch_context(TEXT,UUID,UUID,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.music_get_stem_archive_context(p_auth_id TEXT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row JSONB;
BEGIN
    SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
    SELECT CASE WHEN EXISTS (SELECT 1 FROM public.assets h WHERE h.job_id = a.job_id AND h.held_at IS NOT NULL) THEN jsonb_build_object('ok',false,'code','HELD') ELSE jsonb_build_object('ok',true,'r2_key',a.r2_key,'mime_type',a.mime_type,
        'size_bytes',a.size_bytes,'song_id',r.song_id) END
    INTO v_row FROM public.music_stem_requests r JOIN public.jobs j ON j.id=r.job_id AND j.state='STORED'
    JOIN public.assets a ON a.job_id=j.id AND a.mime_type='application/zip'
    WHERE r.id=p_request_id AND r.user_id=v_user;
    RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','NOT_FOUND'));
END $$;
REVOKE ALL ON FUNCTION public.music_get_stem_archive_context(TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_stem_archive_context(TEXT,UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.music_get_target_stem_asset_context(
  p_auth_id TEXT,p_request_id UUID,p_kind TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row JSONB;
BEGIN
  IF p_kind NOT IN ('target','residual') THEN RETURN jsonb_build_object('ok',false,'code','INVALID_INPUTS'); END IF;
  SELECT id INTO v_user FROM public.users WHERE auth_id=p_auth_id;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.assets h WHERE h.job_id = a.job_id AND h.held_at IS NOT NULL) THEN jsonb_build_object('ok',false,'code','HELD') ELSE jsonb_build_object('ok',true,'r2_key',a.r2_key,'mime_type',a.mime_type,
    'size_bytes',a.size_bytes,'song_id',r.song_id,'instrument',r.instrument) END
    INTO v_row FROM public.music_target_stem_requests r
  JOIN public.jobs j ON j.id=r.job_id AND j.state='STORED'
  JOIN public.music_target_stem_assets p ON p.request_id=r.id
  JOIN public.assets a ON a.id=CASE WHEN p_kind='target' THEN p.target_asset_id ELSE p.residual_asset_id END
  WHERE r.id=p_request_id AND r.user_id=v_user;
  RETURN COALESCE(v_row,jsonb_build_object('ok',false,'code','NOT_FOUND'));
END $$;
REVOKE ALL ON FUNCTION public.music_get_target_stem_asset_context(TEXT,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_get_target_stem_asset_context(TEXT,UUID,TEXT) TO service_role;

