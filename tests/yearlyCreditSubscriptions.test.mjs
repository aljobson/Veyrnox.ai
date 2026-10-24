import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { fixture } from './helpers/publicSiteRender.mjs';
import { yearlySaving } from '../app/veyrnox/_lib/subscriptionPlans.js';
import { createCreditSubscriptionCheckout, creditInvoice } from '../packages/adapters/stripeCreditSubscriptions.js';
import { subscriptionHandler, SUBSCRIPTION_CONSENT_VERSION, SUBSCRIPTION_CONSENT_VERSION_YEARLY } from '../lib/subscriptions/api.js';

const ID = '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const CALLER_ID = '1b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const NOW = Math.floor(Date.now() / 1000);
const SECRET = 'whsec_credit_subscription_test';
const cfg = { apiKey: 'sk_test_x', signingSecret: SECRET, publicHost: 'https://veyrnox.test', idempotencyKey: 'checkout_test' };
const binding = { id: ID, plan_id: 'starter-yearly', billing_interval: 'year', stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', price_usd_cents: 20520, credits: 398 };
const invoice = (days = 365) => ({ id: 'in_1', object: 'invoice', subscription: 'sub_1', customer: 'cus_1', livemode: false, status: 'paid', currency: 'usd',
  billing_reason: 'subscription_create', amount_paid: 20520, discounts: [], lines: { has_more: false, data: [{ subscription: 'sub_1', quantity: 1,
    amount: 20520, currency: 'usd', proration: false, period: { start: NOW - 60, end: NOW - 60 + days * 86400 },
    price: { unit_amount: 20520, currency: 'usd', recurring: { interval: 'year', interval_count: 1 } }, discount_amounts: [] }] } });
const request = (body, auth = CALLER_ID) => new Request('https://veyrnox.test/api/v1/subscriptions', {
  method: body === undefined ? 'GET' : 'POST', headers: { ...(auth ? { 'x-veyrnox-auth-id': auth } : {}), 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const env = () => Object.assign(process.env, { SUBSCRIPTIONS_ENABLED: 'true', STRIPE_SECRET_KEY: cfg.apiKey,
  STRIPE_WEBHOOK_SECRET: SECRET, PUBLIC_HOST: cfg.publicHost, SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test' });

test('a yearly checkout bills once a year at the yearly price and says credits come monthly', async () => {
  let fields;
  const result = await createCreditSubscriptionCheckout({ subscriptionId: ID, planId: 'starter-yearly', interval: 'year', priceUsdCents: 20520, credits: 398 }, {
    ...cfg, fetch: async (_url, req) => { fields = new URLSearchParams(req.body); return Response.json({ object: 'checkout.session', id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/y' }); },
  });
  assert.equal(result.ok, true);
  assert.equal(fields.get('line_items[0][price_data][recurring][interval]'), 'year');
  assert.equal(fields.get('line_items[0][price_data][unit_amount]'), '20520');
  assert.match(fields.get('line_items[0][price_data][product_data][name]'), /398 Credits each month, billed yearly/);
  assert.equal((await createCreditSubscriptionCheckout({ subscriptionId: ID, planId: 'starter-yearly', interval: 'decade', priceUsdCents: 20520, credits: 398 }, cfg)).ok, false);
});

test('a yearly invoice must cover about a year; a month or two years is refused', () => {
  assert.equal(creditInvoice(invoice(365), binding, false).ok, true);
  assert.equal(creditInvoice(invoice(366), binding, false).ok, true);
  assert.equal(creditInvoice(invoice(30), binding, false).ok, false);
  assert.equal(creditInvoice(invoice(400), binding, false).ok, false);
  assert.equal(creditInvoice(invoice(365), { ...binding, billing_interval: 'month' }, false).ok, false, 'a monthly plan never accepts a yearly period');
});

test('plans lists the yearly plans, and checkout needs the yearly consent version for them', async () => {
  env(); let supplied;
  const rows = [
    { id: 'starter-monthly', billing_interval: 'month', price_usd_cents: 1900, credits: 398 },
    { id: 'starter-yearly', billing_interval: 'year', price_usd_cents: 20520, credits: 398 },
    { id: 'starter-weekly', billing_interval: 'week', price_usd_cents: 499, credits: 60 },
  ];
  const plans = subscriptionHandler({ action: 'plans', authed: false, rpcCall: async () => rows });
  const listed = await (await plans(request(undefined, null))).json();
  assert.deepEqual(listed.plans.map((p) => p.id), ['starter-monthly', 'starter-yearly']);
  assert.equal(listed.consent_version, SUBSCRIPTION_CONSENT_VERSION);
  assert.equal(listed.consent_version_yearly, SUBSCRIPTION_CONSENT_VERSION_YEARLY);

  const start = subscriptionHandler({ action: 'start', rpcCall: async (fn) => fn === 'consume_account_read_request' ? { ok: true }
    : { ok: true, subscription_id: ID, status: 'pending', plan_id: 'starter-yearly', billing_interval: 'year', price_usd_cents: 20520, credits: 398 },
  checkout: async (input) => { supplied = input; return { ok: true, url: 'https://checkout.stripe.com/test' }; } });
  const body = { plan_id: 'starter-yearly', idempotency_key: 'checkout-key-yearly', consent: true };
  const wrong = await start(request({ ...body, consent_version: SUBSCRIPTION_CONSENT_VERSION }));
  assert.equal(wrong.status, 400, 'the monthly consent text does not cover a yearly plan');
  assert.equal((await wrong.json()).consent_version, SUBSCRIPTION_CONSENT_VERSION_YEARLY);
  assert.equal((await start(request({ ...body, consent_version: SUBSCRIPTION_CONSENT_VERSION_YEARLY }))).status, 200);
  assert.deepEqual([supplied.interval, supplied.priceUsdCents, supplied.credits], ['year', 20520, 398]);
});

test('the yearly saving is computed from the plan rows against twelve monthly payments', () => {
  const plans = [{ id: 'starter-monthly', billing_interval: 'month', price_usd_cents: 1900 }, { id: 'starter-yearly', billing_interval: 'year', price_usd_cents: 20520 },
    { id: 'plus-monthly', billing_interval: 'month', price_usd_cents: 5900 }, { id: 'plus-yearly', billing_interval: 'year', price_usd_cents: 60180 }];
  assert.deepEqual(yearlySaving(plans[1], plans), { amountCents: 2280, pct: 10 });
  assert.deepEqual(yearlySaving(plans[3], plans), { amountCents: 10620, pct: 15 });
  assert.equal(yearlySaving(plans[0], plans), null);
  assert.equal(yearlySaving({ id: 'x-yearly', billing_interval: 'year', price_usd_cents: 100 }, plans), null, 'no monthly twin, no claim');
});

test('the plan cards show a Monthly/Yearly choice, the yearly price, a monthly equivalent and the real saving', () => {
  const PLANS = [
    { id: 'starter-monthly', billing_interval: 'month', price_usd_cents: 1900, credits: 398 },
    { id: 'starter-yearly', billing_interval: 'year', price_usd_cents: 20520, credits: 398 },
  ];
  const f = fixture('en', '/pricing');
  const { Plans } = f.load('app/veyrnox/_components/CreditSubscriptions.js');
  const monthly = f.render(React.createElement(Plans, { plans: PLANS, packs: [], publicOnly: true }));
  assert.match(monthly, /aria-pressed="true"[^>]*>Monthly</);
  assert.match(monthly, /\$19 \/ month/);
  assert.doesNotMatch(monthly, /billed yearly/);
  const yearly = f.render(React.createElement(Plans, { plans: PLANS, packs: [], publicOnly: true, initialCadence: 'year' }));
  assert.match(yearly, /\$205\.20 \/ year/);
  assert.match(yearly, /\$17\.10 a month, billed yearly/);
  assert.match(yearly, /Save \$22\.80 a year \(10%\)/);
  assert.match(yearly, /398 Credits a month, granted monthly/);
  assert.doesNotMatch(yearly, /<s[ >]|<del[ >]|line-through/, 'no struck-through list price');
  const onlyMonthly = f.render(React.createElement(Plans, { plans: [PLANS[0]], packs: [], publicOnly: true }));
  assert.doesNotMatch(onlyMonthly, /Yearly/, 'no toggle when there is no yearly plan');
});

test('the hourly sweep is scheduled and the yearly plans stay inactive in this change', () => {
  const sql = readFileSync('packages/db/schema/supabase/0384_yearly_cycle_sweep_cron.sql', 'utf8');
  assert.match(sql, /'veyrnox-grant-yearly-cycles'/);
  assert.match(sql, /'12 \* \* \* \*'/);
  assert.match(sql, /grant_due_yearly_cycles\(\)/);
  assert.doesNotMatch(sql, /UPDATE public\.credit_subscription_plans/i, 'activation is a separate, deliberate step');
});

test('Vey beside the plans: the peek mood keeps the bottom edge clipped and the character cheering over the card', () => {
  const f = fixture('en', '/app/credits');
  const { VeyPaywallBuddy } = f.load('app/veyrnox/_components/VeyPaywallBuddy.jsx');
  const html = f.render(React.createElement(VeyPaywallBuddy, { mood: 'peek' }));
  assert.match(html, /data-testid="paywall-vey"/);
  assert.match(html, /data-mood="peek"/);
  assert.match(html, /data-vey-pose="cheer"/);
  assert.match(html, /clip-path:inset\(-300% -50% 0 -50%\)/, 'only the card edge crops Vey');
  assert.match(html, /aria-hidden="true"/, 'decoration only');
});

test('the subscription plans notify Vey on hover, select, consent, checkout and error, like the credit packs', async () => {
  const src = readFileSync('app/veyrnox/_components/CreditSubscriptions.js', 'utf8');
  for (const event of ['hover', 'leave', 'select', 'consent', 'checkout', 'error']) assert.match(src, new RegExp(`notify\\('${event}'\\)`), event);
  assert.match(src, /<VeyPaywallBuddy mood=\{mood\} \/>/);
});
