/**
 * Premium Gating — Plan-Based Access Control
 * 
 * Some models require specific plans or have daily caps:
 * - Veo 3.1 (125 credits) → Plus/Ultra only, 1 generation/day
 * - Premium models → Plus/Ultra gatekeeping
 * - Daily caps → Prevent credit hoarding abuse
 * 
 * Check happens BEFORE debit (§5.6 precedence):
 * 1. User submits generation
 * 2. Check: user_plan ∈ allowed_plans? user_daily_count < cap?
 * 3. If NO: return 403 (no charge)
 * 4. If YES: proceed to moderation → debit → generation
 */

export interface ModelGate {
  model_id: string;
  min_plan: 'starter' | 'plus' | 'ultra'; // Minimum required plan (starter = no gate)
  daily_cap?: number; // Max generations per day (null = no cap)
}

export class PremiumGatingManager {
  constructor(private db: any) {}

  /**
   * Check if user can generate with this model
   */
  async canGenerate(userId: string, modelId: string): Promise<{ allowed: boolean; reason?: string }> {
    // Get user's plan
    const userResult = await this.db.query(
      `SELECT plan FROM users WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return { allowed: false, reason: 'User not found' };
    }

    const userPlan = userResult.rows[0].plan;

    // Get model gate
    const gateResult = await this.db.query(
      `SELECT min_plan, daily_cap FROM model_gates WHERE model_id = $1`,
      [modelId]
    );

    const gate = gateResult.rows[0];
    if (!gate) return { allowed: true }; // No gate = all plans allowed

    // Check plan requirement
    const planHierarchy: Record<string, number> = { none: 0, starter: 1, plus: 2, ultra: 3 };
    if (planHierarchy[userPlan] < planHierarchy[gate.min_plan]) {
      return { allowed: false, reason: `This model requires ${gate.min_plan} plan` };
    }

    // Check daily cap
    if (gate.daily_cap && gate.daily_cap > 0) {
      const countResult = await this.db.query(
        `SELECT COUNT(*) as count FROM jobs
         WHERE user_id = $1 AND model_id = $2
           AND state = 'STORED'
           AND created_at > now() - INTERVAL '1 day'`,
        [userId, modelId]
      );

      const dailyCount = countResult.rows[0]?.count || 0;
      if (dailyCount >= gate.daily_cap) {
        return { allowed: false, reason: `Daily limit reached (${gate.daily_cap} per day)` };
      }
    }

    return { allowed: true };
  }

  /**
   * Create model gate (admin)
   */
  async createGate(gate: ModelGate): Promise<void> {
    await this.db.query(
      `INSERT INTO model_gates (model_id, min_plan, daily_cap)
       VALUES ($1, $2, $3)
       ON CONFLICT (model_id) DO UPDATE
       SET min_plan = $2, daily_cap = $3`,
      [gate.model_id, gate.min_plan, gate.daily_cap ?? null]
    );
  }
}
