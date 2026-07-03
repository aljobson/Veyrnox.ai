/**
 * Stripe Webhook Receiver — Payment Reconciliation
 * 
 * Route: POST /v1/webhooks/stripe
 * 
 * Flow:
 * 1. Verify HMAC-SHA256 signature (§5.4: different from ed25519)
 * 2. Handle charge.succeeded → grant credits (§25.3 transaction)
 * 3. Handle charge.failed → alert (no debit; payment failed)
 * 
 * Idempotency: Stripe sends events multiple times; we dedup in webhook_events table.
 */

import { StripeAdapter } from '../../packages/adapters/stripe';
import { GrantManager } from '../../packages/db/grants';

export async function handleStripeWebhook(req: Request, env: any): Promise<Response> {
  try {
    // Step 1: Verify signature (HMAC-SHA256, not ed25519)
    const adapter = new StripeAdapter(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);
    const event = await adapter.verifyWebhook(req);

    if (!event) {
      console.warn('Invalid Stripe webhook signature');
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        { status: 401 }
      );
    }

    // Step 2: Dedupe (insert-or-ignore)
    const eventId = event.id;
    const result = await env.LEDGER.query(
      `INSERT INTO webhook_events (provider, event_id, received_at)
       VALUES ($1, $2, now())
       ON CONFLICT DO NOTHING`,
      ['stripe', eventId]
    );

    if (result.rowCount === 0) {
      // Duplicate delivery; return 200 (idempotent)
      console.log(`Duplicate Stripe webhook: ${eventId}`);
      return new Response(JSON.stringify({ status: 'deduped' }), { status: 200 });
    }

    // Step 3: Parse event
    const parsed = adapter.parseEvent(event);
    if (!parsed) {
      console.log(`Unhandled Stripe event type: ${event.type}`);
      return new Response(JSON.stringify({ status: 'ignored' }), { status: 200 });
    }

    // Step 4: Process payment
    const charge = event.data.object;
    const userId = charge.metadata?.user_id;
    const plan = charge.metadata?.plan;

    if (!userId) {
      console.warn(`Stripe charge missing user_id: ${eventId}`);
      return new Response(JSON.stringify({ error: 'Missing user_id' }), { status: 400 });
    }

    if (parsed.type === 'grant') {
      const gm = new GrantManager(env.LEDGER);

      if (parsed.reason === 'grant:cycle' && plan) {
        // Monthly plan renewal
        await gm.grantPlanCycle(userId, plan as 'starter' | 'plus' | 'ultra');
        console.log(`Granted ${plan} plan credits to user ${userId}`);
      } else if (parsed.reason === 'grant:topup') {
        // One-time top-up
        await gm.grantTopup(userId, parsed.credits || 0);
        console.log(`Granted ${parsed.credits} topup credits to user ${userId}`);
      }
    } else if (parsed.type === 'failed') {
      console.warn(`Stripe payment failed for user ${userId}: ${charge.failure_message}`);
      // TODO: Send alert to Slack or Sentry
    }

    // Step 5: Return 200 immediately
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  } catch (error) {
    console.error('Stripe webhook processing error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500 }
    );
  }
}
