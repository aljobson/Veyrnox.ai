import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-role' });
const route = await import('../app/api/v1/creator-profile/route.js');
const skip = await import('../app/api/v1/creator-profile/skip/route.js');
const { cleanCreatorAnswers, creatorProfileEnabled } = await import('../lib/creatorProfile.js');

const auth = '11111111-1111-4111-8111-111111111111';
const savedFetch = globalThis.fetch;
const savedFlag = process.env.CREATOR_PROFILE_ENABLED;
const savedErr = console.error;
let calls;
test.beforeEach(() => { calls = []; console.error = () => {}; process.env.CREATOR_PROFILE_ENABLED = 'true'; });
test.afterEach(() => {
    globalThis.fetch = savedFetch; console.error = savedErr;
    if (savedFlag === undefined) delete process.env.CREATOR_PROFILE_ENABLED; else process.env.CREATOR_PROFILE_ENABLED = savedFlag;
});

const good = { look: 'neon_rain', goal: 'story', pace: 'octopus', chaos: 2, destination: 'tiktok', audience: 'me', voice: 'calm' };
const req = (method, body, id = auth, path = '') => new Request(`https://veyrnox.test/api/v1/creator-profile${path}`, {
    method, headers: { 'content-type': 'application/json', ...(id ? { 'x-veyrnox-auth-id': id } : {}) },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
});
function stub(result = { ok: true }, { fail } = {}) {
    globalThis.fetch = async (url, init) => {
        calls.push({ name: new URL(url).pathname.split('/').pop(), args: JSON.parse(init.body) });
        if (fail) throw new Error('backend down');
        return Response.json(result);
    };
}

test('the flag is off unless it is exactly "true"', () => {
    assert.equal(creatorProfileEnabled({}), false);
    assert.equal(creatorProfileEnabled({ CREATOR_PROFILE_ENABLED: '1' }), false);
    assert.equal(creatorProfileEnabled({ CREATOR_PROFILE_ENABLED: 'true' }), true);
});

test('a caller with no identity is refused before any outbound call', async () => {
    stub();
    for (const id of [null, '', 'not-a-uuid']) {
        assert.equal((await route.GET(req('GET', undefined, id))).status, 401);
        assert.equal((await route.PUT(req('PUT', good, id))).status, 401);
        assert.equal((await route.DELETE(req('DELETE', undefined, id))).status, 401);
        assert.equal((await skip.POST(req('POST', undefined, id, '/skip'))).status, 401);
    }
    assert.deepEqual(calls, []);
});

test('with the flag off every verb answers 404 and calls nothing', async () => {
    stub();
    delete process.env.CREATOR_PROFILE_ENABLED;
    assert.equal((await route.GET(req('GET'))).status, 404);
    assert.equal((await route.PUT(req('PUT', good))).status, 404);
    assert.equal((await route.DELETE(req('DELETE'))).status, 404);
    assert.equal((await skip.POST(req('POST', undefined, auth, '/skip'))).status, 404);
    assert.deepEqual(calls, []);
});

test('answers are validated at the boundary; the typed code names our field, never the caller\'s text', async () => {
    stub();
    const bad = [
        [{ ...good, look: 'sepia' }, 'look'], [{ ...good, goal: 7 }, 'goal'], [{ ...good, pace: 'dog' }, 'pace'],
        [{ ...good, chaos: 5 }, 'chaos'], [{ ...good, chaos: 1.5 }, 'chaos'], [{ ...good, chaos: '2' }, 'chaos'],
        [{ ...good, destination: 'myspace' }, 'destination'], [{ ...good, audience: null }, 'audience'], [{ ...good, voice: 'loud' }, 'voice'],
        [{ ...good, studio_name: 'x'.repeat(41) }, 'studio_name'], [{ ...good, studio_name: '<script>' }, 'studio_name'],
        [{ ...good, studio_name: 'a\u0007b' }, 'studio_name'], [{ ...good, studio_name: 5 }, 'studio_name'],
        [{ ...good, is_admin: true }, 'unknown_key'], [{ ...good, 'evil key <x>': 1 }, 'unknown_key'],
        [(() => { const m = { ...good }; delete m.voice; return m; })(), 'voice'],
    ];
    for (const [body, field] of bad) {
        const res = await route.PUT(req('PUT', body));
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.deepEqual(await res.json(), { error: 'invalid_answers', field });
    }
    for (const body of ['not json', '[]', 'null', '"x"']) {
        const res = await route.PUT(req('PUT', body));
        assert.equal(res.status, 400, body);
        assert.equal((await res.json()).error, body === 'not json' || body === '[]' || body === 'null' || body === '"x"' ? 'body_invalid' : '');
    }
    assert.deepEqual(calls, []);
});

