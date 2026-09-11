-- Lock down the auth.users AFTER INSERT trigger function.
-- It was created without an explicit REVOKE, inheriting the default
-- EXECUTE grant to anon/authenticated/PUBLIC. Trigger execution does
-- NOT check EXECUTE on the trigger function, so revoking here does
-- not break the sign-up grant path — it only closes the RPC surface
-- (POST /rest/v1/rpc/handle_auth_user_created).

REVOKE ALL ON FUNCTION public.handle_auth_user_created() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_auth_user_created() FROM anon;
REVOKE ALL ON FUNCTION public.handle_auth_user_created() FROM authenticated;
-- service_role kept for parity with the other definer functions; the
-- trigger runs regardless because trigger dispatch bypasses EXECUTE.
GRANT EXECUTE ON FUNCTION public.handle_auth_user_created() TO service_role;
