-- Switch seedance-2.0-fast back off after the error-capture submit on
-- 2026-09-13 (debit refunded). Stays inactive until the submit is fixed.
UPDATE public.model_catalog
   SET active = false,
       updated_at = now()
 WHERE id = 'seedance-2.0-fast';
