import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  bestPackUnitPrice,
  subscriptionSavingPercent,
} from '../app/veyrnox/_lib/subscriptionPlans.js';

// ADR-0312 (migration 0420) supersedes ADR-0064's 2026-10-24 rule that every plan beats the best
// pack: a web pack is now sold at the best monthly plan's rate, rounded down, and the owner's 50%
// worst-case margin (ADR-0037) holds for every pack.
const packs = [
  { id: 'web-209', credits: 209, price_usd_cents: 1000 },
  { id: 'web-523', credits: 523, price_usd_cents: 2500 },
  { id: 'web-1571', credits: 1571, price_usd_cents: 7500 },
];
const subscriptions = [
  { id: 'lite-monthly', credits: 209, price_usd_cents: 1000 },
  { id: 'starter-monthly', credits: 398, price_usd_cents: 1900 },
  { id: 'plus-monthly', credits: 1171, price_usd_cents: 5900 },
  { id: 'ultra-monthly', credits: 2411, price_usd_cents: 12900 },
];
const yearly = { id: 'starter-yearly', credits: 398 * 12, price_usd_cents: 20900 };

test('monthly plans show no saving against packs at the same rate; yearly still does', () => {
  assert.ok(Math.abs(bestPackUnitPrice(packs) - 7500 / 1571) < 1e-12);
  assert.deepEqual(subscriptions.map((plan) => subscriptionSavingPercent(plan, packs)), [null, null, null, null]);
  assert.equal(subscriptionSavingPercent(yearly, packs), 8);
  assert.equal(subscriptionSavingPercent(subscriptions[0], [{ credits: 270, price_usd_cents: 1900 }]), 32);
});

test('every pack keeps the 50 percent worst-case margin and sits at a monthly plan rate, never below it', () => {
  for (const pack of packs) {
    assert.ok(pack.price_usd_cents * 420 - 30000 >= pack.credits * 1796, `${pack.id} margin`);
    assert.ok(pack.price_usd_cents * 10 >= pack.credits * 43, `${pack.id} sticker floor`);
    const matches = subscriptions.filter((plan) => pack.price_usd_cents * plan.credits >= pack.credits * plan.price_usd_cents
      && pack.price_usd_cents * plan.credits * 100 <= pack.credits * plan.price_usd_cents * 101);
    assert.ok(matches.length > 0, `${pack.id} parity`);
  }
});

test('migration 0420 retires the old packs by shape, adds the parity packs and guards margin and parity', () => {
  const migration = readFileSync(new URL('../packages/db/schema/supabase/0420_packs_match_subscription_rate.sql', import.meta.url), 'utf8');
  for (const shape of ["id = 'web-100' AND credits = 100 AND price_usd_cents = 1000", "id = 'web-300' AND credits = 300 AND price_usd_cents = 2500", "id = 'web-1000' AND credits = 1000 AND price_usd_cents = 7500"]) {
    assert.ok(migration.includes(shape), shape);
  }
  assert.match(migration, /\('web-209', 'web', 209, 1000, true\)/);
  assert.match(migration, /\('web-523', 'web', 523, 2500, true\)/);
  assert.match(migration, /\('web-1571', 'web', 1571, 7500, true\)/);
  assert.match(migration, /web-209:209:1000,web-523:523:2500,web-1571:1571:7500/);
  assert.match(migration, /price_usd_cents::bigint \* 420 - 30000 < credits::bigint \* 1796/);
  assert.match(migration, /not at the monthly subscription rate/);
  assert.equal((migration.match(/GET DIAGNOSTICS affected = ROW_COUNT;/g) || []).length, 2);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.credit_packs/i);
  assert.doesNotMatch(migration, /UPDATE\s+public\.credit_packs\s+SET\s+(credits|price_usd_cents)/i);
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

test('migration 0420 leaves store packs alone', () => {
  const migration = readFileSync(new URL('../packages/db/schema/supabase/0420_packs_match_subscription_rate.sql', import.meta.url), 'utf8');
  const statements = migration.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
  assert.doesNotMatch(statements, /ios|android/i);
});
