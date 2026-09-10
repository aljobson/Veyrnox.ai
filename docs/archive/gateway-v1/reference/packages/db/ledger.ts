/**
 * Veyrnox Ledger — Append-Only Credit Transactions
 * 
 * §25.3 Invariant: balance = SUM(ledger_entries.delta) at all times.
 * All credit mutations go through a single atomic debit transaction.
 * 
 * Caller must provide a Postgres connection pool (via Hyperdrive or direct).
 */

export interface DebitRequest {
  user_id: string;
  idempotency_key: string;
  job_id: string;
  credits: number;
  reason: 'debit:generation' | 'debit:test';
}

export interface DebitResponse {
  success: boolean;
  job_id: string;
  balance_after?: number;
  error?: string;
}

export class Ledger {
  constructor(private db: any) {} // Hyperdrive or postgres pool

  /**
   * Debit user balance for a generation job.
   * 
   * §25.3 transaction: idempotency guard → lock → debit → outbox.
   * Idempotent: same (user_id, idempotency_key) returns existing job, never double-charges.
   * 
   * @throws if user has insufficient balance or database error
   */
  async debit(req: DebitRequest): Promise<DebitResponse> {
    const conn = await this.db.getClient();
    
    try {
      // SERIALIZABLE isolation: prevents concurrent read-modify-write races
      await conn.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

      // Step 1: Idempotency guard
      const existing = await conn.query(
        `SELECT id FROM jobs WHERE user_id = $1 AND idempotency_key = $2`,
        [req.user_id, req.idempotency_key]
      );
      
      if (existing.rows.length > 0) {
        // Already debited; return existing job (no double charge)
        await conn.query('COMMIT');
        return {
          success: true,
          job_id: existing.rows[0].id,
        };
      }

      // Step 2: Lock balance + check sufficiency
      const balance = await conn.query(
        `SELECT balance FROM credit_balances WHERE user_id = $1 FOR UPDATE`,
        [req.user_id]
      );

      if (balance.rows.length === 0) {
        throw new Error(`User ${req.user_id} has no credit_balances row`);
      }

      const current_balance = balance.rows[0].balance;
      if (current_balance < req.credits) {
        await conn.query('ROLLBACK');
        return {
          success: false,
          job_id: '',
          error: `Insufficient balance: ${current_balance} < ${req.credits}`,
        };
      }

      // Step 3: Append ledger entry (append-only, never UPDATE)
      await conn.query(
        `INSERT INTO ledger_entries (user_id, delta, reason, job_id)
         VALUES ($1, $2, $3, $4)`,
        [req.user_id, -req.credits, req.reason, req.job_id]
      );

      // Step 4: Update materialised balance (same transaction)
      await conn.query(
        `UPDATE credit_balances
         SET balance = balance - $1, updated_at = now()
         WHERE user_id = $2`,
        [req.credits, req.user_id]
      );

      // Step 5: Create outbox row for queue relay
      await conn.query(
        `INSERT INTO outbox (topic, payload)
         VALUES ($1, $2)`,
        [
          'job.submit',
          JSON.stringify({
            job_id: req.job_id,
            user_id: req.user_id,
            credits: req.credits,
          }),
        ]
      );

      await conn.query('COMMIT');

      return {
        success: true,
        job_id: req.job_id,
        balance_after: current_balance - req.credits,
      };
    } catch (error) {
      await conn.query('ROLLBACK');
      throw error;
    } finally {
      conn.release();
    }
  }

  /**
   * Refund a failed job.
   * Append a compensating +delta entry, outbox a refund event.
   */
  async refund(job_id: string, user_id: string, credits: number): Promise<void> {
    const conn = await this.db.getClient();

    try {
      await conn.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

      // Append refund entry
      await conn.query(
        `INSERT INTO ledger_entries (user_id, delta, reason, job_id)
         VALUES ($1, $2, $3, $4)`,
        [user_id, credits, 'refund:failed', job_id]
      );

      // Update balance
      await conn.query(
        `UPDATE credit_balances
         SET balance = balance + $1
         WHERE user_id = $2`,
        [credits, user_id]
      );

      // Outbox refund event
      await conn.query(
        `INSERT INTO outbox (topic, payload)
         VALUES ($1, $2)`,
        [
          'job.refund',
          JSON.stringify({ job_id, user_id, credits }),
        ]
      );

      await conn.query('COMMIT');
    } catch (error) {
      await conn.query('ROLLBACK');
      throw error;
    } finally {
      conn.release();
    }
  }

  /**
   * Get user's current balance (cache; source of truth is SUM(ledger_entries.delta))
   */
  async getBalance(user_id: string): Promise<number> {
    const result = await this.db.query(
      `SELECT balance FROM credit_balances WHERE user_id = $1`,
      [user_id]
    );
    return result.rows[0]?.balance ?? 0;
  }

  /**
   * Reconciliation check: balance = SUM(ledger_entries.delta)
   * Run in CI + nightly cron; must return zero rows.
   */
  async reconcile(): Promise<any[]> {
    const result = await this.db.query(
      `SELECT b.user_id, b.balance, COALESCE(SUM(l.delta), 0) AS ledger_sum
       FROM credit_balances b
       LEFT JOIN ledger_entries l ON l.user_id = b.user_id
       GROUP BY b.user_id, b.balance
       HAVING b.balance <> COALESCE(SUM(l.delta), 0)`
    );
    return result.rows;
  }
}
