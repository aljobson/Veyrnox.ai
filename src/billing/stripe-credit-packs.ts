import Stripe from 'stripe';
import { Request, Response } from 'express';
import { db } from '../lib/database';
import { logger } from '../lib/logger';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
});

export interface CreditPackConfig {
  id: string;
  name: string;
  credits: number;
  priceCents: number;
}

const CREDIT_PACKS: Record<string, CreditPackConfig> = {
  'pack_small': { id: 'pack_small', name: 'Starter Pack (100 Credits)', credits: 100, priceCents: 1000 },
  'pack_medium': { id: 'pack_medium', name: 'Pro Pack (550 Credits)', credits: 550, priceCents: 5000 },
  'pack_large': { id: 'pack_large', name: 'Enterprise Pack (1200 Credits)', credits: 1200, priceCents: 10000 },
};

export async function createCreditPackCheckoutSession(req: Request, res: Response): Promise<void> {
  try {
    const { packId, userId } = req.body;

    if (!packId || !CREDIT_PACKS[packId]) {
      res.status(400.json({ error: 'Invalid or missing credit pack ID.' }));
      return;
    }

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized user context.' });
      return;
    }

    const pack = CREDIT_PACKS[packId];

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: pack.name,
              metadata: {
                credits: pack.credits.toString(),
                packId: pack.id,
              },
            },
            unit_amount: pack.priceCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      metadata: {
        userId,
        packId: pack.id,
        credits: pack.credits.toString(),
      },
      success_url: `${process.env.APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/billing/cancel`,
    });

    res.status(200).json({ checkoutUrl: session.url });
  } catch (error: any) {
    logger.error('Failed to create Stripe credit pack checkout session', { error: error.message });
    res.status(500).json({ error: 'Internal server error while processing checkout.' });
  }
}

export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || '');
  } catch (err: any) {
    logger.warn('Webhook signature verification failed', { error: err.message });
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;
    const creditsStr = session.metadata?.credits;

    if (!userId || !creditsStr) {
      logger.error('Checkout session completed missing metadata', { sessionId: session.id });
      res.status(400).json({ error: 'Missing required metadata on checkout session.' });
      return;
    }

    const credits = parseInt(creditsStr, 10);

    try {
      await db.transaction(async (trx) => {
        await trx('users')
          .where({ id: userId })
          .increment('credit_balance', credits);

        await trx('credit_transactions').insert({
          user_id: userId,
          amount: credits,
          stripe_session_id: session.id,
          status: 'completed',
          created_at: new Date(),
        });
      });

      logger.info('Successfully credited user account', { userId, credits, sessionId: session.id });
    } catch (dbError: any) {
      logger.error('Database transaction failed during credit pack fulfillment', { error: dbError.message, sessionId: session.id });
      res.status(500).json({ error: 'Fulfillment database error.' });
      return;
    }
  }

  res.status(200).json({ received: true });
}