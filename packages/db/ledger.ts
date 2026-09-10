/**
 * Veyrnox Ledger — append-only credit transactions.
 *
 * §25.3 Invariant: for every user_id, balance = SUM(ledger_entries.delta)
 * at every commit boundary. debit, refund, and grant all preserve this by
 * inserting a ledger row and updating the materialised balance in the same
 * transaction.
 *
 * Queue emission (job.submit / job.refund / job.failover) is Inngest's job,
 * done by the caller after this class's Promises resolve — see
 * packages/queue/ (Phase 1 slice 6). This class never emits.
 *
 * Driver-agnostic: constructor takes a PgLikePool. In tests that's
 * `pg.Pool`; in production it's `@neondatabase/serverless`'s `Pool`. Both
 * expose the same shape by design.
 */

import type { PgLikePool, PgLikeClient, UUID } from "./types.ts";

// ─── Request/response shapes ────────────────────────────────────────────────

export interface DebitRequest {
    user_id: UUID;
    idempotency_key: string;
    job_id: UUID;
    credits: number;
    reason: string;
}

export interface DebitSuccess {
    ok: true;
    job_id: UUID;
    idempotent: boolean;
    balance_after: number;
}

export interface DebitFailure {
    ok: false;
    code: "INSUFFICIENT_BALANCE" | "NO_BALANCE_ROW" | "INVALID_CREDITS";
    message: string;
    balance?: number;
}

export type DebitResult = DebitSuccess | DebitFailure;

export interface RefundRequest {
    job_id: UUID;
    user_id: UUID;
    credits: number;
    reason: string;
}

export interface RefundResult {
    ok: true;
    entry_id: UUID;
    idempotent: boolean;
    balance_after: number;
}

export interface GrantRequest {
    user_id: UUID;
    credits: number;
    reason: string;
    /**
     * External event id (Stripe/LMS webhook_events.external_id) used only
     * for audit log correlation. Idempotency against replayed webhooks is
     * enforced by the caller against the webhook_events table before
     * calling grant() — this class trusts that it was called at most once
     * per external event.
     */
    source_event_id: string;
}

export interface ReconcileRow {
    user_id: UUID;
    materialised_balance: number;
    ledger_sum: number;
    drift: number;
}

// ─── The class ──────────────────────────────────────────────────────────────

export class Ledger {
    constructor(private readonly pool: PgLikePool) {}

