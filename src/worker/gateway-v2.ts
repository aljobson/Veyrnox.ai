/**
 * Veyrnox Gateway v2 — Integrated Moderation + Premium Gating
 * 
 * POST /v1/generations flow (updated):
 * 1. Validate request (model, prompt, Idempotency-Key)
 * 2. Premium gating: Check plan + daily cap (§5.6 precedence)
 * 3. Moderation: DeepSeek classifier (§5.6 precedence)
 * 4. Look up price from catalog
 * 5. Debit ledger (§25.3 transaction)
 * 6. Create job, queue for generation
 * 7. Return job_id
 */

import { Ledger } from '../../packages/db/ledger';
import { JobStateMachine } from '../../packages/db/job-state';
import { PremiumGatingManager } from '../../packages/db/premium-gating';
import { DeepseekModerationAdapter } from '../../packages/adapters/deepseek-moderation';
import { PresetManager } from '../../packages/db/presets';
import { v4 as uuidv4 } from 'uuid';

export class GatewayV2 {
  private ledger: Ledger;
  private sm: JobStateMachine;
  private gating: PremiumGatingManager;
  private moderation: DeepseekModerationAdapter;
  private presets: PresetManager;

  constructor(db: any, deepseekKey: string) {
    this.ledger = new Ledger(db);
    this.sm = new JobStateMachine(db);
    this.gating = new PremiumGatingManager(db);
    this.moderation = new DeepseekModerationAdapter(deepseekKey);
    this.presets = new PresetManager(db);
  }

  async generateImage(
    req: any,
    userId: string,
    idempotencyKey: string
  ): Promise<any> {
    // Step 1: Validate
    if (!req.model) throw new Error('model required');
    if (!req.prompt) throw new Error('prompt required');

    // Step 2: Premium gating (§5.6 precedence: before moderation)
    const gateCheck = await this.gating.canGenerate(userId, req.model);
    if (!gateCheck.allowed) {
      return {
        status: 403,
        error: gateCheck.reason,
      };
    }

    // Step 3: Moderation (§5.6 precedence: before debit)
    const modResult = await this.moderation.moderate({
      prompt: req.prompt,
      negative_prompt: req.negative_prompt,
    });

    if (!modResult.allowed) {
      // Rejected: zero charge, return category + message
      return {
        status: 400,
        error: 'Content policy violation',
        category: modResult.category,
        message: modResult.message,
      };
    }

    // Step 4: Look up price (from packages/catalog)
    // TODO: Import catalog and lookup model price
    const credits = 15; // Placeholder

    // Step 5: Create job row (state=PRICED)
    const jobId = uuidv4();
    // TODO: INSERT INTO jobs (id, user_id, state, idempotency_key, model_id, credits)

    // Step 6: Debit (§25.3 transaction)
    const debitResult = await this.ledger.debit({
      user_id: userId,
      idempotency_key: idempotencyKey,
      job_id: jobId,
      credits,
      reason: 'debit:generation',
    });

    if (!debitResult.success) {
      return {
        status: 402,
        error: debitResult.error,
      };
    }

    // Step 7: Return job_id
    return {
      status: 200,
      job_id: jobId,
      credits,
      status_url: `/v1/jobs/${jobId}`,
    };
  }

  /**
   * Get presets for display in UI
   */
  async getPresets(modelId?: string): Promise<any> {
    if (modelId) {
      return await this.presets.getPresetsByModel(modelId);
    }
    return await this.presets.listPresets();
  }
}
