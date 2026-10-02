import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Exercises 0154_social_publish_foundation.sql (ADR-0061 Phase 1): brands,
// accounts, the append-only audit log, and the four narrow RPCs. Applies the
// migration twice to prove idempotency, the same discipline as the other
// acceptance tests in this package. 0169 adds the Free tier's one-account
// cap to record_social_account_connection.
describe('social publish foundation (0154, 0169)', { skip: !process.env.DATABASE_URL }, () => {
    let pool: pg.Pool;
    const users: string[] = [];
    const authIds: string[] = [];
    const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
    before(async () => {
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
        await pool.query(`DO $$ DECLARE r TEXT; BEGIN
            FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                    EXECUTE format('CREATE ROLE %I NOLOGIN', r);
                END IF;
            END LOOP; END $$`);
        for (const name of ['0154_social_publish_foundation.sql', '0169_social_publish_free_account_cap.sql']) {
            for (const round of [1, 2]) {
                await pool.query(await readFile(new URL(`./schema/supabase/${name}`, import.meta.url), 'utf8'));
            }
        }
    });
    after(async () => {
        if (!pool) return;
        try {
            // social_account_actions is append-only (its own trigger blocks
            // DELETE even via cascade), and social_brands.owner_user_id is
            // ON DELETE RESTRICT — so a brand that ever logged an action can
            // never be removed, by design (audit trail permanence, same as
            // cinema_pass_events). Delete only brands with zero actions;
            // the rest are left behind, isolated by their random UUIDs, the
            // same "no per-test rollback" pattern the cinema fixtures use.
            await pool.query(`DELETE FROM public.social_brands b WHERE b.owner_user_id = ANY($1::uuid[])
                AND NOT EXISTS (SELECT 1 FROM public.social_account_actions a WHERE a.brand_id = b.id)`, [users]);
            const deletableUsers = (await pool.query(`SELECT id FROM public.users u WHERE u.id = ANY($1::uuid[])
                AND NOT EXISTS (SELECT 1 FROM public.social_brands b WHERE b.owner_user_id = u.id)`, [users])).rows.map((r) => r.id);
            await pool.query('DELETE FROM public.users WHERE id = ANY($1::uuid[])', [deletableUsers]);
            await pool.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [authIds]);
        } finally { await pool.end(); }
    });
    async function user() {
        const auth = randomUUID();
        // The RPCs under test join auth.users the same way production
        // Supabase Auth would have already populated it (start_cinema_pass's
        // own fixture pattern) — provision_user alone only touches
        // public.users, so a bare-Postgres test database needs this row too.
        await pool.query('INSERT INTO auth.users(id, email) VALUES ($1, $2)', [auth, `${auth}@test.veyrnox.ai`]);
        authIds.push(auth);
        const { id } = await one('SELECT public.provision_user($1, $2) AS id', [auth, `${auth}@test.veyrnox.ai`]);
        users.push(id);
        return { id, auth };
    }
    const getOrCreateBrand = async (auth: string) =>
        (await one('SELECT public.get_or_create_default_social_brand($1) AS r', [auth])).r;
    const listAccounts = async (auth: string, brandId: string) =>
        (await one('SELECT public.list_social_accounts($1, $2) AS r', [auth, brandId])).r;
    const connect = async (auth: string, brandId: string, overrides: Record<string, unknown> = {}) => {
        const args = {
            network: 'instagram', externalId: 'ig-123', displayName: '@creator', avatarUrl: null,
            scopes: ['instagram_basic'], accessEnc: Buffer.from('cipher-a'), refreshEnc: Buffer.from('cipher-b'),
            expiresAt: new Date(Date.now() + 3600_000).toISOString(), ...overrides,
        };
        return (await one(
            `SELECT public.record_social_account_connection($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) AS r`,
            [auth, brandId, args.network, args.externalId, args.displayName, args.avatarUrl,
                args.scopes, args.accessEnc, args.refreshEnc, args.expiresAt],
        )).r;
    };
    const disconnect = async (auth: string, accountId: string) =>
        (await one('SELECT public.disconnect_social_account($1, $2) AS r', [auth, accountId])).r;

    it('auto-creates one brand per user and is idempotent on repeat calls', async () => {
        const u = await user();
        const first = await getOrCreateBrand(u.auth);
        assert.equal(first.ok, true);
        assert.equal(first.idempotent, false);
        assert.equal(first.label, 'My Brand');
        assert.equal(first.timezone, 'UTC');
        const second = await getOrCreateBrand(u.auth);
        assert.equal(second.idempotent, true);
        assert.equal(second.brand_id, first.brand_id);
        assert.equal((await one('SELECT count(*) FROM public.social_brands WHERE owner_user_id = $1', [u.id])).count, '1');
    });
    it('unknown identities never create a brand', async () => {
        assert.deepEqual(await getOrCreateBrand(randomUUID()), { ok: false, code: 'USER_NOT_FOUND' });
    });

    it('connects an account, lists it without token columns, and reconnecting updates in place', async () => {
        const u = await user();
        const brand = await getOrCreateBrand(u.auth);
        const connected = await connect(u.auth, brand.brand_id);
        assert.equal(connected.ok, true);
        assert.equal(connected.idempotent, false);

        const listed = await listAccounts(u.auth, brand.brand_id);
        assert.equal(listed.ok, true);
        assert.equal(listed.accounts.length, 1);
        const row = listed.accounts[0];
        assert.equal(row.id, connected.account_id);
        assert.equal(row.network, 'instagram');
        assert.equal(row.external_account_id, 'ig-123');
        assert.equal(row.status, 'active');
        assert.equal('access_token_enc' in row, false);
        assert.equal('refresh_token_enc' in row, false);

        const reconnected = await connect(u.auth, brand.brand_id, { displayName: '@creator-renamed' });
        assert.equal(reconnected.idempotent, true);
        assert.equal(reconnected.account_id, connected.account_id);
        const relisted = await listAccounts(u.auth, brand.brand_id);
        assert.equal(relisted.accounts[0].display_name, '@creator-renamed');
        assert.equal(relisted.accounts.length, 1, 'reconnect upserts, never duplicates');
    });
    it('a brand the caller does not own is never readable or writable', async () => {
        const owner = await user();
        const stranger = await user();
        const brand = await getOrCreateBrand(owner.auth);
        assert.deepEqual(await listAccounts(stranger.auth, brand.brand_id), { ok: false, code: 'BRAND_NOT_FOUND' });
        assert.deepEqual(await connect(stranger.auth, brand.brand_id), { ok: false, code: 'BRAND_NOT_FOUND' });
    });

    it('disconnect soft-deletes, logs the action, and only the owner can do it', async () => {
        const owner = await user();
        const stranger = await user();
        const brand = await getOrCreateBrand(owner.auth);
        const connected = await connect(owner.auth, brand.brand_id);

        assert.deepEqual(await disconnect(stranger.auth, connected.account_id), { ok: false, code: 'ACCOUNT_NOT_FOUND' });
        assert.deepEqual(await disconnect(owner.auth, connected.account_id), { ok: true });

        const row = await one('SELECT status, disconnected_at FROM public.social_accounts WHERE id = $1', [connected.account_id]);
        assert.equal(row.status, 'revoked');
        assert.ok(row.disconnected_at);

        const listed = await listAccounts(owner.auth, brand.brand_id);
        assert.equal(listed.accounts[0].status, 'revoked', 'disconnect is a soft delete, still listed');

        const actions = await pool.query(
            'SELECT action FROM public.social_account_actions WHERE brand_id = $1 ORDER BY created_at', [brand.brand_id],
        );
        assert.deepEqual(actions.rows.map((r) => r.action), ['connect', 'disconnect']);
    });

    it('social_account_actions is append-only', async () => {
        const u = await user();
        const brand = await getOrCreateBrand(u.auth);
        await connect(u.auth, brand.brand_id);
        const row = await one('SELECT id FROM public.social_account_actions WHERE brand_id = $1 LIMIT 1', [brand.brand_id]);
        await assert.rejects(
            pool.query('UPDATE public.social_account_actions SET action = $1 WHERE id = $2', ['tampered', row.id]),
            /append-only/,
        );
        await assert.rejects(
            pool.query('DELETE FROM public.social_account_actions WHERE id = $1', [row.id]),
            /append-only/,
        );
    });

    // ── 0169: Free tier, one connected account ───────────────────────────
    const activeCount = async (userId: string) => Number((await one(
        `SELECT count(*) FROM public.social_accounts a JOIN public.social_brands b ON b.id = a.brand_id
         WHERE b.owner_user_id = $1 AND a.status = 'active'`, [userId])).count);

    it('refuses a second account on the Free tier, on any network', async () => {
        const u = await user();
        const brand = await getOrCreateBrand(u.auth);
        assert.equal((await connect(u.auth, brand.brand_id)).ok, true);
        for (const second of [{ externalId: 'ig-other' }, { network: 'linkedin', externalId: 'li-1' }]) {
            assert.deepEqual(await connect(u.auth, brand.brand_id, second), { ok: false, code: 'ACCOUNT_LIMIT', limit: 1 });
        }
        assert.equal(await activeCount(u.id), 1, 'nothing was stored');
    });

    it('reconnecting the same account still works at the limit', async () => {
        const u = await user();
        const brand = await getOrCreateBrand(u.auth);
        const first = await connect(u.auth, brand.brand_id);
        const again = await connect(u.auth, brand.brand_id, { accessEnc: Buffer.from('cipher-new') });
        assert.deepEqual([again.ok, again.idempotent, again.account_id], [true, true, first.account_id]);
    });

    it('a disconnected account frees the slot', async () => {
        const u = await user();
        const brand = await getOrCreateBrand(u.auth);
        const first = await connect(u.auth, brand.brand_id);
        assert.equal((await disconnect(u.auth, first.account_id)).ok, true);
        const next = await connect(u.auth, brand.brand_id, { network: 'twitter', externalId: 'x-1' });
        assert.equal(next.ok, true);
        assert.equal(await activeCount(u.id), 1);
    });

    it('two concurrent connections cannot both pass the cap', async () => {
        const u = await user();
        const brand = await getOrCreateBrand(u.auth);
        const results = await Promise.all(['a', 'b', 'c'].map((k) =>
            connect(u.auth, brand.brand_id, { externalId: `ig-race-${k}` })));
        assert.equal(results.filter((r) => r.ok).length, 1);
        assert.equal(results.filter((r) => r.code === 'ACCOUNT_LIMIT').length, 2);
        assert.equal(await activeCount(u.id), 1);
    });

    it('forces RLS and permits service-role RPC execution only, on every table', async () => {
        for (const table of ['social_brands', 'social_accounts', 'social_account_actions']) {
            const info = await one(
                'SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = $1::regclass',
                [`public.${table}`],
            );
            assert.equal(info.relrowsecurity, true, `${table} RLS enabled`);
            assert.equal(info.relforcerowsecurity, true, `${table} RLS forced`);
            for (const role of ['anon', 'authenticated', 'service_role']) {
                for (const permission of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
                    assert.equal(
                        (await one('SELECT has_table_privilege($1, $2, $3) AS p', [role, `public.${table}`, permission])).p,
                        false, `${role} has no ${permission} on ${table}`,
                    );
                }
            }
        }
        const fns = [
            'public.get_or_create_default_social_brand(text)',
            'public.list_social_accounts(text, uuid)',
            'public.record_social_account_connection(text, uuid, text, text, text, text, text[], bytea, bytea, timestamptz)',
            'public.disconnect_social_account(text, uuid)',
        ];
        for (const fn of fns) {
            for (const role of ['anon', 'authenticated', 'service_role']) {
                assert.equal(
                    (await one('SELECT has_function_privilege($1, $2, $3) AS p', [role, fn, 'EXECUTE'])).p,
                    role === 'service_role', `${role} EXECUTE on ${fn}`,
                );
            }
            const def = await one('SELECT prosecdef, proconfig FROM pg_proc WHERE oid = $1::regprocedure', [fn]);
            assert.equal(def.prosecdef, true, `${fn} is SECURITY DEFINER`);
            assert.deepEqual(def.proconfig, ['search_path=""'], `${fn} sets search_path`);
        }
    });
});
