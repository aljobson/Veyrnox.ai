-- A Cinema video made from the creator's own finished Library job (ADR-0052 amendment 1).
-- The reservation is the same bounded row as a browser upload (0137/0139/0164): same
-- owner checks, same capacity, same lock. It differs in three ways: the bytes come from
-- our R2 object, never from the browser; the row records which job it came from; and it
-- enters 'processing' directly, because Stream fetches the object itself, so no transfer
-- grant is ever issued for it. Jobs are never deleted, so the reference is RESTRICT.
ALTER TABLE public.cinema_uploads ADD COLUMN IF NOT EXISTS source_job_id UUID REFERENCES public.jobs(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS cinema_upload_source_job_idx ON public.cinema_uploads(source_job_id) WHERE source_job_id IS NOT NULL;

-- Reserve a Library video for a draft. Idempotent on (content, job): the stand-in
-- fingerprint is a hash of the job id, so reserve_cinema_upload's own replay rules
-- apply unchanged (same job -> the existing row, another job -> upload_exists, a
-- reused key with other arguments -> idempotency_conflict). Another person's job, a
-- job that is not finished, and an expired or missing asset all read as not found.
CREATE OR REPLACE FUNCTION public.reserve_cinema_library_upload(p_auth_id TEXT,p_content_id UUID,p_job_id UUID,p_key UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_asset RECORD; v_result JSONB; v_row public.cinema_uploads%ROWTYPE; v_fingerprint TEXT;
BEGIN
  v_user:=public.cinema_upload_owner(p_auth_id,p_content_id);
  IF v_user IS NULL THEN RETURN jsonb_build_object('error','upload_not_allowed'); END IF;
  IF p_key IS NULL OR p_job_id IS NULL THEN RETURN jsonb_build_object('error','invalid_upload'); END IF;
  SELECT a.r2_key,a.mime_type,a.size_bytes,a.expires_at INTO v_asset
    FROM public.jobs j JOIN public.assets a ON a.job_id=j.id
    WHERE j.id=p_job_id AND j.user_id=v_user AND j.state='STORED'
    ORDER BY a.created_at,a.id LIMIT 1;
  IF NOT FOUND OR (v_asset.expires_at IS NOT NULL AND v_asset.expires_at<=now()) THEN RETURN jsonb_build_object('error','source_not_found'); END IF;
  IF v_asset.mime_type IS NULL OR v_asset.mime_type NOT LIKE 'video/%' THEN RETURN jsonb_build_object('error','source_not_video'); END IF;
  IF v_asset.size_bytes IS NULL OR v_asset.size_bytes NOT BETWEEN 1 AND 2147483648 THEN RETURN jsonb_build_object('error','invalid_upload'); END IF;
  v_fingerprint:=encode(pg_catalog.sha256(convert_to('library:'||p_job_id::text,'UTF8')),'hex');
  v_result:=public.reserve_cinema_upload(p_auth_id,p_content_id,p_key,v_asset.size_bytes,v_fingerprint);
  IF v_result ? 'error' THEN RETURN v_result; END IF;
  IF (v_result->>'claimed')::boolean THEN
    UPDATE public.cinema_uploads SET server_mediated=true,source_job_id=p_job_id WHERE id=(v_result->>'id')::uuid RETURNING * INTO v_row;
  ELSE
    SELECT * INTO v_row FROM public.cinema_uploads WHERE id=(v_result->>'id')::uuid;
    IF NOT v_row.server_mediated OR v_row.source_job_id IS DISTINCT FROM p_job_id THEN RETURN jsonb_build_object('error','upload_needs_reconciliation'); END IF;
  END IF;
  -- The object key is for the service role's own presigning only; the handler never returns it.
  RETURN to_jsonb(v_row)||jsonb_build_object('claimed',(v_result->>'claimed')::boolean,'r2_key',v_asset.r2_key,'mime_type',v_asset.mime_type);
END $$;

-- Record the Stream video that is fetching the object. No upload URL exists for this
-- row, so the transfer routes refuse it (state is never 'uploading') and the existing
-- observation path (webhook, refresh, recovery sweep) carries it to ready or error.
CREATE OR REPLACE FUNCTION public.attach_cinema_library_upload(p_id UUID,p_uid TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.cinema_uploads%ROWTYPE;
BEGIN
  IF p_uid IS NULL OR p_uid !~ '^[A-Za-z0-9]{32}$' THEN RETURN jsonb_build_object('error','invalid_upload'); END IF;
  SELECT * INTO v_row FROM public.cinema_uploads WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','upload_not_found'); END IF;
  IF v_row.state IN ('deleting','deleted') THEN RETURN jsonb_build_object('error','upload_removed'); END IF;
  IF v_row.source_job_id IS NULL OR NOT v_row.server_mediated THEN RETURN jsonb_build_object('error','invalid_upload'); END IF;
  IF v_row.stream_uid IS NOT NULL THEN
    IF v_row.stream_uid<>p_uid THEN RETURN jsonb_build_object('error','idempotency_conflict'); END IF;
    RETURN jsonb_build_object('ok',true);
  END IF;
  UPDATE public.cinema_uploads SET stream_uid=p_uid,upload_url=NULL,state='processing' WHERE id=p_id;
  RETURN jsonb_build_object('ok',true);
END $$;

REVOKE ALL ON FUNCTION public.reserve_cinema_library_upload(TEXT,UUID,UUID,UUID),public.attach_cinema_library_upload(UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_cinema_library_upload(TEXT,UUID,UUID,UUID),public.attach_cinema_library_upload(UUID,TEXT) TO service_role;
