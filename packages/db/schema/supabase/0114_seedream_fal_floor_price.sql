-- Retain the verified Seedream 4 fal route; correct its public list cost.
-- https://fal.ai/models/fal-ai/bytedance/seedream/v4/text-to-image
-- Checked 2026-09-24: $0.03 per image, not the catalog's stale $0.04.
-- ADR-0014: ceil(0.03 / 0.0165) = 2 credits. Owner chose to keep v4.
-- Preserve activation state and reject unexpected routing/unit/price drift.
-- The old and new price pairs allow safe replay without overwriting drift.
-- Rollback requires a new guarded migration, never editing this file.
DO $$
DECLARE affected INTEGER;
BEGIN
    UPDATE public.model_catalog
       SET provider_cost_per_unit = 0.0300, credits_5s = 2, updated_at = now()
     WHERE id = 'seedream-4' AND provider = 'fal'
       AND provider_endpoint = 'fal-ai/bytedance/seedream/v4/text-to-image'
       AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND ((provider_cost_per_unit = 0.0400 AND credits_5s = 3)
         OR (provider_cost_per_unit = 0.0300 AND credits_5s = 2));
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one seedream-4/fal row with known pricing and unit, updated %', affected;
    END IF;
END $$;
