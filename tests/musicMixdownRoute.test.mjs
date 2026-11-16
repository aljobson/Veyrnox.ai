import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}`));
const { POST } = await import('../app/api/v1/music/mixdowns/route.js');
import { parseMusicMixdown } from '../lib/musicMixdown.js';
import { encodeWavChannels } from '../app/veyrnox/_lib/music/beat/beatWav.mjs';
const auth = crypto.randomUUID(), version = crypto.randomUUID(), song = crypto.randomUUID();
const wav = () => new Uint8Array(encodeWavChannels([new Float32Array(480), new Float32Array(480)], 48000));
const hash = b => createHash('sha256').update(b).digest('hex');
const good = () => ({ action: 'reserve', idempotency_key: 'test-mixdown-key', title: '  Night Drive  ', size_bytes: wav().length,
  sha256: hash(wav()), duration_seconds: 0.01, sources: [], has_takes: false, rights_confirmed: false });
Object.assign(process.env, { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
  R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret', R2_BUCKET: 'test',
  MUSIC_RUNTIME_FLAGS: '{"ui":true,"beatEditor":true,"beatLibrarySave":true}' });
const original = globalThis.fetch; test.after(() => { globalThis.fetch = original; });
const req = (body = good(), id = auth) => new Request('http://local/api/v1/music/mixdowns', { method: 'POST',
  headers: { 'x-veyrnox-auth-id': id, 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const commit = { action: 'commit', idempotency_key: 'test-mixdown-key', version_id: version };
const reservation = () => ({ ok: true, song_id: song, version_id: version, status: 'reserved', r2_key: `music-renders/${auth}/${version}.wav`,
  size_bytes: wav().length, sha256: hash(wav()), duration_seconds: 0.01, upload_expires_at: new Date(Date.now() + 900000).toISOString() });
function mock({ bytes = wav(), reserved = reservation(), result = { ok: true, song_id: song, version_id: version }, readFailure = false } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const name = String(url).split('/').at(-1); calls.push({ name, method: init.method, body: init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null });
    if (name === 'consume_social_post_write_request') return Response.json({ ok: true });
    if (name === 'music_reserve_mixdown' || name === 'music_read_mixdown') return Response.json(reserved);
    if (name === 'music_commit_mixdown') return Response.json(result);
    if (name === 'music_abandon_mixdown') return Response.json({ ok: true });
    if (init.method === 'GET') return readFailure ? new Response(null, { status: 503 }) : new Response(bytes);
    assert.fail(`Unexpected upstream ${init.method}`);
  };
  return calls;
}
test('identity and flag gates happen before any upstream request', async () => {
  globalThis.fetch = () => assert.fail('Unexpected network');
  assert.equal((await POST(req(good(), ''))).status, 401);
  process.env.MUSIC_RUNTIME_FLAGS = '{"ui":true,"beatEditor":true}';
  const off = await POST(req()); assert.equal(off.status, 404); assert.equal((await off.json()).error, 'beat_library_save_unavailable');
  process.env.MUSIC_RUNTIME_FLAGS = '{"ui":true,"beatEditor":true,"beatLibrarySave":true}';
});
test('strict parser rejects unknown fields, duplicate sources, malformed values and rights violations', () => {
  assert.equal(parseMusicMixdown(good()).title, 'Night Drive');
  assert.equal(parseMusicMixdown({ ...good(), title: 'Ｎｉｇｈｔ' }).title, 'Night');
  for (const patch of [{ extra: 1 }, { size_bytes: 26214401 }, { size_bytes: 43 }, { sha256: 'A'.repeat(64) }, { sha256: null },
    { duration_seconds: 601 }, { duration_seconds: null }, { title: ' ' }, { idempotency_key: 'tiny' }, { sources: Array(17).fill({ song_id: song, version_id: version }) },
    { sources: [{ song_id: song, version_id: version, x: 1 }] }, { has_takes: true }, { rights_confirmed: true }, { has_takes: 'false' }]) {
    assert.equal(parseMusicMixdown({ ...good(), ...patch }).ok, false, JSON.stringify(patch));
  }
  assert.equal(parseMusicMixdown({ ...good(), sources: [{ song_id: song, version_id: version }, { song_id: song, version_id: version }] }).ok, false);
  assert.equal(parseMusicMixdown({ ...good(), has_takes: true, rights_confirmed: true }).ok, true);
  assert.equal(parseMusicMixdown({ ...commit, title: 'bad' }).ok, false);
});
test('4 KiB request and 25 MiB object limits refuse before reserve', async () => {
  globalThis.fetch = () => assert.fail('Unexpected network');
  assert.equal((await POST(req(' '.repeat(4097)))).status, 413);
  assert.equal((await POST(req({ ...good(), size_bytes: 26214401 }))).status, 400);
});
test('reserve binds hash and size and returns a write-once presigned URL', async () => {
  const calls = mock(); const response = await POST(req()); assert.equal(response.status, 201);
  const body = await response.json(), call = calls.find(c => c.name === 'music_reserve_mixdown').body;
  assert.equal(call.p_sha256, hash(wav())); assert.equal(call.p_title, 'Night Drive'); assert.equal(call.p_size_bytes, wav().length);
  assert.deepEqual(body.headers, { 'Content-Type': 'audio/wav', 'If-None-Match': '*' });
  assert.equal(new URL(body.upload_url).searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host;if-none-match');
  assert.equal(body.r2_key, undefined);
});
test('commit validates and forwards measured immutable bytes', async () => {
  const calls = mock(); const response = await POST(req(commit)); assert.equal(response.status, 201);
  const sent = calls.find(c => c.name === 'music_commit_mixdown').body;
  assert.equal(sent.p_sha256, hash(wav())); assert.equal(sent.p_duration, 0.01); assert.equal(sent.p_size_bytes, wav().length);
  assert.equal(calls.some(c => c.name === 'music_abandon_mixdown'), false);
});
test('size, format, duration and SHA failures abandon exact reservation; never directly delete an object', async () => {
  const other = wav(); other[44] = 1;
  const wrongRate = new Uint8Array(encodeWavChannels([new Float32Array(480), new Float32Array(480)], 44100));
  for (const [bytes, reserved, error] of [[wav().subarray(1), reservation(), 'mixdown_size_mismatch'],
    [new Uint8Array(wav().length + 1), reservation(), 'mixdown_size_mismatch'],
    [wrongRate, reservation(), 'mixdown_format_invalid'],
    [wav(), { ...reservation(), duration_seconds: 1 }, 'mixdown_duration_mismatch'], [other, reservation(), 'mixdown_bytes_mismatch']]) {
    const calls = mock({ bytes, reserved }), response = await POST(req(commit));
    assert.equal((await response.json()).error, error); assert.equal(response.status, 409);
    assert.deepEqual(calls.find(c => c.name === 'music_abandon_mixdown').body,
      { p_auth_id: auth, p_idempotency_key: commit.idempotency_key, p_version_id: version });
    assert.ok(calls.every(c => c.method !== 'DELETE')); assert.ok(!calls.some(c => c.name === 'music_commit_mixdown'));
  }
});
test('committed reserve and commit replays never issue PUT URLs or read/abandon the live object', async () => {
  for (const input of [good(), commit]) {
    const calls = mock({ reserved: { ...reservation(), status: 'committed', idempotent: true } });
    const response = await POST(req(input)), body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.committed, true); assert.equal(body.upload_url, undefined);
    assert.ok(calls.every(c => c.method === 'POST' && c.name !== 'music_abandon_mixdown'));
  }
});
test('permanent transaction refusals abandon; transient storage/RPC failures keep reservation for retry', async () => {
  for (const code of ['ACCOUNT_FROZEN', 'SOURCE_UNAVAILABLE', 'UNEXPECTED_DATABASE_TEXT']) {
    const calls = mock({ result: { ok: false, code } }); const response = await POST(req(commit));
    const body = await response.json(); assert.notEqual(body.error, 'unexpected_database_text');
    assert.equal(calls.some(c => c.name === 'music_abandon_mixdown'), code !== 'UNEXPECTED_DATABASE_TEXT');
  }
  const calls = mock({ readFailure: true }); assert.equal((await POST(req(commit))).status, 502);
  assert.ok(!calls.some(c => c.name === 'music_abandon_mixdown'));
});
test('route uses only middleware identity and no direct deletion', async () => {
  const source = await readFile('app/api/v1/music/mixdowns/route.js', 'utf8');
  assert.deepEqual([...source.matchAll(/headers\.get\('([^']+)'\)/g)].map(m => m[1]), ['x-veyrnox-auth-id']);
  assert.doesNotMatch(source, /deleteObject/);
});
