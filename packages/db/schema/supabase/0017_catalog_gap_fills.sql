-- ADR-0011: rename kling-3.0/hailuo-02/seedream-4.5 to closest fal SKUs,
-- drop cosyvoice-2 pending TTS provider decision (ADR-0012).
BEGIN;

UPDATE public.model_catalog
   SET id = 'kling-3.0-i2v',
       name = 'Kling 3.0 (image-to-video)',
       modality = 'image-to-video',
       provider_endpoint = 'fal-ai/kling-video/v3/pro/image-to-video',
       active = true,
       updated_at = now()
 WHERE id = 'kling-3.0';

UPDATE public.model_catalog
   SET id = 'minimax-h3',
       name = 'MiniMax H3',
       provider_endpoint = 'fal-ai/minimax/h3',
       active = true,
       updated_at = now()
 WHERE id = 'hailuo-02';

UPDATE public.model_catalog
   SET id = 'seedream-4',
       name = 'Seedream v4',
       provider_endpoint = 'fal-ai/bytedance/seedream/v4/text-to-image',
       active = true,
       updated_at = now()
 WHERE id = 'seedream-4.5';

DELETE FROM public.model_catalog WHERE id = 'cosyvoice-2';

COMMIT;
