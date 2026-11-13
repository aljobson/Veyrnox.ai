import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-role' });
const route = await import('../app/api/v1/first-goal/route.js');
const { FIRST_GOAL_VALUES, cleanFirstGoal, firstGoalSyncEnabled } = await import('../lib/firstGoal.js');
const { FIRST_GOALS } = await import('../app/veyrnox/_lib/firstGoal.js');

const auth = '11111111-1111-4111-8111-111111111111';
const savedFetch = globalThis.fetch;
const savedFlag = process.env.FIRST_GOAL_SYNC_ENABLED;
const savedErr = console.error;
let calls;
test.beforeEach(() => { calls = []; console.error = () => {}; process.env.FIRST_GOAL_SYNC_ENABLED = 'true'; });
test.afterEach(() => {
    globalThis.fetch = savedFetch; console.error = savedErr;
    if (savedFlag === undefined) delete process.env.FIRST_GOAL_SYNC_ENABLED; else process.env.FIRST_GOAL_SYNC_ENABLED = savedFlag;
});

const req = (method, body, id = auth) => new Request('https://veyrnox.test/api/v1/first-goal', {
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
    assert.equal(firstGoalSyncEnabled({}), false);
    assert.equal(firstGoalSyncEnabled({ FIRST_GOAL_SYNC_ENABLED: '1' }), false);
    assert.equal(firstGoalSyncEnabled({ FIRST_GOAL_SYNC_ENABLED: 'true' }), true);
});

test('the allowlist is the web card\'s goals plus "skipped", and the same words the database accepts', () => {
    assert.deepEqual([...FIRST_GOAL_VALUES], [...FIRST_GOALS.map(({ id }) => id), 'skipped']);
});

test('only a listed word is accepted', () => {
    for (const goal of FIRST_GOAL_VALUES) assert.deepEqual(cleanFirstGoal({ goal }), { ok: true, goal });
    for (const bad of [{}, { goal: 'IMAGE' }, { goal: 'rm -rf' }, { goal: 7 }, { goal: null }, { goal: ['image'] }, null, [], 'image']) {
        assert.equal(cleanFirstGoal(bad).ok, false, JSON.stringify(bad));
    }
    assert.deepEqual(cleanFirstGoal({ goal: 'image', extra: 1 }), { ok: false, field: 'goal' }, 'unknown keys are refused');
});

test('a caller with no identity is refused before any outbound call', async () => {
    stub();
    for (const id of [null, '', 'not-a-uuid']) {
        assert.equal((await route.GET(req('GET', undefined, id))).status, 401);
        assert.equal((await route.PUT(req('PUT', { goal: 'image' }, id))).status, 401);
    }
    assert.deepEqual(calls, []);
});

test('with the flag off every verb answers 404 and calls nothing', async () => {
    stub();
    delete process.env.FIRST_GOAL_SYNC_ENABLED;
    assert.equal((await route.GET(req('GET'))).status, 404);
    assert.equal((await route.PUT(req('PUT', { goal: 'image' }))).status, 404);
    assert.deepEqual(calls, []);
});

test('GET returns the stored answers, or null, never anything else', async () => {
    stub({ ok: true, goal: 'video', role: 'creator', destination: 'youtube', updated_at: '2026-11-12T10:00:00Z', secret: 'x' });
    let res = await route.GET(req('GET'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { goal: 'video', role: 'creator', destination: 'youtube' });
    assert.deepEqual(calls, [{ name: 'get_first_answers', args: { p_auth_id: auth } }]);
    stub({ ok: true, goal: null });
    res = await route.GET(req('GET'));
    assert.deepEqual(await res.json(), { goal: null, role: null, destination: null });
});

test('GET falls back to the goal alone while migration 0499 is not applied', async () => {
    calls = [];
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop();
        calls.push(name);
        if (name === 'get_first_answers') return new Response('{}', { status: 404 });
        return Response.json({ ok: true, goal: 'edit' });
    };
    const res = await route.GET(req('GET'));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { goal: 'edit', role: null, destination: null });
    assert.deepEqual(calls, ['get_first_answers', 'get_first_goal']);
});

test('PUT with a role or destination goes through set_first_answers and returns all three', async () => {
    stub({ ok: true, changed: true, goal: null, role: 'pro', destination: 'reels' });
    let res = await route.PUT(req('PUT', { role: 'pro', destination: 'reels' }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { goal: null, role: 'pro', destination: 'reels', changed: true });
    assert.deepEqual(calls, [{ name: 'set_first_answers', args: { p_auth_id: auth, p_goal: null, p_role: 'pro', p_destination: 'reels' } }]);
    calls = [];
    for (const body of [{ role: 'CEO' }, { destination: 'mars' }, { goal: 'image', role: 'x' }, { role: 'pro', user_id: 'someone-else' }]) {
        res = await route.PUT(req('PUT', body));
        assert.equal(res.status, 400, JSON.stringify(body));
    }
    assert.deepEqual(calls, [], 'nothing invalid reaches the database');
    assert.deepEqual(await (await route.PUT(req('PUT', { role: 'CEO' }))).json(), { error: 'invalid_goal', field: 'role' });
});

test('PUT validates, calls the database with the caller\'s own id, and returns what the account holds', async () => {
    stub({ ok: true, changed: false, goal: 'video' });
    let res = await route.PUT(req('PUT', { goal: 'unsure' }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { goal: 'video', role: null, destination: null, changed: false });
    assert.deepEqual(calls, [{ name: 'set_first_goal', args: { p_auth_id: auth, p_goal: 'unsure' } }]);

    calls = []; stub();
    for (const body of [{ goal: 'rm -rf' }, {}, { goal: 'image', user_id: 'someone-else' }, 'not json{', '[]']) {
        res = await route.PUT(req('PUT', body));
        assert.ok([400].includes(res.status), String(body));
    }
    assert.deepEqual(calls, [], 'nothing invalid reaches the database');
    const invalid = await route.PUT(req('PUT', { goal: 'nope' }));
    assert.deepEqual(await invalid.json(), { error: 'invalid_goal', field: 'goal' });
});

test('database refusals and outages become typed errors with no upstream detail', async () => {
    stub({ ok: false, error: 'account_not_found' });
    assert.equal((await route.GET(req('GET'))).status, 404);
    assert.equal((await route.PUT(req('PUT', { goal: 'image' }))).status, 404);
    stub({ ok: false, error: 'something_internal', detail: 'secret stack' });
    let res = await route.GET(req('GET'));
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'first_goal_unavailable' });
    stub({}, { fail: true });
    res = await route.PUT(req('PUT', { goal: 'image' }));
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'first_goal_unavailable' });
});
