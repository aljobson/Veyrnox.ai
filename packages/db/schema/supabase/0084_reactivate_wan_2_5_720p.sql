-- Reactivate wan-2.5 at 720p, 31 credits (owner decision in chat,
-- 2026-09-22). 0082 switched it off because fal's 1080p default billed
-- $0.75 against 16 credits; the gateway now pins resolution=720p (#211,
-- DEFAULT_PINS) and 0083 priced it at 31 credits ($0.50 cost, 5s at
-- $0.10/s). A live generation is run straight after this applies and must
-- come back 1280x720; if it does not, a follow-up migration switches it off.
UPDATE public.model_catalog
   SET active = true,
       updated_at = now()
 WHERE id = 'wan-2.5';
