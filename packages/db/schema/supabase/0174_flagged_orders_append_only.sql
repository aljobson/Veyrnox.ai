-- 0174: top_up_flagged_orders is append-only (docs/product/ISSUES.md S9).
--
-- A flagged order is a paid order the system refused to credit (already
-- credited, amount/currency/variant mismatch) and queued for an Operator
-- refund. 0131 treats these as append-only payment incident records, and an
-- Operator's review is recorded separately in recovery_alert_reviews — but no
-- trigger enforced it. The only writers are INSERTs (credit_top_up 0054/0097,
-- flag_swept_top_up_order 0068); nothing updates or deletes a row.
--
-- Same guard as account_actions (0059). TRUNCATE is not covered by row
-- triggers; that is tracked as S13 for every append-only table.

CREATE OR REPLACE FUNCTION public.top_up_flagged_orders_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'top_up_flagged_orders is append-only (attempted %)', TG_OP;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                   WHERE tgname = 'top_up_flagged_orders_no_update'
                     AND tgrelid = 'public.top_up_flagged_orders'::regclass) THEN
        CREATE TRIGGER top_up_flagged_orders_no_update
            BEFORE UPDATE OR DELETE ON public.top_up_flagged_orders
            FOR EACH ROW EXECUTE FUNCTION public.top_up_flagged_orders_append_only();
    END IF;
END $$;

REVOKE ALL ON FUNCTION public.top_up_flagged_orders_append_only() FROM PUBLIC, anon, authenticated;
