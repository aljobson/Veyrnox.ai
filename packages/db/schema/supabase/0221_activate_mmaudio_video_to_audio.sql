-- (Renumbered from 0204: production applied 0205 to 0220 first, and the workflow refuses a pending file numbered below an applied one.)
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
-- Topaz is NOT activated here and is left exactly as 0202 applied it (inactive, 49 Credits, $0.80, 10 s). Two billed runs (usage page, 2026-10-05):
--   960x540 source, 5.0 s -> 1080p output:  24 "seconds" x $0.01 = $0.24   (about $0.048 per source-second)
--   1920x1080 source, 5.7 s -> 4K output:   48 "seconds" x $0.01 = $0.48   (about $0.084 per source-second)
-- Both ran above fal's published tier table, and the rate climbs with resolution. A 10 s 1080p source extrapolates to about $0.84, already
-- over the $0.80 this row records and the $0.8085 that 49 Credits support at the 50% floor; a 4K or larger source is unmeasured and would cost
-- more. A flat per-job price cannot be both fair for a small clip and safe for a large one unless the input resolution is controlled, which
-- the server cannot verify from a URL. So Topaz stays staged; do not activate or reprice it without resolution control and a measurement at
-- the largest source it will accept.
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
