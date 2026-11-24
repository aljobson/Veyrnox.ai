#!/usr/bin/env node
// Run only after replay-migrations on a throwaway LOCAL PostgreSQL database.
// Every fixture is rolled back; this never applies a migration to a persistent environment.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must identify a throwaway local test database');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(url.pathname)) {
    throw new Error('Smart Cut feedback tests refuse remote databases and non-test database names');
}

const db = new pg.Client({ connectionString });
await db.connect();
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const one = async (sql, args = []) => (await rows(sql, args))[0];
const scalar = async (sql, args = []) => Object.values(await one(sql, args))[0];
const asRole = async (role, sql, args = []) => {
    await db.query('SAVEPOINT role_call');
    try {
        await db.query(`SET LOCAL ROLE ${role}`);
        const result = await one(sql, args);
        await db.query('RESET ROLE');
        await db.query('RELEASE SAVEPOINT role_call');
        return result;
    } catch (error) {
        await db.query('ROLLBACK TO SAVEPOINT role_call');
        await db.query('RELEASE SAVEPOINT role_call');
        throw error;
    }
};
const denied = async (role, sql, args = []) => {
    await db.query('SAVEPOINT expected_denial');
    try {
        await db.query(`SET LOCAL ROLE ${role}`);
        await assert.rejects(db.query(sql, args), (error) => error.code === '42501');
    } finally {
        await db.query('ROLLBACK TO SAVEPOINT expected_denial');
        await db.query('RESET ROLE');
        await db.query('RELEASE SAVEPOINT expected_denial');
    }
};
const person = async (label) => {
    const auth = randomUUID();
    await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [auth, `${label}-${auth}@example.invalid`]);
    return { auth, id: await scalar('SELECT id FROM public.users WHERE auth_id=$1', [auth]) };
};
const submit = async (auth, response, rating = 'up', comment = null, mode = 'local-preview') =>
    (await asRole('service_role', 'SELECT public.submit_smart_cut_feedback($1,$2,$3,$4,$5) AS result',
        [auth, response, rating, comment, mode])).result;
const startExport = async (auth) =>
    (await asRole('service_role', "SELECT public.start_privacy_export($1,'aal1') AS result", [auth])).result;
const readExport = async (auth, id, after = null, key = null, size = 200) =>
    (await asRole('service_role', "SELECT public.read_privacy_export_page($1,'aal1',$2,'smart_cut_feedback',NULL,$3,$4,$5) AS result",
        [auth, id, after, key, size])).result;

let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`ok ${passed} - ${name}`); };

