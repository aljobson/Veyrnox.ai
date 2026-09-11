-- Restore correct fal `provider_endpoint` values and reactivate rows whose
-- endpoint has been verified against https://fal.ai/models.
--
-- Migration 0011 deactivated every catalog row except `nano-banana` because
-- the previous `provider_endpoint` values were guessed (a `fal-ai/` prefix
-- was appended without checking each path against the live fal model list).
--
-- This migration:
--   1. Sets the verified endpoint id for each fal-hosted model.
--   2. Reactivates only the rows whose text-to-video / text-to-image /
--      text-to-audio endpoint is confirmed live on fal today.
--
-- Rows deliberately left inactive (require a product decision — see the
-- catalog audit report) so credits aren't burned on a guaranteed-refund
-- path:
--   - kling-3.0      : fal only exposes image-to-video for v3 (no t2v).
--   - hailuo-02      : replaced on fal by minimax/h3 & minimax/h3-max.
--   - seedream-4.5   : fal exposes seedream v4; 4.5 / 5.0 don't exist.
--   - cosyvoice-2    : not present on fal (TTS long-tail is not Alibaba).

BEGIN;

-- Verified endpoints — reactivate.
UPDATE public.model_catalog
   SET provider_endpoint = 'fal-ai/wan-25-preview/text-to-video',
       active = true,
       updated_at = now()
 WHERE id = 'wan-2.5';

UPDATE public.model_catalog
   SET provider_endpoint = 'bytedance/seedance-2.0/fast/text-to-video',
       active = true,
       updated_at = now()
 WHERE id = 'seedance-2.0-fast';

UPDATE public.model_catalog
   SET provider_endpoint = 'fal-ai/kling-video/v2.6/pro/text-to-video',
       active = true,
       updated_at = now()
 WHERE id = 'kling-2.6-pro';

UPDATE public.model_catalog
   SET provider_endpoint = 'fal-ai/veo3.1',
       active = true,
       updated_at = now()
 WHERE id = 'veo-3.1';

UPDATE public.model_catalog
   SET provider_endpoint = 'fal-ai/flux-2-pro',
       active = true,
       updated_at = now()
 WHERE id = 'flux-2-pro';

UPDATE public.model_catalog
   SET provider_endpoint = 'fal-ai/ace-step',
       active = true,
       updated_at = now()
 WHERE id = 'ace-step';

-- nano-banana was already active with the correct endpoint; no change.

COMMIT;
