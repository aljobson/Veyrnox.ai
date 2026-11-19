import test from 'node:test';
import assert from 'node:assert/strict';
import { GET as list } from '../app/api/v1/music/beat-projects/route.js';
import { GET, PUT, DELETE } from '../app/api/v1/music/beat-projects/[beatId]/route.js';
import { GET as versions } from '../app/api/v1/music/beat-projects/[beatId]/versions/route.js';
import { GET as version } from '../app/api/v1/music/beat-projects/[beatId]/versions/[versionId]/route.js';
import { GET as takes, POST as reserve } from '../app/api/v1/music/beat-projects/[beatId]/takes/route.js';
import { GET as take, POST as confirm } from '../app/api/v1/music/beat-projects/[beatId]/takes/[takeId]/route.js';
import { createBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
const beatId = crypto.randomUUID(), id = crypto.randomUUID(), user = crypto.randomUUID(), takeId = crypto.randomUUID(), versionId = crypto.randomUUID();
const params = { params: Promise.resolve({ beatId, takeId, versionId }) };
Object.assign(process.env, { APP_ENV: 'development', PUBLIC_HOST: 'http://localhost:3000', SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_local_test', TENANT_PROJECTS_ENABLED: 'true', MUSIC_RUNTIME_FLAGS: '{"ui":true,"beatEditor":true,"beatCloud":true}', R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret', R2_BUCKET: 'test' });
const original = globalThis.fetch; test.after(() => { globalThis.fetch = original; });
const doc = createBeat({ id: beatId }), raw = JSON.stringify(doc, null, 2), body = { expected_revision: 0, doc_json: raw, mode: 'autosave' };
const metadata = { id, beat_id: beatId, title: doc.title, doc_version: 4, revision: 1 };
const req = (method = 'GET', body, headers = {}) => new Request(`http://localhost:3000/api/v1/music/beat-projects/${beatId}`, { method, headers: { 'x-request-id': crypto.randomUUID(), 'x-veyrnox-auth-id': user, authorization: 'Bearer user-jwt', 'content-type': 'application/json', 'idempotency-key': 'music-beat-test', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const handlers = [[list, 'GET'], [GET, 'GET'], [PUT, 'PUT', body], [DELETE, 'DELETE', { expected_revision: 1 }], [versions, 'GET'], [version, 'GET'], [takes, 'GET'], [reserve, 'POST', { take_ref: 'one', byte_size: 44, duration_sec: 1 }], [take, 'GET'], [confirm, 'POST', {}]];
async function error(response, status, code) { assert.equal(response.status, status); assert.equal((await response.json()).error.code, code); }
test('every route is flag gated and refuses missing identity/bearer before upstream calls', async () => {
  globalThis.fetch = async () => { throw Error('unexpected'); };
  for (const [handler, method, body] of handlers) {
    process.env.MUSIC_RUNTIME_FLAGS = '{"ui":true,"beatEditor":true}';
    await error(await handler(req(method, body), params), 404, 'NOT_FOUND');
    process.env.MUSIC_RUNTIME_FLAGS = '{"ui":true,"beatEditor":true,"beatCloud":true}';
    await error(await handler(req(method, body, { 'x-veyrnox-auth-id': '' }), params), 401, 'UNAUTHORIZED');
    await error(await handler(req(method, body, { authorization: '' }), params), 401, 'UNAUTHORIZED');
  }
});
test('PUT forwards exact text, full validation and user JWT; replay returns 200', async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++; assert.equal(init.headers.authorization, 'Bearer user-jwt'); assert.equal(init.headers.apikey, 'sb_publishable_local_test');
    const sent = JSON.parse(init.body); assert.equal(sent.p_doc, raw); assert.equal(sent.p_beat_id, beatId); assert.equal(sent.p_mode, 'autosave');
    return Response.json({ ...metadata, idempotent: calls > 1 });
  };
  assert.equal((await PUT(req('PUT', body), params)).status, 201);
  assert.equal((await PUT(req('PUT', body), params)).status, 200);
  for (const bad of [{ ...body, doc_json: '{}' }, { ...body, doc_json: JSON.stringify({ ...doc, id }) }, { ...body, mode: 'other' }, { ...body, doc_json: raw + ' '.repeat(262144) }]) await error(await PUT(req('PUT', bad), params), 400, 'INVALID_BEAT');
  await error(await PUT(req('PUT', body, { 'idempotency-key': '' }), params), 400, 'INVALID_IDEMPOTENCY_KEY');
  await error(await PUT(req('PUT', { ...body, extra: true }), params), 400, 'UNKNOWN_FIELD');
  await error(await DELETE(req('DELETE', { expected_revision: 0 }), params), 400, 'INVALID_REVISION');
  assert.equal(calls, 2);
});
test('RPC errors preserve only the opted-in typed codes', async () => {
  for (const [status, code] of [[409, 'VERSION_CONFLICT'], [409, 'IDEMPOTENCY_CONFLICT'], [429, 'LIMIT_REACHED'], [429, 'RATE_LIMITED'], [404, 'NOT_FOUND']]) {
    globalThis.fetch = async () => Response.json({ message: code, details: 'secret' }, { status });
    await error(await PUT(req('PUT', body), params), status, code);
  }
});
test('both document reads accept heavily escaped near-limit text and project-bind version reads', async () => {
  const escaped = JSON.stringify({ title: '\\"'.repeat(65000) });
  assert.ok(Buffer.byteLength(escaped) < 262144); assert.ok(Buffer.byteLength(JSON.stringify({ doc_json: escaped })) > 262144);
  globalThis.fetch = async url => {
    const text = String(url);
    if (text.includes('music_beat_project_versions')) { assert.ok(text.includes(`project_id=eq.${id}`)); return Response.json([{ id: versionId, revision: 1, doc_json: escaped }]); }
    return Response.json([{ ...metadata, doc_json: escaped }]);
  };
  for (const handler of [GET, version]) { const response = await handler(req(), params); assert.equal(response.status, 200); assert.equal((await response.json()).doc_json, escaped); }
});
const key = `music-beat-takes/${user}/${takeId}.wav`;
test('reserve binds byte size and If-None-Match; ready takes have no upload URL/key', async () => {
  let ready = false;
  globalThis.fetch = async () => Response.json(ready ? { take_id: takeId, status: 'ready' } : { take_id: takeId, status: 'pending', r2_key: key, byte_size: 44, upload_expires_at: new Date(Date.now() + 900000).toISOString() });
  const body = { take_ref: 'take', byte_size: 44, duration_sec: 1 };
  const response = await reserve(req('POST', body), params); assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.r2_key, undefined);
  assert.equal(new URL(result.upload_url).searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host;if-none-match');
  assert.deepEqual(result.upload_headers, { 'Content-Type': 'audio/wav', 'If-None-Match': '*' }); assert.ok(result.upload_expires_in <= 900);
  ready = true; assert.deepEqual(await (await reserve(req('POST', body), params)).json(), { take_id: takeId, status: 'ready' });
});
test('confirmation reads the owned key, HEADs it, never deletes missing objects; mismatch deletes', async () => {
  for (const scenario of ['missing', 'mismatch', 'ready']) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push(init.method);
      if (String(url).includes('read_music_beat_take')) {
        assert.deepEqual(JSON.parse(init.body), { p_beat_id: beatId, p_take_id: takeId });
        return Response.json({ r2_key: key, byte_size: 44, status: 'pending' });
      }
      if (init.method === 'HEAD') return new Response(null, { status: scenario === 'missing' ? 404 : 200, headers: { 'content-length': scenario === 'mismatch' ? '50' : '44' } });
      if (String(url).includes('confirm_music_beat_take')) return scenario === 'mismatch' ? Response.json({ message: 'SIZE_MISMATCH' }, { status: 409 }) : Response.json({ status: 'ready' });
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      throw Error('Unexpected request');
    };
    const response = await confirm(req('POST', {}), params);
    if (scenario === 'missing') { await error(response, 409, 'take_upload_missing'); assert.ok(!calls.includes('DELETE')); }
    if (scenario === 'mismatch') { await error(response, 409, 'take_upload_invalid'); assert.ok(calls.includes('DELETE')); }
    if (scenario === 'ready') assert.equal(response.status, 200);
  }
});
test('ready take GET returns five-minute URL and pending is refused', async () => {
  globalThis.fetch = async () => Response.json({ r2_key: key, byte_size: 44, status: 'ready' });
  const result = await (await take(req(), params)).json(); assert.equal(result.expires_in, 300); assert.equal(result.r2_key, undefined);
  globalThis.fetch = async () => Response.json({ r2_key: key, byte_size: 44, status: 'pending' });
  await error(await take(req(), params), 404, 'NOT_FOUND');
});


