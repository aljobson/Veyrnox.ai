-- Switch wan-2.5 off: it is sold below cost. Owner decision in chat, 2026-09-22.
--
-- fal-ai/wan-25-preview/text-to-video defaults `resolution` to 1080p
-- ($0.15/s) and the gateway does not send one. The only production job
-- (2026-09-21) came back 1920x1080, 5.04s: $0.75 against 16 credits ($0.53
-- at $0.033/credit), a loss on every generation. The row is costed at 480p
-- ($0.05/s).
--
-- Reactivate in a new migration after the gateway pins 720p and the price
-- is raised to 31 credits (5s at $0.10/s = $0.50, 50% floor), and one live
-- generation reaches STORED at 1280x720.
UPDATE public.model_catalog
   SET active = false,
       updated_at = now()
 WHERE id = 'wan-2.5';
