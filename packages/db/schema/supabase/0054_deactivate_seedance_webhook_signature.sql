-- Applied to production as 0052_deactivate_seedance_webhook_signature.
-- Committed as 0054 because 0052 on main belongs to 0052_credit_top_up
-- (#120) and migration numbers must be unique; the SQL below is the statement
-- production recorded under that name, unchanged. Replay order stays right:
-- 0051 switches seedance-2.0-fast on, this file switches it off.
--
-- Switch seedance-2.0-fast back off: the funded-account retest on 2026-09-13
-- was accepted by OpenRouter, but its completion webhook failed signature
-- verification. Stays inactive until the webhook verifies.
UPDATE public.model_catalog
   SET active = false,
       updated_at = now()
 WHERE id = 'seedance-2.0-fast';
