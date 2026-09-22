-- Reactivate kling-3.0-i2v (0081 switched it off). The gateway now shapes
-- its request from the capability registry (ADR-0027, #214): the start frame
-- goes as start_image_url, and generate_audio is pinned false so fal bills
-- $0.112/s, $0.56 per 5s clip, which 34 credits covers at the 50% floor.
-- A live image-to-video generation is run straight after this applies; if it
-- fails or comes back with an audio track, a follow-up migration switches it
-- off again.
UPDATE public.model_catalog
   SET active = true,
       updated_at = now()
 WHERE id = 'kling-3.0-i2v'
   AND provider_endpoint = 'fal-ai/kling-video/v3/pro/image-to-video';
