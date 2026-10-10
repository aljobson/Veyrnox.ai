-- 0268: use the shared operation-specific TRUNCATE guard for community audits.
-- 0266 already refuses truncation. The full append-only acceptance suite also
-- requires the common diagnostic; preserve 0266's exact staging receipt.
BEGIN;
DROP TRIGGER IF EXISTS cinema_community_actions_no_truncate ON public.cinema_community_actions;
CREATE TRIGGER cinema_community_actions_no_truncate
 BEFORE TRUNCATE ON public.cinema_community_actions
 FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_no_truncate();
COMMIT;
