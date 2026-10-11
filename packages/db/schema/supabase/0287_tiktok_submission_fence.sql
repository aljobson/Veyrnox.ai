-- ADR-0093: TikTok inbox delivery is an irreversible submission too. A lost init
-- response must not create another pending share on retry. Preserve the
-- existing exact-claim fence, one-time marker and service-only ACLs.
CREATE OR REPLACE FUNCTION public.mark_social_provider_submission(p_target_id UUID, p_claim_key UUID, p_network TEXT)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    UPDATE public.social_post_targets
    SET provider_state = provider_state || '{"submission_started":true}'::JSONB
    WHERE id = p_target_id AND claim_key = p_claim_key AND publish_status = 'publishing'
      AND network = p_network AND network IN ('facebook','threads','pinterest','bluesky','gmb','instagram','linkedin','twitter','tiktok')
      AND NOT (provider_state ? 'submission_started')
    RETURNING jsonb_build_object('ok', true);
$$;
REVOKE ALL ON FUNCTION public.mark_social_provider_submission(UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_social_provider_submission(UUID,UUID,TEXT) TO service_role;
