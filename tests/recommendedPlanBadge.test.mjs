import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { isRecommendedPlan } from '../app/veyrnox/_lib/subscriptionPlans.js';

const ids = ['lite', 'starter', 'plus', 'ultra'].flatMap((f) => [`${f}-monthly`, `${f}-yearly`]);

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
