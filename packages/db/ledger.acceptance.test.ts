/**
 * Ledger acceptance tests — §6 gates from architecture.md.
 *
 * Skipped unless DATABASE_URL is set. Run against a fresh Postgres with
 * packages/db/schema/0001_initial.sql applied (see scripts/migrate.mjs).
 *
 * Uses `pg` directly (not the Neon serverless driver) because we're
 * hitting a plain Postgres over TCP. The Ledger class is
 * driver-agnostic — the Pool it accepts implements PgLikePool, which
 * pg.Pool and @neondatabase/serverless's Pool both satisfy.
 *
 * Uses node:test to avoid pulling in a test framework.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

// tsx runs the .ts source directly; falls back to ledger.ts import
// via jiti/tsx in CI.
import { Ledger } from "./ledger.ts";

const DATABASE_URL = process.env.DATABASE_URL;

describe("Ledger acceptance", { skip: !DATABASE_URL && "DATABASE_URL not set" }, () => {
    /** @type {pg.Pool} */
    let pool;
    /** @type {InstanceType<typeof Ledger>} */
    let ledger;

    before(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        ledger = new Ledger(pool);
    });

    after(async () => {
        if (pool) await pool.end();
    });

    /** Fresh isolated user per test — no cross-test contamination. */
    async function makeUser(startingCredits = 0) {
        const clerkId = `clerk_${randomUUID()}`;
        const email = `${randomUUID()}@test.veyrnox.ai`;
        const insU = await pool.query(
            `INSERT INTO users (clerk_id, email) VALUES ($1, $2) RETURNING id`,
            [clerkId, email]
        );
        const userId = insU.rows[0].id;
        await pool.query(
            `INSERT INTO credit_balances (user_id, balance) VALUES ($1, $2)`,
            [userId, startingCredits]
        );
        return userId;
    }

    async function makePricedJob(userId, credits, idempotencyKey) {
        const res = await pool.query(
            `INSERT INTO jobs (user_id, idempotency_key, model_id, credits, inputs)
             VALUES ($1, $2, 'test-model', $3, '{}'::jsonb)
             RETURNING id`,
            [userId, idempotencyKey, credits]
        );
        return res.rows[0].id;
    }

    // §6.1 — 50 concurrent debits on one account with enough balance for N,
    // where N < 50. Expect exactly N successes, zero double-spend, zero
    // negative balance.
    it("§6.1 concurrent debits: N successes, zero negative, zero double-spend", async () => {
        const N_ALLOWED = 20;
        const N_ATTEMPTS = 50;
        const CREDITS_PER = 5;
        const userId = await makeUser(N_ALLOWED * CREDITS_PER);

        const debits = Array.from({ length: N_ATTEMPTS }, async (_, i) => {
            const key = `concurrent-${i}`;
            const jobId = await makePricedJob(userId, CREDITS_PER, key);
            return ledger.debit({
                user_id: userId,
                idempotency_key: key,
                job_id: jobId,
                credits: CREDITS_PER,
                reason: "debit:generation",
            });
        });

        const results = await Promise.all(debits);
        const okCount = results.filter((r) => r.ok).length;
        const failCount = results.filter((r) => !r.ok).length;

        assert.equal(okCount, N_ALLOWED, `expected ${N_ALLOWED} successes, got ${okCount}`);
        assert.equal(failCount, N_ATTEMPTS - N_ALLOWED, `expected ${N_ATTEMPTS - N_ALLOWED} failures`);

        const balance = await ledger.readBalance(userId);
        assert.equal(balance, 0, "balance should be exactly 0 after N debits");
        assert.ok(balance >= 0, "balance never negative");
    });

    // §6.2 — Duplicate idempotency key returns the same job on repeat call,
    // does not debit twice.
    it("§6.2 idempotency: duplicate key returns same job, single debit", async () => {
        const userId = await makeUser(100);
        const key = `idem-${randomUUID()}`;
        const jobId = await makePricedJob(userId, 30, key);

        const first = await ledger.debit({
            user_id: userId,
            idempotency_key: key,
            job_id: jobId,
            credits: 30,
            reason: "debit:generation",
        });
        const second = await ledger.debit({
            user_id: userId,
            idempotency_key: key,
            job_id: jobId,
            credits: 30,
            reason: "debit:generation",
        });

        assert.ok(first.ok && second.ok);
        assert.equal(first.job_id, second.job_id);
        assert.equal(first.idempotent, false);
        assert.equal(second.idempotent, true);
        assert.equal(await ledger.readBalance(userId), 70, "single debit only");
    });

    // §6.3 — Insufficient balance → ROLLBACK. No ledger entry, no state change.
    it("§6.3 insufficient balance: no debit, INSUFFICIENT_BALANCE error", async () => {
        const userId = await makeUser(10);
        const key = `insuf-${randomUUID()}`;
        const jobId = await makePricedJob(userId, 100, key);

        const res = await ledger.debit({
            user_id: userId,
            idempotency_key: key,
            job_id: jobId,
            credits: 100,
            reason: "debit:generation",
        });

        assert.ok(!res.ok);
        assert.equal(res.code, "INSUFFICIENT_BALANCE");
        assert.equal(await ledger.readBalance(userId), 10, "balance unchanged");

        const ledgerRows = await pool.query(
            `SELECT count(*)::int AS n FROM ledger_entries WHERE user_id = $1`,
            [userId]
        );
        assert.equal(ledgerRows.rows[0].n, 0, "no ledger entry on failed debit");
    });

    // §6.4 — Refund returns compensating +delta and restores balance.
    it("§6.4 refund: compensating entry, balance restored, idempotent", async () => {
        const userId = await makeUser(50);
        const key = `refund-${randomUUID()}`;
        const jobId = await makePricedJob(userId, 20, key);

        const debit = await ledger.debit({
            user_id: userId,
            idempotency_key: key,
            job_id: jobId,
            credits: 20,
            reason: "debit:generation",
        });
        assert.ok(debit.ok);
        assert.equal(await ledger.readBalance(userId), 30);

        const refund1 = await ledger.refund({
            job_id: jobId,
            user_id: userId,
            credits: 20,
            reason: "refund:job_failed",
        });
        assert.equal(refund1.ok, true);
        assert.equal(refund1.idempotent, false);
        assert.equal(await ledger.readBalance(userId), 50, "balance fully restored");

        // Second refund is a no-op (idempotent)
        const refund2 = await ledger.refund({
            job_id: jobId,
            user_id: userId,
            credits: 20,
            reason: "refund:job_failed",
        });
        assert.equal(refund2.idempotent, true);
        assert.equal(refund1.entry_id, refund2.entry_id);
        assert.equal(await ledger.readBalance(userId), 50, "no double-refund");
    });

    // §6.5 — Append-only trigger. Direct UPDATE/DELETE on ledger_entries
    // must raise.
    it("§6.5 append-only enforcement: UPDATE and DELETE raise", async () => {
        const userId = await makeUser(100);
        const grant = await ledger.grant({
            user_id: userId,
            credits: 100,
            reason: "grant:test",
            source_event_id: `evt-${randomUUID()}`,
        });

        await assert.rejects(
            pool.query(`UPDATE ledger_entries SET delta = 999 WHERE id = $1`, [grant.entry_id]),
            /append-only/i,
            "UPDATE should raise"
        );

        await assert.rejects(
            pool.query(`DELETE FROM ledger_entries WHERE id = $1`, [grant.entry_id]),
            /append-only/i,
            "DELETE should raise"
        );
    });

    // §6.6 — Reconciliation returns empty when invariants hold.
    it("§6.6 reconciliation: healthy ledger returns no drift", async () => {
        const userId = await makeUser(200);
        await ledger.grant({
            user_id: userId,
            credits: 50,
            reason: "grant:test",
            source_event_id: `evt-${randomUUID()}`,
        });
        const key = `reco-${randomUUID()}`;
        const jobId = await makePricedJob(userId, 30, key);
        await ledger.debit({
            user_id: userId,
            idempotency_key: key,
            job_id: jobId,
            credits: 30,
            reason: "debit:generation",
        });

        const drift = await ledger.reconcile();
        const forThisUser = drift.filter((r) => r.user_id === userId);
        assert.equal(forThisUser.length, 0, "no drift on healthy ledger");
    });
});
