#!/usr/bin/env node
// Only a disposable local replay database: concurrency fixtures remain local.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', 'postgres'].includes(new URL(url).hostname)) throw Error('isolated local replay database required');
const c = new pg.Client({ connectionString: url }); await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const val = async (sql, args = []) => (await q(sql, args))[0]?.r;
const signature = 'public.record_social_multi_account_connection(text,uuid,text,text,text,text,text[],bytea,bytea,timestamptz)';
const argsFor = (u, external = randomUUID(), brand = u.brand) => [u.auth, brand, 'youtube', external, 'Fixture', null, ['scope'], Buffer.from('cipher'), null, null];
const sql = 'SELECT public.record_social_multi_account_connection($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS r';
const connect = (args, db = c) => db.query(sql, args).then(r => r.rows[0].r);
async function user() {
    const auth = randomUUID();
    await q('INSERT INTO auth.users(id,email) VALUES($1,$2)', [auth, `${auth}@example.invalid`]);
    const id = await val('SELECT id AS r FROM public.users WHERE auth_id=$1', [auth]);
    const brand = (await val('SELECT public.get_or_create_default_social_brand($1) AS r', [auth])).brand_id;
    return { auth, id, brand };
}
try {
    const migration = await readFile(new URL('../packages/db/schema/supabase/0265_social_publish_free_multi_account.sql', import.meta.url), 'utf8');
    const body = migration.replace(/^BEGIN;\n/m, '').replace(/^COMMIT;\n?$/m, '');
    await q('BEGIN'); await q(body); await q(body); await q('ROLLBACK');
    await q('BEGIN');
    const a = await user(), b = await user();
    const ledger = await val('SELECT count(*)::int AS r FROM public.ledger_entries');
    const balances = await q('SELECT user_id,balance,free_balance,subscription_balance FROM public.credit_balances ORDER BY user_id');
    assert.equal((await connect(argsFor({ ...a, auth: 'bad' }))).code, 'USER_NOT_FOUND');
    assert.equal((await connect(argsFor({ ...a, auth: randomUUID() }))).code, 'USER_NOT_FOUND');
    assert.equal((await connect(argsFor({ ...b, brand: a.brand }))).code, 'BRAND_NOT_FOUND');
    const channels = Array.from({ length: 5 }, () => randomUUID());
    for (const channel of channels) assert.equal((await connect(argsFor(a, channel))).ok, true);
    assert.deepEqual(await connect(argsFor(a)), { ok: false, code: 'ACCOUNT_LIMIT', limit: 5 });
    // Every brand owned by this user consumes the same allowance.
    const secondBrand = randomUUID();
    await q("INSERT INTO public.social_brands(id,owner_user_id,label) VALUES($1,$2,'Fixture brand')", [secondBrand, a.id]);
    assert.equal((await connect(argsFor(a, randomUUID(), secondBrand))).code, 'ACCOUNT_LIMIT');
    const reconnect = await connect(argsFor(a, channels[0]));
    assert.equal(reconnect.ok, true); assert.equal(reconnect.idempotent, true);
    const disconnected = await val('SELECT public.disconnect_social_account($1,$2) AS r', [a.auth, reconnect.account_id]);
    assert.equal(disconnected.ok, true);
    const replacement = await connect(argsFor(a, randomUUID(), secondBrand)); assert.equal(replacement.ok, true);
    assert.equal((await connect(argsFor(a, channels[0]))).code, 'ACCOUNT_LIMIT', 'revoked reconnect consumes a slot');
    // An old deployment cannot silently open the new allowance.
    assert.equal((await val(sql.replace('record_social_multi_account_connection', 'record_social_account_connection'), argsFor(a))).code, 'ACCOUNT_LIMIT');
    // Grandfathered accounts may refresh, but cannot add or reactivate at/over the cap.
    const sixth = randomUUID();
    await q("INSERT INTO public.social_accounts(brand_id,network,external_account_id,access_token_enc,status) VALUES($1,'youtube',$2,$3,'active')", [a.brand, sixth, Buffer.from('cipher')]);
    assert.equal((await connect(argsFor(a, sixth))).ok, true);
    assert.equal((await connect(argsFor(a))).code, 'ACCOUNT_LIMIT');
    assert.equal((await connect(argsFor(a, channels[0]))).code, 'ACCOUNT_LIMIT');
    assert.equal(await val('SELECT count(*)::int AS r FROM public.ledger_entries'), ledger);
    assert.deepEqual(await q('SELECT user_id,balance,free_balance,subscription_balance FROM public.credit_balances ORDER BY user_id'), balances);
    for (const fn of ['reconcile_balances','reconcile_free_credits','reconcile_top_ups','reconcile_failed_refunds','reconcile_subscription_credits','reconcile_free_allowance','reconcile_referrals']) {
        assert.deepEqual(await q(`SELECT * FROM public.${fn}()`), []);
    }
    for (const role of ['anon', 'authenticated']) {
        assert.equal(await val('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS r', [role, signature]), false);
        await q('SAVEPOINT denied'); await q(`SET LOCAL ROLE ${role}`);
        await assert.rejects(connect(argsFor(b)), e => e.code === '42501'); await q('ROLLBACK TO SAVEPOINT denied');
    }
    assert.equal(await val("SELECT has_function_privilege('service_role',$1,'EXECUTE') AS r", [signature]), true);
    const def = (await q("SELECT proconfig,prosecdef FROM pg_proc WHERE oid=$1::regprocedure", [signature]))[0];
    assert.equal(def.prosecdef, true); assert.ok(def.proconfig.includes('search_path=""'));
    await q('SET LOCAL ROLE service_role'); assert.equal((await connect(argsFor(b))).ok, true); await q('RESET ROLE');
    await q('ROLLBACK');
    // Commit only synthetic local fixtures so independent connections can see them.
    const race = await user();
    for (let i = 0; i < 4; i++) assert.equal((await connect(argsFor(race))).ok, true);
    const results = await Promise.all(Array.from({ length: 2 }, async () => {
        const db = new pg.Client({ connectionString: url }); await db.connect();
        try { return await connect(argsFor(race), db); } finally { await db.end(); }
    }));
    assert.equal(results.filter(r => r.ok).length, 1);
    assert.equal(results.filter(r => r.code === 'ACCOUNT_LIMIT').length, 1);
    assert.equal(await val("SELECT count(*)::int AS r FROM public.social_accounts a JOIN public.social_brands b ON b.id=a.brand_id WHERE b.owner_user_id=$1 AND a.status='active'", [race.id]), 5);
    console.log('Free multi-account Publish: five free slots, sixth denial, cross-brand cap, reconnect/revoked/grandfathered behavior, ownership/ACL, unchanged ledger and competing callbacks passed');
} finally { await c.query('ROLLBACK').catch(() => {}); await c.end(); }
