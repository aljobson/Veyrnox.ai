import { cancelSubscriptionNow, invoicePayment, invoiceSubscriptionId, fetchSubscription } from '../../packages/adapters/stripe.js';
import { creditStripeRequest, fetchCreditInvoice } from '../../packages/adapters/stripeCreditSubscriptions.js';

const objectId = (v) => typeof v === 'string' ? v : v?.id;
const review = () => ({ ok: false, error: 'refund_review_required' });

/** The database already removed this cycle's credits and ended the row.
 * Re-read prior refunds even after Stripe's idempotency-key retention ends.
 */
export async function finishCoolingOffRefund({ subscription, invoiceId }, cfg) {
  const sid = subscription.stripe_subscription_id, live = cfg.apiKey.startsWith('sk_live_');
  const invoice = await fetchCreditInvoice(invoiceId, cfg);
  if (!invoice) return { ok: false, error: 'invoice_fetch_failed' };
  const payment = invoicePayment(invoice);
  if (invoiceSubscriptionId(invoice) !== sid || invoice.livemode !== live || invoice.currency !== 'usd'
      || invoice.status !== 'paid' || objectId(invoice.customer) !== subscription.stripe_customer_id
      || invoice.billing_reason !== 'subscription_create' || !payment || payment.paidCents <= 0
      || invoice.payments?.has_more || (invoice.payments?.data && invoice.payments.data.length !== 1)) return review();
  const pi = await creditStripeRequest(`payment_intents/${payment.paymentIntentId}?expand[]=latest_charge`, cfg);
  if (!pi) return { ok: false, error: 'payment_fetch_failed' };
  const charge = pi.latest_charge;
  if (pi.object !== 'payment_intent' || pi.id !== payment.paymentIntentId || pi.livemode !== live
      || pi.status !== 'succeeded' || pi.currency !== 'usd' || objectId(pi.customer) !== subscription.stripe_customer_id
      || pi.amount_received !== payment.paidCents || charge?.object !== 'charge'
      || !/^ch_[A-Za-z0-9_]{1,250}$/.test(charge.id || '') || charge.livemode !== live
      || charge.currency !== 'usd' || objectId(charge.customer) !== subscription.stripe_customer_id
      || objectId(charge.payment_intent) !== pi.id || charge.paid !== true || charge.captured !== true
      || charge.disputed !== false || charge.amount !== payment.paidCents
      || !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0) return review();
  const stop = await cancelSubscriptionNow(sid, cfg);
  if (!stop.ok) return { ok: false, error: 'cancel_failed' };
  const stopped = await fetchSubscription(sid, cfg);
  if (!stopped.ok) return { ok: false, error: 'subscription_fetch_failed' };
  if (stopped.subscription.id !== sid || stopped.subscription.status !== 'canceled'
      || stopped.subscription.livemode !== live || objectId(stopped.subscription.customer) !== subscription.stripe_customer_id) return review();
  const refunds = await creditStripeRequest(`refunds?charge=${encodeURIComponent(charge.id)}&limit=100`, cfg);
  if (!refunds) return { ok: false, error: 'refund_fetch_failed' };
  if (refunds.object !== 'list' || refunds.has_more !== false || !Array.isArray(refunds.data)) return review();
  const own = refunds.data.filter((r) => r.metadata?.credit_subscription_id === subscription.id && r.metadata?.invoice_id === invoiceId);
  if (own.length > 1) return review();
  if (own.length === 1) return outcome(own[0]);
  if (charge.amount_refunded !== 0 || refunds.data.length) return review();
  const refund = await creditStripeRequest('refunds', cfg, {
    payment_intent: pi.id, amount: String(payment.paidCents),
    'metadata[credit_subscription_id]': subscription.id, 'metadata[invoice_id]': invoiceId,
  }, `credit_subscription_refund:${subscription.id}:${invoiceId}`);
  return refund ? outcome(refund) : { ok: false, error: 'refund_failed' };

  function outcome(r) {
    if (r.object !== 'refund' || !/^re_[A-Za-z0-9_]{1,250}$/.test(r.id || '') || r.amount !== payment.paidCents
        || r.currency !== 'usd' || objectId(r.payment_intent) !== pi.id || objectId(r.charge) !== charge.id
        || r.metadata?.credit_subscription_id !== subscription.id || r.metadata?.invoice_id !== invoiceId) return review();
    if (r.status === 'succeeded') return { ok: true, refundId: r.id, amountCents: r.amount };
    if (['pending', 'requires_action'].includes(r.status)) return { ok: true, pending: true, amountCents: r.amount };
    return { ok: false, error: 'refund_failed' };
  }
}