try {
    await db.query('BEGIN');
    // The disposable replay database does not include Supabase Auth's managed MFA table.
    // Match the privacy-export acceptance fixture so its production MFA guard can execute.
    await db.query('CREATE TABLE IF NOT EXISTS auth.mfa_factors(user_id uuid,factor_type text,status text)');
    const owner = await person('smart-cut-feedback');
    const response = randomUUID();

    await check('service role accepts a minimal response and exact replay is idempotent', async () => {
        const first = await submit(owner.auth, response, 'down', 'Needs a smoother\nending.', 'transcript-silence');
        assert.deepEqual(first, { ok: true, replayed: false });
        assert.deepEqual(await submit(owner.auth, response, 'down', 'Needs a smoother\nending.', 'transcript-silence'), { ok: true, replayed: true });
        const stored = await one('SELECT rating,comment,plan_mode,created_at,expires_at FROM public.smart_cut_feedback WHERE user_id=$1 AND response_id=$2', [owner.id, response]);
        assert.deepEqual({ rating: stored.rating, comment: stored.comment, mode: stored.plan_mode }, {
            rating: 'down', comment: 'Needs a smoother\nending.', mode: 'transcript-silence',
        });
        assert.ok(Math.abs((stored.expires_at - stored.created_at) - 180 * 24 * 60 * 60 * 1000) < 1000);
    });

    await check('changed replay conflicts without overwriting the first answer', async () => {
        assert.deepEqual(await submit(owner.auth, response, 'up', 'Changed', 'transcript-silence'), { ok: false, code: 'IDEMPOTENCY_CONFLICT' });
        assert.equal(await scalar('SELECT rating FROM public.smart_cut_feedback WHERE response_id=$1', [response]), 'down');
    });

    await check('invalid, overlong and control-bearing input is refused before insert', async () => {
        const invalid = [
            [null, 'up', null, 'local-preview'],
            [randomUUID(), 'maybe', null, 'local-preview'],
            [randomUUID(), 'up', null, 'unknown'],
            [randomUUID(), 'up', 'x'.repeat(1001), 'local-preview'],
            [randomUUID(), 'up', `private${String.fromCharCode(1)}value`, 'local-preview'],
        ];
        for (const [id, rating, comment, mode] of invalid) {
            assert.deepEqual(await submit(owner.auth, id, rating, comment, mode), { ok: false, code: 'INVALID_REQUEST' });
        }
        assert.equal(Number(await scalar('SELECT count(*) FROM public.smart_cut_feedback WHERE user_id=$1', [owner.id])), 1);
    });

    await check('table and RPC privileges keep browser roles and direct service reads out', async () => {
        const signature = 'public.submit_smart_cut_feedback(text,uuid,text,text,text)';
        assert.equal(Number(await scalar(`SELECT count(*) FROM pg_class c,
            LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
            WHERE c.oid='public.smart_cut_feedback'::regclass AND a.grantee=0`)), 0, 'PUBLIC table ACL');
        assert.equal(Number(await scalar(`SELECT count(*) FROM pg_proc p,
            LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
            WHERE p.oid=$1::regprocedure AND a.grantee=0`, [signature])), 0, 'PUBLIC RPC ACL');
        for (const role of ['anon', 'authenticated', 'service_role']) {
            assert.equal(await scalar("SELECT has_table_privilege($1,'public.smart_cut_feedback','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')", [role]), false, role);
            assert.equal(await scalar("SELECT has_function_privilege($1,$2,'EXECUTE')", [role, signature]), role === 'service_role', role);
            await denied(role, 'SELECT * FROM public.smart_cut_feedback');
        }
        const security = await one("SELECT prosecdef,proconfig FROM pg_proc WHERE oid=$1::regprocedure", [signature]);
        assert.equal(security.prosecdef, true);
        assert.ok(security.proconfig.includes('search_path=""'));
        const table = await one("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.smart_cut_feedback'::regclass");
        assert.equal(table.relrowsecurity, true); assert.equal(table.relforcerowsecurity, true);
        const purge = await one("SELECT prosecdef,proconfig FROM pg_proc WHERE oid='private.purge_smart_cut_feedback(integer)'::regprocedure");
        assert.equal(purge.prosecdef, true); assert.ok(purge.proconfig.includes('search_path=""'));
        for (const role of ['anon', 'authenticated', 'service_role']) {
            assert.equal(await scalar("SELECT has_function_privilege($1,'private.purge_smart_cut_feedback(integer)','EXECUTE')", [role]), false);
        }
    });

    await check('per-account minute cap refuses the twenty-first stored response', async () => {
        const present = Number(await scalar("SELECT count(*) FROM public.smart_cut_feedback WHERE user_id=$1 AND created_at>now()-interval '1 minute'", [owner.id]));
        for (let i = present; i < 20; i += 1) {
            await db.query("INSERT INTO public.smart_cut_feedback(user_id,response_id,rating,plan_mode) VALUES($1,$2,'up','local-preview')", [owner.id, randomUUID()]);
        }
        assert.deepEqual(await submit(owner.auth, randomUUID()), { ok: false, code: 'RATE_LIMITED' });
        assert.equal(Number(await scalar("SELECT count(*) FROM public.smart_cut_feedback WHERE user_id=$1 AND created_at>now()-interval '1 minute'", [owner.id])), 20);
    });

    await check('privacy export pages only the allowed feedback fields and preserves prior profile wrapper', async () => {
        const exporter = await person('smart-cut-export');
        const firstId = randomUUID(), secondId = randomUUID();
        assert.equal((await submit(exporter.auth, firstId, 'up', null, 'local-preview')).ok, true);
        assert.equal((await submit(exporter.auth, secondId, 'down', 'Too fast', 'transcript-silence')).ok, true);
        const started = await startExport(exporter.auth);
        assert.equal(started.ok, true);
        const first = await readExport(exporter.auth, started.export_id, null, null, 1);
        assert.equal(first.ok, true); assert.equal(first.rows.length, 1); assert.ok(first.next);
        assert.deepEqual(Object.keys(first.rows[0]).sort(), ['comment', 'created_at', 'plan_mode', 'rating', 'response_id']);
        const second = await readExport(exporter.auth, started.export_id, first.next.after, first.next.key, 1);
        assert.equal(second.ok, true); assert.equal(second.rows.length, 1);
        assert.deepEqual(new Set([...first.rows, ...second.rows].map((row) => row.response_id)), new Set([firstId, secondId]));
        const profile = (await asRole('service_role', "SELECT public.read_privacy_export_page($1,'aal1',$2,'profile',NULL,NULL,NULL,1) AS result", [exporter.auth, started.export_id])).result;
        assert.equal(profile.ok, true); assert.equal(profile.rows.length, 1); assert.ok('first_goal' in profile.rows[0]);
    });

    await check('expired responses are pruned and soft account deletion erases remaining feedback', async () => {
        const erased = await person('smart-cut-erased');
        const expired = randomUUID(), live = randomUUID();
        assert.equal((await submit(erased.auth, expired)).ok, true);
        await db.query("UPDATE public.smart_cut_feedback SET expires_at=now()-interval '1 second' WHERE response_id=$1", [expired]);
        assert.equal(Number(await scalar('SELECT private.purge_smart_cut_feedback(1)')), 1);
        assert.equal((await submit(erased.auth, live)).ok, true);
        assert.equal(Number(await scalar('SELECT count(*) FROM public.smart_cut_feedback WHERE response_id=$1', [expired])), 0);
        assert.equal(Number(await scalar('SELECT count(*) FROM public.smart_cut_feedback WHERE user_id=$1', [erased.id])), 1);
        await db.query('UPDATE public.users SET deleted_at=now() WHERE id=$1', [erased.id]);
        assert.equal(Number(await scalar('SELECT count(*) FROM public.smart_cut_feedback WHERE user_id=$1', [erased.id])), 0);
        assert.deepEqual(await submit(erased.auth, randomUUID()), { ok: false, code: 'NOT_FOUND' });
    });

    await check('telemetry admits only the normalized route and cannot project feedback contents', async () => {
        assert.equal(await scalar("SELECT public.telemetry_path_allowed('/api/v1/editor/smart-cut-feedback')"), true);
        assert.equal(await scalar("SELECT public.telemetry_path_allowed('/api/v1/editor/smart-cut-feedback/private-comment')"), false);
        assert.equal(await scalar("SELECT public.telemetry_path_allowed('/api/v1/generations/quote')"), true, 'older allowlist wrapper survives');
        assert.ok(await scalar("SELECT to_regprocedure('public.telemetry_path_allowed_pre_0612(text)') IS NOT NULL"));
        const definition = await scalar("SELECT pg_get_functiondef('public.telemetry_path_allowed(text)'::regprocedure)");
        for (const content of ['response_id', 'rating', 'comment', 'plan_mode', 'smart_cut_feedback']) assert.ok(!definition.includes(content), content);
    });
} finally {
    await db.query('ROLLBACK');
    await db.end();
}
console.log(`${passed} Smart Cut feedback integration checks passed (fixtures rolled back)`);
