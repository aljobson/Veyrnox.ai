import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchStatus } from '../scripts/check-reconcile.mjs';

const FIVE = { balance_drift: 0, free_credit_drift: 0, top_up_drift: 0,
  failed_refund_drift: 0, subscription_credit_drift: 0 };
const SEVEN = { ...FIVE, free_allowance_drift: 0, referral_drift: 0 };
const cfg = { url: 'https://example.invalid', key: 'k' };
const expansion = '0264_reconciliation_free_allowance_referrals';
async function withRow(row, fn, ledger = []) {
  const real = globalThis.fetch;
  globalThis.fetch = async url => Response.json(String(url).endsWith('applied_migration_names') ? ledger.map(name => ({ name })) : [row]);
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test('the watcher reads all seven measured counts including new drift', async () => {
  const measured = { ...SEVEN, free_allowance_drift: 2, referral_drift: 1 };
  assert.deepEqual(await withRow(measured, () => fetchStatus(cfg)), measured);
});
test('five existing counts stay required even before the expansion applies', async () => {
  for (const key of Object.keys(FIVE)) {
    const incomplete = { ...FIVE }; delete incomplete[key];
    await assert.rejects(withRow(incomplete, () => fetchStatus(cfg)), /was not a count/);
  }
});
test('new counts are explicitly unmeasured only while the receipt is actually absent', async () => {
  assert.deepEqual(await withRow(FIVE, () => fetchStatus(cfg)), { ...FIVE, free_allowance_drift: null, referral_drift: null });
  for (const name of [expansion, expansion.slice(5)]) {
    await assert.rejects(withRow(FIVE, () => fetchStatus(cfg), [name]), /free_allowance_drift was not a count/);
  }
});
test('present malformed counts fail regardless of pending migration or other valid counts', async () => {
  for (const key of Object.keys(SEVEN)) {
    for (const value of [null, -1, 1.5, '0']) {
      await assert.rejects(withRow({ ...SEVEN, [key]: value }, () => fetchStatus(cfg)), /was not a count/);
    }
  }
});
test('unreadable receipt evidence cannot make absent measurements pass', async t => {
  t.mock.method(globalThis, 'fetch', async url => String(url).endsWith('applied_migration_names')
    ? new Response('private error', { status: 503 }) : Response.json([FIVE]));
  await assert.rejects(fetchStatus(cfg), /ledger RPC answered 503/);
});
