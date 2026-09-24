-- Run with psql -v ON_ERROR_STOP=1 -f packages/db/tests/signup-ten-credits.sql.
-- Requires the local ledger schema. All fixtures and DDL are rolled back.
BEGIN;
\ir ../schema/supabase/0071_signup_grant_on_email_confirmation.sql
CREATE TEMP TABLE signup_test_users (auth_id text, user_id uuid, old_grant boolean);
INSERT INTO signup_test_users
SELECT auth_id, public.signup_grant(auth_id, 'old@test.veyrnox.ai'), true
FROM (SELECT gen_random_uuid()::text AS auth_id) s;
\ir ../schema/supabase/0127_signup_grant_ten_credits.sql
\ir ../schema/supabase/0127_signup_grant_ten_credits.sql
INSERT INTO signup_test_users
SELECT auth_id, public.signup_grant(auth_id, 'new@test.veyrnox.ai'), false
FROM (SELECT gen_random_uuid()::text AS auth_id) s;
-- Replay both old and new accounts: neither should receive another grant.
SELECT public.signup_grant(auth_id, 'replay@test.veyrnox.ai') FROM signup_test_users;
DO $$
DECLARE u record; expected integer; actual record;
BEGIN
    FOR u IN SELECT * FROM signup_test_users LOOP
        expected := CASE WHEN u.old_grant THEN 50 ELSE 10 END;
        SELECT balance, free_balance INTO actual FROM public.credit_balances WHERE user_id = u.user_id;
        IF actual.balance <> expected OR actual.free_balance <> expected THEN
            RAISE EXCEPTION 'Wrong balance: %, expected %', actual, expected;
        END IF;
        IF (SELECT count(*) FROM public.ledger_entries WHERE user_id = u.user_id) <> 1 OR
           (SELECT delta FROM public.ledger_entries WHERE user_id = u.user_id) <> expected OR
           (SELECT free_delta FROM public.ledger_entries WHERE user_id = u.user_id) <> expected THEN
            RAISE EXCEPTION 'Signup ledger changed or duplicated';
        END IF;
    END LOOP;
    IF has_function_privilege('anon', 'public.signup_grant(text,text)', 'EXECUTE') OR
       has_function_privilege('authenticated', 'public.signup_grant(text,text)', 'EXECUTE') OR
       NOT has_function_privilege('service_role', 'public.signup_grant(text,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'Signup grant privileges changed';
    END IF;
    IF EXISTS (SELECT 1 FROM public.reconcile_balances()) OR
       EXISTS (SELECT 1 FROM public.reconcile_free_credits()) THEN
        RAISE EXCEPTION 'Ledger reconciliation failed';
    END IF;
END $$;
ROLLBACK;
