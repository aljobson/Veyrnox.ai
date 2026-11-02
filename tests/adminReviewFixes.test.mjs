import test from 'node:test';
import assert from 'node:assert/strict';
import { changesQuery } from '../lib/adminChangesQuery.js';
import { cinemaRuntimeGate, CINEMA_ADMISSIONS, prepareRuntimeAdmission } from '../lib/runtimeAdmission.js';

test('a changes range that differs only below a millisecond is accepted, and an equal or reversed one is refused', () => {
  const q = (from, to) => changesQuery(new URLSearchParams({ from, to }));
  assert.equal(q('2026-11-01T12:00:00.123455Z', '2026-11-01T12:00:00.123456Z').error, undefined);
  assert.equal(q('2026-11-01T12:00:00.123456Z', '2026-11-01T12:00:00.123456Z').error, 'filters_invalid');
  assert.equal(q('2026-11-01T12:00:00.123456Z', '2026-11-01T12:00:00.123455Z').error, 'filters_invalid');
  assert.equal(q('2026-11-01T12:00:00Z', '2026-11-01T12:00:00.000001Z').error, undefined);
});

test('the Worker gate leaves the shared comments POST alone so withdrawing and reporting stay available', async () => {
  assert.equal(CINEMA_ADMISSIONS.includes('comments'), false);
  const killed = async () => true;
  const res = await cinemaRuntimeGate(new Request('https://test/api/v1/cinema/comments', { method: 'POST' }), {}, killed);
  assert.equal(res, null);
});

test('comments still trigger the switch refresh so the handler sees a current value', () => {
  let refreshed = 0;
  prepareRuntimeAdmission(new Request('https://test/api/v1/cinema/comments', { method: 'POST' }), {}, null, () => { refreshed++; return Promise.resolve(); });
  assert.equal(refreshed, 1);
});

test('the comments handler pauses only a new submission', async () => {
  const text = (await import('node:fs')).readFileSync(new URL('../lib/cinema/commentsApi.js', import.meta.url), 'utf8');
  assert.match(text, /action === 'mutate' && body\.action === 'submit' && isFeatureKilled\('cinema'\)/);
});
