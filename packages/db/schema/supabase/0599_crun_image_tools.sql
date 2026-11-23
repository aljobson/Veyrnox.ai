-- 0599 — Two Crun-only image tools, live: Background Removal Fast (1 credit) and Upscale 2x Clean (2 credits).
-- New offers, not routes of Bria or Topaz (Crun's models are different), so there is one route each and nothing to fail over to.
-- Owner decisions 2026-11-23: names as given, background removal 1 credit and upscale 2, Bria and Topaz stay, one-step launch.
--
-- Evidence (owner's paid probes, 2026-11-23, Crun prod key; docs.crun.ai/ai-tools/image-background-remove.md, image-upscale.md):
--   image-background-remove: tasks f7c11072-bef6-474e-a834-727121c3bfce (1024x1536 JPEG -> 1024x1536 RGBA PNG, 7 s) and
--     bb8b33e5-6da9-4b0f-98d1-9856e27b3f31 (480x720), 0.5 credits each, edges clean on a green backdrop (frames read by Claude Code).
--   image-upscale 2x clean: task 7078535a-067c-4003-b584-a2cc67ad9466, 480x720 -> 960x1440, 3 credits, 14 s. On a 1024x1536 source
--     (task 9a469ae5-d294-4418-a725-eecceff18285) the output was the SAME size and 3 credits were still charged, so the offer pins
--     a 1024 px long edge (Crun's own rule: 512 to 1024 px is doubled, above 1024 is returned at its size).
-- Cost at the owner's top-up rate of 206 Crun credits per $1: cutout 0.5 / 206 = $0.0024 (recorded $0.0025), upscale 3 / 206 =
--   $0.0146. Floors (credits x 0.01796): 1 credit = $0.0180 >= $0.0025; 2 credits = $0.0359 >= $0.0146 (ADR-0037).
-- NOT established: a 1024 px long edge actually doubling (confirmed with one real run on the website), the 4096 px and 20 MB
--   limits for the cutout (Crun's cutout page states none; the 4096 px / 20 MB figures are the upscale page's), that Crun fetches
--   our signed R2 links, and parity with anything (these are new models; quality is smoother on skin than Topaz).
-- Deploy the Worker that has crun:image-background-remove and crun:image-upscale BEFORE applying: a route the Worker cannot
--   dispatch answers 501. Idempotent. Existing rows are never overwritten; the assertions fail loudly on a different row.
-- Rollback: a forward migration setting active = false for the two ids.

BEGIN;

INSERT INTO public.model_catalog
  (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, billing_seconds, gated_flag, active)
VALUES
  ('background-remove-fast', 'Background Removal Fast', 'crun', 'crun:image-background-remove', 'image-to-image', 1, 0.0025, 'per_generation', NULL, false, true),
  ('upscale-2x-clean',       'Upscale 2x Clean',        'crun', 'crun:image-upscale',            'image-to-image', 2, 0.0146, 'per_generation', NULL, false, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.model_routes
  (model_id, supplier, endpoint, cost_per_unit, cost_unit, billing_seconds, priority, state, provenance, parity_record)
SELECT c.id, 'crun', c.provider_endpoint, c.provider_cost_per_unit, 'per_generation', NULL, 1, 'active', 'licensed_reseller',
       'current dispatch (0599): new Crun-only offer, owner probes 2026-11-23, see the migration header'
  FROM public.model_catalog c
 WHERE c.id IN ('background-remove-fast', 'upscale-2x-clean') AND c.provider = 'crun'
   AND NOT EXISTS (SELECT 1 FROM public.model_routes r WHERE r.model_id = c.id)
ON CONFLICT (model_id, priority) DO NOTHING;

DO $$
DECLARE n BIGINT;
BEGIN
    SELECT count(*) INTO n FROM public.model_catalog c
     WHERE c.active AND c.provider = 'crun' AND c.modality = 'image-to-image' AND c.cost_unit = 'per_generation' AND NOT c.gated_flag
       AND ((c.id = 'background-remove-fast' AND c.provider_endpoint = 'crun:image-background-remove' AND c.credits_5s = 1 AND c.provider_cost_per_unit = 0.0025)
         OR (c.id = 'upscale-2x-clean'       AND c.provider_endpoint = 'crun:image-upscale'            AND c.credits_5s = 2 AND c.provider_cost_per_unit = 0.0146))
       AND round(c.provider_cost_per_unit * 100000) <= c.credits_5s * 1796;
    IF n <> 2 THEN
        RAISE EXCEPTION 'Expected both Crun image tools active at their credits inside the floor, found % rows', n;
    END IF;
    SELECT count(*) INTO n FROM public.model_routes r
     WHERE r.model_id IN ('background-remove-fast', 'upscale-2x-clean') AND r.priority = 1 AND r.state = 'active' AND r.supplier = 'crun'
       AND r.endpoint IN ('crun:image-background-remove', 'crun:image-upscale') AND r.parity_record IS NOT NULL;
    IF n <> 2 THEN
        RAISE EXCEPTION 'Expected one active Crun route for each image tool, found %', n;
    END IF;
END $$;

COMMIT;
