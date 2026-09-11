-- Only nano-banana has a verified working fal endpoint. Deactivate the
-- others until their provider_endpoint is manually confirmed against
-- fal's live model list. Prevents users from triggering guaranteed-refund
-- cycles on wrong endpoint slugs.
UPDATE public.model_catalog SET active = false WHERE id <> 'nano-banana';
