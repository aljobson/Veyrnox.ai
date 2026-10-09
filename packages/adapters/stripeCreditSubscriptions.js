import { TAX_CODE, invoiceSubscriptionId, invoicePayment } from './stripe.js';

const BASE = 'https://api.stripe.com/v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const enc = (s) => new TextEncoder().encode(s);
const objectId = (v) => typeof v === 'string' ? v : v?.id;

async function signingKey(secret, usage) {
  return crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export async function verifyCreditSubscriptionMetadata(metadata, secret) {
  const id = metadata?.credit_subscription_id, sig = metadata?.credit_subscription_sig;
  if (!secret || metadata?.kind !== 'credit_subscription' || !UUID.test(id || '') || !/^[0-9a-f]{64}$/.test(sig || '')) return false;
  const bytes = Uint8Array.from(sig.match(/../g), (b) => parseInt(b, 16));
  return crypto.subtle.verify('HMAC', await signingKey(secret, 'verify'), bytes, enc(`credit_subscription:${id}`));
}

/** Plain fetch, constant host, bounded lifetime; no Stripe SDK on the SSR graph. */
export async function creditStripeRequest(path, cfg, fields, key) {
  try {
    const body = fields && new URLSearchParams(Object.entries(fields).filter(([, v]) => v !== undefined));
    const res = await cfg.fetch(`${BASE}/${path}`, {
      method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${cfg.apiKey}`, ...(body ? {
        'Content-Type': 'application/x-www-form-urlencoded', ...(key ? { 'Idempotency-Key': key } : {}),
      } : {}) }, ...(body ? { body: body.toString() } : {}),
    });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

export async function createCreditSubscriptionCheckout(input, cfg) {
  if (!UUID.test(input.subscriptionId || '') || !/^[a-z0-9-]{1,32}$/.test(input.planId || '')
      || input.interval !== 'month' || !Number.isSafeInteger(input.priceUsdCents) || input.priceUsdCents < 100
      || input.priceUsdCents > 9999999 || !Number.isSafeInteger(input.credits) || input.credits <= 0
      || input.credits > 100000 || !cfg.signingSecret) return { ok: false, error: 'invalid_checkout' };
  let host;
  try { host = new URL(cfg.publicHost); } catch { return { ok: false, error: 'invalid_host' }; }
  if (host.protocol !== 'https:' || host.username || host.password) return { ok: false, error: 'invalid_host' };
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(cfg.signingSecret, 'sign'), enc(`credit_subscription:${input.subscriptionId}`)));
  const sig = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const metadata = { kind: 'credit_subscription', credit_subscription_id: input.subscriptionId, credit_subscription_sig: sig };
  const fields = {
    mode: 'subscription', client_reference_id: input.subscriptionId,
    'line_items[0][quantity]': 1, 'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': input.priceUsdCents,
    'line_items[0][price_data][recurring][interval]': 'month',
    'line_items[0][price_data][recurring][interval_count]': 1,
    'line_items[0][price_data][product_data][name]': `Veyrnox ${input.planId} (${input.credits} Credits per month)`,
    'line_items[0][price_data][product_data][tax_code]': TAX_CODE,
    'automatic_tax[enabled]': cfg.automaticTax === false ? 'false' : 'true',
    allow_promotion_codes: 'false', customer_email: input.email, expires_at: input.expiresAt,
    success_url: `${new URL('/app/credits', host)}?subscription=${input.subscriptionId}&checkout=done&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${new URL('/app/credits', host)}?subscription=${input.subscriptionId}&checkout=cancelled`,
  };
  for (const [k, v] of Object.entries(metadata)) {
    fields[`metadata[${k}]`] = v;
    fields[`subscription_data[metadata][${k}]`] = v;
  }
  const data = await creditStripeRequest('checkout/sessions', cfg, fields, cfg.idempotencyKey);
  let url;
  try { url = new URL(data?.url); } catch { /* Refuse unusable vendor links. */ }
  if (data?.object !== 'checkout.session' || !/^cs_[A-Za-z0-9_]{1,251}$/.test(data.id || '')
      || url?.protocol !== 'https:' || url.username || url.password
      || !(url.hostname === 'stripe.com' || url.hostname.endsWith('.stripe.com'))) return { ok: false, error: 'checkout_failed' };
  return { ok: true, sessionId: data.id, url: data.url };
}

export function creditInvoice(invoice, binding, expectLiveMode, nowSeconds = Math.floor(Date.now() / 1000)) {
  const lines = invoice?.lines;
  const line = lines?.data?.[0];
  const subId = invoiceSubscriptionId(invoice);
  const detail = line?.parent?.subscription_item_details;
  const lineSubId = objectId(line?.subscription) || objectId(detail?.subscription);
  const price = line?.price;
  const period = line?.period;
  // This slice accepts a normal full monthly cycle only. Plan changes need
  // the reviewed database extension before they can grant another allotment.
  if (!binding || invoice?.object !== 'invoice' || !/^in_[A-Za-z0-9_]{1,97}$/.test(invoice.id || '')
      || invoice.livemode !== expectLiveMode || invoice.status !== 'paid' || invoice.currency !== 'usd'
      || subId !== binding.stripe_subscription_id || objectId(invoice.customer) !== binding.stripe_customer_id
      || !['subscription_create', 'subscription_cycle'].includes(invoice.billing_reason)
      || !Number.isSafeInteger(invoice.amount_paid) || invoice.amount_paid < binding.price_usd_cents
      || !lines || lines.has_more !== false || !Array.isArray(lines.data) || lines.data.length !== 1
      || lineSubId !== subId || line.quantity !== 1 || line.amount !== binding.price_usd_cents
      || line.currency !== 'usd' || line.proration === true || detail?.proration === true
      || (price && (price.currency !== 'usd' || price.unit_amount !== binding.price_usd_cents
        || price.recurring?.interval !== 'month' || price.recurring?.interval_count !== 1))
      || (invoice.discounts?.length || line.discount_amounts?.some((d) => d.amount > 0))
      || !Number.isSafeInteger(period?.start) || !Number.isSafeInteger(period?.end)
      || period.start <= 0 || period.end <= period.start || period.end - period.start > 32 * 86400
      || period.end - period.start < 27 * 86400 || period.start > nowSeconds + 300
      || period.end > nowSeconds + 32 * 86400 + 300) return { ok: false, error: 'invoice_review_required' };
  return { ok: true, invoiceId: invoice.id, subscriptionId: subId, paidCents: invoice.amount_paid,
    periodEnd: new Date(period.end * 1000).toISOString() };
}

export async function fetchCreditInvoice(id, cfg) {
  if (!/^in_[A-Za-z0-9_]{1,97}$/.test(id || '')) return null;
  const invoice = await creditStripeRequest(`invoices/${id}?expand[]=payments`, cfg);
  return invoice?.object === 'invoice' && invoice.id === id ? invoice : null;
}

/** A paid invoice remains 'paid' after a refund. Refetch its charge before
 * granting, so a reversal that beat the binding cannot be lost as an orphan.
 */
export async function creditPaymentIsSettled(invoice, cfg) {
  const p = invoicePayment(invoice), live = cfg.apiKey.startsWith('sk_live_');
  if (!p || p.paidCents <= 0 || invoice.payments?.has_more
      || (invoice.payments?.data && invoice.payments.data.length !== 1)) return { ok: false, error: 'payment_review_required' };
  const pi = await creditStripeRequest(`payment_intents/${p.paymentIntentId}?expand[]=latest_charge`, cfg);
  if (!pi) return { ok: false, error: 'payment_fetch_failed', retry: true };
  const c = pi.latest_charge;
  if (pi.object !== 'payment_intent' || pi.id !== p.paymentIntentId || pi.livemode !== live || pi.status !== 'succeeded'
      || pi.currency !== 'usd' || pi.amount_received !== p.paidCents || objectId(pi.customer) !== objectId(invoice.customer)
      || c?.object !== 'charge' || !/^ch_[A-Za-z0-9_]{1,250}$/.test(c.id || '') || c.livemode !== live
      || c.currency !== 'usd' || objectId(c.customer) !== objectId(invoice.customer) || objectId(c.payment_intent) !== pi.id
      || c.paid !== true || c.captured !== true || c.disputed !== false || c.amount !== p.paidCents
      || c.amount_refunded !== 0) return { ok: false, error: 'payment_review_required' };
  return { ok: true };
}

/** Current Stripe charges omit invoice; Invoice Payments supplies the link.
 * A legacy invoice:null is explicitly a non-invoice charge. A failed or
 * ambiguous lookup must retry, never silently lose a subscription reversal.
 */
export async function invoiceForCharge(charge, cfg) {
  if (Object.hasOwn(charge, 'invoice')) {
    const id = objectId(charge.invoice);
    if (id && !/^in_[A-Za-z0-9_]{1,97}$/.test(id)) throw new Error('Invalid charge invoice');
    return id || null;
  }
  const pi = objectId(charge.payment_intent);
  if (!/^pi_[A-Za-z0-9_]{1,250}$/.test(pi || '')) return null;
  const query = new URLSearchParams({ 'payment[type]': 'payment_intent', 'payment[payment_intent]': pi, limit: '2' });
  const payments = await creditStripeRequest(`invoice_payments?${query}`, cfg);
  if (payments?.object !== 'list' || payments.has_more !== false || !Array.isArray(payments.data)
      || payments.data.length > 1) throw new Error('Invoice payment lookup unavailable or ambiguous');
  if (!payments.data.length) return null;
  const p = payments.data[0], id = objectId(p.invoice);
  if (p.object !== 'invoice_payment' || p.payment?.type !== 'payment_intent' || objectId(p.payment.payment_intent) !== pi
      || p.livemode !== charge.livemode || !/^in_[A-Za-z0-9_]{1,97}$/.test(id || '')) throw new Error('Invoice payment mismatch');
  return id;
}
