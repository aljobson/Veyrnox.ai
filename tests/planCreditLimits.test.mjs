import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('packages/db/schema/supabase/0381_lite_plan_and_plan_credit_limits.sql', 'utf8');
const yearlySql = readFileSync('packages/db/schema/supabase/0383_yearly_credit_subscriptions.sql', 'utf8');
const CAP = 0.01796; // ADR-0037: provider cost one credit may carry at 50% margin
const PLANS = [
  { id: 'lite-monthly', price: 10, credits: 209, yearly: 108 },
  { id: 'starter-monthly', price: 19, credits: 398, yearly: 205.2 },
  { id: 'plus-monthly', price: 59, credits: 1171, yearly: 601.8 },
  { id: 'ultra-monthly', price: 129, credits: 2411, yearly: 1238.4 },
];
const margin = (price, fixed, credits) => (price - price * 0.08 - fixed - credits * CAP) / price;

test('every plan keeps 50 percent in the worst case on monthly and on yearly billing', () => {
  for (const p of PLANS) {
    assert.ok(margin(p.price, 0.3, p.credits) >= 0.5 - 1e-9, `${p.id} monthly`);
    assert.ok(margin(p.yearly / 12, 0.3 / 12, p.credits) >= 0.5 - 1e-9, `${p.id} yearly`);
  }
});

test('every plan costs less per credit than the best Credit Pack rate of 7.5 cents', () => {
  for (const p of PLANS) assert.ok(p.price / p.credits < 0.075, p.id);
});

test('the migration names every plan exactly and asserts both standing checks', () => {
  for (const p of PLANS) assert.match(sql, new RegExp(`'${p.id}'`));
  for (const credits of [209, 398, 1171]) assert.match(sql, new RegExp(`\\b${credits}\\b`));
  assert.equal((sql.match(/IF affected <> 1 THEN/g) || []).length, 4);
  assert.match(sql, /credits::bigint \* 1796 > 420::bigint \* price_usd_cents - 30000/);
  assert.match(sql, /price_usd_cents::bigint \* 2 >= credits::bigint \* 15/);
});

test('the yearly migration sets Ultra to 2411 on both plans, the most that keeps 50 percent', () => {
  assert.equal(Math.floor((0.42 * (1238.4 / 12) - 0.3 / 12) / CAP), 2411);
  assert.match(yearlySql, /'ultra-yearly', 123840, 2411/);
  assert.match(yearlySql, /credits = 2411[\s\S]*'ultra-monthly'/);
  assert.match(yearlySql, /credits::bigint \* 1796 \* 12 > 420::bigint \* price_usd_cents - 30000/);
});
