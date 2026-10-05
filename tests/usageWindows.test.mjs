import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { usageWindows } from '../lib/usageWindows.js';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const ago = (hours) => new Date(NOW - hours * 3_600_000).toISOString();
const route = readFileSync(new URL('../app/api/v1/ledger/usage/route.js', import.meta.url), 'utf8');

test('debits count as spend inside every window they fall in', () => {
  const r = usageWindows([{ delta: -5, reason: 'debit:job', created_at: ago(2) }], NOW);
  assert.deepEqual(r, { day: 5, week: 5, month: 5 });
});

test('older debits drop out of the shorter windows', () => {
  const r = usageWindows([
    { delta: -5, reason: 'debit:a', created_at: ago(2) },
    { delta: -10, reason: 'debit:b', created_at: ago(24 * 3) },
    { delta: -20, reason: 'debit:c', created_at: ago(24 * 20) },
  ], NOW);
  assert.deepEqual(r, { day: 5, week: 15, month: 35 });
});

test('refunds net the spend down and it never goes below zero', () => {
  assert.equal(usageWindows([
    { delta: -8, reason: 'debit:a', created_at: ago(3) },
    { delta: 8, reason: 'refund:a', created_at: ago(2) },
  ], NOW).day, 0);
  assert.equal(usageWindows([{ delta: 8, reason: 'refund:orphan', created_at: ago(1) }], NOW).day, 0);
});

test('grants, top-ups and expiry are not usage', () => {
  const r = usageWindows([
    { delta: 10, reason: 'grant:signup', created_at: ago(1) },
    { delta: 500, reason: 'grant:topup', created_at: ago(1) },
    { delta: -10, reason: 'expire:free', created_at: ago(1) },
  ], NOW);
  assert.deepEqual(r, { day: 0, week: 0, month: 0 });
});

test('bad rows are skipped, not counted', () => {
  const r = usageWindows([
    { delta: 'x', reason: 'debit:a', created_at: ago(1) },
    { delta: -5, reason: 'debit:a', created_at: 'not a date' },
    { delta: -5, reason: 'debit:a', created_at: new Date(NOW + 3_600_000).toISOString() },
    { delta: -5, reason: null, created_at: ago(1) },
  ], NOW);
  assert.deepEqual(r, { day: 0, week: 0, month: 0 });
});

test('the route is signed-in only, read-limited, bounded, and leaks no reasons or errors', () => {
  assert.match(route, /not_authenticated/);
  assert.match(route, /accountReadLimit\(/);
  assert.match(route, /MAX_ROWS/);
  assert.match(route, /encodeURIComponent\(since\)/);
  // Only the totals leave; ledger rows and their reasons never reach the response.
  assert.match(route, /return json\(\{ spent: usageWindows\(rows\.slice\(0, MAX_ROWS\), now\), truncated: rows\.length > MAX_ROWS \}\)/);
  assert.match(route, /usage_unavailable/);
});
