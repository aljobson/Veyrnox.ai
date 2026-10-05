#!/usr/bin/env node
// 0217 (ADR-0071 part 1): referral codes and attribution. Runs against the full migration replay (ledger-tests.yml). Every fixture is rolled back.
// This migration moves no Credits, and the last case proves it.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const one = async (sql, args = []) => (await c.query(sql, args)).rows[0];
const rpc = async (sql, args = []) => (await one(`SELECT ${sql} AS r`, args)).r;
async function account(confirmed = true) {
    const auth = randomUUID();
    await c.query('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, $3)', [auth, `${auth}@example.invalid`, confirmed ? new Date() : null]);
    return { auth, id: (await one('SELECT id FROM public.users WHERE auth_id = $1', [auth])).id };
}
const codeOf = async (a) => (await rpc('public.referral_code_for($1)', [a.auth])).code;
const attach = (a, code) => rpc('public.attach_referral($1, $2)', [a.auth, code]);
const ledgerCount = async () => Number((await one('SELECT count(*) AS n FROM public.ledger_entries')).n);

try {
    const migration = await readFile(new URL('../packages/db/schema/supabase/0217_referral_attribution.sql', import.meta.url), 'utf8');
    await c.query('BEGIN'); await c.query(migration); await c.query(migration); await c.query('ROLLBACK'); // safe to apply twice

    await c.query('BEGIN');
    const ledgerBefore = await ledgerCount();
    const referrer = await account(), friend = await account(), other = await account();

    // A code is made once, is stable, 10 characters from the safe alphabet, and different for each account.
    const code = await codeOf(referrer);
    assert.match(code, /^[2-9A-HJKMNP-Z]{10}$/);
    assert.equal(await codeOf(referrer), code, 'stable');
    const codes = new Set([code]);
    for (let i = 0; i < 30; i += 1) codes.add(await codeOf(await account()));
    assert.equal(codes.size, 31, 'no two accounts share a code');
    assert.equal((await rpc('public.referral_code_for($1)', [randomUUID()])).code, 'USER_NOT_FOUND');

    // Attribution: a new account can be attached once; the same code again is a retry; a different one is refused.
    assert.deepEqual(await attach(friend, code), { ok: true, attached: true, idempotent: false });
    assert.deepEqual(await attach(friend, code), { ok: true, attached: true, idempotent: true });
    const otherCode = await codeOf(other);
    assert.equal((await attach(friend, otherCode)).code, 'ALREADY_ATTACHED');
    assert.equal((await one('SELECT referrer_user_id FROM public.referrals WHERE referee_user_id = $1', [friend.id])).referrer_user_id, referrer.id);
    assert.ok(!JSON.stringify(await attach(friend, code)).includes(referrer.id), 'the referrer is never revealed');

    // Refusals: yourself, an unknown or malformed code, an unknown account.
    assert.equal((await attach(referrer, code)).code, 'SELF_REFERRAL');
    for (const bad of [null, '', 'short', 'ABCDEFGHJK1', 'abcdefghjk', 'IIIIIIIIII', '2222222222; drop']) assert.equal((await attach(await account(), bad)).code, 'INVALID_CODE', String(bad));
    assert.equal((await attach(await account(), '2222222222')).code, 'INVALID_CODE', 'well-formed but nobody\'s code');
    assert.equal((await rpc('public.attach_referral($1, $2)', [randomUUID(), code])).code, 'USER_NOT_FOUND');

    // Only a NEW account: old, or with a job, or with a top-up, cannot be attached.
    const old = await account();
    await c.query(`UPDATE public.users SET created_at = now() - interval '3 days' WHERE id = $1`, [old.id]);
    assert.equal((await attach(old, code)).code, 'NOT_NEW');
    const busy = await account();
    const debit = await rpc(`public.ledger_debit($1, $2, 1, 'debit:generation', 'seedance-2.0-fast', '{}'::jsonb)`, [busy.id, randomUUID()]);
    assert.equal(debit.ok, true, JSON.stringify(debit));
    assert.equal((await attach(busy, code)).code, 'NOT_NEW', 'a job makes it not new');
    const paid = await account();
    const pack = (await one('SELECT id, credits, price_usd_cents, variant_id FROM public.credit_packs LIMIT 1'));
    if (pack) {
        await c.query(`INSERT INTO public.top_ups (user_id, pack_id, idempotency_key, sales_channel, credits, price_usd_cents, variant_id, consent_at, consent_version)
            VALUES ($1, $2, $3, 'web', $4, $5, $6, now(), 'v1')`, [paid.id, pack.id, `ref-test-${randomUUID().slice(0, 8)}`, pack.credits, pack.price_usd_cents, pack.variant_id]);
        assert.equal((await attach(paid, code)).code, 'NOT_NEW', 'a top-up makes it not new');
    }
    // A retry after the account stops being new still succeeds, because the existing link is checked first.
    await c.query(`UPDATE public.users SET created_at = now() - interval '3 days' WHERE id = $1`, [friend.id]);
    assert.equal((await attach(friend, code)).idempotent, true);

    // Counts only.
    assert.deepEqual(await rpc('public.referral_summary($1)', [referrer.auth]), { ok: true, referred: 1 });
    assert.equal((await rpc('public.referral_summary($1)', [other.auth])).referred, 0);
    assert.equal((await rpc('public.referral_summary($1)', [randomUUID()])).code, 'USER_NOT_FOUND');

    // A referee is attached at most once at the table level too, and never to itself.
    await c.query('SAVEPOINT s');
    await assert.rejects(c.query('INSERT INTO public.referrals (referee_user_id, referrer_user_id, code) VALUES ($1, $2, $3)', [friend.id, other.id, otherCode]), { code: '23505' });
    await c.query('ROLLBACK TO SAVEPOINT s');
    await assert.rejects(c.query('INSERT INTO public.referrals (referee_user_id, referrer_user_id, code) VALUES ($1, $1, $2)', [other.id, otherCode]), { code: '23514' });
    await c.query('ROLLBACK TO SAVEPOINT s').catch(() => {});

    // Reachable only through the functions, by the service role; both tables are locked down.
    for (const t of ['referral_codes', 'referrals']) {
        const rls = await one(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = ('public.' || $1)::regclass`, [t]);
        assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true }, t);
        const grants = await c.query(`SELECT grantee FROM information_schema.role_table_grants WHERE table_name = $1 AND grantee IN ('anon','authenticated','PUBLIC','service_role')`, [t]);
        assert.equal(grants.rowCount, 0, t);
    }
    for (const sig of ['referral_code_for(text)', 'attach_referral(text,text)', 'referral_summary(text)']) {
        const r = await one(`SELECT has_function_privilege('anon', 'public.${sig}', 'EXECUTE') AS anon, has_function_privilege('authenticated', 'public.${sig}', 'EXECUTE') AS auth,
            has_function_privilege('service_role', 'public.${sig}', 'EXECUTE') AS svc`);
        assert.deepEqual(r, { anon: false, auth: false, svc: true }, sig);
    }

    // It goes with the account (an unconfirmed account has no ledger rows, so it can be deleted).
    const gone = await account(false), keeper = await account(false);
    await attach(gone, await codeOf(keeper));
    await c.query('DELETE FROM public.users WHERE id = $1', [gone.id]);
    assert.equal((await one('SELECT count(*)::int AS n FROM public.referrals WHERE referee_user_id = $1', [gone.id])).n, 0);

    // Nothing here moved Credits beyond the signup grants and the one debit this test made itself.
    const grantsMade = Number((await one(`SELECT count(*) AS n FROM public.ledger_entries WHERE reason LIKE '%referral%'`)).n);
    assert.equal(grantsMade, 0, 'no referral reward or ledger row of any kind');
    assert.ok(await ledgerCount() >= ledgerBefore);
    await c.query('ROLLBACK');
    console.log('referral attribution: ok');
} finally {
    await c.end();
}