    /**
     * Debit `credits` from `user_id`'s balance. Idempotent on
     * (user_id, idempotency_key): a repeat call returns the same job_id
     * without changing state. The caller must have already INSERTED the
     * jobs row (state='PRICED') before calling this — debit transitions
     * it to 'DEBITED'.
     */
    async debit(req: DebitRequest): Promise<DebitResult> {
        if (!Number.isInteger(req.credits) || req.credits <= 0) {
            return {
                ok: false,
                code: "INVALID_CREDITS",
                message: `credits must be a positive integer (got ${req.credits})`,
            };
        }

        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");

            // Idempotency guard
            const existing = await client.query<{ id: UUID; state: string }>(
                `SELECT id, state::text AS state FROM jobs
                 WHERE user_id = $1 AND idempotency_key = $2`,
                [req.user_id, req.idempotency_key]
            );
            if (existing.rows.length > 0) {
                const row = existing.rows[0];
                await client.query("COMMIT");
                const balance = await this.readBalance(req.user_id);
                return {
                    ok: true,
                    job_id: row.id,
                    idempotent: true,
                    balance_after: balance,
                };
            }

            // Lock balance row
            const balanceRes = await client.query<{ balance: number }>(
                `SELECT balance FROM credit_balances
                 WHERE user_id = $1 FOR UPDATE`,
                [req.user_id]
            );
            if (balanceRes.rows.length === 0) {
                await client.query("ROLLBACK");
                return {
                    ok: false,
                    code: "NO_BALANCE_ROW",
                    message: `no credit_balances row for user ${req.user_id}`,
                };
            }
            const currentBalance = balanceRes.rows[0].balance;
            if (currentBalance < req.credits) {
                await client.query("ROLLBACK");
                return {
                    ok: false,
                    code: "INSUFFICIENT_BALANCE",
                    message: `insufficient balance: have ${currentBalance}, need ${req.credits}`,
                    balance: currentBalance,
                };
            }

            // Append ledger entry
            await client.query(
                `INSERT INTO ledger_entries (user_id, delta, reason, job_id)
                 VALUES ($1, $2, $3, $4)`,
                [req.user_id, -req.credits, req.reason, req.job_id]
            );

            // Update materialised balance
            await client.query(
                `UPDATE credit_balances
                 SET balance = balance - $1, updated_at = now()
                 WHERE user_id = $2`,
                [req.credits, req.user_id]
            );

            // Transition job PRICED → DEBITED
            await client.query(
                `UPDATE jobs
                 SET state = 'DEBITED', updated_at = now()
                 WHERE id = $1 AND state = 'PRICED'`,
                [req.job_id]
            );

            await client.query("COMMIT");
            return {
                ok: true,
                job_id: req.job_id,
                idempotent: false,
                balance_after: currentBalance - req.credits,
            };
        } catch (err) {
            try {
                await client.query("ROLLBACK");
            } catch {
                /* rollback failure — the outer catch/throw path handles it */
            }
            throw err;
        } finally {
            client.release();
        }
    }

    /**
     * Refund a previously-debited job. One refund per job — repeat calls
     * return the same entry_id and don't move the balance a second time.
     * `credits` MUST match the original debit; the caller looks it up on
     * the jobs row before calling.
     */
    async refund(req: RefundRequest): Promise<RefundResult> {
        if (!Number.isInteger(req.credits) || req.credits <= 0) {
            throw new Error(
                `refund credits must be a positive integer (got ${req.credits})`
            );
        }

        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");

            // Idempotency: has a refund already landed for this job?
            const existing = await client.query<{ id: UUID }>(
                `SELECT id FROM ledger_entries
                 WHERE job_id = $1 AND delta > 0 AND reason LIKE 'refund:%'`,
                [req.job_id]
            );
            if (existing.rows.length > 0) {
                await client.query("COMMIT");
                const balance = await this.readBalance(req.user_id);
                return {
                    ok: true,
                    entry_id: existing.rows[0].id,
                    idempotent: true,
                    balance_after: balance,
                };
            }

            const inserted = await client.query<{ id: UUID }>(
                `INSERT INTO ledger_entries (user_id, delta, reason, job_id)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id`,
                [req.user_id, req.credits, req.reason, req.job_id]
            );

            const updated = await client.query<{ balance: number }>(
                `UPDATE credit_balances
                 SET balance = balance + $1, updated_at = now()
                 WHERE user_id = $2
                 RETURNING balance`,
                [req.credits, req.user_id]
            );

            // Transition job to REFUNDED (best-effort; not fatal if job is
            // in a state that doesn't match).
            await client.query(
                `UPDATE jobs
                 SET state = 'REFUNDED', updated_at = now()
                 WHERE id = $1 AND state IN ('DEBITED', 'SUBMITTED', 'FAILOVER', 'FAILED')`,
                [req.job_id]
            );

            await client.query("COMMIT");
            return {
                ok: true,
                entry_id: inserted.rows[0].id,
                idempotent: false,
                balance_after: updated.rows[0]?.balance ?? 0,
            };
        } catch (err) {
            try {
                await client.query("ROLLBACK");
            } catch {
                /* see debit */
            }
            throw err;
        } finally {
            client.release();
        }
    }

    /**
     * Grant credits (signup free-tier, subscription top-up, one-off purchase).
     * Caller MUST have already dedup'd against webhook_events(source,
     * external_id) — this method trusts that source_event_id is one-per-real-
     * event. Ensures a balance row exists on first grant.
     */
    async grant(req: GrantRequest): Promise<{ entry_id: UUID; balance_after: number }> {
        if (!Number.isInteger(req.credits) || req.credits <= 0) {
            throw new Error(
                `grant credits must be a positive integer (got ${req.credits})`
            );
        }

        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");

            // Ensure balance row exists
            await client.query(
                `INSERT INTO credit_balances (user_id, balance)
                 VALUES ($1, 0)
                 ON CONFLICT (user_id) DO NOTHING`,
                [req.user_id]
            );

            const inserted = await client.query<{ id: UUID }>(
                `INSERT INTO ledger_entries (user_id, delta, reason, job_id)
                 VALUES ($1, $2, $3, NULL)
                 RETURNING id`,
                [req.user_id, req.credits, req.reason]
            );

            const updated = await client.query<{ balance: number }>(
                `UPDATE credit_balances
                 SET balance = balance + $1, updated_at = now()
                 WHERE user_id = $2
                 RETURNING balance`,
                [req.credits, req.user_id]
            );

            await client.query("COMMIT");
            return {
                entry_id: inserted.rows[0].id,
                balance_after: updated.rows[0]?.balance ?? 0,
            };
        } catch (err) {
            try {
                await client.query("ROLLBACK");
            } catch {
                /* see debit */
            }
            throw err;
        } finally {
            client.release();
        }
    }

    /** Read the materialised balance (cache — SUM(delta) is source of truth). */
    async readBalance(user_id: UUID): Promise<number> {
        const res = await this.pool.query<{ balance: number }>(
            `SELECT balance FROM credit_balances WHERE user_id = $1`,
            [user_id]
        );
        return res.rows[0]?.balance ?? 0;
    }

    /**
     * §6.6 Reconciliation. Returns any user whose materialised balance
     * disagrees with the ledger sum. Empty result = healthy.
     */
    async reconcile(): Promise<ReconcileRow[]> {
        const res = await this.pool.query<ReconcileRow>(
            `SELECT
                cb.user_id,
                cb.balance      AS materialised_balance,
                COALESCE(SUM(le.delta), 0)::int AS ledger_sum,
                (cb.balance - COALESCE(SUM(le.delta), 0))::int AS drift
             FROM credit_balances cb
             LEFT JOIN ledger_entries le ON le.user_id = cb.user_id
             GROUP BY cb.user_id, cb.balance
             HAVING cb.balance <> COALESCE(SUM(le.delta), 0)`
        );
        return res.rows;
    }
}
