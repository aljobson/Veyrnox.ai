/**
 * Free Credit acceptance tests — ADR-0013, issue #102.
 *
 * Exercises the production RPCs (not the Ledger class): signup_grant,
 * ledger_grant, ledger_debit, ledger_refund, expire_free_credits,
 * read_user_credits and reconcile_free_credits, as defined by
 * schema/supabase/0035_free_credit_expiry.sql applied on top of
 * schema/0001_initial.sql.
 *
 * Skipped unless DATABASE_URL is set. The Supabase roles the migration
 * grants to are created here if the database lacks them; pg_cron is
 * optional (the migration only schedules when the extension exists).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATION = new URL("./schema/supabase/0035_free_credit_expiry.sql", import.meta.url);
const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (d: number) => new Date(Date.now() + d * DAY_MS).toISOString();

describe("Free Credits (ADR-0013)", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
    let pool: pg.Pool;

    before(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        await pool.query(`DO $$ DECLARE r TEXT; BEGIN
            FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                    EXECUTE format('CREATE ROLE %I NOLOGIN', r);
                END IF;
            END LOOP; END $$`);
        const sql = await readFile(MIGRATION, "utf8");
        await pool.query(sql);
        await pool.query(sql); // migration must be idempotent
    });

    after(async () => {
        if (pool) await pool.end();
    });

    async function one(sql: string, params: unknown[] = []) {
        const res = await pool.query(sql, params);
        return res.rows[0];
    }

    async function signup(): Promise<string> {
        const r = await one(`SELECT public.signup_grant($1, $2) AS id`,
            [`sb_${randomUUID()}`, `${randomUUID()}@test.veyrnox.ai`]);
        return r.id;
    }

    async function topup(userId: string, credits: number) {
        const r = await one(`SELECT public.ledger_grant($1, $2, 'grant:topup') AS r`, [userId, credits]);
        assert.equal(r.r.ok, true);
    }

    async function debit(userId: string, credits: number, key = randomUUID()) {
        const r = await one(
            `SELECT public.ledger_debit($1, $2, $3, 'debit:generation', 'test-model', '{}'::jsonb) AS r`,
            [userId, key, credits]);
        return r.r;
    }

    async function refund(jobId: string, userId: string, credits: number) {
        const r = await one(`SELECT public.ledger_refund($1, $2, $3, 'refund:job_failed') AS r`,
            [jobId, userId, credits]);
        return r.r;
    }

    /** The provider delivered: the job can no longer be refunded. */
    async function settle(job: { job_id: string }) {
        await pool.query(`UPDATE jobs SET state = 'STORED' WHERE id = $1`, [job.job_id]);
    }

    async function sweep(asOf: string) {
        const r = await one(`SELECT public.expire_free_credits($1::timestamptz) AS r`, [asOf]);
        return r.r;
    }

    async function credits(userId: string) {
        const r = await one(`SELECT balance, free_balance FROM credit_balances WHERE user_id = $1`, [userId]);
        return { balance: r.balance as number, free: r.free_balance as number };
    }

    async function expiries(userId: string) {
        const res = await pool.query(
            `SELECT delta, free_delta FROM ledger_entries WHERE user_id = $1 AND reason = 'expire:free'`,
            [userId]);
        return res.rows;
    }

    /** Balance invariant and Free Credit reconciliation both clean. */
    async function assertInvariants(userId: string) {
        const sums = await one(
            `SELECT COALESCE(SUM(delta), 0)::int AS total,
                    COALESCE(SUM(COALESCE(free_delta, delta)), 0)::int AS free_total
             FROM ledger_entries WHERE user_id = $1`, [userId]);
        const c = await credits(userId);
        assert.equal(c.balance, sums.total, "balance = SUM(delta)");
        assert.equal(c.free, sums.free_total, "free_balance = SUM(free portion)");
        const freeDrift = await pool.query(`SELECT 1 FROM public.reconcile_free_credits() WHERE user_id = $1`, [userId]);
        assert.equal(freeDrift.rowCount, 0, "reconcile_free_credits clean");
    }

    it("spends Free Credits before Pack Credits", async () => {
        const u = await signup();
        await topup(u, 100);
        assert.deepEqual(await credits(u), { balance: 150, free: 50 });

        assert.equal((await debit(u, 30)).ok, true);
        assert.deepEqual(await credits(u), { balance: 120, free: 20 });

        assert.equal((await debit(u, 40)).ok, true);
        assert.deepEqual(await credits(u), { balance: 80, free: 0 }, "20 free then 20 pack");
        await assertInvariants(u);
    });

    it("debit replay does not take Free Credits twice", async () => {
        const u = await signup();
        const key = randomUUID();
        await debit(u, 10, key);
        const replay = await debit(u, 10, key);
        assert.equal(replay.idempotent, true);
        assert.deepEqual(await credits(u), { balance: 40, free: 40 });
        await assertInvariants(u);
    });

    it("Credit Refund returns credits to the source they were taken from", async () => {
        const u = await signup();
        await topup(u, 100);
        const mixed = await debit(u, 70); // 50 free + 20 pack
        assert.deepEqual(await credits(u), { balance: 80, free: 0 });

        const r1 = await refund(mixed.job_id, u, 70);
        assert.equal(r1.ok, true);
        assert.deepEqual(await credits(u), { balance: 150, free: 50 });

        const r2 = await refund(mixed.job_id, u, 70);
        assert.equal(r2.idempotent, true);
        assert.deepEqual(await credits(u), { balance: 150, free: 50 }, "replay restores nothing");

        await debit(u, 60); // 50 free + 10 pack
        const packOnly = await debit(u, 30); // pack only
        await refund(packOnly.job_id, u, 30);
        assert.deepEqual(await credits(u), { balance: 90, free: 0 }, "pack refund never becomes free");
        await assertInvariants(u);
    });

    it("expires the unspent Free Credit remainder at 90 days; Pack Credits untouched", async () => {
        const u = await signup();
        await topup(u, 100);
        await settle(await debit(u, 20));

        await sweep(daysFromNow(89));
        assert.deepEqual(await expiries(u), [], "nothing expires before 90 days");

        const res = await sweep(daysFromNow(91));
        assert.equal(res.ok, true);
        assert.deepEqual(await expiries(u), [{ delta: -30, free_delta: -30 }]);
        assert.deepEqual(await credits(u), { balance: 100, free: 0 });
        await assertInvariants(u);
    });

    it("a fully spent free grant expires nothing", async () => {
        const u = await signup();
        await topup(u, 10);
        await debit(u, 50);
        await sweep(daysFromNow(91));
        assert.deepEqual(await expiries(u), []);
        assert.deepEqual(await credits(u), { balance: 10, free: 0 });
        await assertInvariants(u);
    });

    it("sweep replay and overlapping runs expire a grant once", async () => {
        const u = await signup();
        await Promise.all([sweep(daysFromNow(91)), sweep(daysFromNow(91))]);
        await sweep(daysFromNow(92));
        assert.deepEqual(await expiries(u), [{ delta: -50, free_delta: -50 }]);
        assert.deepEqual(await credits(u), { balance: 0, free: 0 });
        await assertInvariants(u);
    });

    it("defers expiry while a job holding Free Credits is unsettled", async () => {
        const u = await signup();
        const job = await debit(u, 10);
        await sweep(daysFromNow(91));
        assert.deepEqual(await expiries(u), [], "in-flight job could still refund free credits");

        await refund(job.job_id, u, 10);
        await sweep(daysFromNow(91));
        assert.deepEqual(await expiries(u), [{ delta: -50, free_delta: -50 }]);
        await assertInvariants(u);
    });

    it("a Pack-only clawback can never reduce Free Credits", async () => {
        // #96's clawback caps at balance - free_balance; the constraint makes
        // any writer that forgets fail instead of eating Free Credits.
        const u = await signup();
        await topup(u, 100);
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await assert.rejects(
                client.query(`UPDATE credit_balances SET balance = balance - 101 WHERE user_id = $1`, [u]),
                /credit_balances_free_within_balance/);
            await client.query("ROLLBACK");
        } finally {
            client.release();
        }
        assert.deepEqual(await credits(u), { balance: 150, free: 50 });
        await assertInvariants(u);
    });

    it("ledger_grant refuses to mint Free Credits", async () => {
        const u = await signup();
        const r = await one(`SELECT public.ledger_grant($1, 50, 'grant:signup') AS r`, [u]);
        assert.equal(r.r.ok, false);
        assert.equal(r.r.code, "RESERVED_REASON");
        assert.deepEqual(await credits(u), { balance: 50, free: 50 });
    });

    it("read_user_credits reports the Free Credit remainder and expiry date", async () => {
        const authId = `sb_${randomUUID()}`;
        const u = (await one(`SELECT public.signup_grant($1, $2) AS id`, [authId, `${randomUUID()}@test.veyrnox.ai`])).id;
        await topup(u, 100);
        await settle(await debit(u, 5));

        const grant = await one(
            `SELECT created_at FROM ledger_entries WHERE user_id = $1 AND reason = 'grant:signup'`, [u]);
        const r = (await one(`SELECT public.read_user_credits($1) AS r`, [authId])).r;
        assert.equal(r.balance, 145);
        assert.equal(r.free_credits, 45);
        assert.equal(new Date(r.free_expires_at).getTime(), grant.created_at.getTime() + 90 * DAY_MS);

        await sweep(daysFromNow(91));
        const after = (await one(`SELECT public.read_user_credits($1) AS r`, [authId])).r;
        assert.equal(after.free_credits, 0);
        assert.equal(after.free_expires_at, null);

        const unknown = (await one(`SELECT public.read_user_credits($1) AS r`, [`sb_${randomUUID()}`])).r;
        assert.deepEqual(unknown, { balance: 0, free_credits: 0, free_expires_at: null });
    });
});
