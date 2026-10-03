import { rpc } from '../../packages/db/supabase-client.js';
import { markProcessed } from '../providerCompletion.js';
import { verifyCreditSubscriptionMetadata, fetchCreditInvoice, creditInvoice, creditPaymentIsSettled } from '../../packages/adapters/stripeCreditSubscriptions.js';
import { cancelSubscriptionNow, invoiceSubscriptionId, invoicePayment, fetchSession, fetchSubscription, interpretSubscription, fetchCharge } from '../../packages/adapters/stripe.js';
import { resendConfig, sendEmail } from '../../packages/adapters/resend.js';

const SOURCE = 'billing:stripe';
const retry = (error) => Response.json({ error }, { status: 503 });
const young = (created) => !Number.isSafeInteger(created) || Date.now() / 1000 - created < 3600;
const occurred = (created) => new Date(Number.isSafeInteger(created) && created > 0 ? created * 1000 : Date.now()).toISOString();

export async function subscriptionAlert({ eventId, subscriptionId, invoiceId, code }, env = process.env) {
  console.error(JSON.stringify({ event: 'subscription.operator_action_required', event_id: eventId,
    subscription_id: subscriptionId, invoice_id: invoiceId, code }));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(eventId)));
  const key = `subscription-${Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  const mail = { ...resendConfig(env), from: env.SUBSCRIPTION_ALERT_FROM || env.VIOLATION_EMAIL_FROM };
  const sent = await sendEmail(mail, { to: env.SUBSCRIPTION_ALERT_EMAIL,
    subject: 'Veyrnox.ai subscription needs operator action', idempotencyKey: key,
    text: `Subscription: ${subscriptionId}\nInvoice: ${invoiceId || 'none'}\nEvent: ${eventId}\nReason: ${code}\n\nReview the Stripe payment and subscription event log. Do not grant credits manually.`,
  });
  return sent.ok;
}

/** Missing 0188 is safe during the default-off deployment, not after activation. */
async function bindingFor(id, cfg) {
  try { return await rpc('read_credit_subscription_binding', { p_stripe_subscription_id: id }, cfg); }
  catch (err) {
    if (process.env.SUBSCRIPTIONS_ENABLED !== 'true' && ['PGRST202', '42883'].includes(err?.body?.code)) return null;
    throw err;
  }
}

/** Returns null for another billing product. A bound row outranks mutable metadata. */
export async function handleCreditSubscriptionEvent(cfg, ctx) {
  const { s, eventId, type, secret, apiKey, expectLiveMode, eventCreated, object } = ctx;
  const signed = await verifyCreditSubscriptionMetadata(s.metadata, secret);
  const binding = await bindingFor(s.id, cfg);
  if (!signed && !binding && s.metadata?.kind !== 'credit_subscription') return null;
  if (!binding && !signed) {
    return await alertAndFinish('unbound_subscription_metadata');
  }
  const scfg = { fetch: fetch.bind(globalThis), apiKey };
  if (type === 'invoice.paid') {
    // The invoice event belongs exclusively to the grant. A separate lifecycle
    // delivery or verified checkout return must have bound the subscription.
    if (!binding) return young(eventCreated) ? retry('subscription_not_bound_yet') : await alertAndFinish('SUBSCRIPTION_NOT_FOUND');
    const invoice = await fetchCreditInvoice(object.id, scfg);
    if (!invoice) return retry('invoice_fetch_failed');
    const payment = creditInvoice(invoice, binding, expectLiveMode);
    if (!payment.ok) return await alertAndFinish(payment.error);
    const settled = await creditPaymentIsSettled(invoice, scfg);
    if (!settled.ok) return settled.retry ? retry(settled.error) : await alertAndFinish(settled.error);
    const granted = await rpc('grant_credit_subscription_invoice', {
      p_stripe_subscription_id: s.id, p_invoice_id: payment.invoiceId, p_event_id: eventId,
      p_paid_cents: payment.paidCents, p_period_end: payment.periodEnd, p_occurred_at: occurred(eventCreated),
    }, cfg);
    if (granted?.ok === true) return await finish();
    if (['SUBSCRIPTION_NOT_FOUND', 'SUBSCRIPTION_NOT_READY'].includes(granted?.code) && young(eventCreated)) return retry('subscription_not_ready');
    if (granted?.refused === true || ['SUBSCRIPTION_NOT_FOUND', 'SUBSCRIPTION_NOT_READY', 'EVENT_ID_ALREADY_USED'].includes(granted?.code)) return await alertAndFinish(granted.code);
    return retry('subscription_grant_failed');
  }
  const applied = await rpc('apply_credit_subscription_event', {
    p_event_id: eventId, p_type: type, p_id: signed ? s.metadata.credit_subscription_id : null,
    p_stripe_subscription_id: s.id, p_customer_id: s.customerId, p_status: s.status,
    p_period_end: s.periodEnd, p_cancel_at_period_end: s.cancelAtPeriodEnd, p_occurred_at: occurred(eventCreated),
  }, cfg);
  if (applied?.ok !== true) {
    if (applied?.code === 'SUBSCRIPTION_NOT_FOUND' && young(eventCreated)) return retry('subscription_not_bound_yet');
    if (['SUBSCRIPTION_NOT_FOUND', 'SUBSCRIPTION_MISMATCH', 'INVALID_EVENT', 'INVALID_SUBSCRIPTION'].includes(applied?.code)) return await alertAndFinish(applied.code);
    return retry('subscription_state_failed');
  }
  if (applied.flagged) {
    const stopped = await cancelSubscriptionNow(s.id, scfg);
    if (!stopped.ok) return retry('flagged_cancel_failed');
    return await alertAndFinish('duplicate_paid_subscription');
  }
  return await finish();

  async function finish() {
    await markProcessed(cfg, SOURCE, eventId);
    return Response.json({ ok: true });
  }
  async function alertAndFinish(code) {
    if (!(await subscriptionAlert({ eventId, subscriptionId: s.id, invoiceId: type.startsWith('invoice.') ? object.id : null, code }))) return retry('operator_alert_failed');
    return await finish();
  }
}

/** Reversals use the durable binding, not a metadata hint or payload user id. */
export async function handleCreditSubscriptionCharge(cfg, ctx) {
  const { invoice, object, eventId, type, apiKey, eventCreated, expectLiveMode } = ctx;
  const subscriptionId = invoiceSubscriptionId(invoice);
  const binding = subscriptionId && await bindingFor(subscriptionId, cfg);
  if (!binding) {
    const sub = await fetchSubscription(subscriptionId, { fetch: fetch.bind(globalThis), apiKey });
    if (!sub.ok) return retry('subscription_fetch_failed');
    const ours = await verifyCreditSubscriptionMetadata(sub.subscription.metadata, process.env.STRIPE_WEBHOOK_SECRET);
    if (!ours) return null;
    if (young(eventCreated)) return retry('subscription_not_bound_yet');
    if (!(await subscriptionAlert({ eventId, subscriptionId, invoiceId: invoice.id, code: 'reversal_before_binding' }))) return retry('operator_alert_failed');
    await markProcessed(cfg, SOURCE, eventId);
    return Response.json({ ok: true });
  }
  if (invoice.livemode !== expectLiveMode
      || (typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id) !== binding.stripe_customer_id) return retry('invoice_binding_mismatch');
  if (type === 'charge.dispute.closed') {
    await markProcessed(cfg, SOURCE, eventId);
    return Response.json({ ok: true });
  }
  // Re-read for provenance, but classify from this signed delivery's immutable
  // cumulative amount. A partial event retry must not become a full reversal
  // under an event id already recorded as partial. The later full-refund event
  // has its own id. Partials remain audit-only until their policy is decided.
  let charge = object;
  if (type === 'charge.refunded') {
    const read = await fetchCharge(object.id, { fetch: fetch.bind(globalThis), apiKey });
    if (!read.ok) return retry('charge_fetch_failed');
    charge = read.charge;
    const chargeInvoice = typeof charge.invoice === 'string' ? charge.invoice : charge.invoice?.id;
    const paymentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    const linked = Object.hasOwn(charge, 'invoice') ? chargeInvoice === invoice.id : invoicePayment(invoice)?.paymentIntentId === paymentId;
    if (charge.id !== object.id || !linked || charge.livemode !== expectLiveMode
        || charge.currency !== invoice.currency || (typeof charge.customer === 'string' ? charge.customer : charge.customer?.id) !== binding.stripe_customer_id
        || !Number.isSafeInteger(object.amount) || object.amount <= 0 || charge.amount !== object.amount
        || !Number.isSafeInteger(object.amount_refunded) || object.amount_refunded <= 0 || object.amount_refunded > object.amount
        || !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded <= 0
        || charge.amount_refunded < object.amount_refunded || charge.amount_refunded > charge.amount) return retry('charge_binding_mismatch');
  }
  const reason = type === 'charge.dispute.created' ? 'disputed'
    : object.amount_refunded === object.amount ? 'refunded' : 'partially_refunded';
  const reversed = await rpc('reverse_credit_subscription_invoice', {
    p_stripe_subscription_id: subscriptionId, p_invoice_id: invoice.id, p_event_id: eventId,
    p_reason: reason, p_reference: object.id, p_occurred_at: occurred(eventCreated),
  }, cfg);
  if (reversed?.ok !== true) return retry('subscription_reversal_failed');
  if (reason !== 'partially_refunded') {
    const stopped = await cancelSubscriptionNow(subscriptionId, { fetch: fetch.bind(globalThis), apiKey });
    if (!stopped.ok) return retry('subscription_cancel_failed');
  }
  if (reason === 'partially_refunded' && !(await subscriptionAlert({ eventId, subscriptionId, invoiceId: invoice.id, code: 'partial_refund_policy_pending' }))) return retry('operator_alert_failed');
  await markProcessed(cfg, SOURCE, eventId);
  return Response.json({ ok: true });
}

export async function handleCreditSubscriptionCheckout(cfg, ctx) {
  const { object, apiKey, secret, expectLiveMode } = ctx;
  const scfg = { fetch: fetch.bind(globalThis), apiKey };
  const fetched = await fetchSession(object.id, scfg);
  if (!fetched.ok) return retry('session_fetch_failed');
  const session = fetched.session;
  if (session.mode !== 'subscription' || session.livemode !== expectLiveMode
      || !(await verifyCreditSubscriptionMetadata(session.metadata, secret))) return retry('session_binding_mismatch');
  const id = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  const sub = await fetchSubscription(id, scfg);
  const parsed = sub.ok && interpretSubscription(sub.subscription, { expectLiveMode });
  if (!parsed?.ok) return retry('subscription_fetch_failed');
  // The re-fetched session proves which pending row this subscription belongs to.
  return handleCreditSubscriptionEvent(cfg, { ...ctx, s: { ...parsed.subscription, metadata: session.metadata }, type: 'checkout.session.completed' });
}
