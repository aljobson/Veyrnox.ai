import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// 0446 raises the stored/reserved upload count from 10 to 20; the 200 MiB total is unchanged.
describe('upload count cap (0446)', { skip: !process.env.DATABASE_URL }, () => {
    let pool: pg.Pool;
    const users: string[] = [];
    const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
    before(async () => {
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
        // Production has this column from the account-deletion migration; check_upload_batch_budget (0401) reads it.
        await pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
        for (const name of ['0037_free_credit_expiry.sql', '0038_free_credit_sweep_fixes.sql',
            '0071_signup_grant_on_email_confirmation.sql', '0129_upload_reservations.sql', '0446_upload_count_cap_20.sql', '0446_upload_count_cap_20.sql']) {
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
    const reserve = async (auth: string, size = 1, stored: unknown[] = []) =>
        (await one('SELECT public.reserve_upload($1, $2, $3, $4::jsonb) AS r', [auth, key(auth), size, JSON.stringify(stored)])).r;
    it('serializes outstanding URLs to exactly twenty slots across concurrent Workers', async () => {
        const a = await user(), b = await user();
        const results = await Promise.all(Array.from({ length: 30 }, () => reserve(a.auth)));
        assert.equal(results.filter(r => r.ok).length, 20);
        assert.equal(results.filter(r => r.code === 'UPLOAD_BUDGET_EXCEEDED').length, 10);
        assert.equal((await reserve(b.auth)).ok, true);
    });
    it('still enforces the 200 MiB total, and accepts a 21-key stored list', async () => {
        const a = await user(), mb = 1024 * 1024;
        assert.equal((await reserve(a.auth, 100 * mb)).ok, true);
        assert.equal((await reserve(a.auth, 100 * mb)).ok, true);
        assert.equal((await reserve(a.auth, 1)).code, 'UPLOAD_BUDGET_EXCEEDED');
        const stored = Array.from({ length: 21 }, () => ({ key: key(a.auth), size: 1 }));
        assert.notEqual((await reserve(a.auth, 1, stored)).code, 'INVALID');
        assert.equal((await reserve(a.auth, 1, [...stored, { key: key(a.auth), size: 1 }])).code, 'INVALID');
    });
    it('batch preflight counts against 20, keeps privileges to service_role', async () => {
        const a = await user();
        assert.equal((await one(`SELECT public.check_upload_batch_budget($1, '[]', 20, 1) AS r`, [a.auth])).r.ok, true);
        assert.equal((await one(`SELECT public.check_upload_batch_budget($1, '[]', 21, 1) AS r`, [a.auth])).r.code, 'UPLOAD_BUDGET_EXCEEDED');
        for (const sig of ['public.reserve_upload(text,text,bigint,jsonb)', 'public.check_upload_batch_budget(text,jsonb,integer,bigint)']) {
            for (const role of ['anon', 'authenticated', 'service_role']) {
                assert.equal((await one(`SELECT has_function_privilege('${role}', '${sig}', 'EXECUTE') AS ok`)).ok, role === 'service_role');
            }
        }
    });
});
