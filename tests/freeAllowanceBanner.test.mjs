import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { freeCost, freeLeftFor } from '../app/veyrnox/_lib/freeAllowance.js';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service' });
const route = await import('../app/api/v1/free-allowance/route.js');
const page = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');
const AUTH = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';

function network(rpcAnswer = { 'model-a': 2 }, { fail = false } = {}) {
    const calls = []; const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        calls.push({ path: u.pathname, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
        if (u.pathname.endsWith('/rpc/free_allowance_left')) { if (fail) return new Response('boom', { status: 500 }); return Response.json(rpcAnswer); }
        if (u.pathname === '/rest/v1/users') return Response.json([{ id: USER }]);
        return Response.json({ ok: true });
    };
    return { calls, restore: () => { globalThis.fetch = real; } };
}
const get = (headers = { 'x-veyrnox-auth-id': AUTH }) => route.GET(new Request('https://veyrnox.test/api/v1/free-allowance', { headers }));
const withFlag = async (value, fn) => {
    const before = process.env.FREE_ALLOWANCE_ENABLED;
    if (value === undefined) delete process.env.FREE_ALLOWANCE_ENABLED; else process.env.FREE_ALLOWANCE_ENABLED = value;
    try { return await fn(); } finally { if (before === undefined) delete process.env.FREE_ALLOWANCE_ENABLED; else process.env.FREE_ALLOWANCE_ENABLED = before; }
};

test('freeCost: the first jobs of a batch are free, the rest cost the catalog price', () => {
    assert.equal(freeCost(5, 1, 3), 0);
    assert.equal(freeCost(5, 4, 3), 5);
    assert.equal(freeCost(5, 4, 0), 20);
    assert.equal(freeCost(5, 2, 99), 0);
    assert.equal(freeCost(5, 3, -2), 15);
    assert.equal(freeCost(5, 3, 'x'), 15);
});

test('freeLeftFor: only a positive whole number counts', () => {
    assert.equal(freeLeftFor({ a: 2 }, 'a'), 2);
    for (const bad of [0, -1, 1.5, '2', null, undefined, NaN]) assert.equal(freeLeftFor({ a: bad }, 'a'), 0);
    assert.equal(freeLeftFor({}, 'a'), 0);
    assert.equal(freeLeftFor(undefined, 'a'), 0);
});

test('signed out is refused', async () => {
    const res = await get({});
    assert.equal(res.status, 401);
});

test('flag off: nothing is read and the page is told there is no allowance', () => withFlag(undefined, async () => {
    const net = network();
    try {
        const res = await get();
        assert.deepEqual(await res.json(), { enabled: false, left: {} });
        assert.equal(net.calls.length, 0);
        assert.equal(res.headers.get('cache-control'), 'no-store');
    } finally { net.restore(); }
}));

test('flag on: the caller\'s own remainder comes from free_allowance_left', () => withFlag('true', async () => {
    const net = network({ 'model-a': 2, 'model-b': 0 });
    try {
        const res = await get();
        assert.deepEqual(await res.json(), { enabled: true, left: { 'model-a': 2, 'model-b': 0 } });
        assert.deepEqual(net.calls.find((c) => c.path.endsWith('/rpc/free_allowance_left')).body, { p_user_id: USER });
    } finally { net.restore(); }
}));

test('flag on: a failing read answers a typed 502 and leaks nothing', () => withFlag('true', async () => {
    const net = network({}, { fail: true });
    const errors = console.error; console.error = () => {};
    try {
        const res = await get();
        assert.equal(res.status, 502);
        assert.deepEqual(await res.json(), { error: 'free_allowance_unavailable' });
    } finally { console.error = errors; net.restore(); }
}));

test('the create page prices the batch through freeCost and shows a free banner and badge', () => {
    assert.match(page, /freeCost\(unitCost, n, freeLeft\)/);
    assert.match(page, /FREE · \$\{freeLeft\} LEFT TODAY/);
    assert.match(page, /FREE · \{freeLeftFor\(freeMap, m\.id\)\} left/);
});
