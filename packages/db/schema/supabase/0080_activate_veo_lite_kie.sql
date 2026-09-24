-- Activate Veo 3.1 Lite on kie.ai at 23 credits (ADR-0020, ADR-0011).
--
-- 0078 catalogued the row inactive. The price stays at 23 credits: owner
-- decision on 2026-09-21. That keeps the credits-per-dollar ratio of
-- veo-3.1-fast-kie (46 credits for $0.30) and clears the ADR-0014 floor
-- (ceil(0.15 / 0.0165) = 10).
--
-- Evidence (scripts/verify-kie-endpoints.mjs --submit --only=veo-3.1-lite-kie,
-- 2026-09-21):
--   veo-3.1-lite-kie  c59798553667874e63ed7aece7ed6c0a  61s  6,232,379 B
--   video/mp4, HTTP 200, no redirect, tempfile.aiquickdraw.com (inside
--   SOURCE_HOSTS.kie).
-- The production kie path (webhook, webhook_events dedupe, R2 copy, STORED)
-- is proven by nano-banana-kie job 8e340470 and veo-3.1-fast-kie job 12535937.
--
-- Named "(8s)" to match the other kie Veo rows (0079). There is no fal twin
-- to deactivate. Rollback is the mirror of this file, not an edit to it.

UPDATE public.model_catalog
   SET active = true, name = 'Veo 3.1 Lite (8s)', updated_at = now()
 WHERE id = 'veo-3.1-lite-kie' AND provider = 'kie';
