-- Switch seedance-2.0-fast back off: the funded-account retest on 2026-09-13
-- was accepted by OpenRouter, but its completion webhook failed signature
-- verification. Stays inactive until the webhook verifies.
UPDATE public.model_catalog
   SET active = false,
       updated_at = now()
 WHERE id = 'seedance-2.0-fast';
