/** Run only against a disposable database with the current migrations already applied.
 * This test never applies migrations. All fixture data is rolled back. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
const url = process.env.EDITOR_AI_EDIT_TEST_DATABASE_URL;
describe('editor AI edit settlement acceptance', { skip: !url && 'EDITOR_AI_EDIT_TEST_DATABASE_URL not set' }, () => {
    let client: pg.Client;
    let user: string;
    const auth = randomUUID(), otherAuth = randomUUID();
    const result = { plan: { commands: [{ op: 'addText', text: 'Title', start: 0, len: 30 }] }, skipped: [], summary: 'One step', credits: 3 };
    before(async () => {
        const { default: pg } = await import('pg');
        client = new pg.Client({ connectionString: url }); await client.connect(); await client.query('BEGIN');
        const inserted = await client.query('INSERT INTO public.users(auth_id,email) VALUES($1,$2) RETURNING id', [auth, `${auth}@example.test`]); user = inserted.rows[0].id;
    });
    after(async () => { if (client) { await client.query('ROLLBACK'); await client.end(); } });
    async function job(kind = 'editor_ai_edit', state = 'SUBMITTED') {
        const key = randomUUID();
        // Job-only fixture: no raw ledger/balance writes. Settlement must never move money.
        const { rows } = await client.query(`INSERT INTO public.jobs(user_id,idempotency_key,model_id,credits,inputs,state)
            VALUES($1,$2,(SELECT id FROM public.model_catalog LIMIT 1),3,$3,$4) RETURNING id`, [user, key, { kind, request_hash: 'a'.repeat(64) }, state]);
        return { id: rows[0].id, key };
    }
    async function settle(id: string, value = result) {
        return (await client.query('SELECT public.editor_ai_edit_settle($1,$2) AS value', [id, value])).rows[0].value;
    }
    async function lookup(key: string, owner = auth) {
        return (await client.query('SELECT public.editor_ai_edit_lookup($1,$2) AS value', [owner, key])).rows[0].value;
    }
    it('SUBMITTED -> STORED atomically; replay does not overwrite the original result', async () => {
        const j = await job(); assert.equal((await settle(j.id)).ok, true);
        assert.equal((await settle(j.id, { ...result, summary: 'Replacement' })).idempotent, true);
        assert.deepEqual((await lookup(j.key)).result, result);
        assert.equal((await client.query('SELECT state FROM public.jobs WHERE id=$1', [j.id])).rows[0].state, 'STORED');
        assert.equal((await lookup(j.key, otherAuth)).found, false);
    });
    it('refuses wrong kind and invalid state; preserves both', async () => {
        const wrong = await job('chat'), debited = await job('editor_ai_edit', 'DEBITED');
        assert.equal((await settle(wrong.id)).code, 'JOB_NOT_FOUND'); assert.equal((await settle(debited.id)).code, 'BAD_STATE');
        assert.equal((await lookup(wrong.key)).conflict, true);
        assert.equal((await lookup(debited.key)).status, 'pending');
    });
    it('Library list, detail and cancel status exclude editor edit jobs', async () => {
        const j = await job(); await settle(j.id);
        const list = (await client.query('SELECT public.list_user_jobs($1) AS value', [auth])).rows[0].value;
        assert.equal(list.ok, true); assert.equal(list.jobs.some((item: { job_id: string }) => item.job_id === j.id), false);
        for (const fn of ['get_user_job', 'get_user_job_cancel']) {
            assert.equal((await client.query(`SELECT public.${fn}($1,$2) AS value`, [auth, j.id])).rows[0].value.code, 'NOT_FOUND');
        }
    });
    it('expires after 24 hours and purges payload without removing the financial job', async () => {
        const j = await job(); await settle(j.id);
        await client.query("UPDATE public.jobs SET editor_ai_edit_expires_at=now()-interval '1 second' WHERE id=$1", [j.id]);
        assert.equal((await lookup(j.key)).status, 'expired'); assert.equal((await lookup(j.key)).result, null);
        await client.query('SELECT public.purge_editor_ai_edit_results()');
        assert.equal((await client.query('SELECT editor_ai_edit_result FROM public.jobs WHERE id=$1', [j.id])).rows[0].editor_ai_edit_result, null);
    });
    it('tombstoned accounts retain no result payload', async () => {
        const j = await job(); await settle(j.id);
        await client.query('SAVEPOINT erase_test');
        await client.query('UPDATE public.users SET deleted_at=now() WHERE id=$1', [user]);
        assert.equal((await lookup(j.key)).found, false);
        assert.equal((await client.query('SELECT editor_ai_edit_result FROM public.jobs WHERE id=$1', [j.id])).rows[0].editor_ai_edit_result, null);
        await client.query('ROLLBACK TO SAVEPOINT erase_test');
    });
    it('RPCs are service-role only and SECURITY DEFINER uses an empty search path', async () => {
        for (const signature of ['public.editor_ai_edit_settle(uuid,jsonb)', 'public.editor_ai_edit_lookup(text,text)', 'public.purge_editor_ai_edit_results()']) {
            for (const role of ['anon', 'authenticated']) assert.equal((await client.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed', [role, signature])).rows[0].allowed, false);
            const fn = (await client.query('SELECT prosecdef,proconfig FROM pg_proc WHERE oid=$1::regprocedure', [signature])).rows[0];
            assert.equal(fn.prosecdef, true); assert.ok(fn.proconfig.includes('search_path=""'));
        }
    });
});
