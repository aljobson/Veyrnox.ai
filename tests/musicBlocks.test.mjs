import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { musicBlocksHandler } from '../lib/musicBlocks.js';
import { musicExploreHandler } from '../lib/musicExplore.js';
import { musicCommentsReadHandler } from '../lib/musicCommentsRead.js';
import { musicRuntimeFlag } from '../lib/musicRuntime.js';

const AUTH = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const SLUG = 'a'.repeat(24);
const original = { ...process.env };
afterEach(() => { for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key]; Object.assign(process.env, original); });
function on(extra = {}) {
    process.env.MUSIC_RUNTIME_FLAGS = JSON.stringify({ ui: true, schema: true, library: true, distribution: true, publication: true, blocks: true, bestOf: true, ...extra });
    process.env.SUPABASE_URL = 'https://example.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
}
function request({ method = 'GET', body, auth = AUTH, query = '', headers = {} } = {}) {
    return new Request(`https://example.invalid/api/v1/music/blocks${query}`, { method,
        headers: { ...(auth ? { 'x-veyrnox-auth-id': auth } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
        ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
}
function mock(result) {
    const calls = [];
    return { calls, rpcCall: async (name, args) => { calls.push({ name, args }); return name === 'consume_account_read_request' ? { ok: true } : result; } };
}
async function expect(response, status, error) {
    assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json(); if (error) assert.equal(body.error, error); return body;
}

test('auth required and only the gateway auth-id is trusted', async () => {
    on(); const m = mock({ blocks: [] });
    for (const auth of [null, '', 'not-a-uuid']) {
        await expect(await musicBlocksHandler(m)(request({ auth, headers: { 'x-veyrnox-user-id': AUTH, 'x-veyrnox-auth-email': AUTH, authorization: `Bearer ${AUTH}` } })), 401, 'not_authenticated');
    }
    assert.equal(m.calls.length, 0);
});

test('absent, malformed and false blocks switch are off', async () => {
    const m = mock({ blocks: [] });
    for (const flag of [undefined, '{}', 'invalid', '{"blocks":false}']) {
        if (flag === undefined) delete process.env.MUSIC_RUNTIME_FLAGS; else process.env.MUSIC_RUNTIME_FLAGS = flag;
        assert.equal(musicRuntimeFlag('blocks'), false);
        await expect(await musicBlocksHandler(m)(request()), 404, 'blocks_unavailable');
    }
    assert.equal(m.calls.length, 0);
});

test('block validates exact keys, JSON content type, size, query and UUID type before RPC', async () => {
    on(); const m = mock({ ok: true, already: false }); const handler = musicBlocksHandler({ ...m, action: 'block' });
    for (const body of [{}, [], null, { actor_id: ACTOR, user_id: AUTH }, '{']) await expect(await handler(request({ method: 'POST', body })), 400, 'invalid_body');
    for (const actor_id of ['bad', null, 42, [ACTOR], {}]) await expect(await handler(request({ method: 'POST', body: { actor_id } })), 400, 'invalid_actor_id');
    await expect(await handler(request({ method: 'POST', body: { actor_id: ACTOR }, headers: { 'content-type': 'text/plain' } })), 415, 'invalid_content_type');
    await expect(await handler(request({ method: 'POST', body: 'x'.repeat(65537) })), 413, 'invalid_body');
    await expect(await handler(request({ method: 'POST', body: { actor_id: ACTOR }, query: '?auth_id=spoof' })), 400, 'invalid_query');
    assert.equal(m.calls.length, 0);
});

test('block and unblock preserve idempotency and send only actor id and verified auth', async () => {
    on();
    for (const action of ['block', 'unblock']) for (const already of [false, true]) {
        const m = mock({ ok: true, already, user_id: 'secret' });
        const res = await musicBlocksHandler({ ...m, action })(request({ method: action === 'block' ? 'POST' : 'DELETE', ...(action === 'block' ? { body: { actor_id: ACTOR } } : {}) }), { params: Promise.resolve({ actorId: ACTOR }) });
        assert.deepEqual(await expect(res, action === 'block' && !already ? 201 : 200), { actor_id: ACTOR, already, blocked: action === 'block' });
        assert.deepEqual(m.calls, [{ name: 'consume_account_read_request', args: { p_auth_id: AUTH } }, { name: action === 'block' ? 'music_block_actor' : 'music_unblock_actor', args: { p_auth_id: AUTH, p_actor_id: ACTOR } }]);
    }
    await expect(await musicBlocksHandler({ action: 'unblock' })(request({ method: 'DELETE' }), { params: Promise.resolve({ actorId: 'bad' }) }), 400, 'invalid_actor_id');
});

test('typed RPC errors map to public statuses without leaking errors', async () => {
    on();
    for (const [error, status] of Object.entries({ account_not_found: 403, user_not_found: 404, cannot_block_self: 400, invalid_actor_id: 400, block_limit: 409, internal_secret: 503 })) {
        await expect(await musicBlocksHandler({ ...mock({ error }), action: 'block' })(request({ method: 'POST', body: { actor_id: ACTOR } })), status, status === 503 ? 'temporarily_unavailable' : error);
    }
    for (const result of [null, {}, { ok: true }, { ok: false, already: true }]) await expect(await musicBlocksHandler({ ...mock(result), action: 'block' })(request({ method: 'POST', body: { actor_id: ACTOR } })), 503, 'temporarily_unavailable');
});

test('list allows only public typed fields and refuses malformed result', async () => {
    on(); const row = { actor_id: ACTOR, display_name: 'Listener', created_at: '2026-11-20T00:00:00Z' };
    const m = mock({ blocks: [{ ...row, user_id: AUTH }, { ...row, actor_id: 'bad' }, { ...row, display_name: {} }, { ...row, created_at: 'invalid' }] });
    assert.deepEqual(await expect(await musicBlocksHandler(m)(request()), 200), { blocks: [row] });
    assert.deepEqual(m.calls[1], { name: 'music_list_blocked_actors', args: { p_auth_id: AUTH } });
    await expect(await musicBlocksHandler(mock({}))(request()), 503, 'temporarily_unavailable');
});

test('rate denial, failed rate checks and RPC exceptions fail closed', async () => {
    on();
    for (const [rate, status] of [[{ code: 'RATE_LIMITED' }, 429], [{ code: 'NOT_FOUND' }, 403], [null, 503]]) {
        let count = 0; const handler = musicBlocksHandler({ rpcCall: async () => { count++; return rate; } });
        const res = await handler(request()); if (status === 429) assert.equal(res.headers.get('retry-after'), '60');
        await expect(res, status); assert.equal(count, 1);
    }
    await expect(await musicBlocksHandler({ rpcCall: async () => { throw Error('secret'); } })(request()), 503, 'temporarily_unavailable');
});

test('all explore mirrors require authentication and enabled blocks', async () => {
    for (const kind of ['best-of', 'track', 'profile']) {
        on(); const m = mock({ ok: true }); const h = musicExploreHandler({ kind, ...m });
        await expect(await h(request({ auth: null })), 401, 'not_authenticated');
        on({ blocks: false }); await expect(await h(request()), 404, 'blocks_unavailable'); assert.equal(m.calls.length, 0);
    }
});

test('blocked track and profile return only the unblock state and no secondary reads', async () => {
    on({ rails: true, comments: true, reactions: true });
    for (const kind of ['track', 'profile']) {
        const m = mock({ ok: true, blocked: { creator_id: ACTOR, display_name: 'Creator', user_id: AUTH }, track: { title: 'must not leak' } });
        assert.deepEqual(await expect(await musicExploreHandler({ kind, ...m })(request(), { params: Promise.resolve({ slug: SLUG, handle: 'creator' }) }), 200), { blocked: { creator_id: ACTOR, display_name: 'Creator' } });
        assert.equal(m.calls.length, 2); assert.equal(m.calls[1].args.p_auth_id, AUTH);
    }
});

test('mirrored track uses filtered rails/comments, preserves public extras and strips job id', async () => {
    on({ rails: true, comments: true }); const calls = [];
    const rpcCall = async (name, args) => {
        calls.push({ name, args });
        if (name === 'consume_account_read_request') return { ok: true };
        if (name === 'music_resolve_publication_for_viewer') return { ok: true, track: { title: 'Track', creator_id: ACTOR, job_id: AUTH } };
        if (name === 'music_public_rails_for_viewer') return { ok: true, by_creator: [], similar: [] };
        if (name === 'music_comments_read_for_viewer') return { ok: true, comments: [{ id: ACTOR, author_id: ACTOR, author: 'Listener' }], own_comments: [] };
        throw Error(`Unexpected ${name}`);
    };
    const body = await expect(await musicExploreHandler({ kind: 'track', rpcCall })(request(), { params: Promise.resolve({ slug: SLUG }) }), 200);
    assert.equal(body.track.creator_id, ACTOR); assert.equal(body.track.job_id, undefined);
    assert.equal(body.comments.comments[0].author_id, ACTOR); assert.deepEqual(body.rails, { by_creator: [], similar: [] });
    for (const call of calls) assert.equal(call.args.p_auth_id, AUTH);
    const failed = async (name, args) => name === 'music_public_rails_for_viewer' ? { ok: false } : rpcCall(name, args);
    await expect(await musicExploreHandler({ kind: 'track', rpcCall: failed })(request(), { params: Promise.resolve({ slug: SLUG }) }), 503, 'temporarily_unavailable');
});

test('best-of/profile mirrors call viewer RPCs, validate ids and preserve existing fields', async () => {
    on();
    const track = { slug: SLUG, handle: 'creator', title: 'Pop', display_name: 'Creator', creator_id: ACTOR };
    const best = mock({ ok: true, playlists: [{ genre: 'pop', tracks: [track] }] });
    const b = await expect(await musicExploreHandler({ kind: 'best-of', ...best })(request()), 200);
    assert.equal(b.playlists[0].tracks[0].creator_id, ACTOR); assert.equal(best.calls[1].name, 'music_best_of_playlists_for_viewer');
    const profile = mock({ ok: true, profile: { handle: 'creator', display_name: 'Creator', creator_id: 'invalid' }, tracks: [track] });
    const p = await expect(await musicExploreHandler({ kind: 'profile', ...profile })(request(), { params: Promise.resolve({ handle: 'creator' }) }), 200);
    assert.equal(p.profile.creator_id, undefined); assert.equal(p.tracks[0].creator_id, ACTOR);
    await expect(await musicExploreHandler({ kind: 'best-of', ...mock({ error: 'account_not_found' }) })(request()), 403, 'account_not_found');
});

test('existing authenticated comments select the filtered RPC only when blocks is on', async () => {
    for (const blocks of [false, true]) {
        on({ comments: true, blocks }); const m = mock({ ok: true, comments: [], own_comments: [{ id: ACTOR, body: 'Waiting', status: 'pending' }] });
        const req = new Request(`https://example.invalid/api/v1/music/comments?slug=${SLUG}`, { headers: { 'x-veyrnox-auth-id': AUTH } });
        const body = await expect(await musicCommentsReadHandler(m)(req), 200);
        assert.equal(m.calls[0].name, blocks ? 'music_comments_read_for_viewer' : 'music_comments_read');
        assert.equal(m.calls[0].args.p_auth_id, AUTH); assert.equal(body.comments.own_comments[0].body, 'Waiting');
    }
});
