-- RLS policies for the money-critical tables.
--
-- The gateway connects to Postgres with the Supabase service_role key
-- (bypasses RLS) so the application layer is the primary authorisation
-- point. RLS here is defense-in-depth for two cases:
--
--   1. A leaked non-service key that ends up on a client browser or
--      third-party integration is still rate-limited to the caller's
--      own rows.
--   2. A future feature that lets end users run SQL against a
--      read-replica (analytics, dashboards) inherits the same
--      authorisation rules by construction.
--
-- Policies use auth.uid() which the Supabase Postgres server returns
-- from the caller's JWT. When the service_role key is used, auth.uid()
-- returns NULL and the policies short-circuit to allow all (matches
-- service role semantics).

BEGIN;

-- Enable RLS on every user-scoped table. FORCE so even the table owner
-- respects RLS (defense in depth against superuser accidents).
ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE users             FORCE  ROW LEVEL SECURITY;
ALTER TABLE credit_balances   ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_balances   FORCE  ROW LEVEL SECURITY;
ALTER TABLE ledger_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries    FORCE  ROW LEVEL SECURITY;
ALTER TABLE jobs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs              FORCE  ROW LEVEL SECURITY;
ALTER TABLE assets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets            FORCE  ROW LEVEL SECURITY;

-- model_catalog and webhook_events are shared / admin — no RLS.

-- ----------------------------------------------------------------------
-- Service-role bypass
-- ----------------------------------------------------------------------
-- Any query executed with the service_role JWT (auth.role() = 'service_role')
-- sees all rows. This is how the gateway backend reads/writes.

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['users', 'credit_balances', 'ledger_entries', 'jobs', 'assets']
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS service_role_all ON %I', t);
        EXECUTE format(
            'CREATE POLICY service_role_all ON %I '
            'FOR ALL TO PUBLIC '
            'USING (auth.role() = ''service_role'') '
            'WITH CHECK (auth.role() = ''service_role'')',
            t
        );
    END LOOP;
END $$;

-- ----------------------------------------------------------------------
-- Owner-only read for end-user JWTs
-- ----------------------------------------------------------------------
-- An authenticated end user (auth.uid() IS NOT NULL) can read only their
-- own rows. Writes are NEVER granted to end users directly — the gateway
-- backend using service_role is the sole writer to money tables.

DROP POLICY IF EXISTS users_owner_read ON users;
CREATE POLICY users_owner_read ON users
    FOR SELECT TO PUBLIC
    USING (auth_id = auth.uid()::text);

DROP POLICY IF EXISTS credit_balances_owner_read ON credit_balances;
CREATE POLICY credit_balances_owner_read ON credit_balances
    FOR SELECT TO PUBLIC
    USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()::text));

DROP POLICY IF EXISTS ledger_entries_owner_read ON ledger_entries;
CREATE POLICY ledger_entries_owner_read ON ledger_entries
    FOR SELECT TO PUBLIC
    USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()::text));

DROP POLICY IF EXISTS jobs_owner_read ON jobs;
CREATE POLICY jobs_owner_read ON jobs
    FOR SELECT TO PUBLIC
    USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()::text));

DROP POLICY IF EXISTS assets_owner_read ON assets;
CREATE POLICY assets_owner_read ON assets
    FOR SELECT TO PUBLIC
    USING (job_id IN (
        SELECT j.id FROM jobs j
        JOIN users u ON u.id = j.user_id
        WHERE u.auth_id = auth.uid()::text
    ));

COMMIT;
