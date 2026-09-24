-- Activate the kie.ai Nano Banana row and retire its fal twin (ADR-0020).
--
-- Evidence, 2026-09-20, scripts/verify-kie-endpoints.mjs --submit:
--
--   taskId  ee6ab0cb6b403a01ffd3aba5771397fc
--   latency 10s wall
--   output  https://tempfile.aiquickdraw.com/... 1,538,067 bytes
--   HTTP    200, no redirect
--
-- That clears every precondition ADR-0020 sets: the endpoint returns real
-- output, the host matches the `.aiquickdraw.com` suffix `copyUrlToR2`
-- allows, and it serves bytes rather than a 3xx — the failure that would
-- have debited and refunded every job on the row.
--
-- One row, not three. The webhook, its `webhook_events` dedupe, the R2 copy
-- and the STORED transition have never run for provider `kie` in production,
-- and the gateway 404s an inactive row so they cannot be proven any other
-- way. This proves them at $0.02 per job instead of $1.25. The two Veo rows
-- verified the same day (17dbce6f52f4ee881a82d05b1f5a1d91 at 112s, 4,996,494
-- bytes; 6eb7c00559e62f51a1b39cb6d0995b6c at 153s, 5,240,950 bytes) follow in
-- their own migration once this one has run clean.
--
-- A swap, not an addition. Two active rows for one model would show the user
-- "Nano Banana" twice, so the fal row goes inactive in the same statement
-- pair. Credits are unchanged at 3 either way (migration 0074), so nothing
-- the user sees moves: same name, same price, cheaper for us — $0.0200
-- against fal's $0.0390.
--
-- Rollback is the mirror of this file: set nano-banana active, nano-banana-kie
-- inactive. Prefer that over editing this one; the applied name is permanent.

UPDATE public.model_catalog
   SET active = true,
       name = 'Nano Banana',
       updated_at = now()
 WHERE id = 'nano-banana-kie'
   AND provider = 'kie';

UPDATE public.model_catalog
   SET active = false,
       updated_at = now()
 WHERE id = 'nano-banana'
   AND provider = 'fal';
