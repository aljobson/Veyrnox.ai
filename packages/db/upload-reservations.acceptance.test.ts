import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('upload reservations (0129)', { skip: !process.env.DATABASE_URL }, () => {
    let pool: pg.Pool;
    const users: string[] = [];
    const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
    before(async () => {
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
        for (const name of ['0037_free_credit_expiry.sql', '0038_free_credit_sweep_fixes.sql',
            '0071_signup_grant_on_email_confirmation.sql', '0129_upload_reservations.sql', '0129_upload_reservations.sql']) {
            await pool.query(await readFile(new URL(`./schema/supabase/${name}`, import.meta.url), 'utf8'));
        }
    });
    after(async () => {
        if (!pool) return;
        try {
            const deleted = await pool.query(`DELETE FROM public.users u WHERE id = ANY($1::uuid[])
                AND NOT EXISTS (SELECT 1 FROM public.ledger_entries l WHERE l.user_id = u.id)`, [users]);
            assert.equal(deleted.rowCount, users.length);
        } finally { await pool.end(); }
    });
    const key = (auth: string) => `uploads/${auth}/${randomUUID()}.png`;
    async function user() {
        const auth = randomUUID();
        const { id } = await one('SELECT public.provision_user($1, $2) AS id', [auth, `${auth}@test.veyrnox.ai`]);
        users.push(id); return { id, auth };
    }
    const reserve = async (auth: string, size = 1, stored: unknown[] = [], k = key(auth)) =>
        (await one('SELECT public.reserve_upload($1, $2, $3, $4::jsonb) AS r', [auth, k, size, JSON.stringify(stored)])).r;
    it('serializes outstanding URLs to exactly ten slots across concurrent Workers', async () => {
        const a = await user(), b = await user();
        const results = await Promise.all(Array.from({ length: 30 }, () => reserve(a.auth)));
        assert.equal(results.filter(r => r.ok).length, 10);
        assert.equal(results.filter(r => r.code === 'UPLOAD_BUDGET_EXCEEDED').length, 20);
        assert.equal((await reserve(b.auth)).ok, true);
    });
    it('enforces the byte budget including legacy objects without double counting reserved ones', async () => {
        const a = await user();
        const k = key(a.auth), mb = 1024 * 1024;
        assert.equal((await reserve(a.auth, 100 * mb, [], k)).ok, true);
        assert.equal((await reserve(a.auth, 100 * mb, [{ key: k, size: 100 * mb }])).ok, true);
        assert.equal((await reserve(a.auth)).code, 'UPLOAD_BUDGET_EXCEEDED');
        const b = await user();
        assert.equal((await reserve(b.auth, 100 * mb, [{ key: key(b.auth), size: 150 * mb }])).code, 'UPLOAD_BUDGET_EXCEEDED');
    });
    it('does not renew reservations or release budget while a signed PUT remains valid', async () => {
        const a = await user(), k = key(a.auth);
        assert.equal((await reserve(a.auth, 100, [], k)).ok, true);
        assert.equal((await reserve(a.auth, 100, [], k)).code, 'ALREADY_RESERVED');
        await pool.query('SELECT public.release_upload($1)', [k]);
        assert.equal((await one('SELECT count(*)::int AS n FROM public.upload_reservations WHERE r2_key = $1', [k])).n, 1);
        await pool.query("UPDATE public.upload_reservations SET put_expires_at = now() - interval '1 minute' WHERE r2_key = $1", [k]);
        await pool.query('SELECT public.release_upload($1)', [k]);
        await pool.query('SELECT public.release_upload($1)', [k]);
        assert.equal((await one('SELECT count(*)::int AS n FROM public.upload_reservations WHERE r2_key = $1', [k])).n, 0);
    });
    it('reserves nothing for unknown users or invalid sizes and denies browser roles', async () => {
        const auth = randomUUID();
        assert.equal((await reserve(auth)).code, 'NOT_FOUND');
        const a = await user();
        for (const size of [0, -1, 104857601]) assert.equal((await reserve(a.auth, size)).code, 'INVALID');
        for (const role of ['anon', 'authenticated']) {
            const acl = await one(`SELECT has_function_privilege($1, 'public.reserve_upload(text,text,bigint,jsonb)', 'EXECUTE') AS reserve,
                has_function_privilege($1, 'public.release_upload(text)', 'EXECUTE') AS release,
                has_table_privilege($1, 'public.upload_reservations', 'SELECT') AS read`, [role]);
            assert.deepEqual(acl, { reserve: false, release: false, read: false });
        }
    });
});
