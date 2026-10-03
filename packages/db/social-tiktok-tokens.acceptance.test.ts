import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('TikTok atomic token rotation (0190)', { skip: !process.env.DATABASE_URL }, () => {
    let pool: pg.Pool;
    const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
    before(async () => {
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
        const sql = await readFile(new URL('./schema/supabase/0190_tiktok_token_rotation.sql', import.meta.url), 'utf8');
        await pool.query(sql); await pool.query(sql);
    });
    after(async () => { await pool?.end(); });
    async function connected(network = 'tiktok') {
        const auth = randomUUID();
        await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [auth, `${auth}@test.veyrnox.ai`]);
        await one('SELECT public.provision_user($1,$2)', [auth, `${auth}@test.veyrnox.ai`]);
        const brand = (await one('SELECT public.get_or_create_default_social_brand($1) AS r', [auth])).r;
        const account = (await one('SELECT public.record_social_account_connection($1,$2,$3,$4,NULL,NULL,$5,$6,$7,$8) AS r',
            [auth, brand.brand_id, network, randomUUID(), ['user.info.basic'], Buffer.from('old-access'), Buffer.from('old-refresh'), new Date(Date.now() + 60_000)])).r;
        assert.equal(account.ok, true);
        return { auth, id: account.account_id };
    }
    const rotate = async (id: string) => (await one(
        'SELECT public.rotate_tiktok_account_tokens($1,$2,$3,$4,$5,$6,$7) AS r',
        [id, Buffer.from('old-access'), Buffer.from('old-refresh'), Buffer.from('new-access'), Buffer.from('new-refresh'),
            new Date(Date.now() + 86400_000), ['user.info.basic', 'video.list']],
    )).r;

    it('writes both tokens, expiry and grants together; a replay cannot overwrite them', async () => {
        const a = await connected();
        assert.deepEqual(await rotate(a.id), { ok: true });
        const row = await one('SELECT access_token_enc,refresh_token_enc,scopes_granted FROM public.social_accounts WHERE id=$1', [a.id]);
        assert.deepEqual(row.access_token_enc, Buffer.from('new-access'));
        assert.deepEqual(row.refresh_token_enc, Buffer.from('new-refresh'));
        assert.deepEqual(row.scopes_granted, ['user.info.basic', 'video.list']);
        assert.equal(await rotate(a.id), null);
    });

    it('two competing refreshes cannot both replace the claimed connection', async () => {
        const a = await connected();
        const results = await Promise.all(Array.from({ length: 8 }, () => rotate(a.id)));
        assert.equal(results.filter((r) => r?.ok).length, 1);
    });

    it('disconnect, reconnect and a foreign network refuse stale rotation', async () => {
        const gone = await connected();
        await one('SELECT public.disconnect_social_account($1,$2)', [gone.auth, gone.id]);
        assert.equal(await rotate(gone.id), null);
        const again = await connected();
        await pool.query('UPDATE public.social_accounts SET access_token_enc=$2 WHERE id=$1', [again.id, Buffer.from('reconnected-access')]);
        assert.equal(await rotate(again.id), null);
        assert.equal(await rotate((await connected('youtube')).id), null);
        assert.equal(await rotate(randomUUID()), null);
    });

    it('a changed refresh token refuses a stale rotation even if access token matches', async () => {
        const a = await connected();
        await pool.query('UPDATE public.social_accounts SET refresh_token_enc=$2 WHERE id=$1', [a.id, Buffer.from('newer-refresh')]);
        assert.equal(await rotate(a.id), null);
        assert.deepEqual((await one('SELECT refresh_token_enc FROM public.social_accounts WHERE id=$1', [a.id])).refresh_token_enc, Buffer.from('newer-refresh'));
    });

    it('empty replacements, missing grants and expired or infinite expiry do not mutate the connection', async () => {
        const a = await connected();
        const base = [a.id, Buffer.from('old-access'), Buffer.from('old-refresh'), Buffer.from('new-access'), Buffer.from('new-refresh'), new Date(Date.now() + 86400_000), ['video.list']];
        for (const [index, value] of [[3, null], [4, Buffer.alloc(0)], [5, new Date(0)], [5, 'infinity'], [6, null]] as [number, unknown][]) {
            const args = [...base]; args[index] = value;
            assert.equal((await one('SELECT public.rotate_tiktok_account_tokens($1,$2,$3,$4,$5,$6,$7) AS r', args)).r, null);
        }
        assert.deepEqual(await rotate(a.id), { ok: true });
    });

    it('browser roles cannot execute; only service_role has the grant', async () => {
        const fn = 'public.rotate_tiktok_account_tokens(uuid,bytea,bytea,bytea,bytea,timestamptz,text[])';
        for (const role of ['anon', 'authenticated', 'service_role']) {
            assert.equal((await one('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed', [role, fn])).allowed, role === 'service_role');
        }
    });
});
