import { fetchSubscription, interpretSubscription, invoiceSubscriptionId, invoicePayment, cancelSubscriptionNow } from '../../packages/adapters/stripe.js';

const STRIPE = 'https://api.stripe.com/v1';
const objectId = (v) => typeof v === 'string' ? v : v?.id;
const validId = (v, prefix) => typeof v === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9_]{1,250}$`).test(v);
const unavailable = () => ({ error: 'stripe_unavailable' });
const review = () => ({ error: 'refund_review_required' });

async function request(path, cfg, fields, key) {
  try {
    const res = await cfg.fetch(`${STRIPE}/${path}`, {
      method: fields ? 'POST' : 'GET', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${cfg.apiKey}`, ...(fields ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': key } : {}) },
      ...(fields ? { body: new URLSearchParams(fields).toString() } : {}),
    });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

/**
 * Full refund of the initial invoice of a flagged Pass. The persisted action
 * owns the Stripe key and metadata. Re-read refunds on every retry, including
 * after Stripe's idempotency retention expires or our receipt write fails.
 */
export async function refundFlaggedPass(operation, cfg) {
  const { subscription_id: subscriptionId, customer_id: customerId, action_id: actionId } = operation;
  const live = cfg.apiKey.startsWith('sk_live_');
  const fetched = await fetchSubscription(subscriptionId, cfg);
  if (!fetched.ok) return unavailable();
  let sub = fetched.subscription;
  let parsed = interpretSubscription(sub, { expectLiveMode: live });
  if (!parsed.ok || sub.id !== subscriptionId || parsed.subscription.customerId !== customerId || sub.livemode !== live) return review();
  if (sub.status !== 'canceled') {
    const stopped = await cancelSubscriptionNow(subscriptionId, cfg);
    if (!stopped.ok) return { error: 'cancel_failed' };
    // Cancellation can change latest_invoice. Restart from Stripe's final state.
    const check = await fetchSubscription(subscriptionId, cfg);
    if (!check.ok) return unavailable();
    sub = check.subscription;
    parsed = interpretSubscription(sub, { expectLiveMode: live });
    if (!parsed.ok || sub.id !== subscriptionId || parsed.subscription.customerId !== customerId || sub.livemode !== live) return review();
    if (sub.status !== 'canceled') return { error: 'cancel_failed' };
  }
  const invoiceId = parsed.subscription.latestInvoiceId;
  if (!validId(invoiceId, 'in')) return review();
  const invoice = await request(`invoices/${invoiceId}?expand[]=payments`, cfg);
  if (!invoice) return unavailable();
  const payment = invoicePayment(invoice);
  if (invoice.id !== invoiceId || invoiceSubscriptionId(invoice) !== subscriptionId
      || objectId(invoice.customer) !== customerId || invoice.livemode !== live
      || invoice.status !== 'paid' || invoice.currency !== 'usd' || invoice.billing_reason !== 'subscription_create'
      || !payment || payment.paidCents <= 0 || invoice.payments?.has_more
      || (invoice.payments?.data && invoice.payments.data.length !== 1)) return review();
  const pi = await request(`payment_intents/${payment.paymentIntentId}?expand[]=latest_charge`, cfg);
  if (!pi) return unavailable();
  const charge = pi.latest_charge;
  if (pi.object !== 'payment_intent' || pi.id !== payment.paymentIntentId || pi.livemode !== live
      || pi.status !== 'succeeded' || pi.currency !== 'usd' || objectId(pi.customer) !== customerId
      || pi.amount_received !== payment.paidCents || charge?.object !== 'charge' || !validId(charge.id, 'ch')
      || charge.livemode !== live || charge.currency !== 'usd' || objectId(charge.customer) !== customerId
      || objectId(charge.payment_intent) !== pi.id || charge.paid !== true || charge.captured !== true
      || charge.disputed !== false || charge.amount !== payment.paidCents
      || !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0) return review();
  const refunds = await request(`refunds?charge=${encodeURIComponent(charge.id)}&limit=100`, cfg);
  if (!refunds) return unavailable();
  if (refunds.object !== 'list' || refunds.has_more !== false || !Array.isArray(refunds.data)) return review();
  const own = refunds.data.filter(r => r.metadata?.cinema_operator_action_id === actionId);
  if (own.length > 1) return review();
  if (own.length === 1) return outcome(own[0]);
  // Do not top up a partial/manual refund or retry a failed refund with a new key.
  if (charge.amount_refunded !== 0 || refunds.data.length) return review();
  const refund = await request('refunds', cfg, {
    payment_intent: pi.id, amount: String(payment.paidCents),
    'metadata[cinema_operator_action_id]': actionId,
  }, `cinema_flagged_refund:${actionId}`);
  return refund ? outcome(refund) : unavailable();

  function outcome(refund) {
    if (refund.object !== 'refund' || !validId(refund.id, 're') || refund.amount !== payment.paidCents
        || refund.currency !== 'usd' || objectId(refund.payment_intent) !== pi.id || objectId(refund.charge) !== charge.id
        || refund.metadata?.cinema_operator_action_id !== actionId) return review();
    if (refund.status === 'succeeded') return { ok: true, refundId: refund.id, amountCents: refund.amount };
    if (['pending', 'requires_action'].includes(refund.status)) return { pending: true };
    return { error: 'refund_failed' };
  }
}
