-- Activate four Face Filters staged by 0356: A1 skin retouch, A2 face enhancement,
-- A4 digital makeup, A5 age modify. A3 relight stays staged (see below).
--
-- Evidence: one real job per endpoint ran on 2026-10-20 through scripts/verify-filter-endpoints.mjs
-- and each returned an output. fal's usage page (read 2026-10-20) billed:
--   fal-ai/image-editing/retouch              1 image   x $0.04 = $0.04
--   fal-ai/image-editing/face-enhancement     1 image   x $0.04 = $0.04
--   fal-ai/image-apps-v2/makeup-application   1 image   x $0.04 = $0.04
--   fal-ai/image-apps-v2/age-modify           1 image   x $0.04 = $0.04
-- The recorded cost ($0.0400) is unchanged and 3 Credits is the minimum that clears the
-- ADR-0014 floor, ceil(0.04 / 0.0165) = 3. The predicate pins the 0356 values (inactive,
-- 3 Credits, 0.0400), so an edited row fails loudly.
--
-- NOT activated: face-relight (fal-ai/iclight-v2). The same run billed 2.00 megapixels =
-- $0.20, double the $0.10 recorded, but the test script did not send our pinned 1000x1000
-- canvas, so it does not show what a gateway job bills. At 7 Credits a $0.20 bill is a ~13%
-- margin. Run one job with the pinned payload; if it bills 1 MP, activate as is, otherwise
-- reprice (13 Credits clears the floor at $0.20).
--
-- Apply only through the owner-approved workflow.
DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET active = true, updated_at = now()
     WHERE provider = 'fal' AND modality = 'image-to-image' AND cost_unit = 'per_generation' AND gated_flag = false
       AND active = false AND credits_5s = 3 AND provider_cost_per_unit = 0.0400
       AND (id, provider_endpoint) IN (
           ('face-retouch', 'fal-ai/image-editing/retouch'),
           ('face-enhance', 'fal-ai/image-editing/face-enhancement'),
           ('face-makeup', 'fal-ai/image-apps-v2/makeup-application'),
           ('face-age', 'fal-ai/image-apps-v2/age-modify'));
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 4 THEN
        RAISE EXCEPTION 'Expected four verified face filter rows, updated %', affected;
    END IF;
END $$;
