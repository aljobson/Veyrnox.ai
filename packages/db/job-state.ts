/**
 * Job State Machine — Veyrnox Generation Pipeline
 * 
 * State flow: PRICED → SUBMITTED → POLLING → STORE_PENDING → STORED
 * Failure paths: REJECTED, TIMEOUT, FAILOVER, FAILED, REFUNDED
 * 
 * Architecture §25.7: Cloudflare Workflow manages state transitions.
 * Each state has a well-defined next action and deadline.
 */

export type JobState =
  | 'PRICED'          // Job created, price locked, ledger debited
  | 'SUBMITTED'       // Submitted to provider (job.provider_job_id populated)
  | 'POLLING'         // Waiting for provider to complete
  | 'STORE_PENDING'   // Provider done, queued for R2 storage
  | 'STORED'          // In R2, ready for download
  | 'REJECTED'        // Pre-debit validation failed (moderation, etc.)
  | 'TIMEOUT'         // Exceeded polling deadline
  | 'FAILOVER'        // Primary failed, trying failover provider
  | 'FAILED'          // Both providers failed, job unrecoverable
  | 'REFUNDED';       // Balance refunded (automatic on FAILED)

export interface JobRow {
  id: string;
  user_id: string;
  state: JobState;
  idempotency_key: string;
  model_id: string;
  credits: number;
  provider?: string;        // 'fal' | 'replicate'
  provider_job_id?: string;
  r2_key?: string;          // s3://veyrnox-media/jobs/{user_id}/{job_id}
  error_code?: string;
  created_at: string;
  updated_at: string;
}

export interface JobTransition {
  job_id: string;
  from_state: JobState;
  to_state: JobState;
  provider_job_id?: string;
  r2_key?: string;
  error_code?: string;
}

export class JobStateMachine {
  constructor(private db: any) {}

  /**
   * Transition job to a new state.
   * Atomically updates state and optionally provider fields.
   */
  async transition(t: JobTransition): Promise<void> {
    const result = await this.db.query(
      `UPDATE jobs
       SET state = $1,
           provider = COALESCE($2, provider),
           provider_job_id = COALESCE($3, provider_job_id),
           r2_key = COALESCE($4, r2_key),
           error_code = COALESCE($5, error_code),
           updated_at = now()
       WHERE id = $6 AND state = $7`,
      [
        t.to_state,
        null,                    // provider (TODO: parse from provider_job_id format)
        t.provider_job_id,
        t.r2_key,
        t.error_code,
        t.job_id,
        t.from_state             // Optimistic lock: only update if state matches
      ]
    );

    if (result.rowCount === 0) {
      throw new Error(`Job ${t.job_id} state mismatch: expected ${t.from_state}`);
    }
  }

  /**
   * Get job by ID.
   */
  async getJob(job_id: string): Promise<JobRow | null> {
    const result = await this.db.query(
      `SELECT * FROM jobs WHERE id = $1`,
      [job_id]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Find jobs stuck in a state past the deadline (for sweeper cron).
   * 
   * Deadlines:
   * - PRICED: 30s (should have submitted immediately)
   * - SUBMITTED: 5m (fal processing)
   * - POLLING: 30m (max generation time + buffer)
   * - STORE_PENDING: 5m (R2 copy should be fast)
   */
  async findStuckJobs(): Promise<JobRow[]> {
    const result = await this.db.query(
      `SELECT * FROM jobs
       WHERE state IN ('PRICED', 'SUBMITTED', 'POLLING', 'STORE_PENDING')
         AND updated_at < now() - INTERVAL '1 minute' * CASE
           WHEN state = 'PRICED' THEN 0.5         -- 30s
           WHEN state = 'SUBMITTED' THEN 5        -- 5m
           WHEN state = 'POLLING' THEN 30         -- 30m
           WHEN state = 'STORE_PENDING' THEN 5    -- 5m
         END
       ORDER BY updated_at ASC
       LIMIT 100`
    );
    return result.rows;
  }

  /**
   * Transition job to FAILED and queue automatic refund.
   * Used by: stuck-job sweeper, provider failover exhaustion, error handlers.
   */
  async markFailedAndRefund(
    job_id: string,
    user_id: string,
    credits: number,
    error_code: string
  ): Promise<void> {
    const conn = await this.db.getClient();

    try {
      await conn.query('BEGIN');

      // Transition to FAILED
      await conn.query(
        `UPDATE jobs
         SET state = 'FAILED', error_code = $1, updated_at = now()
         WHERE id = $2`,
        [error_code, job_id]
      );

      // Queue refund
      const ledger = new (await import('./ledger')).Ledger(this.db);
      await ledger.refund(job_id, user_id, credits);

      await conn.query('COMMIT');
    } catch (error) {
      await conn.query('ROLLBACK');
      throw error;
    } finally {
      conn.release();
    }
  }
}
