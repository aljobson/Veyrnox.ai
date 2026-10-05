-- Activate the two staged fal video rows from 0202: video to audio and video upscale.
-- One real generation of each ran through scripts/verify-fal-video-tools.mjs on 2026-10-05 against a public
-- 960x540, 5 s clip: both completed, and each result URL served the file directly (HTTP 200, no redirect,
-- host v3b.fal.media, which r2Copy's fal allowlist covers). Job time: MMAudio 131 s, Topaz 58 s.
--
-- Topaz is repriced here, in the same statement that activates it (owner: "go with recommendation", 2026-10-05).
-- 0202 priced it at the worst tier over a 10 s source: $0.08 x 10 s = $0.80 -> 49 Credits, which over-charges a short
-- clip. The source is now capped at 5 s (lib/modelCapabilities.js), so the worst case is $0.08 x 5 s = $0.40 and the
-- ADR-0014 floor is ceil(0.40 / 0.0165) = 25 Credits. 0202 is already applied on production, so it is left alone and
-- the correction is made here; the predicate pins the 0202 values (49 / 0.8000), so an edited row fails loudly.
--
-- DRAFT: do not merge until the owner has confirmed on fal's usage page that each request was billed the cost
-- the row carries (a wrong tier is a silent margin leak):
--   mmaudio-v2-video     request 01a10cce-0ea3-77d2-b3e6-a4e9638f6b6f   expect about $0.008
--   topaz-upscale-video  request 01a10cd0-0f2b-7b91-b9c0-b5d7798f577f   expect about $0.10 (1080p tier, 5 s)
-- Apply only through the owner-approved workflow. The predicates pin id, endpoint, price and cost.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = true, updated_at = now()
     WHERE id = 'mmaudio-v2-video' AND provider = 'fal' AND provider_endpoint = 'fal-ai/mmaudio-v2'
       AND modality = 'video-to-video' AND cost_unit = 'per_generation' AND gated_flag = false
       AND credits_5s = 1 AND provider_cost_per_unit = 0.0080;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one verified mmaudio-v2-video row, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = true, credits_5s = 25, provider_cost_per_unit = 0.4000,
           name = 'Topaz Video Upscale 2x (up to 5s)', updated_at = now()
     WHERE id = 'topaz-upscale-video' AND provider = 'fal' AND provider_endpoint = 'fal-ai/topaz/upscale/video'
       AND modality = 'video-to-video' AND cost_unit = 'per_generation' AND gated_flag = false
       AND active = false AND credits_5s = 49 AND provider_cost_per_unit = 0.8000;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one verified topaz-upscale-video row, updated %', affected;
    END IF;
END $$;
