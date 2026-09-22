-- Switch kling-3.0-i2v off until the gateway sends the payload fal expects.
-- Owner decision in chat, 2026-09-22.
--
-- Checked against fal's live OpenAPI schema for
-- fal-ai/kling-video/v3/pro/image-to-video on 2026-09-22:
--   * `start_image_url` is required. The gateway forwards our `image_url`,
--     so every submit would be rejected and refunded. The row has had no jobs.
--   * `generate_audio` defaults to true: $0.168/s, against the $0.112/s
--     (audio off) this row is costed at, so 34 credits for 5s would sit at
--     ~25% margin, under the 50% floor.
--
-- Reactivate in a new migration once the request maps image_url to
-- start_image_url and pins generate_audio=false (docs/model-capability-registry
-- /SPEC.md), and one live generation has reached STORED.
UPDATE public.model_catalog
   SET active = false,
       updated_at = now()
 WHERE id = 'kling-3.0-i2v';
