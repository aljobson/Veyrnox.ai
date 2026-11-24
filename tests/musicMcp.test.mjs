import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { musicGenerationPending } from '../lib/mcpMusic.js';

register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

const AUTH_ID = '33333333-3333-4333-8333-333333333333';
const CLIENT_ID = '9a8b7c6d-5e4f-4a2b-8c0d-9e8f7a6b5c4d';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function mcp(method, params) {
  const { POST } = await import('../app/api/v1/mcp/route.js');
  const response = await POST(new Request('https://veyrnox.test/api/v1/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
      'x-veyrnox-auth-id': AUTH_ID, 'x-veyrnox-auth-client-id': CLIENT_ID,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params }),
  }));
  const text = await response.text();
  return JSON.parse(text.includes('data:') ? text.split('data:').pop().trim() : text).result;
}

const call = (name, args) => mcp('tools/call', { name, arguments: args });

test('Music wait classification covers request and candidate pending and terminal states', () => {
  assert.equal(musicGenerationPending({ state: 'debited', candidates: [] }), true);
  assert.equal(musicGenerationPending({ state: 'running', candidates: [{ state: 'ready' }] }), true);
  assert.equal(musicGenerationPending({ state: 'unknown', candidates: [{ state: 'queued' }] }), true);
  assert.equal(musicGenerationPending({ state: 'unknown', candidates: [{ state: 'running' }] }), true);
  for (const state of ['partial', 'succeeded', 'failed', 'refunded']) {
    assert.equal(musicGenerationPending({ state, candidates: [{ state: 'running' }] }), false, state);
  }
});

function configure() {
  Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', PUBLIC_HOST: 'https://veyrnox.test',
    R2_ACCOUNT_ID: 'test-account', R2_ACCESS_KEY_ID: 'test-access', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'test-bucket',
    MUSIC_RUNTIME_FLAGS: JSON.stringify({ schema: true, dispatch: true, generation: true, library: true, playlists: true, beatAi: true, ui: true, beatEditor: true }),
  });
  delete process.env.ASSET_LINK_RATE_LIMIT_ENABLED;
}

test('Music tools advertise truthful read, quote, spending and destructive annotations', async () => {
  configure();
  const result = await mcp('tools/list', {});
  const tools = Object.fromEntries(result.tools.map((tool) => [tool.name, tool]));
  assert.equal(tools.get_music_draft.annotations.readOnlyHint, true);
  assert.deepEqual(tools.estimate_music_generation.annotations, {
    readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false,
  });
  assert.deepEqual(tools.generate_music.annotations, {
    readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true,
  });
  assert.equal(tools.get_music_generation.annotations.openWorldHint, true);
  assert.equal(tools.update_music_playlist.annotations.destructiveHint, true);
  assert.match(tools.estimate_music_generation.inputSchema.properties.rights_confirmed.description, /user explicitly confirms/i);
  assert.equal(tools.update_music_playlist.inputSchema.type, 'object');
  assert.deepEqual(Object.keys(tools.update_music_playlist.inputSchema.properties).sort(), [
    'action', 'expected_revision', 'idempotency_key', 'pinned', 'playlist_id', 'song_ids',
  ]);
  assert.equal('oneOf' in tools.update_music_playlist.inputSchema, false);
  assert.equal('anyOf' in tools.update_music_playlist.inputSchema, false);
});

