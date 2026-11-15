import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('packages/db/schema/supabase/0539_uniform_yearly_discount_plan_credits.sql', 'utf8');
const CAP = 0.01796; // ADR-0037: provider cost one credit may carry at 50% margin
// One set of figures on web, iOS and Android (owner, 2026-11-15).
const PLANS = [
  { family: 'lite', monthly: 10, yearly: 96.99, exact: 96, credits: 157 },
  { family: 'starter', monthly: 19, yearly: 182.99, exact: 182.4, credits: 297 },
  { family: 'plus', monthly: 59, yearly: 569, exact: 566.4, credits: 924 },
  { family: 'ultra', monthly: 129, yearly: 1238.4, exact: 1238.4, credits: 2011 },
];
const webMargin = (price, fixed, credits) => (price - price * 0.08 - fixed - credits * CAP) / price;
const storeMargin = (price, credits) => (price * 0.85 - credits * CAP) / price;

test('each yearly price is the exact 20 percent price rounded up to the next store point, under 1 percent above it', () => {
  for (const p of PLANS) {
    assert.equal(Math.round(p.exact * 100), Math.round(p.monthly * 12 * 0.8 * 100), p.family);
    assert.ok(p.yearly >= p.exact && p.yearly < p.monthly * 12 * 0.81, p.family);
  }
});

test('every plan keeps 50 percent in the worst case on the web, monthly and yearly', () => {
  for (const p of PLANS) {
    assert.ok(webMargin(p.monthly, 0.3, p.credits) >= 0.5 - 1e-9, `${p.family} monthly`);
    assert.ok(webMargin(p.yearly / 12, 0.3 / 12, p.credits) >= 0.5 - 1e-9, `${p.family} yearly`);
  }
});

test('every plan keeps 50 percent after the 15 percent store fee, monthly and yearly, at the same credits', () => {
  for (const p of PLANS) {
    assert.ok(storeMargin(p.monthly, p.credits) >= 0.5, `${p.family} store monthly`);
    assert.ok(storeMargin(p.yearly / 12, p.credits) >= 0.5 - 1e-4, `${p.family} store yearly`);
  }
});

test('the credits are the most the store yearly price holds at 50 percent', () => {
  for (const p of PLANS) assert.equal(Math.floor((p.yearly * 0.35) / (12 * CAP)), p.credits, p.family);
});

test('the monthly price per credit does not rise with plan size by more than rounding', () => {
  const rates = PLANS.map((p) => p.monthly / p.credits);
  for (let i = 1; i < rates.length; i += 1) assert.ok(rates[i] <= rates[i - 1] * 1.01, 'flat within 1 percent');
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
  assert.match(sql, /credits::bigint \* 1796 \* 12 > price_usd_cents::bigint \* 350/);
  assert.match(sql, /falls below 50 percent after the 15 percent store fee/);
  assert.match(sql, /20 percent off twelve monthly payments/);
  assert.doesNotMatch(sql, /credit_packs/);
});
