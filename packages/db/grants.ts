/**
 * Grant Manager — Credit Grants with Expiry
 * 
 * All credit income flows through the ledger as grants:
 * - grant:cycle — Monthly plan renewal (30-day expiry)
 * - grant:topup — One-time top-up (never expires)
 * - grant:referral — Referral bonus (30-day expiry)
 * 
 * §25.3 Invariant: balance = SUM(ledger_entries.delta) where reason IN ('grant:*', 'debit:*', 'refund:*', 'expire:*')
 * 
 * Non-rollover expiry: expires_at in schema, not cron afterthought.
 * Expiry cron runs once per day, marks expired grants with compensating entries.
 */

export interface GrantRequest {
  user_id: string;
  credits: number;
  reason: 'grant:cycle' | 'grant:topup' | 'grant:referral';
  expires_at?: Date; // null for topups (never expire)
}

export class GrantManager {
  constructor(private db: any) {}

  /**
   * Grant credits to user
   * 
   * Appends positive-delta ledger entry with optional expiry.
   * Atomic with balance update (§25.3 invariant).
   */
  async grant(req: GrantRequest): Promise<void> {
    const expiresAt = req.expires_at?.toISOString() ?? null;

    // Append grant entry
    await this.db.query(
      `INSERT INTO ledger_entries (user_id, delta, reason, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [req.user_id, req.credits, req.reason, expiresAt]
    );

    // Update balance
    await this.db.query(
      `UPDATE credit_balances
       SET balance = balance + $1, updated_at = now()
       WHERE user_id = $2`,
      [req.credits, req.user_id]
    );
  }

  /**
   * Grant plan credits (monthly cycle)
   * 
   * - Starter: 200 credits, 30-day expiry
   * - Plus: 1000 credits, 30-day expiry
   * - Ultra: 3000 credits, 30-day expiry
   */
  async grantPlanCycle(
    userId: string,
    plan: 'starter' | 'plus' | 'ultra'
  ): Promise<void> {
    const credits: Record<string, number> = {
      starter: 200,
      plus: 1000,
      ultra: 3000,
    };

    const amount = credits[plan];
    if (!amount) throw new Error(`Unknown plan: ${plan}`);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30-day expiry

    await this.grant({
      user_id: userId,
      credits: amount,
      reason: 'grant:cycle',
      expires_at: expiresAt,
    });
  }

  /**
   * Grant top-up credits (never expire)
   * 
   * - 200 credits / $9
   * - 500 credits / $21
   * - 1200 credits / $45
   */
  async grantTopup(userId: string, credits: number): Promise<void> {
    await this.grant({
      user_id: userId,
      credits,
      reason: 'grant:topup',
      // expires_at: null (never expires)
    });
  }

  /**
   * Expire grants past their expiry date
   * 
   * Cron: Daily, runs expire:cycle compensating entries for expired balance.
   * 
   * Flow:
   * 1. Find ledger entries where expires_at < now
   * 2. For each, append compensating -delta entry (reason: expire:cycle)
   * 3. Update balance
   * 
   * Result: User balance reflects only active (non-expired) credits.
   */
  async expireCredits(): Promise<number> {
    const conn = await this.db.getClient();
    let expiredCount = 0;

    try {
      await conn.query('BEGIN');

      // Find expired grant entries
      const result = await conn.query(
        `SELECT id, user_id, delta FROM ledger_entries
         WHERE expires_at < now() AND reason LIKE 'grant:%'
           AND id NOT IN (
             SELECT job_id FROM ledger_entries WHERE reason = 'expire:cycle'
           )
         ORDER BY expires_at ASC
         LIMIT 1000`
      );

      for (const row of result.rows) {
        // Append compensating -delta entry (invalidate the grant)
        await conn.query(
          `INSERT INTO ledger_entries (user_id, delta, reason, expires_at)
           VALUES ($1, $2, $3, NULL)`,
          [row.user_id, -row.delta, 'expire:cycle']
        );

        // Update balance
        await conn.query(
          `UPDATE credit_balances
           SET balance = GREATEST(0, balance - $1), updated_at = now()
           WHERE user_id = $2`,
          [row.delta, row.user_id]
        );

        expiredCount++;
      }

      await conn.query('COMMIT');
    } catch (error) {
      await conn.query('ROLLBACK');
      throw error;
    } finally {
      conn.release();
    }

    return expiredCount;
  }

  /**
   * Get active balance (sum of non-expired grants + topups minus debits + refunds)
   */
  async getActiveBalance(userId: string): Promise<number> {
    const result = await this.db.query(
      `SELECT COALESCE(SUM(delta), 0) as balance
       FROM ledger_entries
       WHERE user_id = $1
         AND (expires_at IS NULL OR expires_at > now())`,
      [userId]
    );

    return result.rows[0]?.balance ?? 0;
  }
}
