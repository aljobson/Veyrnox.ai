-- Switch seedance-2.0-fast back on after the test account was granted credits
-- (0056 switched it off because the account had none). Applied to production
-- on 2026-09-13; the SQL is the statement production recorded under this name.
UPDATE public.model_catalog
   SET active = true,
       updated_at = now()
 WHERE id = 'seedance-2.0-fast'
   AND provider = 'openrouter';
