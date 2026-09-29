-- Applied name: 0158_cinema_proxy_transfers
-- Renumbered after production advanced to 0162; staging already records 0158.
-- Legacy grants may already be public: never relabel them as server-only.
ALTER TABLE public.cinema_uploads ADD COLUMN IF NOT EXISTS server_mediated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.cinema_uploads ADD COLUMN IF NOT EXISTS transfer_claim UUID;
ALTER TABLE public.cinema_uploads ADD COLUMN IF NOT EXISTS transfer_started_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.reserve_cinema_proxy_upload(p_auth_id TEXT,p_content_id UUID,p_key UUID,p_size BIGINT,p_fingerprint TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result JSONB; v_row public.cinema_uploads%ROWTYPE;
BEGIN
  v_result:=public.reserve_cinema_upload(p_auth_id,p_content_id,p_key,p_size,p_fingerprint);
  IF v_result ? 'error' THEN RETURN v_result; END IF;
  IF (v_result->>'claimed')::boolean THEN
    UPDATE public.cinema_uploads SET server_mediated=true WHERE id=(v_result->>'id')::uuid RETURNING * INTO v_row;
  ELSE
    SELECT * INTO v_row FROM public.cinema_uploads WHERE id=(v_result->>'id')::uuid;
    IF NOT v_row.server_mediated THEN RETURN jsonb_build_object('error','upload_needs_reconciliation'); END IF;
  END IF;
  RETURN to_jsonb(v_row)||jsonb_build_object('claimed',(v_result->>'claimed')::boolean);
END $$;

-- A claim has deliberately NO automatic expiry. An interrupted PATCH may
-- still be running upstream; reclaiming by time could race a DELETE.
CREATE OR REPLACE FUNCTION public.claim_cinema_transfer(p_auth_id TEXT,p_content_id UUID,p_upload_id UUID,p_key UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_row public.cinema_uploads%ROWTYPE;
BEGIN
  v_user:=public.cinema_upload_owner(p_auth_id,p_content_id);
  IF v_user IS NULL THEN RETURN jsonb_build_object('error','upload_not_allowed'); END IF;
  PERFORM 1 FROM public.cinema_memberships WHERE user_id=v_user FOR UPDATE;
  IF public.cinema_upload_owner(p_auth_id,p_content_id) IS NULL THEN RETURN jsonb_build_object('error','upload_not_allowed'); END IF;
  IF p_key IS NULL THEN RETURN jsonb_build_object('error','invalid_upload'); END IF;
  SELECT * INTO v_row FROM public.cinema_uploads WHERE id=p_upload_id AND content_id=p_content_id AND creator_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','upload_not_allowed'); END IF;
  IF v_row.state IN ('deleting','deleted') THEN RETURN jsonb_build_object('error','upload_removed'); END IF;
  IF NOT v_row.server_mediated THEN RETURN jsonb_build_object('error','upload_needs_reconciliation'); END IF;
  IF v_row.state<>'uploading' OR v_row.expires_at<=clock_timestamp() OR v_row.upload_url IS NULL THEN RETURN jsonb_build_object('error','upload_not_writable'); END IF;
  IF v_row.transfer_claim IS NOT NULL THEN RETURN jsonb_build_object('error','upload_busy'); END IF;
  UPDATE public.cinema_uploads SET transfer_claim=p_key,transfer_started_at=clock_timestamp() WHERE id=p_upload_id;
  RETURN jsonb_build_object('ok',true,'upload_url',v_row.upload_url,'file_size',v_row.file_size);
END $$;

CREATE OR REPLACE FUNCTION public.finish_cinema_transfer(p_upload_id UUID,p_key UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.cinema_uploads SET transfer_claim=NULL,transfer_started_at=NULL
    WHERE id=p_upload_id AND transfer_claim=p_key AND server_mediated;
  IF FOUND THEN RETURN jsonb_build_object('ok',true); END IF;
  RETURN jsonb_build_object('error','stale_claim');
END $$;

CREATE OR REPLACE FUNCTION public.claim_cinema_upload_removals(p_key UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_items JSONB;
BEGIN
  IF p_key IS NULL THEN RETURN jsonb_build_object('error','invalid_claim'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key::TEXT,139));
  IF NOT EXISTS(SELECT 1 FROM public.cinema_uploads WHERE delete_claim=p_key) THEN
    WITH candidates AS (
      SELECT id FROM public.cinema_uploads WHERE state='deleting' AND stream_uid IS NOT NULL
        AND server_mediated AND transfer_claim IS NULL
        AND (delete_claimed_at IS NULL OR delete_claimed_at<=now()-interval '5 minutes')
      ORDER BY delete_claimed_at NULLS FIRST,id LIMIT 10 FOR UPDATE SKIP LOCKED
    ) UPDATE public.cinema_uploads u SET delete_claim=p_key,delete_claimed_at=now() FROM candidates c WHERE u.id=c.id;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'stream_uid',stream_uid) ORDER BY id),'[]'::JSONB)
    INTO v_items FROM public.cinema_uploads WHERE delete_claim=p_key AND state='deleting'
      AND server_mediated AND transfer_claim IS NULL;
  RETURN jsonb_build_object('items',v_items);
END $$;

CREATE OR REPLACE FUNCTION public.finish_cinema_upload_removal(p_id UUID,p_key UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(137,1);
  UPDATE public.cinema_uploads SET state='deleted',deleted_at=clock_timestamp(),stream_uid=NULL,upload_url=NULL,
    duration_seconds=NULL,width=NULL,height=NULL
    WHERE id=p_id AND state='deleting' AND delete_claim=p_key AND server_mediated AND transfer_claim IS NULL;
  IF FOUND OR EXISTS(SELECT 1 FROM public.cinema_uploads WHERE id=p_id AND state='deleted' AND delete_claim=p_key AND server_mediated AND transfer_claim IS NULL) THEN
    RETURN jsonb_build_object('ok',true);
  END IF;
  RETURN jsonb_build_object('error','stale_claim');
END $$;

REVOKE ALL ON FUNCTION public.reserve_cinema_proxy_upload(TEXT,UUID,UUID,BIGINT,TEXT),public.claim_cinema_transfer(TEXT,UUID,UUID,UUID),public.finish_cinema_transfer(UUID,UUID),public.claim_cinema_upload_removals(UUID),public.finish_cinema_upload_removal(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_cinema_proxy_upload(TEXT,UUID,UUID,BIGINT,TEXT),public.claim_cinema_transfer(TEXT,UUID,UUID,UUID),public.finish_cinema_transfer(UUID,UUID),public.claim_cinema_upload_removals(UUID),public.finish_cinema_upload_removal(UUID,UUID) TO service_role;
