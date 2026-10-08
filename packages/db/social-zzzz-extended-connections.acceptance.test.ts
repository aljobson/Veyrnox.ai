import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('extended social connections (0228)', { skip: !process.env.DATABASE_URL }, () => {
    let pool: pg.Pool;
    const fixturePosts: string[] = [];
    const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
    before(async () => {
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
        // The full suite already applies the scheduling prerequisites. Do
        // not replay an old RETURNS TABLE signature over its later version.
        const existing = await one("SELECT to_regclass('public.social_post_targets') AS table_name");
        const prerequisites = existing.table_name ? [] : ['0154_social_publish_foundation.sql', '0156_social_publish_scheduling.sql',
            '0160_social_publish_composer.sql', '0161_social_publish_async_engine.sql', '0168_social_publish_claim_guards.sql',
            '0169_social_publish_free_account_cap.sql', '0175_social_actions_actor_restrict.sql'];
        for (const name of [...prerequisites, '0228_social_extended_connections.sql']) {
            const sql = await readFile(new URL(`./schema/supabase/${name}`, import.meta.url), 'utf8');
            await pool.query(sql);
            if (name.startsWith('0228_')) await pool.query(sql);
        }
    });
    after(async () => {
        if (!pool) return;
        await pool.query('DELETE FROM public.social_posts WHERE id=ANY($1::uuid[])', [fixturePosts]);
        await pool.end();
    });
    async function user() {
        const auth = randomUUID();
        await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [auth, `${auth}@test.veyrnox.ai`]);
        await one('SELECT public.provision_user($1,$2)', [auth, `${auth}@test.veyrnox.ai`]);
        return auth;
    }
    const prepare = async (auth: string, network = 'facebook') => (await one(
        'SELECT public.prepare_social_connection_selection($1,$2,$3) AS r', [auth, network, Buffer.from('encrypted-candidates')])).r;
    const consume = async (auth: string, network: string, id: string) => (await one(
        'SELECT public.consume_social_connection_selection($1,$2,$3) AS r', [auth, network, id])).r;

    it('selection is bound to the caller and network, and can be consumed only once', async () => {
        const auth = await user(), foreign = await user();
        const { id } = await prepare(auth);
        assert.equal(await consume(foreign, 'facebook', id), null);
        assert.equal(await consume(auth, 'pinterest', id), null);
        assert.ok((await consume(auth, 'facebook', id)).payload_enc);
        assert.equal(await consume(auth, 'facebook', id), null);
    });
    it('expired and superseded selections cannot be consumed', async () => {
        const auth = await user(), old = await prepare(auth), current = await prepare(auth);
        assert.notEqual(old.id, current.id);
        assert.equal(await consume(auth, 'facebook', old.id), null);
        await pool.query('UPDATE public.social_connection_selections SET expires_at=now()-interval \'1 second\' WHERE id=$1', [current.id]);
        assert.equal(await consume(auth, 'facebook', current.id), null);
        const next = await prepare(auth);
        assert.ok(next.id);
    });
    it('concurrent selection completion has exactly one winner', async () => {
        const auth = await user(), { id } = await prepare(auth);
        const results = await Promise.all(Array.from({ length: 8 }, () => consume(auth, 'facebook', id)));
        assert.equal(results.filter(Boolean).length, 1);
    });
    it('unknown users, unrelated networks, empty and oversized payloads are rejected', async () => {
        const auth = await user();
        assert.equal(await prepare(randomUUID()), null);
        assert.equal(await prepare(auth, 'youtube'), null);
        for (const bytes of [Buffer.alloc(0), Buffer.alloc(1048577)]) {
            assert.equal((await one('SELECT public.prepare_social_connection_selection($1,$2,$3) AS r', [auth, 'facebook', bytes])).r, null);
        }
    });
    async function connection(network = 'pinterest', refresh: Buffer | null = Buffer.from('old-refresh')) {
        const auth = await user();
        const brand = (await one('SELECT public.get_or_create_default_social_brand($1) AS r', [auth])).r;
        const connected = (await one('SELECT public.record_social_account_connection($1,$2,$3,$4,NULL,NULL,$5,$6,$7,$8) AS r',
            [auth, brand.brand_id, network, randomUUID(), [], Buffer.from('old-access'), refresh, new Date(Date.now() + 60000)])).r;
        assert.equal(connected.ok, true);
        return { auth, id: connected.account_id, network, refresh };
    }
    const rotate = async (account: { id: string, network: string, refresh: Buffer | null }) => (await one(
        'SELECT public.rotate_extended_social_tokens($1,$2,$3,$4,$5,$6,$7) AS r',
        [account.id, account.network, Buffer.from('old-access'), account.refresh, Buffer.from('new-access'),
            account.network === 'threads' ? null : Buffer.from('new-refresh'), new Date(Date.now() + 86400000)])).r;

    it('rotates access and refresh together, preserves scopes and refuses stale/disconnected work', async () => {
        const account = await connection();
        assert.deepEqual(await rotate(account), { ok: true });
        assert.equal(await rotate(account), null);
        const row = await one('SELECT access_token_enc,refresh_token_enc,scopes_granted FROM public.social_accounts WHERE id=$1', [account.id]);
        assert.deepEqual(row.access_token_enc, Buffer.from('new-access'));
        assert.deepEqual(row.refresh_token_enc, Buffer.from('new-refresh')); assert.deepEqual(row.scopes_granted, []);
        const gone = await connection();
        await one('SELECT public.disconnect_social_account($1,$2)', [gone.auth, gone.id]);
        assert.equal(await rotate(gone), null);
        assert.equal(await rotate(await connection('youtube')), null);
    });
    it('Threads renews its long-lived access token without requiring a refresh token', async () => {
        assert.deepEqual(await rotate(await connection('threads', null)), { ok: true });
        assert.equal(await rotate(await connection('pinterest', null)), null);
    });
    it('competing refreshes cannot overwrite one another', async () => {
        const account = await connection();
        const results = await Promise.all(Array.from({ length: 8 }, () => rotate(account)));
        assert.equal(results.filter((r) => r?.ok).length, 1);
    });
    it('only the current claim can mark a provider submission, and never twice', async () => {
        const account = await connection('facebook');
        const parent = await one('SELECT a.brand_id,b.owner_user_id FROM public.social_accounts a JOIN public.social_brands b ON b.id=a.brand_id WHERE a.id=$1', [account.id]);
        const post = randomUUID(), target = randomUUID(), claim = randomUUID();
        await pool.query("INSERT INTO public.social_posts(id,brand_id,created_by_user_id,scheduled_at,idempotency_key) VALUES($1,$2,$3,now(),$4)", [post, parent.brand_id, parent.owner_user_id, randomUUID()]);
        fixturePosts.push(post);
        await pool.query("INSERT INTO public.social_post_targets(id,post_id,account_id,network,publish_status,claim_key) VALUES($1,$2,$3,'facebook','publishing',$4)", [target, post, account.id, claim]);
        const mark = async (key: string, network = 'facebook') => (await one('SELECT public.mark_social_provider_submission($1,$2,$3) AS r', [target, key, network])).r;
        assert.equal(await mark(randomUUID()), null);
        assert.equal(await mark(claim, 'pinterest'), null);
        const results = await Promise.all(Array.from({ length: 8 }, () => mark(claim)));
        assert.equal(results.filter((r) => r?.ok).length, 1);
        const row = await one('SELECT provider_state,claim_key,publish_status FROM public.social_post_targets WHERE id=$1', [target]);
        assert.equal(row.provider_state.submission_started, true); assert.equal(row.claim_key, claim); assert.equal(row.publish_status, 'publishing');
    });
    it('RLS is forced and browser roles can neither read pending tokens nor call privileged RPCs', async () => {
        const table = await one("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.social_connection_selections'::regclass");
        assert.equal(table.relrowsecurity, true); assert.equal(table.relforcerowsecurity, true);
        const functions = ['prepare_social_connection_selection(uuid,text,bytea)', 'consume_social_connection_selection(uuid,text,uuid)',
            'rotate_extended_social_tokens(uuid,text,bytea,bytea,bytea,bytea,timestamptz)', 'mark_social_provider_submission(uuid,uuid,text)'];
        for (const role of ['anon', 'authenticated', 'service_role']) {
            assert.equal((await one("SELECT has_table_privilege($1,'public.social_connection_selections','SELECT') AS p", [role])).p, false);
            for (const fn of functions) assert.equal((await one("SELECT has_function_privilege($1,$2,'EXECUTE') AS p", [role, `public.${fn}`])).p, role === 'service_role');
        }
    });
});
