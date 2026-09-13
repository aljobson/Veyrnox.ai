-- Switch seedance-2.0-fast back off: the 0055 retest could not submit because
-- the test account lacked credits. Stays inactive until a test reaches STORED.
UPDATE public.model_catalog
   SET active = false,
       updated_at = now()
 WHERE id = 'seedance-2.0-fast';
