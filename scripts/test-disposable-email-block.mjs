#!/usr/bin/env node
// 0343: a sign-up from a disposable-email domain is refused before the account exists. Runs against the full
// migration replay (ledger-tests.yml). Every fixture is rolled back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];

const signUp = (email, { confirmed = false, anonymous = false } = {}) => {
    const id = randomUUID();
    return c
        .query('INSERT INTO auth.users(id, email, email_confirmed_at, is_anonymous) VALUES ($1, $2, $3, $4)', [
            id, email, confirmed ? new Date() : null, anonymous,
        ])
        .then(() => id);
};
const shadow = async (id) => one('SELECT id FROM public.users WHERE auth_id = $1', [id]);
const attempt = async (email, opts) => {
    await c.query('SAVEPOINT attempt');
    try {
        const id = await signUp(email, opts);
        await c.query('RELEASE SAVEPOINT attempt');
        return { id };
    } catch (error) {
        await c.query('ROLLBACK TO SAVEPOINT attempt');
        return { error };
    }
};
const refusedAs = async (role, sql) => {
    await c.query('SAVEPOINT r');
    try { await c.query(`SET LOCAL ROLE ${role}`); await c.query(sql); assert.fail(`${role} was allowed: ${sql}`); }
    catch (err) { assert.equal(err.code, '42501', err.message); }
    finally { await c.query('ROLLBACK TO SAVEPOINT r'); }
};

await c.query('BEGIN');
try {
    // 1. A listed domain is refused, with a stable message, and leaves no shadow row behind.
    const blocked = await attempt(`${randomUUID()}@mailinator.com`);
    assert.ok(blocked.error, 'a mailinator.com sign-up was accepted');
    assert.match(blocked.error.message, /disposable_email_blocked/);
    assert.equal(
        (await one(`SELECT count(*)::int AS n FROM public.users WHERE email LIKE '%@mailinator.com'`)).n,
        0,
        'a refused sign-up left a public.users row',
    );

    // 2. Case and subdomains do not get around the list.
    assert.ok((await attempt(`${randomUUID()}@MAILINATOR.COM`)).error, 'upper-case domain got through');
    assert.ok((await attempt(`${randomUUID()}@inbox.mailinator.com`)).error, 'subdomain got through');

    // 3. A confirmed address (autoconfirm, admin-created) is refused too, so the grant path never runs.
    assert.ok((await attempt(`${randomUUID()}@yopmail.com`, { confirmed: true })).error, 'a confirmed disposable sign-up got through');

    // 4. A domain that merely ends in a listed name is a different domain and stays allowed.
    const lookalike = await attempt(`${randomUUID()}@notmailinator.com`);
    assert.ok(lookalike.id, `lookalike domain was refused: ${lookalike.error?.message}`);

    // 5. Real providers, privacy relays and the test fixtures other suites rely on are never listed.
    for (const domain of ['gmail.com', 'googlemail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'me.com',
                          'privaterelay.appleid.com', 'proton.me', 'protonmail.com', 'example.invalid', 'example.com']) {
        const ok = await attempt(`${randomUUID()}@${domain}`);
        assert.ok(ok.id, `${domain} was refused: ${ok.error?.message}`);
        assert.ok(await shadow(ok.id), `${domain} sign-up created no public.users row`);
    }

    // 6. An unconfirmed, ordinary sign-up still gets its shadow row (the existing trigger ordering is intact).
    const plain = await attempt(`${randomUUID()}@example.invalid`);
    assert.ok(plain.id && (await shadow(plain.id)), 'ordinary sign-up lost its shadow row');

    // 7. An anonymous user has no email and is not subject to the check.
    const anon = await attempt(null, { anonymous: true });
    assert.ok(anon.id, `anonymous sign-up was refused: ${anon.error?.message}`);

    // 8. The list is not readable or writable from the browser roles, and RLS is forced.
    await refusedAs('anon', 'SELECT * FROM public.blocked_email_domains');
    await refusedAs('authenticated', 'SELECT * FROM public.blocked_email_domains');
    await refusedAs('authenticated', `INSERT INTO public.blocked_email_domains(domain) VALUES ('example.org')`);
    const rls = await one(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.blocked_email_domains'::regclass`);
    assert.deepEqual([rls.relrowsecurity, rls.relforcerowsecurity], [true, true]);

    // 9. Every listed domain is stored lower-case, bare, and without a leading dot.
    const bad = await q(`SELECT domain FROM public.blocked_email_domains WHERE domain <> lower(domain) OR domain ~ '[@\\s]' OR domain LIKE '.%'`);
    assert.deepEqual(bad, [], 'malformed domain rows');

    // 10. The migration can be applied twice (inside the transaction, so it leaves nothing behind).
    const sql = await readFile(new URL('../packages/db/schema/supabase/0343_block_disposable_email.sql', import.meta.url), 'utf8');
    await c.query(sql);
    await c.query(sql);
    assert.ok((await attempt(`${randomUUID()}@mailinator.com`)).error, 're-applying the migration dropped the check');

    console.log('disposable email block: ok');
} finally {
    await c.query('ROLLBACK');
    await c.end();
}
