import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('packages/db/schema/supabase/0539_uniform_yearly_discount_plan_credits.sql', 'utf8');
const CAP = 0.01796; // ADR-0037: provider cost one credit may carry at 50% margin
const PLANS = [
  { family: 'lite', monthly: 10, yearly: 96.99, exact: 96, credits: 185 },
  { family: 'starter', monthly: 19, yearly: 182.99, exact: 182.4, credits: 354 },
  { family: 'plus', monthly: 59, yearly: 569, exact: 566.4, credits: 1102 },
  { family: 'ultra', monthly: 129, yearly: 1238.4, exact: 1238.4, credits: 2411 },
];
const margin = (price, fixed, credits) => (price - price * 0.08 - fixed - credits * CAP) / price;

test('each yearly price is the exact 20 percent price rounded up to the next store point, under 1 percent of the monthly total above it', () => {
  for (const p of PLANS) {
    assert.equal(Math.round(p.exact * 100), Math.round(p.monthly * 12 * 0.8 * 100), p.family);
    assert.ok(p.yearly >= p.exact && p.yearly < p.monthly * 12 * 0.81, p.family);
  }
});

test('every plan keeps 50 percent in the worst case on monthly and yearly billing', () => {
  for (const p of PLANS) {
    assert.ok(margin(p.monthly, 0.3, p.credits) >= 0.5 - 1e-9, `${p.family} monthly`);
    assert.ok(margin(p.yearly / 12, 0.3 / 12, p.credits) >= 0.5 - 1e-9, `${p.family} yearly`);
  }
});

test('the credits are the most the yearly price holds at 50 percent', () => {
  for (const p of PLANS) assert.equal(Math.floor((0.42 * (p.exact / 12) - 0.3 / 12) / CAP), p.credits, p.family);
});

test('the monthly price per credit does not rise with plan size', () => {
  const rates = PLANS.map((p) => p.monthly / p.credits);
  for (let i = 1; i < rates.length; i += 1) assert.ok(rates[i] <= rates[i - 1] + 1e-9);
});

test('the migration names every plan exactly, asserts one row each and the standing checks', () => {
  for (const p of PLANS) {
    assert.match(sql, new RegExp(`'${p.family}-monthly'`));
    assert.match(sql, new RegExp(`'${p.family}-yearly'`));
    assert.match(sql, new RegExp(`\\b${p.credits}\\b`));
  }
  assert.equal((sql.match(/IF affected <> 1 THEN/g) || []).length, 2);
  assert.match(sql, /credits::bigint \* 1796 \* 12 > 420::bigint \* price_usd_cents - 30000/);
  assert.match(sql, /credits::bigint \* 1796 > 420::bigint \* price_usd_cents - 30000/);
  assert.match(sql, /20 percent off twelve monthly payments/);
  assert.doesNotMatch(sql, /credit_packs/);
});

const storeSql = readFileSync('packages/db/schema/supabase/0542_store_yearly_plans_at_50_percent.sql', 'utf8');
const STORE_YEARLY = [
  { id: 'lite-yearly-store', price: 96.99, credits: 157 },
  { id: 'starter-yearly-store', price: 182.99, credits: 297 },
  { id: 'plus-yearly-store', price: 569, credits: 924 },
  { id: 'ultra-yearly-store', price: 1238.4, credits: 2011 },
];

test('store yearly plans keep 50 percent after the 15 percent store fee and are the most that does', () => {
  for (const p of STORE_YEARLY) {
    assert.ok(p.price * 0.85 - 12 * p.credits * CAP >= p.price * 0.5 - 1e-6, `${p.id} margin`);
    assert.equal(Math.floor((p.price * 0.35) / (12 * CAP)), p.credits, p.id);
  }
});

test('monthly store plans already hold 50 percent at 15 percent', () => {
  for (const p of PLANS) assert.ok(p.monthly * 0.85 - p.credits * CAP >= p.monthly * 0.5, p.family);
});

test('0542 adds the store yearly plans, re-points seven annual products and guards margin and price', () => {
  for (const p of STORE_YEARLY) assert.match(storeSql, new RegExp(`'${p.id}', 'year', ${Math.round(p.price * 100)}, ${p.credits}`));
  assert.match(storeSql, /Apply 0539/);
  assert.match(storeSql, /updated %', affected/);
  assert.match(storeSql, /p\.credits::bigint \* 1796 \* 12 > p\.price_usd_cents::bigint \* 350/);
  assert.match(storeSql, /does not cost the same as the web yearly plan/);
});
