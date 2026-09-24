-- Move both Veo rows from fal to kie.ai (ADR-0020). DO NOT APPLY until the
-- kie webhook path has completed one real job in production — see below.
--
-- Same credits the user pays today (0074 set the kie rows to fal parity), and
-- twice the clip:
--
--   row                 credits  clip             provider cost
--   veo-3.1-fast  (fal)      46  4s 720p          $0.60
--   veo-3.1-fast-kie         46  8s 720p + audio  $0.30
--   veo-3.1       (fal)     122  4s 720p          $1.60   gated
--   veo-3.1-kie             122  8s 720p + audio  $1.25   gated
--
-- A swap, as 0075 did for Nano Banana: the kie row goes active and the fal
-- twin inactive in one migration, so the picker never lists a model twice.
-- The fal rows are named "(4s)", so the kie rows say "(8s)" — the length is
-- the whole point of the change and the user should see it.
--
-- Evidence (scripts/verify-kie-endpoints.mjs --submit, 2026-09-20):
--   veo-3.1-fast-kie  17dbce6f52f4ee881a82d05b1f5a1d91  112s  4,996,494 B  HTTP 200, no redirect
--   veo-3.1-kie       6eb7c00559e62f51a1b39cb6d0995b6c  153s  5,240,950 B  HTTP 200, no redirect
-- Both on tempfile.aiquickdraw.com, inside SOURCE_HOSTS.kie.
--
-- PRECONDITION NOT YET MET when this was written: zero kie jobs had run in
-- production. The adapter call is proven; the kie webhook, its
-- webhook_events dedupe, the R2 copy and the STORED transition are not. At
-- $0.30-$1.25 a job, a broken callback path turns into a refund loop on real
-- users, so one nano-banana-kie generation (active since 0075, $0.02) must
-- reach STORED with an asset first.
--
-- Rollback is the mirror of this file, not an edit to it.

UPDATE public.model_catalog
   SET active = true, name = 'Veo 3.1 Fast (8s)', updated_at = now()
 WHERE id = 'veo-3.1-fast-kie' AND provider = 'kie';

UPDATE public.model_catalog
   SET active = true, name = 'Veo 3.1 (8s)', updated_at = now()
 WHERE id = 'veo-3.1-kie' AND provider = 'kie';

UPDATE public.model_catalog
   SET active = false, updated_at = now()
 WHERE id IN ('veo-3.1-fast', 'veo-3.1') AND provider = 'fal';
