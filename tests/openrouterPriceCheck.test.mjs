import test from 'node:test';
import assert from 'node:assert/strict';
import { OPENROUTER_ROWS, checkOpenRouterRow } from '../lib/openrouterPriceCheck.js';

const row = OPENROUTER_ROWS[0];
const models = (price) => [{ id: 'bytedance/seedance-2.0-fast', pricing_skus: { video_tokens_without_audio: price, video_tokens: '0.0000056' } }];

test('108,000 tokens at $5.60 per million matches the recorded $0.6048', () => {
  assert.deepEqual(checkOpenRouterRow(row, models('0.0000056'), 0.6048), { id: 'seedance-2.0-fast', status: 'ok', observed: 0.6048, recorded: 0.6048, drift: 0 });
});

test('a price move beyond one percent is drift, a small one is not', () => {
  assert.equal(checkOpenRouterRow(row, models('0.0000050'), 0.6048).status, 'drift');
  assert.equal(checkOpenRouterRow(row, models('0.00000561'), 0.6048).status, 'ok');
});

test('a missing model or price is reported, never read as zero drift', () => {
  assert.equal(checkOpenRouterRow(row, [], 0.6048).status, 'missing');
  assert.equal(checkOpenRouterRow(row, models(undefined), 0.6048).status, 'missing');
  assert.equal(checkOpenRouterRow(row, models('0'), 0.6048).status, 'missing');
});

test('the token count matches the adapter\'s priced unit (5 s, 720p)', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../packages/adapters/openrouter.js', import.meta.url), 'utf8');
  assert.match(src, /5 s, 720p, 16:9 — \$0\.6048 at \$5\.60\/M video tokens/);
  assert.equal(Math.round(row.tokens * 0.0000056 * 1e6) / 1e6, 0.6048);
});
