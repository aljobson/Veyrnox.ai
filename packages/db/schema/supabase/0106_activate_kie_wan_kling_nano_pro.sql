-- Activate the kie.ai twins of Wan 2.5, Kling 2.6 Pro and Nano Banana Pro and
-- retire their fal rows (ADR-0020). Staged inactive by 0105.
--
-- Evidence, 2026-09-24, scripts/verify-kie-endpoints.mjs --submit, with the
-- charge read off kie's dashboard (1 credit = $0.005):
--
--   row                  taskId                            time  output                         kie charged
--   wan-2.5-kie          02be5ac35e52008369f7b46563c09bac  133s  mp4 1280x720, 5.04s, 2.9 MB    60 cr  $0.300
--   kling-2.6-pro-kie    bb2e77dc11624211580c42104830c093  163s  mp4 1920x1080, 5.04s, 13.1 MB  55 cr  $0.275  (no audio track)
--   nano-banana-pro-kie  b3051c06db5d49b65a8aa7b12a654a95   41s  png 8.3 MB                     18 cr  $0.090
--                        fcf79e39833eef2657cbcf65371a8387  255s  png 8.8 MB                     18 cr  $0.090
--
-- Each charge equals the row's provider_cost_per_unit (0105), so the ADR-0014
-- floor holds: 19, 17 and 6 credits. Every output came from
-- tempfile.aiquickdraw.com over HTTP 200 with no redirect, inside
-- SOURCE_HOSTS.kie. The production kie path (webhook, dedupe, R2 copy, STORED)
-- is already proven by nano-banana-kie job 8e340470 and veo-3.1-fast-kie job
-- 12535937 (0080).
--
-- Not run live: a 10s clip. kie's rate card prices it at exactly twice the 5s
-- clip (Wan 720p $0.60, Kling 2.6 without audio $0.55), which is how the
-- gateway bills it (credits_5s * 2).
--
-- A swap, as 0075 did for nano-banana: the kie row goes active under the
-- model's plain name and the fal twin goes inactive in the same migration, so
-- the picker never lists a model twice. nano-banana-pro-edit (fal) stays
-- active: it has no kie twin yet. Credits the user pays:
--   Wan 2.5          31 -> 19     Kling 2.6 Pro  22 -> 17     Nano Banana Pro  10 -> 6
--
-- Rollback is the mirror of this file (kie rows inactive, fal rows active), not
-- an edit to it. Idempotent: each UPDATE sets an absolute value.

UPDATE public.model_catalog
   SET active = true, name = 'Wan 2.5', updated_at = now()
 WHERE id = 'wan-2.5-kie' AND provider = 'kie';

UPDATE public.model_catalog
   SET active = true, name = 'Kling 2.6 Pro', updated_at = now()
 WHERE id = 'kling-2.6-pro-kie' AND provider = 'kie';

UPDATE public.model_catalog
   SET active = true, name = 'Nano Banana Pro', updated_at = now()
 WHERE id = 'nano-banana-pro-kie' AND provider = 'kie';

UPDATE public.model_catalog
   SET active = false, updated_at = now()
 WHERE id IN ('wan-2.5', 'kling-2.6-pro', 'nano-banana-pro') AND provider = 'fal';
