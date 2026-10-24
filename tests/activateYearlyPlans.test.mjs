import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('packages/db/schema/supabase/0385_activate_yearly_plans.sql', 'utf8');

test('the activation names every yearly plan exactly and asserts one row each and four active', () => {
  for (const [id, price, credits] of [['lite-yearly', 10800, 209], ['starter-yearly', 20520, 398], ['plus-yearly', 60180, 1171], ['ultra-yearly', 123840, 2411]]) {
    assert.match(sql, new RegExp(`\\('${id}', ${price}, ${credits}\\)`));
  }
  assert.match(sql, /IF affected <> 1 THEN/);
  assert.match(sql, /<> 4 THEN/);
  assert.match(sql, /grant_due_yearly_cycles/, 'the sweep must exist before a yearly plan can be bought');
});

test('activating yearly plans does not open sales: that stays behind SUBSCRIPTIONS_ENABLED', () => {
  assert.doesNotMatch(sql, /SUBSCRIPTIONS_ENABLED\s*=/);
  assert.match(sql, /SUBSCRIPTIONS_ENABLED/);
});
