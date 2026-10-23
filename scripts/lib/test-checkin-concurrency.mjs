import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';

export async function checkinConcurrency(url) {
    const admin = new pg.Client({ connectionString: url });
    const name = `checkin_${randomUUID().replaceAll('-', '')}`;
    const isolated = new URL(url); isolated.pathname = `/${name}`;
    let created = false, a, b;
    await admin.connect();
    try {
        // Generated identifier only. Never reuse/drop another test's database.
        await admin.query(`CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
        created = true;
        await promisify(execFile)(process.execPath, ['scripts/replay-migrations.mjs'], {
            cwd: new URL('../..', import.meta.url), env: { ...process.env, DATABASE_URL: isolated.href }, maxBuffer: 8 * 1024 * 1024,
        });
        a = new pg.Client({ connectionString: isolated.href }); b = new pg.Client({ connectionString: isolated.href });
        await a.connect(); await b.connect();
        for (const client of [a, b]) {
            await client.query("SET statement_timeout='10s'");
            await client.query("SET lock_timeout='8s'");
        }
        const pid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        async function waiting() {
            const deadline = Date.now() + 4000;
            while (Date.now() < deadline) {
                const r = await a.query('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [pid]);
                if (r.rows[0]?.blocked) return;
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            assert.fail('claim did not wait on the lifecycle lock');
        }
        async function person() {
            const auth = randomUUID();
            await a.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [auth, `${auth}@example.invalid`]);
            const id = (await a.query('SELECT id FROM public.users WHERE auth_id=$1', [auth])).rows[0].id;
            assert.notEqual(id, auth);
            const balance = (await a.query('SELECT balance FROM public.credit_balances WHERE user_id=$1', [id])).rows[0].balance;
            return { auth, id, balance };
        }
        const claim = (client, u) => client.query('SELECT public.daily_checkin($1) AS r', [u.auth]).then(r => r.rows[0].r);
        async function noGrant(u) {
            assert.equal((await a.query('SELECT count(*)::int AS n FROM public.checkin_streaks WHERE user_id=$1', [u.id])).rows[0].n, 0);
            assert.equal((await a.query("SELECT count(*)::int AS n FROM public.ledger_entries WHERE user_id=$1 AND reason LIKE 'grant:checkin#%'", [u.id])).rows[0].n, 0);
            assert.equal((await a.query('SELECT balance FROM public.credit_balances WHERE user_id=$1', [u.id])).rows[0].balance, u.balance);
        }
        // Deterministic concurrent same-day claims: B waits until A commits its grant.
        const concurrent = await person();
        await a.query('BEGIN');
        const first = await claim(a, concurrent);
        assert.equal(first.ok, true); assert.equal(first.credits, 1);
        const pending = claim(b, concurrent); pending.catch(() => {});
        await waiting(); await a.query('COMMIT');
        assert.deepEqual(await pending, { ...first, already_claimed: true, credits: 0 });
        assert.equal((await a.query("SELECT count(*)::int AS n FROM public.ledger_entries WHERE user_id=$1 AND reason LIKE 'grant:checkin#%'", [concurrent.id])).rows[0].n, 1);

        // Dispute takes balance first. BUSY must release users even while B's outer transaction is still open.
        const busy = await person();
        await a.query('BEGIN'); await b.query('BEGIN');
        await a.query('SELECT 1 FROM public.credit_balances WHERE user_id=$1 FOR UPDATE', [busy.id]);
        assert.deepEqual(await claim(b, busy), { ok: false, code: 'CHECKIN_BUSY' });
        await a.query('SELECT 1 FROM public.users WHERE id=$1 FOR UPDATE NOWAIT', [busy.id]);
        await a.query("SELECT public.freeze_account($1,'checkin contention',NULL)", [busy.id]);
        await a.query('COMMIT'); await b.query('COMMIT');
        assert.equal((await claim(b, busy)).code, 'ACCOUNT_UNAVAILABLE'); await noGrant(busy);

        for (const action of ['freeze', 'erase']) {
            const u = await person();
            const prep = action === 'erase' ? (await a.query('SELECT public.prepare_account_deletion($1) AS r', [u.auth])).rows[0].r : null;
            await a.query('BEGIN');
            await a.query('SELECT 1 FROM public.users WHERE id=$1 FOR UPDATE', [u.id]);
            const pending = claim(b, u); pending.catch(() => {});
            await waiting();
            if (action === 'freeze') await a.query("SELECT public.freeze_account($1,'checkin concurrency',NULL)", [u.id]);
            else assert.equal((await a.query('SELECT public.erase_account($1,$2) AS r', [u.auth, prep.confirmation_token])).rows[0].r.ok, true);
            await a.query('COMMIT');
            assert.equal((await pending).code, 'ACCOUNT_UNAVAILABLE');
            await noGrant(u);
        }
        for (const fn of ['reconcile_balances', 'reconcile_free_credits', 'reconcile_subscription_credits']) {
            assert.deepEqual((await a.query(`SELECT * FROM public.${fn}()`)).rows, []);
        }
        console.log('checkin: two-connection replay, dispute BUSY, freeze and erase lock races passed');
    } finally {
        await a?.end(); await b?.end();
        if (created) await admin.query(`DROP DATABASE ${name}`);
        await admin.end();
    }
}
