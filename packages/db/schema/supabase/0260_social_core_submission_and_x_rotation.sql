-- 0260_social_core_submission_and_x_rotation.sql
-- Two widenings for the core publishing networks (audit 2026-10-09, S-03
-- and S-04; D-01 is the same two on the day Publish opens in production).
--
-- S-03. The Instagram, LinkedIn and X dispatchers called the provider with no
-- "submission started" marker, so a timeout after the provider had accepted
-- the post, or a failed report, sent the post again on the next attempt (up
-- to three) or on the 15-minute stale reclaim. The extended networks already
-- mark the row first through mark_social_provider_submission (0228) and
-- refuse to resend a marked one; the function's network list is widened to
-- the three core networks and lib/socialPublishSweep.js now marks them the
-- same way.
--
-- S-04. X access tokens last about two hours and were never refreshed, so a
-- post scheduled more than two hours after connecting failed three times.
-- The sweep now refreshes X (and TikTok) tokens in dispatch when they are
-- near expiry; X rotates the refresh token on each use, so the stored pair is
-- replaced only when it still matches what was read (a compare-and-swap),
-- through rotate_extended_social_tokens, whose network list gains 'twitter'.
-- TikTok already has rotate_tiktok_account_tokens (0190).
--
-- Both bodies are 0228's with one list each widened. Same signatures and
-- grants. Idempotent: OR REPLACE, REVOKE and GRANT re-run.

CREATE OR REPLACE FUNCTION public.mark_social_provider_submission(p_target_id UUID, p_claim_key UUID, p_network TEXT)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    UPDATE public.social_post_targets
    SET provider_state = provider_state || '{"submission_started":true}'::JSONB
    WHERE id = p_target_id AND claim_key = p_claim_key AND publish_status = 'publishing'
      AND network = p_network AND network IN ('facebook','threads','pinterest','bluesky','gmb','instagram','linkedin','twitter')
      AND NOT (provider_state ? 'submission_started')
    RETURNING jsonb_build_object('ok', true);
$$;
REVOKE ALL ON FUNCTION public.mark_social_provider_submission(UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_social_provider_submission(UUID,UUID,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.rotate_extended_social_tokens(
    p_account_id UUID, p_network TEXT, p_expected_access_token_enc BYTEA, p_expected_refresh_token_enc BYTEA,
    p_access_token_enc BYTEA, p_refresh_token_enc BYTEA, p_token_expires_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    UPDATE public.social_accounts SET access_token_enc = p_access_token_enc, refresh_token_enc = p_refresh_token_enc,
        token_expires_at = p_token_expires_at
    WHERE id = p_account_id AND network = p_network AND status = 'active'
      AND p_network IN ('pinterest','threads','bluesky','twitch','gmb','twitter')
      AND access_token_enc = p_expected_access_token_enc
      AND refresh_token_enc IS NOT DISTINCT FROM p_expected_refresh_token_enc
      AND (p_network = 'threads' OR octet_length(p_expected_refresh_token_enc) > 0)
      AND octet_length(p_access_token_enc) > 0
      AND (p_network = 'threads' OR octet_length(p_refresh_token_enc) > 0)
      AND p_token_expires_at > now() AND p_token_expires_at < 'infinity'::TIMESTAMPTZ
    RETURNING jsonb_build_object('ok', true);
$$;
REVOKE ALL ON FUNCTION public.rotate_extended_social_tokens(UUID,TEXT,BYTEA,BYTEA,BYTEA,BYTEA,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_extended_social_tokens(UUID,TEXT,BYTEA,BYTEA,BYTEA,BYTEA,TIMESTAMPTZ) TO service_role;
