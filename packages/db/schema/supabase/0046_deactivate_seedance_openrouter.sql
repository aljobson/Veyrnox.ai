-- Switch seedance-2.0-fast back off: its live test on 2026-09-13 failed at
-- submit (OpenRouter rejected the request; the debit was refunded). Stays
-- inactive until the submit is fixed and a test reaches STORED.
UPDATE public.model_catalog
   SET active = false,
       updated_at = now()
 WHERE id = 'seedance-2.0-fast';
