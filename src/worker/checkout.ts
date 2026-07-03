/**
 * Checkout API — Create Payment Sessions
 * 
 * Route: POST /v1/checkout
 * 
 * Body: { plan: 'starter' | 'plus' | 'ultra' | 'topup_200' | 'topup_500' | 'topup_1200' }
 * Response: { sessionId, url } (redirect user to Stripe Checkout)
 */

import { StripeAdapter } from '../../packages/adapters/stripe';

export async function handleCheckout(req: Request, env: any): Promise<Response> {
  try {
    const body = await req.json() as any;
    const { plan } = body;

    // Extract user from auth (Clerk JWT)
    // TODO: Verify auth token, extract user_id
    const userId = 'test-user'; // Placeholder

    if (!plan) {
      return new Response(
        JSON.stringify({ error: 'plan required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const adapter = new StripeAdapter(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);

    let session;
    if (plan === 'starter' || plan === 'plus' || plan === 'ultra') {
      // Monthly plan
      session = await adapter.createCheckoutSession(userId, plan);
    } else if (plan.startsWith('topup_')) {
      // One-time top-up
      // TODO: Implement topup session creation (different flow in Stripe)
      return new Response(
        JSON.stringify({ error: 'topup checkout not yet implemented' }),
        { status: 501, headers: { 'Content-Type': 'application/json' } }
      );
    } else {
      return new Response(
        JSON.stringify({ error: `unknown plan: ${plan}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify(session), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
