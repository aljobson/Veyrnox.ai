import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GET as list, POST } from '../app/api/v1/film-studio/route.js';
import { GET, PUT, DELETE } from '../app/api/v1/film-studio/[id]/route.js';
import { emptyFilm, SHOT_LANES, STYLE_BOARDS, lockAsset, isLocked, promptContext, testMatrix } from '../app/veyrnox/_lib/filmStudio.js';
import { parseFilm } from '../app/veyrnox/_lib/filmStudioStorage.js';
import { filmFixture } from './fixtures/filmStudio.mjs';

const id = crypto.randomUUID(), user = crypto.randomUUID();
const params = { params: Promise.resolve({ id }) };
Object.assign(process.env, { APP_ENV: 'development', PUBLIC_HOST: 'http://localhost:3000', SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_local_test', TENANT_PROJECTS_ENABLED: 'true', FILM_STUDIO_CLOUD_ENABLED: 'true' });
const original = globalThis.fetch;
test.after(() => { globalThis.fetch = original; });
const req = (method = 'GET', body, headers = {}) => new Request(`http://localhost:3000/api/v1/film-studio/${id}`, {
  method, headers: { 'x-request-id': crypto.randomUUID(), authorization: 'Bearer test-user', 'x-veyrnox-auth-id': user, 'content-type': 'application/json', 'idempotency-key': 'film-save-test', ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const metadata = { id, name: 'Film', shot_count: 0, revision: 1, created_at: '2026-10-21T00:00:00Z', updated_at: '2026-10-21T00:00:00Z' };
const raw = JSON.stringify(emptyFilm());
const handlers = [[list, 'GET'], [POST, 'POST', { studio_json: raw }], [GET, 'GET'], [PUT, 'PUT', { expected_revision: 1, studio_json: raw }], [DELETE, 'DELETE', { expected_revision: 1 }]];
async function error(response, status, code) {
  assert.equal(response.status, status);
  assert.equal((await response.json()).error.code, code);
}

test('every endpoint is gated per request by both exact true flags, without upstream calls', async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; throw Error('unexpected upstream'); };
  for (const flag of ['TENANT_PROJECTS_ENABLED', 'FILM_STUDIO_CLOUD_ENABLED']) {
    try {
      for (const value of [undefined, 'false', 'TRUE', '1']) {
        if (value === undefined) delete process.env[flag]; else process.env[flag] = value;
        for (const [handler, method, body] of handlers) await error(await handler(req(method, body), params), 404, 'NOT_FOUND');
      }
    } finally { process.env[flag] = 'true'; }
  }
  assert.equal(calls, 0);
  assert.doesNotMatch(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'), /FILM_STUDIO_CLOUD_ENABLED/);
});

test('identity and bearer credentials are required', async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; throw Error('unexpected upstream'); };
  for (const [handler, method, body] of handlers) {
    await error(await handler(req(method, body, { 'x-veyrnox-auth-id': '' }), params), 401, 'UNAUTHORIZED');
    await error(await handler(req(method, body, { authorization: '' }), params), 401, 'UNAUTHORIZED');
  }
  assert.equal(calls, 0);
});

test('list and get use user JWT/public key, metadata projections, bounds and no-store responses', async () => {
  const urls = [];
  globalThis.fetch = async (url, init) => {
    urls.push(new URL(url));
    assert.equal(init.headers.authorization, 'Bearer test-user');
    assert.equal(init.headers.apikey, 'sb_publishable_local_test');
    assert.equal(init.redirect, 'manual');
    return Response.json(urls.length === 1 ? [metadata] : [{ ...metadata, film_json: raw }]);
  };
  const response = await list(req());
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), { projects: [metadata] });
  assert.equal(urls[0].pathname, '/rest/v1/film_studio_projects');
  assert.equal(urls[0].search, '?select=id,name,shot_count,revision,created_at,updated_at&order=updated_at.desc&limit=20');
  assert.deepEqual(await (await GET(req(), params)).json(), { project: metadata, studio_json: raw });
  assert.equal(urls[1].searchParams.get('id'), `eq.${id}`);
  assert.equal(urls[1].searchParams.get('select'), 'id,name,shot_count,revision,created_at,updated_at,film_json');
  assert.equal(urls[1].searchParams.get('limit'), '1');
  globalThis.fetch = async () => Response.json([]);
  await error(await GET(req(), params), 404, 'NOT_FOUND');
});

