// Run only against the disposable local database built by replay-migrations.mjs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', 'postgres'].includes(new URL(url).hostname)) {
    throw Error('isolated local replay database required');
}
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const scalar = async (sql, args = []) => (await q(sql, args))[0]?.result;
const createSql = 'SELECT public.create_cinema_profile($1,$2,$3) AS result';
const own = (auth) => scalar('SELECT public.read_own_cinema_profile($1) AS result', [auth]);
const pub = (username) => scalar('SELECT public.read_public_cinema_profile($1) AS result', [username]);
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const profile = (name) => ({ username: `u_${name}_${suffix}`, display_name: name, bio: 'Profile text' });
const actors = Array.from({ length: 5 }, () => randomUUID());
async function denied(sql, args = []) {
    await c.query('SAVEPOINT denied');
    await assert.rejects(c.query(sql, args), (e) => e.code === '42501');
    await c.query('ROLLBACK TO SAVEPOINT denied');
}
async function concurrent(args) {
    return Promise.all(args.map(async (a) => {
        const peer = new pg.Client({ connectionString: url });
        await peer.connect();
        try { return (await peer.query(createSql, a)).rows[0].result; }
        finally { await peer.end(); }
    }));
}
try {
    const migration = await readFile(new URL('../packages/db/schema/supabase/0132_social_cinema_foundation.sql', import.meta.url), 'utf8');
    await c.query(migration);
    await c.query(migration);
    // Existing identity trigger is the only provisioning path. An unconfirmed
    // user stays unfunded; repeated confirmation still grants exactly once.
    for (const id of actors) await c.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [id, `${id}@example.invalid`]);
    const users = await q('SELECT id,auth_id FROM public.users WHERE auth_id=ANY($1::text[])', [actors]);
    const ids = users.map((u) => u.id);
    assert.equal(users.length, 5);
    assert.equal(await scalar('SELECT sum(balance)::int AS result FROM public.credit_balances WHERE user_id=ANY($1::uuid[])', [ids]), 0);
    for (let i = 0; i < 2; i++) await c.query('UPDATE auth.users SET email_confirmed_at=now() WHERE id=ANY($1::uuid[])', [actors]);
    assert.equal(await scalar("SELECT count(*)::int AS result FROM public.ledger_entries WHERE user_id=ANY($1::uuid[]) AND reason='grant:signup'", [ids]), 5);
    const before = await q('SELECT user_id,balance,free_balance FROM public.credit_balances WHERE user_id=ANY($1::uuid[]) ORDER BY user_id', [ids]);
    assert.ok(before.every((x) => x.balance === 10 && x.free_balance === 10));
    const ledgerBefore = await scalar('SELECT count(*)::int AS result FROM public.ledger_entries WHERE user_id=ANY($1::uuid[])', [ids]);
    const pa = profile('alice'), pb = profile('bob'), key = randomUUID();
    const made = await scalar(createSql, [actors[0], key, pa]);
    assert.ok(made.profile_id);
    assert.equal(made.idempotent, false);
    assert.deepEqual(await scalar(createSql, [actors[0], key, pa]), { profile_id: made.profile_id, idempotent: true });
    assert.equal((await scalar(createSql, [actors[0], key, { ...pa, bio: 'changed' }])).error, 'idempotency_conflict');
    assert.equal((await scalar(createSql, [actors[0], randomUUID(), pa])).error, 'profile_exists');
    const bob = await scalar(createSql, [actors[1], randomUUID(), pb]);
    assert.notEqual(bob.profile_id, made.profile_id);
    assert.equal((await own(actors[0])).id, made.profile_id);
    assert.equal((await own(actors[1])).id, bob.profile_id);
    assert.equal(await own(randomUUID()), null);
    assert.equal((await own(actors[0])).role, 'viewer');
    assert.equal((await own(actors[0])).account_status, 'active');
    assert.deepEqual(await pub(pa.username), { id: made.profile_id, ...pa });
    assert.ok(!Object.values(await pub(pa.username)).includes(actors[0]));
    assert.ok(!ids.includes(made.profile_id));
    for (const field of ['user_id','auth_id','id','role','account_status','is_admin']) {
        assert.equal((await scalar(createSql, [actors[2], randomUUID(), { ...profile('mallory'), [field]: actors[0] }])).error, 'invalid_profile');
    }
    for (const payload of [null, [], 1, { ...pa, username: 'UPPER' }, { ...pa, bio: null }, { ...pa, display_name: '' }, { ...pa, bio: 'x'.repeat(501) }]) {
        assert.equal((await scalar(createSql, [actors[2], randomUUID(), payload])).error, 'invalid_profile');
    }
    assert.equal((await scalar(createSql, [randomUUID(), randomUUID(), profile('unknown')])).error, 'user_not_provisioned');
    assert.equal((await scalar(createSql, [actors[2], randomUUID(), pa])).error, 'username_unavailable');
    assert.equal(await own(actors[2]), null);
    // A replay must not reset an operator-owned role or moderation decision.
    await c.query("UPDATE public.cinema_memberships SET role='moderator',account_status='suspended' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)", [actors[0]]);
    await scalar(createSql, [actors[0], key, pa]);
    assert.equal((await own(actors[0])).role, 'moderator');
    assert.equal((await own(actors[0])).account_status, 'suspended');
    assert.equal(await pub(pa.username), null);
    const replayKey = randomUUID(), pc = profile('carol');
    const replayResults = await concurrent([[actors[2], replayKey, pc], [actors[2], replayKey, pc]]);
    assert.equal(new Set(replayResults.map((r) => r.profile_id)).size, 1);
    assert.deepEqual(replayResults.map((r) => r.idempotent).sort(), [false, true]);
    const race = await concurrent([[actors[3], randomUUID(), profile('shared')], [actors[4], randomUUID(), profile('shared')]]);
    assert.equal(race.filter((r) => r.profile_id).length, 1);
    assert.equal(race.filter((r) => r.error === 'username_unavailable').length, 1);
    const functions = ['create_cinema_profile(text,uuid,jsonb)', 'read_own_cinema_profile(text)', 'read_public_cinema_profile(text)'];
    const tables = ['cinema_profiles','cinema_memberships'];
    for (const fn of functions) {
        const [entry] = await q('SELECT prosecdef,proconfig FROM pg_proc WHERE oid=$1::regprocedure', [`public.${fn}`]);
        assert.equal(entry.prosecdef, true);
        assert.ok(entry.proconfig.includes('search_path=""'));
        assert.equal(await scalar("SELECT has_function_privilege('service_role',$1,'EXECUTE') AS result", [`public.${fn}`]), true);
    }
    for (const table of tables) {
        const [entry] = await q('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass', [`public.${table}`]);
        assert.equal(entry.relrowsecurity, true);
        assert.equal(entry.relforcerowsecurity, true);
        for (const role of ['anon','authenticated','service_role']) {
            for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) {
                assert.equal(await scalar('SELECT has_table_privilege($1,$2,$3) AS result', [role, `public.${table}`, privilege]), false);
            }
        }
    }
    await c.query('BEGIN');
    for (const role of ['anon','authenticated']) {
        await c.query(`SET LOCAL ROLE ${role}`);
        for (const table of tables) {
            await denied(`SELECT * FROM public.${table}`);
            await denied(`TRUNCATE public.${table}`);
        }
        await denied(createSql, [actors[0], key, pa]);
        await denied('SELECT public.read_own_cinema_profile($1)', [actors[1]]);
        await denied('SELECT public.read_public_cinema_profile($1)', [pb.username]);
        await c.query('RESET ROLE');
    }
    // Prove deny-default RLS still holds if a table grant is accidentally added.
    await c.query('GRANT SELECT ON public.cinema_profiles,public.cinema_memberships TO authenticated');
    await c.query('SET LOCAL ROLE authenticated');
    for (const table of tables) assert.equal((await q(`SELECT * FROM public.${table}`)).length, 0);
    await c.query('RESET ROLE');
    await c.query('ROLLBACK');
    // Actual service-role calls work only through the approved projections.
    await c.query('SET ROLE service_role');
    assert.equal((await own(actors[1])).id, bob.profile_id);
    assert.deepEqual(await pub(pb.username), { id: bob.profile_id, ...pb });
    await c.query('RESET ROLE');
    assert.deepEqual(await q('SELECT user_id,balance,free_balance FROM public.credit_balances WHERE user_id=ANY($1::uuid[]) ORDER BY user_id', [ids]), before);
    assert.equal(await scalar('SELECT count(*)::int AS result FROM public.ledger_entries WHERE user_id=ANY($1::uuid[])', [ids]), ledgerBefore);
    // Reapplying the migration preserves existing profiles and private roles.
    await c.query(migration);
    assert.equal((await own(actors[0])).role, 'moderator');
    assert.equal((await own(actors[0])).id, made.profile_id);
    console.log('Social Cinema: replay, identity/ledger preservation, ownership/projection, ACL/RLS, role denial and concurrent idempotency passed');
} finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
}
