/**
 * Failover Handler — Outbox Consumer
 * 
 * Processes job.failover events (when fal.ai submission fails).
 * Attempts to submit to Replicate as secondary provider.
 * 
 * Event flow:
 * 1. fal submit fails → job.failover event queued
 * 2. Failover handler: retry with Replicate
 * 3. If Replicate succeeds: FAILOVER → SUBMITTED → POLLING
 * 4. If Replicate fails: → FAILED → REFUNDED (automatic)
 */

import { ReplicateAdapter } from '../../packages/adapters/replicate';
import { JobStateMachine } from '../../packages/db/job-state';
import { FailoverManager } from '../../packages/db/failover';

export async function handleFailover(
  payload: any,
  env: any,
  sm: JobStateMachine
): Promise<void> {
  const { job_id, user_id, credits, model_id } = payload;

  const job = await sm.getJob(job_id);
  if (!job) throw new Error(`Job ${job_id} not found`);

  try {
    // Submit to Replicate
    const adapter = new ReplicateAdapter(env.REPLICATE_KEY, env.REPLICATE_WEBHOOK_SECRET);
    const result = await adapter.submit({
      job_id,
      user_id,
      model_id,
      prompt: job.prompt || '', // TODO: Store in jobs table
    });

    // Transition: FAILOVER → SUBMITTED (replicate)
    await sm.transition({
      job_id,
      from_state: 'FAILOVER',
      to_state: 'SUBMITTED',
      provider_job_id: `replicate-${result.providerJobId}`,
    });

    // Transition to POLLING
    await sm.transition({
      job_id,
      from_state: 'SUBMITTED',
      to_state: 'POLLING',
    });

    console.log(`Job ${job_id} failover to Replicate: ${result.providerJobId}`);
  } catch (error) {
    // Replicate also failed → FAILED + refund
    const fm = new FailoverManager(sm, env.LEDGER);
    await fm.handleReplicateSubmitFailure(
      job_id,
      user_id,
      credits,
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
}
