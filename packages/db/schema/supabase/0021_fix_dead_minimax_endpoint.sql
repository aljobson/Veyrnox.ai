-- minimax-h3 pointed at fal-ai/minimax/h3 which 404s — Hailuo H3 is
-- request-access-only on fal, so every generation on that row debited,
-- failed to submit and refunded. Repoint to the cheapest generally
-- available MiniMax tier (Hailuo 02 Standard, 768p, $0.045/s = $0.225
-- per 5s) and reprice to the 50% floor per ADR-0014.
BEGIN;
UPDATE public.model_catalog
   SET id = 'minimax-hailuo-02',
       name = 'MiniMax Hailuo 02',
       provider_endpoint = 'fal-ai/minimax/hailuo-02/standard/text-to-video',
       credits_5s = 14,
       provider_cost_per_unit = 0.2250,
       active = true,
       updated_at = now()
 WHERE id = 'minimax-h3';
COMMIT;
