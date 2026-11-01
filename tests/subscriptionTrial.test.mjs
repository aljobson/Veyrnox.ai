import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { subscriptionTrialDays, SUBSCRIPTION_CONSENT_VERSION_TRIAL, TRIAL_REMINDER_DAYS } from '../lib/subscriptions/trial.js';
import { createCreditSubscriptionCheckout } from '../packages/adapters/stripeCreditSubscriptions.js';
import { subscriptionHandler, SUBSCRIPTION_CONSENT_VERSION } from '../lib/subscriptions/api.js';
import { sendTrialEndingReminder } from '../lib/subscriptions/webhook.js';
import { renderTrialEnding } from '../lib/i18n/email.mjs';
import { hasIntroSteps, STEP_COUNT } from '../app/veyrnox/_lib/hardPaywall.mjs';

const ID = '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const CALLER_ID = '1b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';
const SECRET = 'whsec_trial_test';
const cfg = { apiKey: 'sk_test_x', signingSecret: SECRET, publicHost: 'https://veyrnox.test', idempotencyKey: 'checkout_trial' };
const checkoutInput = { subscriptionId: ID, planId: 'starter-monthly', interval: 'month', priceUsdCents: 1900, credits: 398 };
const request = (body) => new Request('https://veyrnox.test/api/v1/subscriptions', {
  method: body === undefined ? 'GET' : 'POST', headers: { 'x-veyrnox-auth-id': CALLER_ID, 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const withEnv = async (vars, run) => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, { SUBSCRIPTIONS_ENABLED: 'true', STRIPE_SECRET_KEY: cfg.apiKey, STRIPE_WEBHOOK_SECRET: SECRET,
    PUBLIC_HOST: cfg.publicHost, SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test', ...vars });
  try { return await run(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

test('a trial is offered only while SUBSCRIPTION_TRIAL_ENABLED is exactly "true"', () => {
  assert.equal(subscriptionTrialDays({ SUBSCRIPTION_TRIAL_ENABLED: 'true' }), 7);
  for (const value of [undefined, '', 'false', 'TRUE', '1']) assert.equal(subscriptionTrialDays({ SUBSCRIPTION_TRIAL_ENABLED: value }), 0);
});

test('the trial flag is "false" on staging and absent from production vars', () => {
  const text = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const hits = text.match(/^\s*"SUBSCRIPTION_TRIAL_ENABLED":\s*"([^"]*)"/gm) || [];
  assert.equal(hits.length, 1);
  assert.match(hits[0], /"false"$/);
  assert.ok(text.indexOf('"SUBSCRIPTION_TRIAL_ENABLED"') > text.indexOf('"env"'));
});

test('checkout sends trial_period_days only when a trial is asked for, and refuses nonsense', async () => {
  const seen = [];
  const fetch = async (_url, req) => { seen.push(new URLSearchParams(req.body)); return Response.json({ object: 'checkout.session', id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/t' }); };
  assert.equal((await createCreditSubscriptionCheckout({ ...checkoutInput, trialDays: 7 }, { ...cfg, fetch })).ok, true);
  assert.equal(seen[0].get('subscription_data[trial_period_days]'), '7');
  assert.equal((await createCreditSubscriptionCheckout({ ...checkoutInput, trialDays: 0 }, { ...cfg, fetch })).ok, true);
  assert.equal(seen[1].has('subscription_data[trial_period_days]'), false);
  assert.equal((await createCreditSubscriptionCheckout(checkoutInput, { ...cfg, fetch })).ok, true);
  assert.equal(seen[2].has('subscription_data[trial_period_days]'), false);
  for (const trialDays of [-1, 31, 1.5, '7']) assert.equal((await createCreditSubscriptionCheckout({ ...checkoutInput, trialDays }, { ...cfg, fetch })).ok, false, String(trialDays));
});

test('plans reports the trial the server will really give, and checkout then needs the trial consent version', async () => {
  const rows = [{ id: 'starter-monthly', billing_interval: 'month', price_usd_cents: 1900, credits: 398 }];
  const rpcCall = async (fn) => fn === 'consume_account_read_request' ? { ok: true }
    : fn === 'start_credit_subscription' ? { ok: true, status: 'pending', subscription_id: ID, plan_id: 'starter-monthly', billing_interval: 'month', price_usd_cents: 1900, credits: 398 } : rows;
  const body = (consent_version) => ({ plan_id: 'starter-monthly', idempotency_key: 'trial-key-0001', consent: true, consent_version });
  await withEnv({ SUBSCRIPTION_TRIAL_ENABLED: 'true' }, async () => {
    const listed = await (await subscriptionHandler({ action: 'plans', authed: false, rpcCall })(request())).json();
    assert.equal(listed.trial_days, 7);
    assert.equal(listed.consent_version_trial, SUBSCRIPTION_CONSENT_VERSION_TRIAL);
    const start = (consent_version, checkout) => subscriptionHandler({ action: 'start', rpcCall, checkout })(request(body(consent_version)));
    const stale = await start(SUBSCRIPTION_CONSENT_VERSION, async () => assert.fail('no checkout without the trial consent'));
    assert.equal(stale.status, 400);
    assert.equal((await stale.json()).consent_version, SUBSCRIPTION_CONSENT_VERSION_TRIAL);
    let input;
    const ok = await start(SUBSCRIPTION_CONSENT_VERSION_TRIAL, async (i) => { input = i; return { ok: true, url: 'https://checkout.stripe.com/c/pay/t' }; });
    assert.equal(ok.status, 200);
    assert.equal(input.trialDays, 7);
  });
  await withEnv({ SUBSCRIPTION_TRIAL_ENABLED: 'false' }, async () => {
    const listed = await (await subscriptionHandler({ action: 'plans', authed: false, rpcCall })(request())).json();
    assert.equal(listed.trial_days, 0);
    let input;
    const ok = await subscriptionHandler({ action: 'start', rpcCall, checkout: async (i) => { input = i; return { ok: true, url: 'https://checkout.stripe.com/c/pay/t' }; } })(request(body(SUBSCRIPTION_CONSENT_VERSION)));
    assert.equal(ok.status, 200);
    assert.equal(input.trialDays, 0);
  });
});

test('the trial-ending email names the date, the price and how to avoid the charge', () => {
  const { subject, text } = renderTrialEnding({ endsAt: '2026-11-08T10:00:00.000Z', priceUsdCents: 1900, interval: 'month' }, 'en');
  assert.match(subject, /2026-11-08/);
  assert.match(text, /\$19\.00/);
  assert.match(text, /month/);
  assert.match(text, /cancel before 2026-11-08/);
  assert.match(text, /https:\/\/veyrnox\.ai\/app\/credits/);
  assert.equal(TRIAL_REMINDER_DAYS, 3);
  const fr = renderTrialEnding({ endsAt: '2026-11-08T10:00:00.000Z', priceUsdCents: 1900, interval: 'month' }, 'fr');
  assert.match(fr.text, /2026-11-08/);
  assert.match(fr.text, /mois/);
});

test('the reminder is sent once per subscription and a failed send is retried, not dropped', async () => {
  const env = { RESEND_API_KEY: 'resend-fixture', VIOLATION_EMAIL_FROM: 'Veyrnox <support@veyrnox.ai>' };
  const binding = { price_usd_cents: 1900, billing_interval: 'month' };
  const s = { id: 'sub_1', periodEnd: '2026-11-08T10:00:00.000Z', trialing: true };
  const select = async (table) => table === 'credit_subscriptions' ? [{ user_id: CALLER_ID }] : [{ email: 'a@example.com', preferred_locale: null }];
  const sent = [];
  const ok = await sendTrialEndingReminder({}, { binding, s }, env, { select, sendEmail: async (_c, mail) => { sent.push(mail); return { ok: true }; } });
  assert.equal(ok, 'sent');
  assert.equal(sent[0].to, 'a@example.com');
  assert.equal(sent[0].idempotencyKey, 'trial-end-sub_1');
  assert.equal(await sendTrialEndingReminder({}, { binding, s }, env, { select, sendEmail: async () => ({ ok: false, error: 'http_500' }) }), 'failed');
  assert.equal(await sendTrialEndingReminder({}, { binding, s }, {}, { select, sendEmail: async () => assert.fail('sender not configured') }), 'skipped');
  assert.equal(await sendTrialEndingReminder({}, { binding, s }, env, { select: async () => [], sendEmail: async () => assert.fail('no address') }), 'skipped');
});

test('the introduction screens show only while there is a trial and the plans are not yet reached', () => {
  assert.equal(STEP_COUNT, 3);
  assert.equal(hasIntroSteps(7, 1), true);
  assert.equal(hasIntroSteps(7, 2), true);
  assert.equal(hasIntroSteps(7, 3), false);
  for (const days of [0, undefined, -1, 1.5]) assert.equal(hasIntroSteps(days, 1), false, String(days));
});
