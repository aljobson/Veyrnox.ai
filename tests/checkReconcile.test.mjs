import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchStatus } from '../scripts/check-reconcile.mjs';

const FOUR = { balance_drift: 0, free_credit_drift: 0, top_up_drift: 0, failed_refund_drift: 0 };
const cfg = { url: 'https://example.invalid', key: 'k' };

async function withRow(row, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([row]), { status: 200, headers: { 'content-type': 'application/json' } });
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test('the watcher reads all five counts', async () => {
  const status = await withRow({ ...FOUR, subscription_credit_drift: 2 }, () => fetchStatus(cfg));
  assert.deepEqual(status, { ...FOUR, subscription_credit_drift: 2 });
});

test('0185 is applied, so a missing fifth count fails instead of reading as absent', async () => {
  await assert.rejects(withRow(FOUR, () => fetchStatus(cfg)), /subscription_credit_drift was not a count/);
});

test('a missing or malformed count fails', async () => {
  const { balance_drift, ...rest } = FOUR;
  await assert.rejects(withRow(rest, () => fetchStatus(cfg)), /balance_drift was not a count/);
  await assert.rejects(withRow({ ...FOUR, subscription_credit_drift: null }, () => fetchStatus(cfg)), /subscription_credit_drift was not a count/);
  await assert.rejects(withRow({ ...FOUR, subscription_credit_drift: -1 }, () => fetchStatus(cfg)), /not a count/);
});
