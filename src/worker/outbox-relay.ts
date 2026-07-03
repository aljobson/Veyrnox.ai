/**
 * Outbox Relay — Cloudflare Queue Consumer
 * 
 * Binding: SUBMIT_QUEUE (producer) → veyrnox-submit (queue)
 * 
 * Processes outbox events:
 * - job.submit: Submit job to provider (transition PRICED → SUBMITTED)
 * - media.store: Copy result from provider to R2 (transition STORE_PENDING → STORED)
 * 
 * Key invariant: Outbox relay is durable. Jobs are only queued after
 * the ledger.debit() transaction commits, ensuring no loss.
 * 
 * If a message fails (e.g., provider unreachable), it's retried up to
 * max_retries (5); if still failing, it goes to DLQ for manual inspection.
 */

import { FalAdapter } from '../../packages/adapters/fal';
import { JobStateMachine } from '../../packages/db/job-state';

export interface OutboxMessage {
  id: number;
  topic: 'job.submit' | 'media.store' | 'job.refund';
  payload: any;
  created_at: string;
  dispatched_at?: string;
}

export async function handleOutbox(batch: MessageBatch<any>, env: any): Promise<void> {
  const sm = new JobStateMachine(env.LEDGER);

  for (const msg of batch.messages) {
    try {
      const outbox = msg.body as OutboxMessage;

      if (outbox.topic === 'job.submit') {
        await handleJobSubmit(outbox.payload, env, sm);
      } else if (outbox.topic === 'media.store') {
        await handleMediaStore(outbox.payload, env, sm);
      }

      msg.ack();
    } catch (error) {
      console.error(`Outbox relay error for message ${msg.id}:`, error);
      msg.retry(); // Cloudflare will retry up to max_retries
    }
  }
}

async function handleJobSubmit(payload: any, env: any, sm: JobStateMachine): Promise<void> {
  const { job_id, user_id, credits } = payload;

  // Get job details
  const job = await sm.getJob(job_id);
  if (!job) throw new Error(`Job ${job_id} not found`);

  // Submit to fal
  const adapter = new FalAdapter(env.FAL_KEY, env.WEBHOOK_URL);
  const result = await adapter.submit({
    job_id,
    user_id,
    model_id: job.model_id,
    prompt: job.prompt || '', // TODO: Store in jobs table
  });

  // Transition to SUBMITTED
  await sm.transition({
    job_id,
    from_state: 'PRICED',
    to_state: 'SUBMITTED',
    provider_job_id: result.providerJobId,
  });

  // Transition to POLLING (ready for webhooks)
  // TODO: Actually, SUBMITTED → POLLING should happen after first poll,
  // or it can happen immediately. For now, move to POLLING.
  await sm.transition({
    job_id,
    from_state: 'SUBMITTED',
    to_state: 'POLLING',
  });

  console.log(`Job ${job_id} submitted to fal: ${result.providerJobId}`);
}

async function handleMediaStore(payload: any, env: any, sm: JobStateMachine): Promise<void> {
  const { job_id, user_id, provider_url, r2_key } = payload;

  try {
    // Download from provider
    const response = await fetch(provider_url);
    if (!response.ok) {
      throw new Error(`Failed to fetch from provider: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();

    // Upload to R2 (with retries)
    let retries = 3;
    while (retries > 0) {
      try {
        await env.MEDIA.put(r2_key, buffer, {
          httpMetadata: {
            contentType: 'image/jpeg', // TODO: Detect from provider response
          },
        });
        break;
      } catch (error) {
        retries--;
        if (retries === 0) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * (4 - retries))); // Exponential backoff
      }
    }

    // Transition to STORED
    await sm.transition({
      job_id,
      from_state: 'STORE_PENDING',
      to_state: 'STORED',
      r2_key,
    });

    console.log(`Job ${job_id} stored in R2: ${r2_key}`);
  } catch (error) {
    console.error(`Failed to store job ${job_id}:`, error);

    // Max retries exceeded → mark FAILED + refund
    const job = await sm.getJob(job_id);
    if (job) {
      await sm.markFailedAndRefund(job_id, user_id, job.credits, 'storage_failed');
    }
    throw error;
  }
}
