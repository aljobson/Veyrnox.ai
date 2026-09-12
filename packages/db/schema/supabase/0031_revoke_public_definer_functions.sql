-- Supabase security advisors 0028 / 0029: SECURITY DEFINER functions that
-- anon and authenticated can call over PostgREST. A definer function runs as
-- its owner and bypasses RLS, so anything reachable at /rest/v1/rpc/<name>
-- with the publishable key is a hole unless it is meant to be public.
--
-- Two of the three flagged functions should never have been reachable.
--
-- assets_set_expires_at() is a trigger function — it RETURNS trigger and
-- reads NEW. Called directly over PostgREST it errors, so this is defence
-- in depth rather than a live exploit, but a trigger body has no business
-- being an API endpoint.
--
-- track_event(uuid, text, jsonb) belongs to the sibling wallet product: its
-- allowed event names are wallet_created, seed_generated,
-- wc_session_approved and friends, none of which this product emits.
-- Nothing in this repository calls it. `public.events` has never held a
-- row, so revoking cannot break a caller that was working — if a wallet
-- client is ever pointed at this database, it should get its own project,
-- not borrow the generation product's.
--
-- catalog_watch() is deliberately left anon-callable. The fal catalog
-- watcher in GitHub Actions reads it with SUPABASE_ANON_KEY precisely so
-- CI does not hold the service-role key (PR #61), and ADR-0014 declares
-- provider costs public. That is an owner decision, not drift, so this
-- migration leaves it alone. See the addendum in ADR-0014 before changing
-- it — and note it does expose provider_endpoint alongside the costs,
-- which 0028_relock_model_catalog_from_anon withholds from the same role.
--
-- Idempotent: REVOKE is safe to re-run.

REVOKE ALL ON FUNCTION public.assets_set_expires_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assets_set_expires_at() FROM anon;
REVOKE ALL ON FUNCTION public.assets_set_expires_at() FROM authenticated;

REVOKE ALL ON FUNCTION public.track_event(UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.track_event(UUID, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.track_event(UUID, TEXT, JSONB) FROM authenticated;

-- The trigger fires as the table owner and does not need an EXECUTE grant;
-- service_role keeps one so an operator can still exercise it directly.
GRANT EXECUTE ON FUNCTION public.assets_set_expires_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.track_event(UUID, TEXT, JSONB) TO service_role;
