/**
 * Stripe Adapter — Payment Processing & Billing
 * 
 * §5.4 Invariant: HMAC-SHA256 webhook verification (different from ed25519).
 * Never conflate: x-stripe-signature uses HMAC, x-fal-signature-256 uses ed25519.
 * 
 * Plans (from build brief §7):
 * - Starter: 200 credits / $15
 * - Plus: 1000 credits / $39
 * - Ultra: 3000 credits / $99
 * 
 * Top-ups (never expire):
 * - 200 credits / $9
 * - 500 credits / $21
 * - 1200 credits / $45
 */

import crypto from 'crypto';

export interface StripeEvent {
  type: string;
  data: {
    object: any;
  };
}

export interface PaymentSession {
  sessionId: string;
  url: string;
}

export class StripeAdapter {
  private secretKey: string;
  private webhookSecret: string;
  private baseUrl = 'https://api.stripe.com/v1';

  constructor(secretKey: string, webhookSecret: string) {
    this.secretKey = secretKey;
    this.webhookSecret = webhookSecret;
  }

  /**
   * Verify Stripe webhook signature
   * 
   * §5.4 Invariant: HMAC-SHA256, never ed25519
   * 
   * Signature: x-stripe-signature = "t={timestamp},v1={hmac}"
   * Compute: HMAC-SHA256(webhook_secret, "{timestamp}.{body}")
   * Verify: constant-time comparison
   */
  async verifyWebhook(req: Request): Promise<StripeEvent | null> {
    const signature = req.headers.get('x-stripe-signature');
    if (!signature) return null;

    try {
      const body = await req.text();
      const event = JSON.parse(body);

      // Parse signature
      const parts = signature.split(',');
      let timestamp: string = '';
      let providedSignature: string = '';

      for (const part of parts) {
        const [key, value] = part.split('=');
        if (key === 't') timestamp = value;
        if (key === 'v1') providedSignature = value;
      }

      if (!timestamp || !providedSignature) return null;

      // Compute expected signature
      const signedContent = `${timestamp}.${body}`;
      const hmac = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(signedContent)
        .digest('hex');

      // Constant-time comparison (prevent timing attacks)
      if (!constantTimeEqual(hmac, providedSignature)) {
        console.warn('Stripe signature mismatch');
        return null;
      }

      return event;
    } catch (error) {
      console.error('Stripe webhook verification failed:', error);
      return null;
    }
  }

  /**
   * Create Checkout session
   * 
   * Plan mapping:
   * - plan_starter → 200 credits, $15
   * - plan_plus → 1000 credits, $39
   * - plan_ultra → 3000 credits, $99
   */
  async createCheckoutSession(
    userId: string,
    plan: 'starter' | 'plus' | 'ultra'
  ): Promise<PaymentSession> {
    const prices: Record<string, { credits: number; amount: number }> = {
      starter: { credits: 200, amount: 1500 }, // $15.00 in cents
      plus: { credits: 1000, amount: 3900 },   // $39.00
      ultra: { credits: 3000, amount: 9900 },  // $99.00
    };

    const price = prices[plan];
    if (!price) throw new Error(`Unknown plan: ${plan}`);

    const response = await fetch(`${this.baseUrl}/checkout/sessions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'payment_method_types[]': 'card',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': price.amount.toString(),
        'line_items[0][price_data][product_data][name]': `Veyrnox ${plan} plan`,
        'line_items[0][price_data][product_data][metadata][credits]': price.credits.toString(),
        'line_items[0][quantity]': '1',
        'mode': 'payment',
        'success_url': 'https://veyrnox.ai/billing/success',
        'cancel_url': 'https://veyrnox.ai/billing/cancel',
        'client_reference_id': userId,
        'metadata[plan]': plan,
        'metadata[user_id]': userId,
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Stripe API error: ${response.statusText}`);
    }

    const session = await response.json() as any;
    return {
      sessionId: session.id,
      url: session.url,
    };
  }

  /**
   * Parse Stripe event into ledger transaction
   * 
   * charge.succeeded → grant:cycle (plan renewal) or grant:topup
   * charge.failed → refund or alert
   */
  parseEvent(event: StripeEvent): {
    type: 'grant' | 'failed';
    reason: string;
    credits?: number;
    plan?: string;
  } | null {
    if (event.type === 'charge.succeeded') {
      const charge = event.data.object;
      const metadata = charge.metadata || {};
      const plan = metadata.plan || 'unknown';
      const credits = parseInt(metadata.credits || '0');

      return {
        type: 'grant',
        reason: plan.includes('topup') ? 'grant:topup' : 'grant:cycle',
        credits,
        plan,
      };
    }

    if (event.type === 'charge.failed') {
      return {
        type: 'failed',
        reason: 'payment_failed',
      };
    }

    return null;
  }
}

/**
 * Constant-time string comparison (prevent timing attacks)
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  
  let equal = 0;
  for (let i = 0; i < a.length; i++) {
    equal |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return equal === 0;
}
