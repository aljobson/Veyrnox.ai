-- Reprice the four live kie.ai rows to the ADR-0014 floor (ADR-0020).
--
-- 0074 priced these rows at their fal twin's credits so a supplier swap would
-- be invisible to the user and the saving would be ours to spend deliberately.
-- The owner has now decided to spend it: pass kie's cost through, so each row
-- sells at the minimum whole credits that clear the 50% margin floor at the
-- $0.033 reference rate, ceil(provider_cost_per_unit / 0.0165) as in 0035.
--
--   row                credits (was -> now)  kie cost   ceil(cost / 0.0165)
--   veo-3.1-fast-kie        46 ->  19        $0.30      18.18 -> 19
--   veo-3.1-kie            122 ->  76        $1.25      75.76 -> 76   (gated)
--   veo-3.1-lite-kie        23 ->  10        $0.15       9.09 -> 10
--   nano-banana-kie          3 ->   2        $0.02       1.21 ->  2
--
-- Only credits_5s moves. `active`, names and provider_cost_per_unit are left
-- as 0075, 0079 and 0080 set them, and provider_cost_per_unit is already the
-- verified cost each row's ADR-0020 evidence cites. Jobs already debited keep
-- the credits they were charged; a refund returns the debited amount, not the
-- catalog's current price.
--
-- seedance-2.0-fast (OpenRouter) is not touched: 28 credits already equals
-- ceil(0.4536 / 0.0165). The fal rows are not touched: no cheaper verified
-- supplier exists for them yet.
--
-- Rollback is the mirror of this file (set the old credits back), not an edit
-- to it. Idempotent: each UPDATE sets an absolute value.

UPDATE public.model_catalog
   SET credits_5s = 19, updated_at = now()
 WHERE id = 'veo-3.1-fast-kie' AND provider = 'kie';

UPDATE public.model_catalog
   SET credits_5s = 76, updated_at = now()
 WHERE id = 'veo-3.1-kie' AND provider = 'kie';

UPDATE public.model_catalog
   SET credits_5s = 10, updated_at = now()
 WHERE id = 'veo-3.1-lite-kie' AND provider = 'kie';

UPDATE public.model_catalog
   SET credits_5s = 2, updated_at = now()
 WHERE id = 'nano-banana-kie' AND provider = 'kie';
