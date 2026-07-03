/**
 * Veyrnox Gateway Worker — POST /v1/generations
 * 
 * Entry point for the Cloudflare Worker gateway.
 * Handles generation requests, debits credits, submits jobs to queue.
 */

import { Ledger } from '../../packages/db/ledger';
import { v4 as uuidv4 } from 'uuid';

export interface GenerationRequest {
  model: string;
  prompt: string;
  negative_prompt?: string;
  idempotency_key?: string;
  [key: string]: any;
}

export interface GenerationResponse {
  job_id: string;
  status: string;
  estimated_credits: number;
  error?: string;
}

export class GatewayWorker {
  private ledger: Ledger;

  constructor(db: any) {
    this.ledger = new Ledger(db);
  }

  /**
   * POST /v1/generations
   * 
   * 1. Validate request (model exists, prompt length, etc.)
   * 2. Look up model price from catalog
   * 3. Debit user balance (§25.3 transaction, idempotent)
   * 4. Create job row with state=PRICED
   * 5. Queue outbox event for provider submission
   * 6. Return job_id
   */
  async generateImage(
    req: GenerationRequest,
    userId: string
  ): Promise<GenerationResponse> {
    // Step 1: Validate
    if (!req.model) throw new Error('model required');
    if (!req.prompt) throw new Error('prompt required');
    if (!req.idempotency_key) req.idempotency_key = uuidv4();

    // Step 2: Look up price (from packages/catalog)
    // TODO: Import and call getModelPrice(req.model)
    const credits = 15; // Placeholder: Wan 2.5 = 15 credits

    // Step 3: Create job row (state=PRICED)
    const job_id = uuidv4();
    // TODO: INSERT INTO jobs (id, user_id, state, idempotency_key, model_id, credits)
    //       VALUES (job_id, userId, 'PRICED', req.idempotency_key, req.model, credits)

    // Step 4: Debit (§25.3 transaction)
    const debitResult = await this.ledger.debit({
      user_id: userId,
      idempotency_key: req.idempotency_key,
      job_id,
      credits,
      reason: 'debit:generation',
    });

    if (!debitResult.success) {
      return {
        job_id: '',
        status: 'REJECTED',
        estimated_credits: credits,
        error: debitResult.error,
      };
    }

    // Step 5: Queue is automatic — ledger.debit() creates outbox row (job.submit event)
    // The outbox relay will pick it up and transition job to SUBMITTED state

    // Step 6: Return
    return {
      job_id,
      status: 'PRICED',
      estimated_credits: credits,
    };
  }

  /**
   * GET /v1/generations/:jobId
   * Poll for job status and result.
   */
  async getJob(jobId: string): Promise<any> {
    // TODO: SELECT from jobs WHERE id = jobId
    // Return status, output_url, error, etc.
    return {
      job_id: jobId,
      status: 'PRICED',
      output_url: null,
    };
  }
}
