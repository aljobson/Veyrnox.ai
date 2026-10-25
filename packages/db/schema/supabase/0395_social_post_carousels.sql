-- ADR-0262. The legacy claim excludes carousels on every claim path, including stale reclaims.
BEGIN;
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
          AND (SELECT count(*) FROM public.social_post_media one_media WHERE one_media.post_id = p.id) = 1
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

CREATE OR REPLACE FUNCTION public.claim_due_social_post_targets_v2(p_limit INTEGER)
RETURNS TABLE (
    target_id UUID, post_id UUID, account_id UUID, network TEXT,
    text_override TEXT, global_text TEXT, brand_id UUID, attempts INTEGER,
    access_token_enc BYTEA, refresh_token_enc BYTEA, token_expires_at TIMESTAMPTZ,
    external_account_id TEXT, media_type TEXT, r2_key TEXT,
    mime_type TEXT, size_bytes BIGINT, provider_state JSONB, claim_key UUID, media JSONB
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
        ordered.media->0->>'media_type', ordered.media->0->>'r2_key',
        ordered.media->0->>'mime_type', (ordered.media->0->>'size_bytes')::BIGINT,
        c.provider_state, c.claim_key, ordered.media
    FROM claimed c JOIN public.social_posts p ON p.id = c.post_id
    JOIN public.social_accounts a ON a.id = c.account_id
    CROSS JOIN LATERAL (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
            'position', pm.position, 'media_type', pm.media_type,
            'r2_key', coalesce(src.r2_key, upload.r2_key),
            'mime_type', coalesce(src.mime_type, upload.mime_type),
            'size_bytes', coalesce(src.size_bytes, upload.size_bytes)
        ) ORDER BY pm.position), '[]'::jsonb) AS media
        FROM public.social_post_media pm
        LEFT JOIN LATERAL (
            SELECT x.r2_key, x.mime_type, x.size_bytes FROM public.assets x
            JOIN public.jobs j ON j.id=x.job_id AND j.user_id=p.created_by_user_id
            WHERE x.job_id=pm.source_job_id AND j.deleted_at IS NULL ORDER BY x.created_at LIMIT 1
        ) src ON true
        LEFT JOIN public.social_uploads upload ON upload.id=pm.source_upload_id
            AND upload.user_id=p.created_by_user_id AND upload.status='ready'
        WHERE pm.post_id=c.post_id
    ) ordered;
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
    'attachments',(SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'position',m.position,'media_type',m.media_type,
      'r2_key',CASE WHEN EXISTS(SELECT 1 FROM public.assets h WHERE h.job_id=m.source_job_id AND h.held_at IS NOT NULL) THEN NULL ELSE coalesce(a.r2_key,u.r2_key) END,
      'mime_type',coalesce(a.mime_type,u.mime_type),
      'held',EXISTS(SELECT 1 FROM public.assets h WHERE h.job_id=m.source_job_id AND h.held_at IS NOT NULL))) ORDER BY m.position),'[]'::jsonb)
      FROM public.social_post_media m LEFT JOIN LATERAL (
        SELECT x.r2_key,x.mime_type FROM public.assets x JOIN public.jobs j ON j.id=x.job_id
        WHERE x.job_id=m.source_job_id AND j.user_id=p.created_by_user_id AND j.deleted_at IS NULL
        ORDER BY x.created_at LIMIT 1
      ) a ON true LEFT JOIN public.social_uploads u ON u.id=m.source_upload_id AND u.user_id=p.created_by_user_id AND u.status='ready'
      WHERE m.post_id=p.id),
    'media',(SELECT jsonb_strip_nulls(jsonb_build_object('media_type',m.media_type,'r2_key',coalesce(a.r2_key,u.r2_key),'mime_type',coalesce(a.mime_type,u.mime_type),
        'held',EXISTS(SELECT 1 FROM public.assets h WHERE h.job_id=m.source_job_id AND h.held_at IS NOT NULL)))
      FROM public.social_post_media m LEFT JOIN public.assets a ON a.job_id=m.source_job_id AND a.held_at IS NULL LEFT JOIN public.social_uploads u ON u.id=m.source_upload_id WHERE m.post_id=p.id ORDER BY m.position LIMIT 1)) INTO v
  FROM public.social_approval_reviewers rv JOIN public.social_approval_requests r ON r.id=rv.request_id
  JOIN public.social_posts p ON p.id=r.post_id JOIN public.social_brands b ON b.id=r.brand_id WHERE rv.id=p_reviewer_id;
  RETURN coalesce(v,jsonb_build_object('ok',false,'code','REVIEW_NOT_FOUND'));
END $$;
REVOKE ALL ON FUNCTION public.claim_due_social_post_targets(INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_social_post_targets(INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.claim_due_social_post_targets_v2(INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_social_post_targets_v2(INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.get_social_approval_review(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_social_approval_review(UUID) TO service_role;
-- Retain the claim and its hold rollback snapshot during in-tick progress.
CREATE OR REPLACE FUNCTION public.checkpoint_social_carousel(p_target_id UUID,p_claim_key UUID,p_provider_state JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_state JSONB;
BEGIN
  SELECT provider_state INTO v_state FROM public.social_post_targets
    WHERE id=p_target_id AND claim_key=p_claim_key AND publish_status='publishing'
      AND network IN ('instagram','threads') FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','CLAIM_LOST'); END IF;
  IF p_provider_state IS NULL OR jsonb_typeof(p_provider_state)<>'object' THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_STATE'); END IF;
  v_state:=p_provider_state || CASE WHEN v_state ? 'submission_started'
    THEN '{"submission_started":true}'::jsonb ELSE '{}'::jsonb END;
  UPDATE public.social_post_targets SET provider_state=v_state,claimed_provider_state=v_state,claimed_at=now()
    WHERE id=p_target_id;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.checkpoint_social_carousel(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.checkpoint_social_carousel(UUID,UUID,JSONB) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
