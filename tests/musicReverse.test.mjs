import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderPcmWavReverse } from '../lib/musicWavRender.js';
import { parseMusicLocalRender } from '../lib/musicEditing.js';
import { musicReverseEnabled } from '../lib/musicBackend.js';

const ID = 'b6ed2d0d-8276-4fbb-9c4f-39f401a3158c';

function wav(samples, channels = 1, rate = 8000) {
  const data = new Int16Array(samples);
  const bytes = new Uint8Array(44 + data.byteLength);
  const view = new DataView(bytes.buffer);
  const ascii = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, 36 + data.byteLength, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2 * channels, true); view.setUint16(32, 2 * channels, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, data.byteLength, true);
  bytes.set(new Uint8Array(data.buffer), 44);
  return bytes;
}
const samples = (bytes) => Array.from(new Int16Array(bytes.buffer.slice(44)));

test('reverse plays the frames backwards and keeps stereo pairs together', () => {
  assert.deepEqual(samples(renderPcmWavReverse(wav([1, 2, 3, 4])).bytes), [4, 3, 2, 1]);
  const stereo = renderPcmWavReverse(wav([1, -1, 2, -2, 3, -3], 2));
  assert.deepEqual(samples(stereo.bytes), [3, -3, 2, -2, 1, -1]);
  assert.equal(stereo.seconds, 3 / 8000);
  assert.equal(renderPcmWavReverse(new Uint8Array(10)).ok, false);
});

test('the render parser takes reverse with no parameters and refuses extras', () => {
  assert.deepEqual(parseMusicLocalRender({ operation: 'reverse', version_id: ID, idempotency_key: 'reverse.0001' }), {
    ok: true, operation: 'reverse', versionId: ID, parameters: {}, idempotencyKey: 'reverse.0001',
  });
  assert.equal(parseMusicLocalRender({ operation: 'reverse', version_id: ID, idempotency_key: 'reverse.0001', speed_ratio: 2 }).error, 'invalid_request');
});

test('Reverse needs editing and its own switch, which ships false; 0534 admits it everywhere it must', async () => {
  const on = { MUSIC_RUNTIME_FLAGS: JSON.stringify({ ui: true, schema: true, library: true, editing: true, reverse: true }) };
  assert.equal(musicReverseEnabled(on), true);
  assert.equal(musicReverseEnabled({ ...on, MUSIC_REVERSE_ENABLED: 'false' }), false);
  const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  // Off in production; on in staging only (owner, 2026-11-15).
  assert.equal((wrangler.match(/\\"reverse\\":false/g) || []).length, 1);
  assert.equal((wrangler.match(/\\"reverse\\":true/g) || []).length, 1);
  const sql = await readFile(new URL('../packages/db/schema/supabase/0534_music_reverse_render.sql', import.meta.url), 'utf8');
  assert.match(sql, /'music-local-reverse'/);
  assert.match(sql, /'remaster','reverse'\)\);/);
  assert.match(sql, /'mashup','sample','reverse'\)\);/);
  assert.equal((sql.match(/p_operation NOT IN \('fade','speed','remaster','reverse'\)/g) || []).length, 2);
  assert.match(sql, /p_parameters IS DISTINCT FROM '\{\}'::jsonb/);
  assert.doesNotMatch(sql, /ledger_|credit_balances/);
  const route = await readFile(new URL('../app/api/v1/music/songs/[id]/render/route.js', import.meta.url), 'utf8');
  assert.match(route, /input\.operation === 'reverse' && !musicReverseEnabled\(\)/);
});