test('PUT preserves trailing space, tab and newline titles exactly', async () => {
  for (const title of ['My beat ', 'My beat\t', 'My beat\n']) {
    const text = JSON.stringify({ ...doc, title });
    globalThis.fetch = async (url, init) => {
      const sent = JSON.parse(init.body);
      assert.equal(sent.p_title, title); assert.equal(sent.p_doc, text);
      return Response.json({ ...metadata, title });
    };
    assert.equal((await PUT(req('PUT', { ...body, doc_json: text }), params)).status, 201);
  }
});

test('declared version defaults to 4 for old clients and passes 5 for new saves and deletes', async () => {
  for (const declared of [undefined, 5]) {
    globalThis.fetch = async (_url, init) => {
      const sent = JSON.parse(init.body);
      assert.equal(sent.p_client_beat_version, declared ?? 4);
      if (sent.p_doc) assert.equal(JSON.parse(sent.p_doc).version, 4);
      return Response.json(metadata);
    };
    const declaration = declared === undefined ? {} : { client_beat_version: declared };
    assert.equal((await PUT(req('PUT', { ...body, ...declaration }), params)).status, 201);
    assert.equal((await DELETE(req('DELETE', { expected_revision: 1, ...declaration }), params)).status, 200);
  }
});
test('old-client replace/delete preserve BEAT_CLIENT_OUTDATED from PostgREST and expose no upstream detail', async () => {
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++; assert.equal(JSON.parse(init.body).p_client_beat_version, 4);
    return Response.json({ message: 'BEAT_CLIENT_OUTDATED', details: 'private database detail' }, { status: 409 });
  };
  await error(await PUT(req('PUT', body), params), 409, 'BEAT_CLIENT_OUTDATED');
  await error(await DELETE(req('DELETE', { expected_revision: 1 }), params), 409, 'BEAT_CLIENT_OUTDATED');
  assert.equal(calls, 2);
});
test('route cannot write v5 and rejects invalid declarations before any upstream mutation', async () => {
  globalThis.fetch = async () => { assert.fail('no RPC may be called'); };
  await error(await PUT(req('PUT', { ...body, client_beat_version: 5, doc_json: JSON.stringify({ ...doc, version: 5 }) }), params), 409, 'BEAT_CLIENT_OUTDATED');
  for (const client_beat_version of [null, 0, 6, 999, '5', 1.5]) {
    await error(await PUT(req('PUT', { ...body, client_beat_version }), params), 400, 'INVALID_BEAT_CLIENT_VERSION');
    await error(await DELETE(req('DELETE', { expected_revision: 1, client_beat_version }), params), 400, 'INVALID_BEAT_CLIENT_VERSION');
  }
});