test('Music estimate uses the authoritative draft contract, widest duration bounds, and never requests daily allowance', async (t) => {
  configure();
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(String(input));
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ path: url.pathname, body });
    if (url.pathname === '/rest/v1/model_catalog') return Response.json([{
      id: 'ace-step-1.5', active: true, gated_flag: false, provider: 'crun',
      provider_endpoint: 'crun:suno/music-generate', modality: 'audio', credits_5s: 4,
      updated_at: '2099-01-01T00:00:00Z',
    }]);
    if (url.pathname.endsWith('/music_get_custom_draft')) {
      assert.equal(body.p_auth_id, AUTH_ID);
      return Response.json({
        ok: true, provider_contract: 'crun-suno-v1',
        draft: { id: uuid(10), revision: 4, model_id: 'ace-step-1.5', lyrics: 'original words', styles: 'glacial synth', title: 'North' },
      });
    }
    if (url.pathname.endsWith('/music_create_custom_quote')) return Response.json({
      ok: true, quote_id: uuid(11), mode: 'custom', model_id: 'ace-step-1.5', provider_contract: 'crun-suno-v1',
      unit_credits: 4, total_credits: 8, charged_credits: 8, balance: 20, balance_after: 12,
      affordable: true, expires_at: '2099-01-01T00:10:00Z',
    });
    assert.fail(`unexpected request ${url.pathname}`);
  });

  const draft = await call('get_music_draft', {});
  assert.equal(draft.structuredContent.draft.id, uuid(10));
  assert.match(draft.structuredContent.instruction, /estimate_music_generation/);

  for (const duration_seconds of [1, 135]) {
    const result = await call('estimate_music_generation', {
      provider_contract: 'crun-suno-v1', draft_id: uuid(10), draft_revision: 4,
      instrumental: true, rights_confirmed: false, duration_seconds,
    });
    assert.equal(result.structuredContent.total_credits, 8);
    assert.equal(result.structuredContent.rights_confirmed, false);
  }
  const vocal = await call('estimate_music_generation', {
    provider_contract: 'crun-suno-v1', draft_id: uuid(10), draft_revision: 4,
    instrumental: false, rights_confirmed: true, duration_seconds: 60,
  });
  assert.equal(vocal.structuredContent.rights_confirmed, true);
  assert.match(vocal.content[0].text, /user's explicit lyric-rights confirmation/i);
  const quoteBodies = requests.filter(({ path }) => path.endsWith('/music_create_custom_quote')).map(({ body }) => body);
  assert.deepEqual(quoteBodies.map((body) => body.p_duration_seconds), [1, 135, 60]);
  assert.ok(quoteBodies.every((body) => !Object.hasOwn(body, 'p_daily_allowance_capable')));
  assert.ok(requests.every(({ path }) => !path.includes('daily_allowance')));
});

test('Music estimate returns typed contract and duration refusals through the transport', async (t) => {
  configure();
  const paths = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(String(input)); paths.push(url.pathname);
    if (url.pathname === '/rest/v1/model_catalog') return Response.json([{
      id: 'ace-step-1.5', active: true, gated_flag: false, provider: 'fal',
      provider_endpoint: 'fal-ai/ace-step-1.5', modality: 'audio', credits_5s: 2,
      updated_at: '2099-01-01T00:00:00Z',
    }]);
    assert.fail(`unexpected request ${url.pathname}`);
  });
  const base = { draft_id: uuid(10), draft_revision: 4, instrumental: true, rights_confirmed: false, duration_seconds: 60 };
  const stale = await call('estimate_music_generation', { ...base, provider_contract: 'crun-suno-v1' });
  assert.deepEqual([stale.isError, stale.structuredContent.error], [true, 'contract_stale']);
  const duration = await call('estimate_music_generation', { ...base, provider_contract: 'fal-ace-v1', duration_seconds: 135 });
  assert.deepEqual([duration.isError, duration.structuredContent.error], [true, 'duration_invalid']);
  assert.deepEqual(paths, ['/rest/v1/model_catalog', '/rest/v1/model_catalog']);
});

test('a missing Music draft directs the caller to web or iOS without exposing a write tool', async (t) => {
  configure();
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/rest/v1/model_catalog') return Response.json([{
      id: 'ace-step-1.5', active: true, gated_flag: false, provider: 'crun',
      provider_endpoint: 'crun:suno/music-generate', modality: 'audio', credits_5s: 4,
      updated_at: '2099-01-01T00:00:00Z',
    }]);
    if (url.pathname.endsWith('/music_get_custom_draft')) return Response.json({
      ok: true, provider_contract: 'crun-suno-v1', draft: { id: null, revision: 0 },
    });
    assert.fail(`unexpected request ${url.pathname}`);
  });
  const result = await call('get_music_draft', {});
  assert.match(result.structuredContent.instruction, /web or iOS app/);
  const tools = await mcp('tools/list', {});
  assert.equal(tools.tools.some(({ name }) => name.includes('save_music_draft')), false);
});

