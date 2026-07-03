/**
 * Webhook Receiver — Provider Results
 * 
 * Route: POST /v1/webhooks/:provider
 * 
 * Flow:
 * 1. Verify webhook signature (ed25519 for fal, HMAC for Replicate)
 * 2. Dedupe via webhook_events table (insert-or-ignore)
 * 3. Transition job state: POLLING → STORE_PENDING (on completion)
 * 4. Queue outbox event (media.store) for R2 upload
 * 5. Return 200 immediately (async R2 copy in separate worker)
 * 
 * §5.4 Invariant: ed25519 ≠ HMAC (verify against correct key type)
 */

import { FalAdapter } from '../../packages/adapters/fal';
import { JobStateMachine } from '../../packages/db/job-state';

export async function handleWebhook(req: Request, env: any): Promise<Response> {
  const url = new URL(req.url);
  const provider = url.searchParams.get('provider') || url.pathname.split('/').pop();

  try {
    // Step 1: Verify signature
    const adapter = getAdapter(provider, env);
    const verifiedEvent = await adapter.verifyWebhook(req);

    if (!verifiedEvent) {
      console.warn(`Invalid webhook signature from ${provider}`);
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        { status: 401 }
      );
    }

    // Step 2: Dedupe (insert-or-ignore)
    const result = await env.LEDGER.query(
      `INSERT INTO webhook_events (provider, event_id, received_at)
       VALUES ($1, $2, now())
       ON CONFLICT DO NOTHING`,
      [provider, verifiedEvent.eventId]
    );

    if (result.rowCount === 0) {
      // Duplicate delivery; return 200 (idempotent)
      console.log(`Duplicate webhook from ${provider}: ${verifiedEvent.eventId}`);
      return new Response(JSON.stringify({ status: 'deduped' }), { status: 200 });
    }

    // Step 3: Transition job state
    const sm = new JobStateMachine(env.LEDGER);
    const job = await sm.getJob(verifiedEvent.jobId);

    if (!job) {
      console.warn(`Webhook for unknown job: ${verifiedEvent.jobId}`);
      return new Response(JSON.stringify({ error: 'Job not found' }), { status: 404 });
    }

    // Parse result
    const parsed = adapter.parseResult(verifiedEvent);

    if (verifiedEvent.status === 'completed') {
      // Transition to STORE_PENDING (R2 upload queued separately)
      await sm.transition({
        job_id: verifiedEvent.jobId,
        from_state: 'POLLING',
        to_state: 'STORE_PENDING',
      });

      // Step 4: Queue media.store event (R2 upload will happen async)
      await env.LEDGER.query(
        `INSERT INTO outbox (topic, payload)
         VALUES ($1, $2)`,
        [
          'media.store',
          JSON.stringify({
            job_id: verifiedEvent.jobId,
            user_id: job.user_id,
            provider_url: parsed.outputUrl,
            r2_key: `jobs/${job.user_id}/${verifiedEvent.jobId}`,
          }),
        ]
      );

      console.log(`Job ${verifiedEvent.jobId} completed, queued for R2 storage`);
    } else {
      // Provider failed; transition to FAILED + refund
      await sm.markFailedAndRefund(
        verifiedEvent.jobId,
        job.user_id,
        job.credits,
        parsed.errorCode || 'provider_error'
      );
      console.log(`Job ${verifiedEvent.jobId} failed by provider: ${parsed.errorCode}`);
    }

    // Step 5: Return 200 immediately (outbox relay runs async)
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500 }
    );
  }
}

function getAdapter(provider: string, env: any): any {
  switch (provider) {
    case 'fal':
      return new FalAdapter(env.FAL_KEY, env.WEBHOOK_URL);
    // TODO: case 'replicate': return new ReplicateAdapter(...)
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
