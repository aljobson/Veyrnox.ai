-- 0177: append-only tables cannot be TRUNCATEd (docs/product/ISSUES.md S13).
--
-- Every append-only table refuses UPDATE and DELETE with a FOR EACH ROW
-- trigger, but row triggers never fire for TRUNCATE, so the table owner (or a
-- future grant) could still empty the ledger or an audit log in one statement.
-- A statement-level BEFORE TRUNCATE trigger closes that. No code or test
-- truncates these tables.
--
-- project_assets is not in the list: its row trigger is a state-machine
-- guard, not an append-only rule. scripts/test-append-only.mjs fails if a
-- table gains an append-only row trigger without this one.

CREATE OR REPLACE FUNCTION public.append_only_no_truncate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION '% is append-only (attempted TRUNCATE)', TG_TABLE_NAME;
END $$;

REVOKE ALL ON FUNCTION public.append_only_no_truncate() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'ledger_entries', 'account_actions', 'top_up_order_collisions', 'top_up_flagged_orders',
        'audit_events', 'project_document_versions', 'social_account_actions',
        'cinema_creator_reviews', 'cinema_unlock_reversals', 'cinema_pass_events', 'cinema_pass_plays',
        'cinema_submission_reviews', 'cinema_moderation_actions', 'cinema_operator_actions',
        'cinema_operator_refund_receipts'
    ] LOOP
        CONTINUE WHEN to_regclass('public.' || t) IS NULL;
        CONTINUE WHEN EXISTS (SELECT 1 FROM pg_trigger
                              WHERE tgname = t || '_no_truncate' AND tgrelid = ('public.' || t)::regclass);
        EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT '
                       'EXECUTE FUNCTION public.append_only_no_truncate()', t || '_no_truncate', t);
    END LOOP;
END $$;