test('Music generation requires explicit approval and exact frozen credits before the atomic submit route', async (t) => {
  configure();
  const paths = [];
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(String(input)); paths.push(url.pathname);
    if (url.pathname === '/rest/v1/users') return Response.json([{ id: uuid(20) }]);
    if (url.pathname === '/rest/v1/music_generation_quotes') return Response.json([{
      model_id: 'ace-step-1.5', consumed_at: null, provider_contract: 'crun-suno-v1', charged_credits: 8,
    }]);
    if (url.pathname.endsWith('/music_submit_pair')) {
      const body = JSON.parse(init.body);
      assert.equal(body.p_auth_id, AUTH_ID, 'the internal route uses only the trusted MCP identity');
      return Response.json({ ok: true, request_id: uuid(21), state: 'debited', job_ids: [uuid(22), uuid(23)], balance_after: 12, provider_contract: 'crun-suno-v1' });
    }
    assert.fail(`unexpected request ${url.pathname}`);
  });

  const base = { provider_contract: 'crun-suno-v1', quote_id: uuid(24), confirmed_credits: 8, idempotency_key: 'music-mcp-approval-1' };
  for (const refusedArgs of [
    base,
    { ...base, user_approved: false },
    { quote_id: uuid(24), confirmed_credits: 8, user_approved: true, idempotency_key: 'music-mcp-approval-1' },
    { provider_contract: 'crun-suno-v1', quote_id: uuid(24), user_approved: true, idempotency_key: 'music-mcp-approval-1' },
    { ...base, user_approved: true, idempotency_key: 'x'.repeat(121) },
  ]) {
    assert.equal((await call('generate_music', refusedArgs)).isError, true);
  }
  assert.equal(paths.length, 0, 'schema-level approval refusal cannot read or charge');

  const wrong = await call('generate_music', { ...base, confirmed_credits: 7, user_approved: true });
  assert.deepEqual([wrong.isError, wrong.structuredContent.error], [true, 'credit_confirmation_mismatch']);
  assert.deepEqual(paths, ['/rest/v1/users', '/rest/v1/music_generation_quotes']);
  paths.length = 0;

  const accepted = await call('generate_music', { ...base, user_approved: true });
  assert.equal(accepted.structuredContent.generation_id, uuid(21));
  assert.deepEqual(paths, ['/rest/v1/users', '/rest/v1/music_generation_quotes', '/rest/v1/rpc/music_submit_pair']);
});

test('Music wait polls pending state, then signs only the final ready candidate', async (t) => {
  configure();
  let statusReads = 0, assetReads = 0;
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/music_get_generation')) {
      statusReads += 1;
      if (statusReads === 1) return Response.json({ ok: true, generation: {
        id: uuid(50), state: 'running', candidates: [
          { ordinal: 1, label: 'A', state: 'running', job_id: uuid(51) },
          { ordinal: 2, label: 'B', state: 'queued', job_id: uuid(52) },
        ],
      } });
      return Response.json({ ok: true, generation: {
        id: uuid(50), state: 'partial', candidates: [
          { ordinal: 1, label: 'A', state: 'ready', job_id: uuid(51), audio_url: `/api/v1/jobs/${uuid(51)}/asset` },
          { ordinal: 2, label: 'B', state: 'refunded', job_id: uuid(52) },
        ],
      } });
    }
    if (url.pathname.endsWith('/get_user_asset')) {
      assetReads += 1;
      return Response.json({ ok: true, r2_key: 'music/polled.wav', mime_type: 'audio/wav', size_bytes: 1024 });
    }
    assert.fail(`unexpected request ${url.pathname}`);
  });
  const result = await call('get_music_generation', { generation_id: uuid(50), wait_seconds: 4 });
  assert.equal(result.structuredContent.state, 'partial');
  assert.equal(result.structuredContent.candidates[0].state, 'ready');
  assert.equal(result.structuredContent.candidates[1].state, 'refunded');
  assert.deepEqual({ statusReads, assetReads }, { statusReads: 2, assetReads: 1 });
});

test('ready Music candidates receive one signed link each after terminal status, while refunded candidates remain terminal', async (t) => {
  configure();
  const assetReads = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/music_get_generation')) return Response.json({ ok: true, generation: {
      id: uuid(30), state: 'partial', candidates: [
        { ordinal: 1, label: 'A', state: 'ready', job_id: uuid(31), audio_url: `/api/v1/jobs/${uuid(31)}/asset` },
        { ordinal: 2, label: 'B', state: 'refunded', job_id: uuid(32), error_code: 'provider_failed', audio_url: '/api/v1/jobs/wrong/asset' },
        { ordinal: 3, label: 'C', state: 'ready', audio_url: '/api/v1/jobs/missing/asset' },
      ],
    } });
    if (url.pathname.endsWith('/get_user_asset')) {
      assetReads.push(url.pathname);
      return Response.json({ ok: true, r2_key: 'music/owned.wav', mime_type: 'audio/wav', size_bytes: 4096, asset_expires_at: null });
    }
    assert.fail(`unexpected request ${url.pathname}`);
  });
  const result = await call('get_music_generation', { generation_id: uuid(30), wait_seconds: 0 });
  assert.equal(assetReads.length, 1);
  assert.equal(result.structuredContent.candidates[0].state, 'ready');
  assert.match(result.structuredContent.candidates[0].asset.url, /^https:\/\/test-account\.r2\.cloudflarestorage\.com\//);
  assert.equal('audio_url' in result.structuredContent.candidates[0], false);
  assert.equal(result.structuredContent.candidates[1].state, 'refunded');
  assert.deepEqual(result.structuredContent.candidates[2].asset_error, { error: 'asset_unavailable' });
  assert.ok(result.structuredContent.candidates.every((candidate) => !Object.hasOwn(candidate, 'audio_url')));
  assert.equal(result.content.filter((item) => item.type === 'resource_link').length, 1);
});

