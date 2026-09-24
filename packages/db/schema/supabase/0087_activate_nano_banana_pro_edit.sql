-- Switch on nano-banana-pro-edit (staged inactive by 0086). The create page
-- can now upload a start image (ADR-0028, #217), which the gateway sends as a
-- one-item image_urls list. Price unchanged: $0.15 per 2K image, 10 credits.
-- A live edit runs straight after this applies; if it fails, a follow-up
-- migration switches it off.
UPDATE public.model_catalog
   SET active = true,
       updated_at = now()
 WHERE id = 'nano-banana-pro-edit'
   AND provider_endpoint = 'fal-ai/nano-banana-pro/edit';
