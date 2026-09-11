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
    credits: number;
    reason: string;
    /**
     * The generation the caller wants to run. We insert the jobs row
     * inside the same transaction as the -delta ledger entry so job
     * creation and money movement are atomic.
     */
    model_id: string;
    inputs: Record<string, unknown>;
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

            // Idempotency guard — if a jobs row already exists for
            // (user_id, idempotency_key), the debit already ran. Return
            // that job unchanged; do not move any money.
            const existing = await client.query<{ id: UUID }>(
                `SELECT id FROM jobs
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

            // Lock balance row — FOR UPDATE serialises concurrent debits
            // for the same user without needing SERIALIZABLE isolation.
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

            // Create the jobs row (state = DEBITED — we're doing the debit
            // right here in the same transaction, no need for the PRICED
            // intermediate).
            const jobIns = await client.query<{ id: UUID }>(
                `INSERT INTO jobs (user_id, idempotency_key, model_id, credits, inputs, state)
                 VALUES ($1, $2, $3, $4, $5::jsonb, 'DEBITED')
                 RETURNING id`,
                [
                    req.user_id,
                    req.idempotency_key,
                    req.model_id,
                    req.credits,
                    JSON.stringify(req.inputs),
                ]
            );
            const newJobId = jobIns.rows[0].id;

            // Append -delta ledger entry
            await client.query(
                `INSERT INTO ledger_entries (user_id, delta, reason, job_id)
                 VALUES ($1, $2, $3, $4)`,
                [req.user_id, -req.credits, req.reason, newJobId]
            );

            // Update materialised balance
            await client.query(
                `UPDATE credit_balances
                 SET balance = balance - $1, updated_at = now()
                 WHERE user_id = $2`,
                [req.credits, req.user_id]
            );

            await client.query("COMMIT");
            return {
                ok: true,
                job_id: newJobId,
                idempotent: false,
                balance_after: currentBalance - req.credits,
            };
        } catch (err) {
            try {
                await client.query("ROLLBACK");
            } catch {
                /* rollback failure — outer throw handles it */
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
     * §6.6 Reconciliation. Returns any user where the invariant
     * `credit_balances.balance = SUM(ledger_entries.delta)` fails.
     * Empty result = healthy.
     *
     * FULL OUTER JOIN catches three defect modes:
     *   1. drift — balance != SUM(delta) for a user in both tables.
     *   2. orphan ledger — user has ledger rows but no balance row
     *      (materialised = NULL treated as 0, so any nonzero sum flags).
     *   3. balance without ledger — user has a nonzero balance and no
     *      ledger row backing it (SUM=NULL treated as 0).
     */
    async reconcile(): Promise<ReconcileRow[]> {
        const res = await this.pool.query<ReconcileRow>(
            `WITH sums AS (
                SELECT user_id, SUM(delta)::int AS ledger_sum
                FROM ledger_entries
                GROUP BY user_id
             )
             SELECT
                COALESCE(cb.user_id, s.user_id) AS user_id,
                COALESCE(cb.balance, 0)         AS materialised_balance,
                COALESCE(s.ledger_sum, 0)       AS ledger_sum,
                (COALESCE(cb.balance, 0) - COALESCE(s.ledger_sum, 0))::int AS drift
             FROM credit_balances cb
             FULL OUTER JOIN sums s ON s.user_id = cb.user_id
             WHERE COALESCE(cb.balance, 0) <> COALESCE(s.ledger_sum, 0)`
        );
        return res.rows;
    }
}
