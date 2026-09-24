-- Switch MiniMax Hailuo 02 from fal to its verified kie twin (ADR-0020).
-- Evidence, 2026-09-24: task 408da84ad1071e48a5ec5bc42d1c7de8 succeeded;
-- kie dashboard charge 30 credits = $0.15. Result preview video metadata:
-- 1366x768, 5.875s (the nominal 6s tier), served by tempfile.aiquickdraw.com.
-- The standalone adapter verification recorded HTTP 200 without redirects.
-- Request pins duration "6" and nsfw_checker:true. No new paid test needed.
-- The existing kie webhook/R2 path is unchanged; an app-level Hailuo run is
-- still outstanding. Seedream, ElevenLabs TTS and GrsAI are not activated here.
-- Retail changes from 17 to 10 credits, with the same plain display name.
-- Both updates are atomic, replay-safe and assert the expected row count.
-- Rollback: a new guarded migration restores fal active and kie inactive.
DO $$
DECLARE affected INTEGER;
BEGIN
    UPDATE public.model_catalog
       SET active = true, name = 'MiniMax Hailuo 02', updated_at = now()
     WHERE id = 'hailuo-02-kie' AND provider = 'kie'
       AND provider_endpoint = 'market:hailuo/02-text-to-video-standard'
       AND credits_5s = 10 AND provider_cost_per_unit = 0.1500
       AND cost_unit = 'per_second' AND billing_seconds = 6;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one verified hailuo-02-kie row at 10 credits and $0.15, updated %', affected;
    END IF;

    UPDATE public.model_catalog
       SET active = false, updated_at = now()
     WHERE id = 'minimax-hailuo-02' AND provider = 'fal'
       AND provider_endpoint = 'fal-ai/minimax/hailuo-02/standard/text-to-video';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one minimax-hailuo-02/fal row, updated %', affected;
    END IF;
END $$;
