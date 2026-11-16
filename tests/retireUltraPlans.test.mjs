import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { subscriptionHandler, subscriptionProjection, SUBSCRIPTION_CONSENT_VERSION, SUBSCRIPTION_CONSENT_VERSION_YEARLY } from '../lib/subscriptions/api.js';

const read = name => readFileSync(`packages/db/schema/supabase/${name}.sql`, 'utf8');
const support = read('0545_store_retirement_support');
// 0546 is held outside the migrations folder so apply-migrations cannot apply it with 0545 (ADR-0346).
const retirement = readFileSync('docs/operations/0546_retire_ultra_plans.sql', 'utf8');
const code = sql => sql.replace(/--[^\n]*/g, '');
const sig = 'TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ';

test('support is inert until the separately staged retirement migration', () => {
  assert.match(support, /ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ/);
  assert.doesNotMatch(code(support), /UPDATE public\.credit_subscription_plans|SET active\s*=\s*false/);
  assert.match(retirement, /SET active = false, retired_at = COALESCE\(retired_at, now\(\)\)/);
  assert.match(retirement, /WHERE id IN \('ultra-monthly', 'ultra-yearly'\);\s*GET DIAGNOSTICS affected = ROW_COUNT;\s*IF affected <> 2 THEN/);
  assert.match(retirement, /WHERE active\) <> 6/);
  for (const sql of [support, retirement]) {
    assert.match(code(sql), /BEGIN;[\s\S]*COMMIT;/);
    assert.doesNotMatch(code(sql), /DELETE FROM public\.(credit_subscription_plans|credit_subscription_store_products)/);
    assert.doesNotMatch(code(sql), /(?:INSERT INTO|UPDATE|DELETE FROM) public\.(ledger_entries|credit_balances)/);
  }
});

test('RPC signature replacement is unambiguous, defaulted and explicitly service-only', () => {
  assert.ok(support.includes(`DROP FUNCTION IF EXISTS public.apply_store_generation_event(${sig});`));
  assert.match(support, /p_purchased_at TIMESTAMPTZ DEFAULT NULL/);
  assert.ok(support.includes(`REVOKE ALL ON FUNCTION public.apply_store_generation_event(${sig}, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;`));
  assert.ok(support.includes(`GRANT EXECUTE ON FUNCTION public.apply_store_generation_event(${sig}, TIMESTAMPTZ) TO service_role;`));
  assert.match(support, /SECURITY DEFINER\s*SET search_path = ''/);
  assert.match(support, /NOTIFY pgrst, 'reload schema'/);
});

test('inactive same-product snapshots survive, new targets require purchased evidence', () => {
  assert.match(support, /NOT \(v_sub\.id IS NOT NULL AND v_plan\.id = v_sub\.plan_id AND v_sub\.status IN/);
  assert.match(support, /p_purchased_at IS NOT NULL\s*AND p_purchased_at < v_plan.retired_at/);
  assert.match(support, /v_sub\.status IN \('active', 'past_due'\)\)/, 'only a live subscription continues without the cutoff');
  assert.match(support, /p_type IN \('initial_purchase', 'initial_purchase_trial', 'renewal'\)/);
  assert.match(support, /v_plan.price_usd_cents := v_sub.price_usd_cents;\s*v_plan.credits := v_sub.credits;/);
  const original = read('0422_starter_credits_on_first_subscription');
  const body = sql => sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.apply_store_generation_event('), sql.indexOf('REVOKE ALL ON FUNCTION public.apply_store_generation_event('));
  // Every line outside the signature and target-plan lookup stays verbatim, including grants/refunds/order checks.
  const normalize = sql => body(sql).replace(',\n    p_purchased_at TIMESTAMPTZ DEFAULT NULL', '')
    .replace(/    IF p_action = 'activate' THEN[\s\S]*?    IF v_sub.id IS NULL THEN/, '    IF v_sub.id IS NULL THEN');
  assert.equal(normalize(support), normalize(original));
});

test('owned projection carries inactive yearly interval and the original snapshot', () => {
  const own = { id: 'own', plan_id: 'ultra-yearly', billing_interval: 'year', price_usd_cents: 123840, credits: 2411 };
  const projected = subscriptionProjection(own);
  for (const [key, value] of Object.entries(own)) assert.equal(projected[key], value);
  assert.match(support, /'billing_interval', \(SELECT p.billing_interval FROM public.credit_subscription_plans p WHERE p.id = v_sub.plan_id\)/);
});

test('public API filters stale Ultra catalog rows and checkout refuses both intervals before RPC', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { SUBSCRIPTIONS_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_fixture', PUBLIC_HOST: 'https://example.invalid', STRIPE_WEBHOOK_SECRET: 'fixture' });
  try {
    const plans = ['lite', 'starter', 'plus', 'ultra'].flatMap(f => ['month', 'year'].map(interval => ({ id: `${f}-${interval}ly`, billing_interval: interval, price_usd_cents: 1000, credits: 157 })));
    const response = await subscriptionHandler({ action: 'plans', authed: false, rpcCall: async () => plans })(new Request('https://example.invalid/api/credit-subscription-plans'));
    const visible = (await response.json()).plans;
    assert.equal(visible.length, 6);
    assert.ok(visible.every(p => !p.id.startsWith('ultra-')));
    for (const [plan_id, consent_version] of [['ultra-monthly', SUBSCRIPTION_CONSENT_VERSION], ['ultra-yearly', SUBSCRIPTION_CONSENT_VERSION_YEARLY]]) {
      let called = false;
      const result = await subscriptionHandler({ action: 'start', rpcCall: async () => { called = true; } })(new Request('https://example.invalid/api/v1/subscriptions', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-veyrnox-auth-id': '11111111-1111-4111-8111-111111111111' },
        body: JSON.stringify({ plan_id, consent_version, consent: true, idempotency_key: 'retired-purchase-test' }),
      }));
      assert.equal(result.status, 400); assert.equal(called, false);
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
