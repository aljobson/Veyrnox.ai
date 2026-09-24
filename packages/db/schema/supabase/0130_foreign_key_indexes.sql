-- Referencing-side indexes bound parent-key checks and operator lookups.
-- Tables were checked before preparing this migration and are currently tiny.
-- Fail quickly if an unexpected transaction blocks the short index build.
SET LOCAL lock_timeout = '5s';
CREATE INDEX IF NOT EXISTS account_actions_top_up_id_idx ON public.account_actions(top_up_id);
CREATE INDEX IF NOT EXISTS top_up_flagged_orders_user_id_idx ON public.top_up_flagged_orders(user_id);
CREATE INDEX IF NOT EXISTS top_up_order_collisions_credited_top_up_id_idx ON public.top_up_order_collisions(credited_top_up_id);
CREATE INDEX IF NOT EXISTS top_up_order_collisions_top_up_id_idx ON public.top_up_order_collisions(top_up_id);
CREATE INDEX IF NOT EXISTS top_ups_pack_id_idx ON public.top_ups(pack_id);
