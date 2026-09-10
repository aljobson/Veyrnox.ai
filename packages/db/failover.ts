/**
 * Provider Failover Logic
 * 
 * Job submission to fal.ai fails → transition to FAILOVER → retry with Replicate.
 * Both providers fail → transition to FAILED → auto-REFUNDED (automatic).
 * 
 * State machine:
 * - PRICED → SUBMITTED (fal) → ...
 * - On fal error: SUBMITTED → FAILOVER
 * - FAILOVER → SUBMITTED (replicate) → ...
 * - On replicate error: SUBMITTED → FAILED → REFUNDED
 * 
 * Idempotency: Failover counts as a state; no infinite retries.
 */

import { JobStateMachine } from './job-state';

export class FailoverManager {
  constructor(private sm: JobStateMachine, private db: any) {}

  /**
   * Handle fal.ai submission failure
   * 
   * 1. Transition to FAILOVER
   * 2. Retry with Replicate
   * 3. If Replicate also fails, transition to FAILED + refund
   */
  async handleFalSubmitFailure(
    jobId: string,
    userId: string,
    credits: number,
    error: Error
  ): Promise<void> {
    const job = await this.sm.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    // Transition to FAILOVER
    await this.sm.transition({
      job_id: jobId,
      from_state: 'SUBMITTED',
      to_state: 'FAILOVER',
      error_code: `fal_error: ${error.message}`,
    });

    console.log(`Job ${jobId} failover triggered (fal failed: ${error.message})`);

    // Caller emits the Inngest `job.failover` event after this Promise
    // resolves. Payload shape: { job_id, user_id, provider: 'replicate',
    // model_id }. See packages/queue/ (Phase 1 slice 6).
  }

  /**
   * Handle Replicate submission failure (secondary provider)
   * 
   * Both providers failed → mark FAILED + auto-refund
   */
  async handleReplicateSubmitFailure(
    jobId: string,
    userId: string,
    credits: number,
    error: Error
  ): Promise<void> {
    const job = await this.sm.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    // Both providers failed
    await this.sm.markFailedAndRefund(
      jobId,
      userId,
      credits,
      `both_providers_failed: ${error.message}`
    );

    console.log(`Job ${jobId} failed (both fal and Replicate): auto-refunded`);
  }
}
