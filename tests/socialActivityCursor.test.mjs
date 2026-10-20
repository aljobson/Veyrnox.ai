import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { runInNewContext } from 'node:vm';
import { encodeActivityCursor, decodeActivityCursor } from '../lib/social/activityCursor.js';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) {
  if(s.endsWith('/veyrnox/_lib/gateway.js')) return {url:'data:text/javascript,export const gatewayFetch=async(path)=>({path})',shortCircuit:true};
  return next(s,c);
}`));
const { listSocialActivity } = await import('../app/lib/socialActivityClient.js');

// Execute the installed adapter's pure URL reconstruction function without
// loading its unrelated build manifests and server dependencies.
const adapter = readFileSync(new URL('../node_modules/@opennextjs/aws/dist/core/routing/util.js', import.meta.url), 'utf8');
const definition = adapter.match(/export function convertToQueryString\(query\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(definition, 'the installed OpenNext query reconstruction function must be exercised');
const convertToQueryString = runInNewContext(`(${definition.replace(/^export /, '')})`, { URLSearchParams });
const adapterRoundTrip = (path) => {
  const initial = new URL(path, 'https://veyrnox.test');
  return new URL(initial.pathname + convertToQueryString(Object.fromEntries(initial.searchParams)), initial.origin);
};
const cursor = { created_at: '2026-10-16T12:34:56.123456+00:00', id: '11111111-1111-4111-8111-111111111111', source: 'inbox' };

test('the Activity client cursor survives the actual OpenNext query reconstruction with exact microseconds', async () => {
  const { path } = await listSocialActivity(50, cursor);
  const token = new URL(path, 'https://veyrnox.test').searchParams.get('cursor');
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  const reconstructed = adapterRoundTrip(path);
  assert.deepEqual(decodeActivityCursor(reconstructed.searchParams.get('cursor')), cursor);
});

test('raw JSON positive offsets reproduce the deployed adapter failure and remain readable for legacy clients', () => {
  const reconstructed = adapterRoundTrip(`/social/activity?cursor=${encodeURIComponent(JSON.stringify(cursor))}`);
  const raw = reconstructed.searchParams.get('cursor');
  assert.equal(JSON.parse(raw).created_at, '2026-10-16T12:34:56.123456 00:00');
  assert.deepEqual(decodeActivityCursor(raw), cursor);
  assert.deepEqual(decodeActivityCursor(JSON.stringify({ ...cursor, created_at: '2026-10-16T12:34:56.123456Z' })), { ...cursor, created_at: '2026-10-16T12:34:56.123456Z' });
});

test('opaque cursors preserve negative offsets, source tie-breakers and UUIDs', () => {
  for (const source of ['publish', 'team', 'inbox', 'approval']) {
    const value = { ...cursor, source, created_at: '2026-10-16T12:34:56.000001-04:00' };
    assert.deepEqual(decodeActivityCursor(encodeActivityCursor(value)), value);
  }
});

test('cursor decoding rejects oversized, malformed and invalid fields', () => {
  for (const value of ['', null, 'x'.repeat(257), '%%%%', 'e30', 'a', JSON.stringify(null), JSON.stringify({ ...cursor, id: 'bad' }), JSON.stringify({ ...cursor, id: [cursor.id] }),
    JSON.stringify({ ...cursor, source: 'private' }), JSON.stringify({ ...cursor, created_at: 'yesterday' }),
    JSON.stringify({ ...cursor, created_at: '2026-10-16T12:34:56.123456 +00:00' }),
    JSON.stringify({ ...cursor, created_at: '2026-10-16T12:34:56.123456+99:99' })]) {
    assert.throws(() => decodeActivityCursor(value), /invalid cursor/);
  }
  assert.throws(() => encodeActivityCursor({ ...cursor, source: 'private' }), /invalid cursor/);
});

test('the first Activity page does not send a cursor', async () => {
  assert.equal((await listSocialActivity()).path, '/social/activity?limit=50');
});
