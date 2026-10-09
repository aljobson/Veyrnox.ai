-- ACE-Step: the recorded provider cost is corrected from 0.0100 to 0.0120, what fal bills for the track we pin.
-- https://fal.ai/models/fal-ai/ace-step, read 2026-10-09: "Your request will cost $0.0002 per second of generated audio."
-- lib/modelCapabilities.js pins duration: 60 for fal-ai/ace-step (fal's schema: default 60, min 5, max 240), so one
-- generation is 60 s x $0.0002 = $0.0120. The catalog recorded $0.0100, $0.002 under.
--
-- This is not a fal price change: the rate was already $0.0002 per second when the record was written on 2026-09-22.
-- No fal invoice was read; the figure rests on fal's published rate and our own pin.
--
-- The customer price does not change. One Credit still clears the 50% floor of ADR-0014: ceil(0.0120 / 0.0165) = 1.
-- At the $0.033 reference rate the margin is 63.6%, where the old record showed 69.7%.
--
-- Only provider_cost_per_unit moves. credits_5s, cost_unit, billing_seconds and active are left as they are.
-- The predicate names the route and unit the figure is true for and the two known costs, so a replay matches the
-- corrected row and a row that has drifted to another route, unit or cost fails loudly instead of being overwritten.
-- Rollback is a new guarded migration, never an edit to this file.
DO $$
DECLARE affected INTEGER;
BEGIN
    UPDATE public.model_catalog
       SET provider_cost_per_unit = 0.0120, updated_at = now()
     WHERE id = 'ace-step' AND provider = 'fal'
       AND provider_endpoint = 'fal-ai/ace-step'
       AND cost_unit = 'per_generation' AND billing_seconds IS NULL
       AND provider_cost_per_unit IN (0.0100, 0.0120);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one ace-step/fal row on the known route, unit and cost, updated %', affected;
    END IF;
END $$;
