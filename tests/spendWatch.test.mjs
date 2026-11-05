import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchSpendWatch, exitCodeFor } from '../scripts/check-spend-watch.mjs';

const cfg = { url: 'https://example.invalid', key: 'k' };
async function withReply(reply, run, status = 200) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => Response.json(reply, { status });
  try { return await run(); } finally { globalThis.fetch = real; }
}

test('a quiet verdict reads as ok and exits 0', async () => {
  const v = await withReply({ ok: true, level: 'ok', scope: 'none', admission_open: true }, () => fetchSpendWatch(cfg));
  assert.deepEqual(v, { level: 'ok', scope: 'none', admissionOpen: true });
  assert.equal(exitCodeFor(v), 0);
});
test('warn, critical and a closed admission all exit 1', async () => {
  for (const [level, open] of [['warn', true], ['critical', true], ['ok', false]]) {
    const v = await withReply({ ok: true, level, scope: 'provider', admission_open: open }, () => fetchSpendWatch(cfg));
    assert.equal(exitCodeFor(v), 1, `${level}/${open}`);
  }
});
test('an unreadable or malformed answer throws, never passes', async () => {
  await assert.rejects(withReply({}, () => fetchSpendWatch(cfg), 404), /answered 404/);
  await assert.rejects(withReply({ ok: false, code: 'POLICY_MISSING' }, () => fetchSpendWatch(cfg)), /POLICY_MISSING/);
  for (const bad of [{ level: 'fine' }, { scope: 'everything' }, { admission_open: 'yes' }]) {
    await assert.rejects(withReply({ ok: true, level: 'ok', scope: 'none', admission_open: true, ...bad }, () => fetchSpendWatch(cfg)), /unexpected shape/);
  }
});
test('the workflow is main-only, secret-free and files issues only for a real warning', async () => {
  const wf = await readFile(new URL('../.github/workflows/spend-watch.yml', import.meta.url), 'utf8');
  assert.match(wf, /github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(wf, /secrets\./);
  assert.match(wf, /needs\.check\.outputs\.exit == '1'/);
  assert.match(wf, /SPEND_WATCH_ENABLED != 'false'/);
});
