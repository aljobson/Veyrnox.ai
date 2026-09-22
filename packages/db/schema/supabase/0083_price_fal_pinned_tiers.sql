-- Price the tiers the gateway now pins (lib/providerDuration.js
-- DEFAULT_PINS, DURATION_FIELDS). Owner decision in chat, 2026-09-22.
-- fal prices read from each model page on 2026-09-22. Floor: 50% margin at
-- $0.033/credit, so credits >= ceil(cost / 0.0165).
--
--   wan-2.5            720p pinned, $0.10/s x 5s = $0.50      -> 31 credits
--                      (was costed at 480p; fal's 1080p default billed $0.75)
--   minimax-hailuo-02  fal only makes 6s or 10s; our 5s unit buys the 6s
--                      clip, $0.045/s x 6s = $0.27             -> 17 credits
--   kling-2.6-pro      audio now pinned off, $0.07/s x 5s = $0.35, as
--                      already recorded; no change.
--
-- wan-2.5 stays inactive (0082) until a live generation reaches STORED at
-- 1280x720; its reactivation is a separate migration.
UPDATE public.model_catalog
   SET credits_5s = 31,
       provider_cost_per_unit = 0.5000,
       cost_unit = 'per_second',
       billing_seconds = 5,
       updated_at = now()
 WHERE id = 'wan-2.5';

UPDATE public.model_catalog
   SET credits_5s = 17,
       provider_cost_per_unit = 0.2700,
       cost_unit = 'per_second',
       billing_seconds = 6,
       updated_at = now()
 WHERE id = 'minimax-hailuo-02';
