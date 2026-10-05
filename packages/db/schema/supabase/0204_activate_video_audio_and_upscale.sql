-- Activate video to audio (MMAudio v2) from 0202, with its recorded cost corrected to what fal actually billed.
-- One real generation ran through scripts/verify-fal-video-tools.mjs on 2026-10-05 against a public 960x540, 5 s clip: it completed,
-- and the result URL served the file directly (HTTP 200, no redirect, host v3b.fal.media, which r2Copy's fal allowlist covers).
--
-- What fal billed (usage page, read 2026-10-05):
--   fal-ai/mmaudio-v2   10 s x $0.001 = $0.0100   (we asked for 8 s of audio and expected $0.0080; fal billed 10 s)
--   fal-ai/topaz/upscale/video   24 "seconds" x $0.01 = $0.24 for ONE 5 s, 960x540 source, where the published tier table
--                                predicted about $0.10. The billed quantity (24 for a 5 s clip) does not follow that table.
--
-- MMAudio: the recorded cost is raised from 0.0080 to 0.0100. One Credit still clears the 50% floor, ceil(0.0100 / 0.0165) = 1, and the
-- source stays capped at 8 s. The predicate pins the 0202 values (inactive, 1 Credit, 0.0080), so an edited row fails loudly.
--
-- Topaz is NOT activated here and is left exactly as 0202 applied it (inactive, 49 Credits, $0.80, 10 s). One billed run at $0.24 is
-- the mildest case (the largest output that is still 1080p), and it already ran 2.4x the table, so the worst case for a larger source is
-- not bounded by anything measured. It needs a second measurement at a larger source (and an answer for how fal derives the quantity)
-- before it is activated or repriced; until then it stays staged.
--
-- Apply only through the owner-approved workflow.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = true, provider_cost_per_unit = 0.0100, updated_at = now()
     WHERE id = 'mmaudio-v2-video' AND provider = 'fal' AND provider_endpoint = 'fal-ai/mmaudio-v2'
       AND modality = 'video-to-video' AND cost_unit = 'per_generation' AND gated_flag = false
       AND active = false AND credits_5s = 1 AND provider_cost_per_unit = 0.0080;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one verified mmaudio-v2-video row, updated %', affected;
    END IF;
END $$;
