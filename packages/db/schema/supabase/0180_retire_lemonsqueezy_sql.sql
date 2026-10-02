-- 0180: retire the LemonSqueezy-only SQL (docs/product/ISSUES.md I1, S14).
--
-- Stripe is the only billing provider (ADR-0031); the LemonSqueezy webhook,
-- adapter and backfill sweep are gone from the app. These four functions had
-- no caller left. Each took LemonSqueezy's numeric order id and its return
-- identifier; the Stripe path uses record_top_up_return_session (0108),
-- next_top_up_backfill_batch and close_top_up_return, which stay.
--
--   record_top_up_return           0060/0064  LemonSqueezy return link
--   backfill_credit_top_up         0068       email-bound LemonSqueezy backfill
--   next_top_up_order_sweep_batch  0068       order sweep hand-out
--   flag_swept_top_up_order        0068       order sweep flagger
--
-- Kept on purpose:
--   top_up_order_collisions and operator_order_collisions: an append-only
--     record (0177 guards TRUNCATE) that recovery_status still counts. With
--     backfill_credit_top_up gone nothing writes it; its numeric order_id
--     CHECK describes the rows it already holds (none in production).
--   top_ups.order_sweeps / order_swept_at: history of the LemonSqueezy-era
--     Top-ups that were swept. Only the sweep's partial index goes.
--   credit_packs_net_floor: written for LemonSqueezy's fee, it is stricter
--     than Stripe's, so it still holds every pack and still refuses a
--     non-web channel. Re-described below rather than dropped.

DROP FUNCTION IF EXISTS public.record_top_up_return(TEXT, UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS public.backfill_credit_top_up(UUID, TEXT, TEXT, INTEGER, TEXT, TEXT, BIGINT, BIGINT);
DROP FUNCTION IF EXISTS public.next_top_up_order_sweep_batch(INTEGER);
DROP FUNCTION IF EXISTS public.flag_swept_top_up_order(UUID, TEXT, TEXT, TIMESTAMPTZ, INTEGER, TEXT, TEXT);

DROP INDEX IF EXISTS public.top_ups_order_sweep_due_idx;

COMMENT ON CONSTRAINT credit_packs_net_floor ON public.credit_packs IS
    'Net >= $0.033/credit after an 8.255% + 50c fee (written for LemonSqueezy, 0041). '
    'Stricter than Stripe''s fee, so it still bounds every web pack; any other channel is refused.';
