import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { isRecommendedPlan, saleablePlans, ownedSubscriptionInterval } from '../app/veyrnox/_lib/subscriptionPlans.js';

const ids = ['lite', 'starter', 'plus'].flatMap((f) => [`${f}-monthly`, `${f}-yearly`]);

test('Starter, monthly and yearly, is the only recommended plan', () => {
  assert.deepEqual(ids.filter((id) => isRecommendedPlan({ id })), ['starter-monthly', 'starter-yearly']);
  for (const bad of [null, undefined, {}, { id: 5 }, { id: 'starterpack-monthly' }]) assert.equal(isRecommendedPlan(bad), false);
});

test('the plan card shows the badge from the helper and every locale has the label', () => {
  const card = readFileSync('app/veyrnox/_components/CreditSubscriptions.js', 'utf8');
  assert.match(card, /isRecommendedPlan\(p\) && \([\s\S]{0,400}t\('pricing\.subs\.recommended'\)/);
  const dir = 'lib/i18n/messages';
  const locales = readdirSync(dir).filter((f) => /^[a-z]{2}\.mjs$/.test(f));
  assert.equal(locales.length, 11);
  for (const f of locales) assert.match(readFileSync(`${dir}/${f}`, 'utf8'), /'pricing\.subs\.recommended': '[^']+'/, f);
});

test('stale catalogs hide retired plans and retain Starter recommendation', () => {
  const plans = saleablePlans([...ids, 'ultra-monthly', 'ultra-yearly', 'ultra-weekly'].map(id => ({ id })));
  assert.deepEqual(plans.map(p => p.id), ids);
  assert.deepEqual(plans.filter(isRecommendedPlan).map(p => p.id), ['starter-monthly', 'starter-yearly']);
});

test('owned Ultra yearly uses its interval even without a public catalog row', () => {
  const sub = { plan_id: 'ultra-yearly', price_usd_cents: 123840, billing_interval: 'year' };
  const plans = saleablePlans(ids.map(id => ({ id })));
  const interval = ownedSubscriptionInterval(sub, plans.find(p => p.id === sub.plan_id));
  assert.equal(`${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(sub.price_usd_cents / 100)} / ${interval}`, '$1,238.40 / year');
  assert.equal(ownedSubscriptionInterval({ plan_id: 'ultra-yearly' }), 'year');
});
