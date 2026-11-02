-- 0433 — Reprice the two kie Kling rows for kie's 2026-11-04 price increase.
--
-- kie.ai emailed support@veyrnox.com on 2026-11-02: Kling prices rise on
-- 2026-11-04 10:00 UTC (1 credit = $0.005). Tasks submitted before the cutoff
-- are billed at the old rate, so APPLY THIS ON OR JUST BEFORE THE CUTOFF, not
-- days early. Only these two rows route to kie; the fal Kling rows are not
-- affected.
--
--   row                 kie rate card                   cost/5s           credits
--   kling-2.6-pro-kie   2.6 no audio, 5 s: 55 -> 63 cr   $0.275 -> $0.315   16 -> 18
--   kling-3.0-i2v-kie   3.0 1080p no audio: 18 -> 20.2   $0.450 -> $0.505   26 -> 29
--                       cr/s (x5 s = 101 cr)
--
-- Each credits value is ceil(cost / 0.01796), the ADR-0037 floor that keeps
-- half of gross at the $129/3000 pack. The 0366 trigger refuses an active row
-- whose cost exceeds credits * 0.01796, so cost and credits move together in
-- one UPDATE. Each UPDATE names the row's identity and accepts the old or new
-- values, so a replay is a no-op and drift stops the migration.
--
-- kling-3.0-i2v-kie is not required to be active: 0155 activates it separately
-- and may not be applied everywhere. Existing jobs keep the credits they were
-- debited. Rollback: a forward migration setting the old values back.

BEGIN;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET provider_cost_per_unit = 0.3150, credits_5s = 18, updated_at = now()
     WHERE id = 'kling-2.6-pro-kie' AND provider = 'kie' AND provider_endpoint = 'market:kling-2.6/text-to-video'
       AND cost_unit = 'per_second' AND billing_seconds = 5
       AND provider_cost_per_unit IN (0.2750, 0.3150) AND credits_5s IN (16, 18);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one kling-2.6-pro-kie row at $0.275 or $0.315, updated %', affected;
    END IF;
END $$;

DO $$
DECLARE affected BIGINT;
BEGIN
    UPDATE public.model_catalog
       SET provider_cost_per_unit = 0.5050, credits_5s = 29, updated_at = now()
     WHERE id = 'kling-3.0-i2v-kie' AND provider = 'kie' AND provider_endpoint = 'market:kling-3.0/video'
       AND cost_unit = 'per_second' AND billing_seconds = 5
       AND provider_cost_per_unit IN (0.4500, 0.5050) AND credits_5s IN (26, 29);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one kling-3.0-i2v-kie row at $0.45 or $0.505, updated %', affected;
    END IF;
END $$;

COMMIT;
