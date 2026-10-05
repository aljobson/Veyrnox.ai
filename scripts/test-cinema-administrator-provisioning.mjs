// Isolated local replay database only. All fixture writes are rolled back.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', 'postgres'].includes(new URL(url).hostname)) {
    throw Error('isolated local database required');
}
const c = new pg.Client({ connectionString: url });
const user = '3e3dfd74-a099-4c1b-8bb4-8a336d4f1895';
const auth = 'cbb38593-f293-48fb-9012-0c5f7357dfc6';
const migration = await readFile(new URL('../packages/db/schema/supabase/0153_cinema_production_administrator.sql', import.meta.url), 'utf8');
await c.connect();
async function rejected(pattern) {
    await c.query('SAVEPOINT rejected_grant');
    await assert.rejects(c.query(migration), pattern);
    await c.query('ROLLBACK TO SAVEPOINT rejected_grant');
    await c.query('RELEASE SAVEPOINT rejected_grant');
}
try {
    await c.query('BEGIN');
    // Clean rebuild / other environment: no role is bootstrapped.
    await c.query(migration);
    await c.query(`CREATE TABLE auth.mfa_factors
        (user_id uuid, factor_type text, status text)`);
    await c.query('INSERT INTO public.users(id,auth_id,email) VALUES($1,$2,$3)',
        [user, auth, 'wrong@example.invalid']);
    await rejected(/Expected production identity missing/);
    await c.query('UPDATE public.users SET email=$2 WHERE id=$1', [user, 'support@veyrnox.com']);
    await rejected(/Verified authenticator required/);
    await c.query("INSERT INTO auth.mfa_factors VALUES($1,'totp','unverified')", [auth]);
    await rejected(/Verified authenticator required/);
    await c.query("UPDATE auth.mfa_factors SET status='verified' WHERE user_id=$1", [auth]);
    await c.query(migration);
    await c.query(migration);
    assert.deepEqual((await c.query('SELECT role,account_status FROM public.cinema_memberships WHERE user_id=$1', [user])).rows,
        [{ role: 'administrator', account_status: 'active' }]);
    await c.query("UPDATE public.cinema_memberships SET role='viewer' WHERE user_id=$1", [user]);
    await c.query(migration);
    assert.equal((await c.query('SELECT role FROM public.cinema_memberships WHERE user_id=$1', [user])).rows[0].role, 'administrator');
    await c.query("UPDATE public.cinema_memberships SET role='creator' WHERE user_id=$1", [user]);
    await rejected(/Unexpected existing Cinema membership/);
    await c.query("UPDATE public.cinema_memberships SET role='viewer',account_status='suspended' WHERE user_id=$1", [user]);
    await rejected(/Unexpected existing Cinema membership/);
    console.log('Cinema administrator provisioning: identity, MFA, replay and role/status guards pass');
} finally {
    await c.query('ROLLBACK');
    await c.end();
}
