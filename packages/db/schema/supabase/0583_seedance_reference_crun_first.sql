-- 0583 — Seedance 2.0 Reference: Crun first, fal second, for the proved shape only; the price does not change (ADR-0256).
--
-- Evidence (the owner's paid proofs, 2026-11-22, run-crun-kling-seedance-proofs.mjs, model bytedance/seedance2-0-r2v,
-- 720p, 5 s, sound on, a 720x1280 test pattern; one sample each):
--   image only: task c6be2f4e-aaa4-47e5-994a-209cdb6961b4, success in 179 s, 157.93 credits, 720x1280, 5.088 s, audio track.
--   image plus a 5.000 s reference video: task 193ea5bf-d737-4af4-8fa3-8fe1de3c538c, success in 241 s, 191.46 credits,
--   720x1280, 5.088 s, audio track.
--
-- Cost at 206 Crun credits per $1, against 85 x 0.01796 = $1.5266:
--   image only $0.7667; image plus video $0.9294. A reference video bills input plus output seconds at 19 credits, and the
--   Worker caps it at 5.05 s, so the recorded worst case is 193 credits = $0.9369. fal, second, is $1.5120.
--
-- The Worker refuses 10 s, 1080p and 4K before the debit on this route. NOT established: a real person or scene, more than one
-- reference picture, aspect ratios other than the portrait proved, Crun fetching our signed R2 links, and which model made
-- the output. An image-source job never hops, so a job Crun refuses is refunded.
--
-- Deploy the Worker with this PR BEFORE applying this. Idempotent. Rollback: a forward migration with model_route_reorder.

BEGIN;

-- This offer was activated after the 0367 backfill, so it has no route row for its current fal dispatch.
INSERT INTO public.model_routes
    (model_id, supplier, endpoint, cost_per_unit, cost_unit, billing_seconds, priority, state, provenance, parity_record)
SELECT 'seedance-2.0-reference', 'fal', 'bytedance/seedance-2.0/reference-to-video', 1.5120, 'per_second', 5, 1, 'active', 'official',
       'current dispatch before 0583 (activated by 0417)'
 WHERE NOT EXISTS (SELECT 1 FROM public.model_routes WHERE model_id = 'seedance-2.0-reference');

INSERT INTO public.model_routes
    (model_id, supplier, endpoint, cost_per_unit, cost_unit, billing_seconds, priority, state, provenance)
SELECT 'seedance-2.0-reference', 'crun', 'crun:bytedance/seedance2-0-r2v', 0.9369, 'per_second', 5,
       (SELECT COALESCE(max(x.priority), 0) + 1 FROM public.model_routes x WHERE x.model_id = 'seedance-2.0-reference'),
       'standby', 'licensed_reseller'
ON CONFLICT (model_id, supplier, endpoint) DO NOTHING;

DO $$
DECLARE affected BIGINT; res jsonb;
BEGIN
    UPDATE public.model_routes
       SET parity_record = 'proofs 2026-11-22 (owner): bytedance/seedance2-0-r2v 720p 5 s sound on, test pattern. Image only: task c6be2f4e-aaa4-47e5-994a-209cdb6961b4, 179 s, 157.93 credits. Image plus 5 s video: task 193ea5bf-d737-4af4-8fa3-8fe1de3c538c, 241 s, 191.46 credits. Both 720x1280 with audio. Covers only 720p 5 s; real people, several pictures and other ratios not proved; one sample each',
           state = 'active', updated_at = now()
     WHERE model_id = 'seedance-2.0-reference' AND supplier = 'crun' AND endpoint = 'crun:bytedance/seedance2-0-r2v'
       AND provenance = 'licensed_reseller' AND cost_unit = 'per_second' AND billing_seconds = 5
       AND cost_per_unit = 0.9369 AND state IN ('standby', 'active');
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected one Crun route to prove on seedance-2.0-reference, updated %', affected;
    END IF;

    IF EXISTS (SELECT 1 FROM public.model_catalog WHERE id = 'seedance-2.0-reference' AND provider <> 'crun') THEN
        SELECT public.model_route_reorder(
            'seedance-2.0-reference',
            (SELECT array_agg(id ORDER BY CASE supplier WHEN 'crun' THEN 0 ELSE 1 END, priority)
               FROM public.model_routes WHERE model_id = 'seedance-2.0-reference' AND state = 'active'),
            'Crun first, fal second, Seedance Reference 720p 5 s (0583)'
        ) INTO res;
        IF NOT COALESCE((res->>'ok')::boolean, false) THEN
            RAISE EXCEPTION 'Could not put Crun first for seedance-2.0-reference: %', res;
        END IF;
    END IF;

    SELECT count(*) INTO affected FROM public.model_catalog
     WHERE id = 'seedance-2.0-reference' AND provider = 'crun' AND provider_endpoint = 'crun:bytedance/seedance2-0-r2v'
       AND provider_cost_per_unit = 0.9369 AND cost_unit = 'per_second' AND billing_seconds = 5 AND credits_5s = 85;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected seedance-2.0-reference served by Crun at 85 credits, found % rows', affected;
    END IF;

    SELECT count(*) INTO affected FROM public.model_routes
     WHERE model_id = 'seedance-2.0-reference' AND state = 'active'
       AND ((priority = 1 AND supplier = 'crun' AND endpoint = 'crun:bytedance/seedance2-0-r2v')
         OR (priority = 2 AND supplier = 'fal' AND endpoint = 'bytedance/seedance-2.0/reference-to-video' AND cost_per_unit = 1.5120));
    IF affected <> 2 THEN
        RAISE EXCEPTION 'Expected Crun first and fal second on seedance-2.0-reference, found % matching routes', affected;
    END IF;
END $$;

COMMIT;
