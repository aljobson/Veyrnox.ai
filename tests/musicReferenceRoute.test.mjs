import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}`,
));
const { GET, POST, DELETE } = await import('../app/api/v1/music/reference-links/route.js');

const auth = '11111111-1111-4111-8111-111111111111';
const linkId = '22222222-2222-4222-8222-222222222222';
const link = {
  id: linkId,
  provider: 'youtube',
  external_id: 'dQw4w9WgXcQ',
  canonical_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  title: 'Public track',
  creator: 'Public creator',
  thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  embed_url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=0&playsinline=1',
  rights_mode: 'inspiration',
};

Object.assign(process.env, {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-only',
  ACCOUNT_READ_RATE_LIMIT_ENABLED: 'true',
  MUSIC_SCHEMA_ENABLED: 'true',
  MUSIC_LIBRARY_ENABLED: 'true',
  MUSIC_REFERENCES_ENABLED: 'true',
});

const request = (method, body, identity = auth) => new Request('https://veyrnox.test/api/v1/music/reference-links', {
  method,
  headers: { 'x-veyrnox-auth-id': identity, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const createBody = (overrides = {}) => ({
  url: 'https://youtu.be/dQw4w9WgXcQ',
  rights_mode: 'inspiration',
  rights_confirmed: false,
  idempotency_key: 'music-reference.route-test',
  ...overrides,
});

let calls;
function stub(overrides = {}) {
  calls = [];
  globalThis.fetch = async (target, init = {}) => {
    const url = new URL(target);
    if (url.hostname === 'www.youtube.com') {
      calls.push({ name: 'youtube_oembed', args: null });
      if (overrides.oembedStatus) return new Response('', { status: overrides.oembedStatus });
      return Response.json({
        title: 'Public track', author_name: 'Public creator', provider_name: 'YouTube',
        thumbnail_url: link.thumbnail_url,
      });
    }
    const name = url.pathname.split('/').pop();
    const args = init.body ? JSON.parse(init.body) : null;
    calls.push({ name, args });
    const defaults = {
      consume_account_read_request: { ok: true },
      consume_social_post_write_request: { ok: true },
      music_list_reference_links: { ok: true, links: [link] },
      music_get_reference_link_by_idempotency: { ok: true, found: false },
      music_create_reference_link: { ok: true, idempotent: false, link },
      music_delete_reference_link: { ok: true },
    };
    return Response.json(Object.hasOwn(overrides, name) ? overrides[name] : defaults[name]);
  };
}

test('reference route lists owner links with no-store and rejects malformed identity before storage', async () => {
  stub();
  const response = await GET(request('GET'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { links: [link] });
  assert.deepEqual(calls.map(({ name }) => name), ['consume_account_read_request', 'music_list_reference_links']);

  stub();
  const rejected = await GET(request('GET', undefined, 'bad'));
  assert.equal(rejected.status, 401);
  assert.equal(rejected.headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 0);
});

test('reference route resolves metadata then creates, replays, conflicts and deletes through owner RPCs', async () => {
  stub();
  const created = await POST(request('POST', createBody()));
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await created.json(), { link, idempotent: false });
  assert.deepEqual(calls.map(({ name }) => name), ['music_get_reference_link_by_idempotency', 'consume_social_post_write_request', 'youtube_oembed', 'music_create_reference_link']);
  assert.equal(calls.at(-1).args.p_auth_id, auth);
  assert.equal(calls.at(-1).args.p_rights_mode, 'inspiration');

  stub({ music_get_reference_link_by_idempotency: { ok: true, found: true, link } });
  const replayed = await POST(request('POST', createBody()));
  assert.equal(replayed.status, 200);
  assert.deepEqual(await replayed.json(), { link, idempotent: true });
  assert.deepEqual(calls.map(({ name }) => name), ['music_get_reference_link_by_idempotency']);
  stub({ music_get_reference_link_by_idempotency: { ok: true, found: true, link } });
  assert.equal((await POST(request('POST', createBody({ rights_mode: 'owned_or_licensed', rights_confirmed: true })))).status, 409);
  assert.equal(calls.some(({ name }) => name === 'youtube_oembed'), false);
  stub({ music_create_reference_link: { ok: false, code: 'IDEMPOTENCY_CONFLICT' } });
  const conflict = await POST(request('POST', createBody()));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.headers.get('cache-control'), 'no-store');
  stub({ music_create_reference_link: { ok: false, code: 'REFERENCE_LIMIT_REACHED' } });
  assert.equal((await POST(request('POST', createBody()))).status, 409);

  stub();
  assert.equal((await DELETE(request('DELETE', { id: linkId }))).status, 200);
  assert.deepEqual(calls.at(-1), { name: 'music_delete_reference_link', args: { p_auth_id: auth, p_id: linkId } });
  stub({ music_delete_reference_link: { ok: false, code: 'NOT_FOUND' } });
  assert.equal((await DELETE(request('DELETE', { id: linkId }))).status, 404);
});

test('a valid session with no account row stays signed in and receives safe empty/not-found responses', async () => {
  stub({ music_list_reference_links: { ok: false, code: 'NOT_FOUND' } });
  const listed = await GET(request('GET'));
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), { links: [] });

  stub({ music_get_reference_link_by_idempotency: { ok: false, code: 'NOT_FOUND' } });
  const created = await POST(request('POST', createBody()));
  assert.equal(created.status, 404);
  assert.deepEqual(await created.json(), { error: 'account_not_found' });
  assert.equal(calls.some(({ name }) => name === 'youtube_oembed'), false);
});

test('reference route maps provider refusal and throttling without retrying or leaking cacheable errors', async () => {
  for (const [oembedStatus, expectedStatus, code] of [[403, 422, 'reference_not_embeddable'], [429, 503, 'reference_upstream_rate_limited'], [500, 502, 'reference_upstream_unavailable']]) {
    stub({ oembedStatus });
    const response = await POST(request('POST', createBody()));
    assert.equal(response.status, expectedStatus, String(oembedStatus));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: code });
    assert.equal(calls.some(({ name }) => name === 'music_create_reference_link'), false);
  }
});

test('invalid rights are refused before the write limiter or provider is contacted', async () => {
  stub();
  const response = await POST(request('POST', createBody({ rights_mode: 'owned_or_licensed', rights_confirmed: false })));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'rights_confirmation_required' });
  assert.equal(calls.length, 0);
});

test('dedicated disabled rollout touches no reference tables before the migration lands', async () => {
  process.env.MUSIC_REFERENCES_ENABLED = 'false';
  try {
    stub();
    const listed = await GET(request('GET'));
    assert.equal(listed.status, 503);
    assert.deepEqual(await listed.json(), { error: 'references_not_open' });
    assert.equal(calls.length, 0);
    stub();
    const blocked = await POST(request('POST', createBody()));
    assert.equal(blocked.status, 503);
    assert.deepEqual(await blocked.json(), { error: 'references_not_open' });
    assert.equal(calls.length, 0);
    stub();
    assert.equal((await DELETE(request('DELETE', { id: linkId }))).status, 503);
    assert.equal(calls.length, 0);
  } finally {
    process.env.MUSIC_REFERENCES_ENABLED = 'true';
  }
});
