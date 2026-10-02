-- 0175: social_account_actions.actor_id is ON DELETE RESTRICT
-- (docs/product/ISSUES.md S11).
--
-- 0154 declared actor_id ON DELETE SET NULL on an append-only table. The SET
-- NULL is an UPDATE, which social_account_actions_append_only rejects, so
-- deleting a user with any Publish history failed with a misleading
-- "append-only" error. Nothing deletes public.users today (Auth deletion keeps
-- the row), so this has never fired. RESTRICT says what is actually true and
-- matches the table's own brand_id rule: the audit log outlives its subjects.

ALTER TABLE public.social_account_actions DROP CONSTRAINT IF EXISTS social_account_actions_actor_id_fkey;
ALTER TABLE public.social_account_actions ADD CONSTRAINT social_account_actions_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE RESTRICT;
