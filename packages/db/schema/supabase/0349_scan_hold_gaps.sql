-- Scan and hold gaps found reviewing 0288/0289 (PR #886).
--  1. A post for a generated image could be sent while the image's scan was still
--     queued or scanning: the claim and the dispatch check looked at held_at only.
--     While the scanner is armed, a scan younger than an hour now defers the
--     target (MEDIA_SCANNING) exactly as a hold does. An older undecided scan
--     fails open, as ADR-0083 amendment 1 says it does for an outage, so a dead
--     scanner cannot block publishing for good. Nothing changes while the
--     scanner is disarmed, which is its state wherever CONTENT_SCAN_ENABLED is off.
--  2. get_social_approval_review gave an external reviewer the r2_key of a held
--     image. Held media now returns no key and "held": true.
BEGIN;
CREATE OR REPLACE FUNCTION public.social_post_media_unscanned(p_post_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (SELECT 1 FROM public.content_scan_monitor WHERE armed)
  AND EXISTS (SELECT 1 FROM public.social_post_media m
   JOIN public.assets a ON a.job_id=m.source_job_id
   JOIN public.content_scans s ON s.asset_id=a.id
   WHERE m.post_id=p_post_id AND s.status IN ('queued','scanning') AND s.queued_at > now()-interval '1 hour');
$$;
REVOKE ALL ON FUNCTION public.social_post_media_unscanned(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.social_post_media_unscanned(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.authorize_social_target_dispatch(p_target_id UUID,p_claim_key UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.social_post_targets%ROWTYPE; v_held BOOLEAN := false; v_scanning BOOLEAN := false; v_asset RECORD;
BEGIN
 IF p_claim_key IS NULL THEN RETURN jsonb_build_object('ok',false,'code','CLAIM_KEY_REQUIRED'); END IF;
 SELECT * INTO v FROM public.social_post_targets WHERE id=p_target_id FOR UPDATE;
 IF v.id IS NULL OR v.publish_status <> 'publishing' OR NOT (v.claim_key IS NOT DISTINCT FROM p_claim_key) THEN
  RETURN jsonb_build_object('ok',false,'code','CLAIM_LOST');
 END IF;
 FOR v_asset IN SELECT a.held_at FROM public.assets a JOIN public.social_post_media m ON m.source_job_id=a.job_id
  WHERE m.post_id=v.post_id ORDER BY a.id FOR UPDATE OF a
 LOOP
  v_held := v_held OR v_asset.held_at IS NOT NULL;
 END LOOP;
 v_scanning := NOT v_held AND public.social_post_media_unscanned(v.post_id);
 IF v_held OR v_scanning THEN
  UPDATE public.social_post_targets
   SET publish_status=CASE WHEN claimed_from_status='publishing' THEN 'pending' ELSE COALESCE(claimed_from_status,'pending') END,
    attempts=COALESCE(claimed_attempts,GREATEST(attempts-1,0)), provider_state=COALESCE(claimed_provider_state,provider_state),
    next_attempt_at=CASE WHEN claimed_from_status='submitted' THEN now()+interval '5 minutes' WHEN claimed_from_status='publishing' THEN now() ELSE next_attempt_at END,
    claim_key=NULL,claimed_from_status=NULL,claimed_attempts=NULL,claimed_provider_state=NULL WHERE id=p_target_id;
  RETURN jsonb_build_object('ok',false,'code',CASE WHEN v_held THEN 'MEDIA_HELD' ELSE 'MEDIA_SCANNING' END);
 END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE OR REPLACE FUNCTION public.claim_due_social_post_targets(p_limit INTEGER)
RETURNS TABLE (
    target_id UUID, post_id UUID, account_id UUID, network TEXT,
    text_override TEXT, global_text TEXT, brand_id UUID, attempts INTEGER,
    access_token_enc BYTEA, refresh_token_enc BYTEA, token_expires_at TIMESTAMPTZ,
    external_account_id TEXT, media_type TEXT, r2_key TEXT,
    mime_type TEXT, size_bytes BIGINT, provider_state JSONB, claim_key UUID
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
BEGIN
    PERFORM public.social_fail_inactive_targets(NULL);
    RETURN QUERY
    WITH due AS (
        SELECT t.id, t.publish_status AS prior_status FROM public.social_post_targets t JOIN public.social_posts p ON p.id = t.post_id JOIN public.social_accounts a ON a.id = t.account_id WHERE p.status = 'scheduled'
          AND p.scheduled_at <= now()
          AND a.status = 'active'
          AND (
              ((t.publish_status = 'pending' AND (t.next_attempt_at IS NULL OR t.next_attempt_at <= now()))
              OR (t.publish_status = 'publishing' AND t.claimed_at <= now() - interval '15 minutes'))
               AND NOT EXISTS (SELECT 1 FROM public.social_post_media m JOIN public.assets ast ON ast.job_id=m.source_job_id WHERE m.post_id=t.post_id AND ast.held_at IS NOT NULL)
               AND NOT public.social_post_media_unscanned(t.post_id)
              OR (t.publish_status = 'submitted' AND t.next_attempt_at IS NOT NULL AND t.next_attempt_at <= now())
          ) ORDER BY p.scheduled_at LIMIT least(greatest(COALESCE(p_limit, 1), 1), 50)
        FOR UPDATE OF t SKIP LOCKED
    ),
    claimed AS (
        UPDATE public.social_post_targets t
        SET publish_status = 'publishing',
            claimed_from_status = due.prior_status, claimed_attempts = t.attempts, claimed_provider_state = t.provider_state,
            claimed_at = now(),
            claim_key = gen_random_uuid(),
            attempts = CASE WHEN due.prior_status = 'submitted' THEN t.attempts ELSE t.attempts + 1 END FROM due WHERE t.id = due.id
        RETURNING t.id, t.post_id, t.account_id, t.network, t.text_override, t.attempts, t.provider_state, t.claim_key
    )
    SELECT c.id, c.post_id, c.account_id, c.network, c.text_override, p.global_text, p.brand_id, c.attempts,
        a.access_token_enc, a.refresh_token_enc, a.token_expires_at, a.external_account_id,
        m.media_type, coalesce(ast.r2_key,up.r2_key), coalesce(ast.mime_type,up.mime_type), coalesce(ast.size_bytes,up.size_bytes), c.provider_state, c.claim_key FROM claimed c JOIN public.social_posts p ON p.id = c.post_id JOIN public.social_accounts a ON a.id = c.account_id LEFT JOIN LATERAL (
        SELECT pm.media_type, pm.source_job_id, pm.source_upload_id FROM public.social_post_media pm WHERE pm.post_id = c.post_id ORDER BY pm."position" LIMIT 1
    ) m ON true LEFT JOIN LATERAL (
        SELECT x.r2_key, x.mime_type, x.size_bytes FROM public.assets x WHERE x.job_id = m.source_job_id ORDER BY x.created_at LIMIT 1
    ) ast ON true LEFT JOIN public.social_uploads up ON up.id = m.source_upload_id AND up.status = 'ready';
END $$;
CREATE OR REPLACE FUNCTION public.get_social_approval_review(p_reviewer_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v JSONB;
BEGIN
  SELECT jsonb_build_object('ok',true,'reviewer_id',rv.id,'decision',rv.decision,
    'request_id',r.id,'request_status',r.status,'policy',r.policy,'scheduled_at',p.scheduled_at,
    'global_text',p.global_text,'brand_name',b.label,
    'networks',(SELECT coalesce(jsonb_agg(t.network ORDER BY t.network),'[]'::jsonb) FROM public.social_post_targets t WHERE t.post_id=p.id),
    'targets',(SELECT coalesce(jsonb_agg(jsonb_build_object('network',t.network,'text',coalesce(t.text_override,p.global_text)) ORDER BY t.network),'[]'::jsonb) FROM public.social_post_targets t WHERE t.post_id=p.id),
    'media',(SELECT jsonb_strip_nulls(jsonb_build_object('media_type',m.media_type,'r2_key',coalesce(a.r2_key,u.r2_key),'mime_type',coalesce(a.mime_type,u.mime_type),
        'held',EXISTS(SELECT 1 FROM public.assets h WHERE h.job_id=m.source_job_id AND h.held_at IS NOT NULL)))
      FROM public.social_post_media m LEFT JOIN public.assets a ON a.job_id=m.source_job_id AND a.held_at IS NULL LEFT JOIN public.social_uploads u ON u.id=m.source_upload_id WHERE m.post_id=p.id ORDER BY m.position LIMIT 1)) INTO v
  FROM public.social_approval_reviewers rv JOIN public.social_approval_requests r ON r.id=rv.request_id
  JOIN public.social_posts p ON p.id=r.post_id JOIN public.social_brands b ON b.id=r.brand_id WHERE rv.id=p_reviewer_id;
  RETURN coalesce(v,jsonb_build_object('ok',false,'code','REVIEW_NOT_FOUND'));
END $$;
REVOKE ALL ON FUNCTION public.get_social_approval_review(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_social_approval_review(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.authorize_social_target_dispatch(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_social_target_dispatch(UUID,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.claim_due_social_post_targets(INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_social_post_targets(INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.get_social_approval_review(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_social_approval_review(UUID) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
