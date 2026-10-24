import test from 'node:test';
import assert from 'node:assert/strict';
import { paywallReason, LOW_CREDIT_THRESHOLD } from '../app/veyrnox/_lib/paywallPrompt.mjs';

const now = Date.parse('2026-10-17T12:00:00Z');
const base = { credits: 50, createdAt: '2026-10-17T11:00:00Z', seenFirst: false, shownThisSession: false, now };

test('a new account that has not seen the paywall gets it, whatever its balance', () => {
  assert.equal(paywallReason(base), 'first');
});

test('a new account that has seen it is only prompted when low', () => {
  assert.equal(paywallReason({ ...base, seenFirst: true }), null);
  assert.equal(paywallReason({ ...base, seenFirst: true, credits: LOW_CREDIT_THRESHOLD - 1 }), 'low');
});

test('an old account with credits is left alone; an empty one gets the depletion prompt', () => {
  const old = { ...base, createdAt: '2026-01-01T00:00:00Z' };
  assert.equal(paywallReason(old), null);
  assert.equal(paywallReason({ ...old, credits: 0 }), 'depleted');
  assert.equal(paywallReason({ ...old, credits: LOW_CREDIT_THRESHOLD }), null);
});

test('once per sign-in, and never before the balance is known', () => {
  assert.equal(paywallReason({ ...base, shownThisSession: true }), null);
  assert.equal(paywallReason({ ...base, credits: undefined }), null);
});

test('zero balance is a separate repeatable depletion cycle', () => {
  assert.equal(paywallReason({ ...base, credits: 0, shownThisSession: true }), 'depleted');
  assert.equal(paywallReason({ ...base, credits: 0, shownThisSession: true, shownDepletedBalance: true }), null);
  assert.equal(paywallReason({ ...base, credits: 25, shownThisSession: true, shownDepletedBalance: true }), null);
  assert.equal(paywallReason({ ...base, credits: 0, shownThisSession: true, shownDepletedBalance: false }), 'depleted');
});

test('the prompt exposes repeat Top-ups and only advertises subscriptions after public catalog discovery', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../app/veyrnox/_components/PaywallPrompt.js', import.meta.url), 'utf8');
  assert.match(source, /app\.credits\.paywall\.repeat/);
  assert.match(source, /fetch\('\/api\/credit-subscription-plans'/);
  assert.match(source, /subscriptionsOpen &&/);
  assert.match(source, /href="\/app\/credits#credit-subscriptions"/);
});