test('POST/PUT/DELETE forward only the validated intent and use replay status', async () => {
  let sent, path, replay = false;
  globalThis.fetch = async (url, init) => {
    sent = JSON.parse(init.body); path = new URL(url).pathname;
    assert.equal(init.method, 'POST');
    return Response.json(path.endsWith('remove_film_studio') ? { removed: true } : { ...metadata, idempotent: replay });
  };
  const studio_json = JSON.stringify({ ...emptyFilm(), name: '  A\n  film  ' });
  let response = await POST(req('POST', { studio_json }));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).project.id, id);
  assert.equal(path, '/rest/v1/rpc/save_film_studio');
  assert.deepEqual(sent, { p_id: null, p_expected_revision: 0, p_film: studio_json, p_name: 'A film', p_idempotency_key: 'film-save-test' });
  replay = true;
  assert.equal((await POST(req('POST', { studio_json: raw }))).status, 200);
  assert.equal(sent.p_name, 'Untitled film');
  assert.equal((await PUT(req('PUT', { expected_revision: 3, studio_json }), params)).status, 200);
  assert.deepEqual(sent, { p_id: id, p_expected_revision: 3, p_film: studio_json, p_name: 'A film', p_idempotency_key: 'film-save-test' });
  await POST(req('POST', { studio_json: JSON.stringify({ ...emptyFilm(), name: 'x'.repeat(130) }) }));
  assert.equal(sent.p_name.length, 120);
  await POST(req('POST', { studio_json: JSON.stringify({ ...emptyFilm(), name: `${'x'.repeat(119)}\u{1F600}\u{1F600}` }) }));
  assert.equal(Array.from(sent.p_name).length, 120);
  assert.ok(sent.p_name.isWellFormed(), 'a name cut at the limit never keeps half of an emoji');
  assert.deepEqual(await (await DELETE(req('DELETE', { expected_revision: 4 }), params)).json(), { removed: true });
  assert.equal(path, '/rest/v1/rpc/remove_film_studio');
  assert.deepEqual(sent, { p_id: id, p_expected_revision: 4 });
});

test('invalid films, envelopes, revisions, ids and keys never reach upstream', async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; throw Error('unexpected upstream'); };
  const oversized = raw + ' '.repeat(1_000_001 - Buffer.byteLength(raw));
  assert.equal(Buffer.byteLength(oversized), 1_000_001);
  for (const studio_json of [undefined, {}, 'null', '[]', '{', '{}', oversized,
    JSON.stringify({ ...emptyFilm(), schema: 2 }), JSON.stringify({ ...emptyFilm(), extra: true }),
    JSON.stringify({ ...emptyFilm(), shots: Array.from({ length: 201 }, (_, i) => ({ ...filmFixture().shots[0], id: `s${i}` })) })]) {
    await error(await POST(req('POST', { studio_json })), 400, 'INVALID_FILM');
    await error(await PUT(req('PUT', { expected_revision: 1, studio_json }), params), 400, 'INVALID_FILM');
  }
  for (const [handler, method, body] of handlers.filter(([, method]) => method !== 'GET')) {
    await error(await handler(req(method, { ...body, user_id: user }), params), 400, 'UNKNOWN_FIELD');
  }
  for (const expected_revision of [undefined, null, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    await error(await PUT(req('PUT', { expected_revision, studio_json: raw }), params), 400, 'INVALID_REVISION');
    await error(await DELETE(req('DELETE', { expected_revision }), params), 400, 'INVALID_REVISION');
  }
  for (const handler of [GET, PUT, DELETE]) await error(await handler(req(), { params: { id: '../bad' } }), 400, 'INVALID_ID');
  for (const [handler, method, body] of handlers.filter(([, method]) => ['POST', 'PUT'].includes(method)))
    await error(await handler(req(method, body, { 'idempotency-key': 'bad' }), params), 400, 'INVALID_IDEMPOTENCY_KEY');
  const malformed = new Request('http://localhost:3000', { method: 'POST', headers: req().headers, body: '{' });
  await error(await POST(malformed), 400, 'INVALID_JSON');
  // The envelope has its own transport cap; decoded films above 1 MB get INVALID_FILM above.
  await error(await POST(req('POST', { studio_json: 'x'.repeat(2_100_001) })), 413, 'BODY_TOO_LARGE');
  assert.equal(calls, 0);
});