test('save passes the verified identity and only the cleaned answers', async () => {
    stub({ ok: true, changed: true, answers: { ...good, studio_name: 'Night Owl Films' } });
    const res = await route.PUT(req('PUT', { ...good, studio_name: '  Night Owl Films  ' }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'completed', answers: { ...good, studio_name: 'Night Owl Films' }, changed: true });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(calls, [{ name: 'save_creator_profile', args: { p_auth_id: auth, p_answers: { ...good, studio_name: 'Night Owl Films' } } }]);
});

test('an empty studio name is dropped before the call; the same save twice sends the same call', async () => {
    stub({ ok: true, changed: false, answers: good });
    await route.PUT(req('PUT', { ...good, studio_name: '   ' }));
    await route.PUT(req('PUT', good));
    assert.deepEqual(calls[0], calls[1]);
    assert.equal('studio_name' in calls[0].args.p_answers, false);
    assert.equal(cleanCreatorAnswers({ ...good, chaos: 0 }).ok, true, 'chaos 0 is a real answer');
});

test('read: none, skipped and completed each have their own shape', async () => {
    stub({ ok: true, status: 'none' });
    assert.deepEqual(await (await route.GET(req('GET'))).json(), { status: 'none' });
    stub({ ok: true, status: 'skipped', answers: {}, skipped_at: '2026-10-21T10:00:00Z', completed_at: null });
    assert.deepEqual(await (await route.GET(req('GET'))).json(), { status: 'skipped', answers: {}, skipped_at: '2026-10-21T10:00:00Z' });
    stub({ ok: true, status: 'completed', answers: good, completed_at: '2026-10-21T10:00:00Z', skipped_at: null });
    assert.deepEqual(await (await route.GET(req('GET'))).json(), { status: 'completed', answers: good, completed_at: '2026-10-21T10:00:00Z' });
    assert.deepEqual(calls.map((c) => c.args), [{ p_auth_id: auth }, { p_auth_id: auth }, { p_auth_id: auth }]);
});

test('reset and skip name only the caller and answer the same on a replay', async () => {
    stub({ ok: true, changed: false });
    for (let i = 0; i < 2; i++) {
        const res = await route.DELETE(req('DELETE'));
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { reset: true });
    }
    stub({ ok: true, changed: false, status: 'completed' });
    const s = await skip.POST(req('POST', undefined, auth, '/skip'));
    assert.deepEqual(await s.json(), { status: 'completed', changed: false });
    assert.deepEqual(calls.map((c) => [c.name, c.args]), [
        ['reset_creator_profile', { p_auth_id: auth }], ['reset_creator_profile', { p_auth_id: auth }], ['skip_creator_profile', { p_auth_id: auth }],
    ]);
});

test('database refusals map to typed errors; internals never leak', async () => {
    stub({ ok: false, error: 'account_not_found' });
    assert.equal((await route.GET(req('GET'))).status, 404);
    assert.equal((await skip.POST(req('POST', undefined, auth, '/skip'))).status, 404);
    stub({ ok: false, error: 'invalid_answers' });
    assert.deepEqual(await (await route.PUT(req('PUT', good))).json(), { error: 'invalid_answers' });
    stub({ ok: false, error: 'relation creator_profiles does not exist' });
    for (const res of [await route.GET(req('GET')), await route.PUT(req('PUT', good)), await route.DELETE(req('DELETE')), await skip.POST(req('POST', undefined, auth, '/skip'))]) {
        assert.equal(res.status, 502);
        assert.deepEqual(await res.json(), { error: 'creator_profile_unavailable' });
    }
    stub({}, { fail: true });
    assert.equal((await route.GET(req('GET'))).status, 502);
    assert.equal((await route.PUT(req('PUT', good))).status, 502);
});