test('a signed-asset refusal preserves ready state and retry metadata without leaking the relative route', async (t) => {
  configure();
  process.env.ASSET_LINK_RATE_LIMIT_ENABLED = 'true';
  t.after(() => { delete process.env.ASSET_LINK_RATE_LIMIT_ENABLED; });
  const paths = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(String(input)); paths.push(url.pathname);
    if (url.pathname.endsWith('/music_get_generation')) return Response.json({ ok: true, generation: {
      id: uuid(33), state: 'succeeded', candidates: [
        { ordinal: 1, label: 'A', state: 'ready', job_id: uuid(34), audio_url: `/api/v1/jobs/${uuid(34)}/asset` },
      ],
    } });
    if (url.pathname.endsWith('/consume_asset_link_request')) return Response.json({ ok: false, code: 'RATE_LIMITED', retry_after_seconds: 17 });
    assert.fail(`unexpected request ${url.pathname}`);
  });
  const result = await call('get_music_generation', { generation_id: uuid(33), wait_seconds: 0 });
  const candidate = result.structuredContent.candidates[0];
  assert.equal(candidate.state, 'ready');
  assert.deepEqual(candidate.asset_error, { error: 'rate_limited', status: 429, retry_after_seconds: 17 });
  assert.equal('audio_url' in candidate, false);
  assert.deepEqual(paths, ['/rest/v1/rpc/music_get_generation', '/rest/v1/rpc/consume_asset_link_request']);
});

test('playlist list and create operations stay on the existing owned routes', async (t) => {
  configure();
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(String(input));
    const body = init.body ? JSON.parse(init.body) : {};
    seen.push([url.pathname, body.p_auth_id]);
    if (url.pathname.endsWith('/music_list_playlists')) return Response.json({ playlists: [{ id: uuid(35), title: 'Night drive' }] });
    if (url.pathname.endsWith('/music_create_playlist')) return Response.json({ ok: true, playlist: { id: uuid(36), title: 'New list' } });
    assert.fail(`unexpected request ${url.pathname}`);
  });
  const listed = await call('list_music_playlists', {});
  assert.equal(listed.structuredContent.playlists[0].title, 'Night drive');
  const created = await call('create_music_playlist', { title: 'New list', idempotency_key: 'playlist-mcp-create-1' });
  assert.equal(created.structuredContent.playlist.id, uuid(36));
  assert.deepEqual(seen, [
    ['/rest/v1/rpc/music_list_playlists', AUTH_ID], ['/rest/v1/rpc/music_create_playlist', AUTH_ID],
  ]);
});

test('playlist replacement accepts 75 songs through the real handler and refuses 76 before route execution', async (t) => {
  configure();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    if (url.pathname.endsWith('/music_patch_playlist')) {
      const body = JSON.parse(init.body);
      assert.equal(body.p_auth_id, AUTH_ID);
      if (body.p_action === 'replace') assert.equal(body.p_song_ids.length, 75);
      if (body.p_action === 'pin') assert.equal(body.p_pinned, true);
      return Response.json({ ok: true, revision: 2, idempotent: false });
    }
    assert.fail(`unexpected request ${url.pathname}`);
  });
  const base = { playlist_id: uuid(40), action: 'replace', expected_revision: 1, idempotency_key: 'playlist-mcp-replace-1' };
  const accepted = await call('update_music_playlist', { ...base, song_ids: Array.from({ length: 75 }, (_, i) => uuid(100 + i)) });
  assert.equal(accepted.structuredContent.revision, 2);
  const duplicate = uuid(180);
  const duplicateRefused = await call('update_music_playlist', { ...base, song_ids: [duplicate, duplicate.toUpperCase()] });
  assert.equal(duplicateRefused.isError, true);
  const pinned = await call('update_music_playlist', {
    playlist_id: uuid(40), action: 'pin', expected_revision: 1, pinned: true, idempotency_key: 'playlist-mcp-pin-0001',
  });
  assert.equal(pinned.structuredContent.revision, 2);
  const refused = await call('update_music_playlist', { ...base, song_ids: Array.from({ length: 76 }, (_, i) => uuid(200 + i)) });
  assert.equal(refused.isError, true);
  assert.deepEqual(calls, ['/rest/v1/rpc/music_patch_playlist', '/rest/v1/rpc/music_patch_playlist']);
});