test('upstream errors remain typed and private; film limit survives the whole POST route', async () => {
  for (const [status, message, code] of [[404, 'NOT_FOUND', 'NOT_FOUND'], [409, 'VERSION_CONFLICT', 'CONFLICT'], [429, 'RATE_LIMITED', 'RATE_LIMITED'], [429, 'LIMIT_REACHED', 'LIMIT_REACHED']]) {
    globalThis.fetch = async () => Response.json({ code: `PT${status}`, message, details: 'secret database content' }, { status });
    for (const [handler, method, body] of handlers) {
      const response = await handler(req(method, body), params);
      assert.equal(response.status, status);
      if (status === 429) assert.equal(response.headers.get('retry-after'), '60');
      const result = await response.json();
      assert.equal(result.error.code, code);
      assert.ok(!JSON.stringify(result).includes('secret'));
    }
  }
});

function lockedFilm() {
  let film = filmFixture();
  film.boards = [{ id: 'room', name: '@room:v1', type: 'location', decision: 'approved', references: Array.from({ length: 8 }, (_, i) => ({ source: `room-${i}.png`, caption: `Room ${i}`, kind: 'reference' })) },
    ...STYLE_BOARDS.map(name => ({ id: name, name, type: 'style', decision: 'approved', references: [{ source: `${name}.png`, caption: name, kind: 'reference' }] }))];
  const asset = { tag: '@room', version: 1, type: 'location', descriptor: 'An empty room.', references: ['room.png'], tests: {}, lock: null };
  film.assets = [asset];
  asset.tests = Object.fromEntries(testMatrix(film, asset).map(row => [row.id, { result: `${row.id}.png`, verdict: 'pass' }]));
  film = lockAsset(film, '@room:v1');
  film.prompts = [{ shot: film.shots[0].id, content: 'Current prompt', context: promptContext(film, film.shots[0]), at: '2026-10-21', version: 1 }];
  return film;
}
async function roundTrip(studio_json, update = false) {
  let stored;
  globalThis.fetch = async (url, init) => {
    if (init.method === 'POST') {
      stored = JSON.parse(init.body).p_film;
      return Response.json(metadata);
    }
    return Response.json([{ ...metadata, film_json: stored }]);
  };
  const response = update ? await PUT(req('PUT', { expected_revision: 1, studio_json }), params) : await POST(req('POST', { studio_json }));
  assert.equal(response.status, update ? 200 : 201);
  assert.equal(stored, studio_json);
  const fetched = await (await GET(req(), params)).json();
  assert.equal(fetched.studio_json, studio_json);
  return parseFilm(fetched.studio_json);
}

test('exact text preserves locks and current prompts; simulated JSONB sorting breaks both', async () => {
  const film = await roundTrip(JSON.stringify(lockedFilm()));
  assert.equal(isLocked(film, film.assets[0]), true);
  assert.equal(film.prompts[0].context, promptContext(film, film.shots[0]));
  const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
  const reordered = parseFilm(JSON.stringify(sorted(film)));
  assert.equal(isLocked(reordered, reordered.assets[0]), false);
  assert.notEqual(reordered.prompts[0].context, promptContext(reordered, reordered.shots[0]));
});

test('escape-heavy 999999-byte film POSTs, PUTs and GETs byte-identically', async () => {
  const film = emptyFilm();
  film.shots = Array.from({ length: 21 }, (_, i) => ({ ...Object.fromEntries(SHOT_LANES.flatMap(([, fields]) => fields.map(([key]) => [key, '']))), id: `s${i}`, oneAction: true }));
  for (const shot of film.shots) {
    const remaining = 999999 - Buffer.byteLength(JSON.stringify(film));
    shot.description = '"\\'.repeat(12000).slice(0, Math.min(24000, Math.floor(remaining / 2)));
  }
  film.script = ' '.repeat(999999 - Buffer.byteLength(JSON.stringify(film)));
  const studio_json = JSON.stringify(film);
  assert.equal(Buffer.byteLength(studio_json), 999999);
  assert.ok(Buffer.byteLength(JSON.stringify({ studio_json })) > 1_100_000);
  parseFilm(studio_json);
  await roundTrip(studio_json);
  await roundTrip(studio_json, true);
});
