import { stripeJsonRequest as request } from './stripeClient.js';
import { TAX_CODE } from './stripe.js';

import { isUuidLoose } from '../../lib/validate.js';
const enc = (value) => new TextEncoder().encode(value);

async function key(secret, usage) {
  return crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

function objectId(value) {
  return typeof value === 'string' ? value : value?.id;
}

export async function verifyPublishPlanMetadata(metadata, secret) {
  const id = metadata?.social_publish_subscription_id;
  const sig = metadata?.social_publish_subscription_sig;
  if (!secret || metadata?.kind !== 'social_publish_plan' || !isUuidLoose(id || '') || !/^[0-9a-f]{64}$/.test(sig || '')) return false;
  const bytes = Uint8Array.from(sig.match(/../g), (part) => parseInt(part, 16));
  return crypto.subtle.verify('HMAC', await key(secret, 'verify'), bytes, enc(`social_publish_subscription:${id}`));
}

export async function createPublishPlanCheckout(input, cfg) {
  if (!isUuidLoose(input.subscriptionId || '') || !/^[a-z0-9-]{1,32}$/.test(input.planId || '')
      || !['week', 'month', 'year'].includes(input.interval) || !Number.isSafeInteger(input.priceUsdCents)
      || input.priceUsdCents < 100 || input.priceUsdCents > 9999999 || !cfg.signingSecret) {
    return { ok: false, error: 'invalid_checkout' };
  }
  let host;
  try { host = new URL(cfg.publicHost); } catch { return { ok: false, error: 'invalid_host' }; }
  if (host.protocol !== 'https:' || host.username || host.password) return { ok: false, error: 'invalid_host' };

  const signature = new Uint8Array(await crypto.subtle.sign(
    'HMAC', await key(cfg.signingSecret, 'sign'), enc(`social_publish_subscription:${input.subscriptionId}`),
  ));
  const sig = Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const metadata = {
    kind: 'social_publish_plan',
    social_publish_subscription_id: input.subscriptionId,
    social_publish_subscription_sig: sig,
  };
  const fields = {
    mode: 'subscription',
    client_reference_id: input.subscriptionId,
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': input.priceUsdCents,
    'line_items[0][price_data][recurring][interval]': input.interval,
    'line_items[0][price_data][recurring][interval_count]': 1,
    'line_items[0][price_data][product_data][name]': 'Veyrnox.ai Publish Plan',
    'line_items[0][price_data][product_data][description]': 'Full social analytics and best-time recommendations',
    'line_items[0][price_data][product_data][tax_code]': TAX_CODE,
    'managed_payments[enabled]': 'true',
    allow_promotion_codes: 'false',
    customer_email: input.email,
    expires_at: input.expiresAt,
    success_url: `${new URL('/app/publish/plan', host)}?subscription=${input.subscriptionId}&checkout=done&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${new URL('/app/publish/plan', host)}?subscription=${input.subscriptionId}&checkout=cancelled`,
  };
  for (const [name, value] of Object.entries(metadata)) {
    fields[`metadata[${name}]`] = value;
    fields[`subscription_data[metadata][${name}]`] = value;
  }
  const data = await request('checkout/sessions', cfg, fields, cfg.idempotencyKey);
  let url;
  try { url = new URL(data?.url); } catch { /* refused below */ }
  if (data?.object !== 'checkout.session' || !/^cs_[A-Za-z0-9_]{1,251}$/.test(data.id || '')
      || url?.protocol !== 'https:' || url.username || url.password
      || !(url.hostname === 'stripe.com' || url.hostname.endsWith('.stripe.com'))) {
    return { ok: false, error: 'checkout_failed' };
  }
  return { ok: true, sessionId: data.id, url: data.url };
}

export function publishPlanInvoiceMatches(invoice, binding, expectLiveMode) {
  const lines = invoice?.lines;
  const line = lines?.data?.[0];
  const subscriptionId = objectId(invoice?.subscription)
    || objectId(invoice?.parent?.subscription_details?.subscription)
    || objectId(line?.subscription)
    || objectId(line?.parent?.subscription_item_details?.subscription);
  return Boolean(binding && invoice?.object === 'invoice' && invoice.livemode === expectLiveMode
    && subscriptionId === binding.stripe_subscription_id
    && objectId(invoice.customer) === binding.stripe_customer_id);
}
