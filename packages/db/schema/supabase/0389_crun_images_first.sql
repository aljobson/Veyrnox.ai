-- 0389 — Nano Banana and Seedream 4: Crun becomes the first route and each falls from 2 credits to 1 (ADR-0256, ADR-0037).
--
-- Evidence (the owner's key, paid probes 2026-10-25, scripts/probe-crun.mjs nano-banana | seedream):
--   google/nano-banana     task 3b63f9cc-b179-40b0-8f27-ce236150facf: success after 17 s, PNG 1024x1024, a red paper boat on a calm lake at
--     dusk, read by Claude Code: coherent, follows the prompt, no watermark or overlay;
--   bytedance/seedream-4   task 1f9ceec6-5b8c-4896-99bb-8fe4c02e7b4b: success after 11 s, JPEG 2048x2048, a red paper boat in ripples at
--     sunrise, read by Claude Code: coherent, no watermark or overlay (2048 is the size the fal row renders).
-- Both came from static.mediaoss.bar, already on the R2 copy allowlist.
-- Cost: 3 Crun credits each on Crun's price pages, at the owner's top-up rate of 206 credits per $1 = $0.0146.
-- NOT established: the charge in crun.ai/logs (the owner reads it; 3 credits expected), whether Crun's google/nano-banana is
-- the same model as kie's, and which channel makes either image. The route provenance is `licensed_reseller` (0375).
--
-- 1 credit is the smallest price that keeps 50% at $0.0146 (cap $0.01796 per credit, ADR-0037); 0.0146 > 0.5 * 0.01796, so a
-- whole credit is the floor. kie ($0.0200) and fal ($0.0300) stay second: above the 1-credit cap, so a failover hop onto
-- either needs a margin waiver (ADR-0256 decision 3) and a job Crun refuses is refunded.
--
-- Each UPDATE names the row's exact identity and asserts one row. Idempotent. Existing jobs keep the credits they were debited.
-- Rollback: a forward migration with model_route_reorder (kie / fal first) and credits back at 2.

BEGIN;

DO $$
DECLARE
    r RECORD;
    affected BIGINT;
    res jsonb;
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('nano-banana-kie', 'crun:google/nano-banana', 'probe 2026-10-25 (owner key): google/nano-banana, task 3b63f9cc-b179-40b0-8f27-ce236150facf success after 17 s, PNG 1024x1024, image read by Claude Code (coherent, no watermark); charge in crun.ai/logs to be confirmed by the owner (3 credits expected); model identity vs kie not established'),
        ('seedream-4', 'crun:bytedance/seedream-4', 'probe 2026-10-25 (owner key): bytedance/seedream-4, task 1f9ceec6-5b8c-4896-99bb-8fe4c02e7b4b success after 11 s, JPEG 2048x2048, image read by Claude Code (coherent, no watermark); charge in crun.ai/logs to be confirmed by the owner (3 credits expected)')
    ) AS v(model_id, endpoint, note)
    LOOP
        -- 1. record the evidence and the real cost on the Crun route and make it active
        UPDATE public.model_routes
           SET parity_record = r.note, cost_per_unit = 0.0146, state = 'active', updated_at = now()
         WHERE supplier = 'crun' AND endpoint = r.endpoint AND model_id = r.model_id
           AND provenance = 'licensed_reseller' AND cost_unit = 'per_generation'
           AND cost_per_unit = 0.0146 AND state IN ('standby', 'active')
           AND (parity_record IS NULL OR parity_record LIKE 'probe 2026-10-25 (owner key): %');
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 1 THEN
            RAISE EXCEPTION 'Expected one Crun route for % to prove and activate, updated %', r.model_id, affected;
        END IF;

        -- 2. put Crun first through the guarded reorder where it is not already first
        IF EXISTS (SELECT 1 FROM public.model_catalog WHERE id = r.model_id AND provider <> 'crun') THEN
            SELECT public.model_route_reorder(
                r.model_id,
                (SELECT array_agg(id ORDER BY CASE supplier WHEN 'crun' THEN 0 ELSE 1 END, priority)
                   FROM public.model_routes WHERE model_id = r.model_id AND state = 'active'),
                'Crun first for ' || r.model_id || ', parity 2026-10-25 (0389)'
            ) INTO res;
            IF NOT COALESCE((res->>'ok')::boolean, false) THEN
                RAISE EXCEPTION 'Could not put Crun first for %: %', r.model_id, res;
            END IF;
        END IF;

        -- 3. price the offer at 1 credit
        UPDATE public.model_catalog SET credits_5s = 1, updated_at = now()
         WHERE id = r.model_id AND provider = 'crun' AND provider_endpoint = r.endpoint
           AND provider_cost_per_unit = 0.0146 AND cost_unit = 'per_generation' AND billing_seconds IS NULL
           AND active AND credits_5s IN (2, 1);
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 1 THEN
            RAISE EXCEPTION 'Expected one % row on Crun, updated %', r.model_id, affected;
        END IF;
    END LOOP;
END $$;

COMMIT;
