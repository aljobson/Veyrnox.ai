import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  bestPackUnitPrice,
  subscriptionSavingPercent,
} from '../app/veyrnox/_lib/subscriptionPlans.js';

const packs = [
  { id: 'web-100', credits: 100, price_usd_cents: 1000 },
  { id: 'web-300', credits: 300, price_usd_cents: 2500 },
  { id: 'web-1000', credits: 1000, price_usd_cents: 7500 },
];
const subscriptions = [
  { id: 'starter-monthly', credits: 270, price_usd_cents: 1900 },
  { id: 'plus-monthly', credits: 1200, price_usd_cents: 5900 },
  { id: 'ultra-monthly', credits: 3000, price_usd_cents: 12900 },
];

test('every monthly subscription beats the best one-off pack rate', () => {
  assert.equal(bestPackUnitPrice(packs), 7.5);
  assert.deepEqual(subscriptions.map((plan) => subscriptionSavingPercent(plan, packs)), [6, 34, 43]);
  assert.equal(subscriptionSavingPercent(subscriptions[0], [{ credits: 270, price_usd_cents: 1900 }]), null);
});

test('the catalog migration retires parity packs and guards the final offers', () => {
  const migration = readFileSync(new URL('../packages/db/schema/supabase/0382_restore_subscription_value_separation.sql', import.meta.url), 'utf8');
  assert.match(migration, /SET active = false[\s\S]*id = 'web-160'/);
  assert.match(migration, /SET active = true[\s\S]*id = 'web-300'/);
  assert.match(migration, /web-100:100:1000,web-300:300:2500,web-1000:1000:7500/);
  assert.match(migration, /subscription does not beat the best Credit Pack rate/);
});

test('subscriptions precede packs and expose mascot targets on both pricing surfaces', () => {
  const pricing = readFileSync(new URL('../app/veyrnox/pricing/page.js', import.meta.url), 'utf8');
  const credits = readFileSync(new URL('../app/veyrnox/app/credits/page.js', import.meta.url), 'utf8');
  const subscriptionsUi = readFileSync(new URL('../app/veyrnox/_components/CreditSubscriptions.js', import.meta.url), 'utf8');
  assert.ok(pricing.indexOf('<CreditSubscriptionOffer />') < pricing.indexOf('id="credit-packs"'));
  assert.ok(credits.indexOf('<CreditSubscriptions />') < credits.indexOf('id="credit-packs"'));
  assert.match(subscriptionsUi, /data-assistant-target="pricing\.subscriptions"/);
  assert.match(subscriptionsUi, /data-assistant-target="credits\.subscriptions"/);
});
