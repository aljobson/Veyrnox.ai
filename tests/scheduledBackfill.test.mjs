import test from 'node:test';
import assert from 'node:assert/strict';
import { runScheduledBackfill } from '../lib/scheduledBackfill.js';

const env = { PUBLIC_HOST: 'https://veyrnox.ai', TOP_UP_BACKFILL_TOKEN: 'tok_123' };

function recorder(response = new Response(JSON.stringify({ checked: 2 }), { status: 200 })) {
    const calls = [];
    const errors = [];
    const fetch = async (req, e, ctx) => { calls.push({ req, e, ctx }); return typeof response === 'function' ? response() : response; };
    return { calls, errors, fetch, log: (...a) => errors.push(a.join(' ')) };
}

test('posts to the backfill route through the app handler with the bearer token', async () => {
    const r = recorder();
    const ctx = {};
    const res = await runScheduledBackfill(r.fetch, env, ctx, { log: r.log });
    assert.equal(r.calls.length, 1);
    const { req } = r.calls[0];
    assert.equal(req.method, 'POST');
    assert.equal(req.url, 'https://veyrnox.ai/api/admin/top-up-backfill');
    assert.equal(req.headers.get('authorization'), 'Bearer tok_123');
    assert.equal(r.calls[0].e, env, 'the Worker env, so the route sees its secrets');
    assert.equal(r.calls[0].ctx, ctx);
    assert.deepEqual(res, { ok: true, status: 200 });
    assert.equal(r.errors.length, 0);
});

test('a trailing slash on PUBLIC_HOST does not double the path', async () => {
    const r = recorder();
    await runScheduledBackfill(r.fetch, { ...env, PUBLIC_HOST: 'https://veyrnox.ai/' }, {}, { log: r.log });
    assert.equal(r.calls[0].req.url, 'https://veyrnox.ai/api/admin/top-up-backfill');
});

test('missing or non-https config is logged and nothing is called', async () => {
    for (const bad of [{ TOP_UP_BACKFILL_TOKEN: '' }, { PUBLIC_HOST: '' }, { PUBLIC_HOST: 'http://veyrnox.ai' }, { PUBLIC_HOST: 'not a url' }]) {
        const r = recorder();
        const res = await runScheduledBackfill(r.fetch, { ...env, ...bad }, {}, { log: r.log });
        assert.equal(r.calls.length, 0, JSON.stringify(bad));
        assert.deepEqual(res, { ok: false, status: null });
        assert.equal(r.errors.length, 1);
    }
});

test('a non-2xx answer is logged with its status, never the token', async () => {
    const r = recorder(new Response('{"error":"not_configured"}', { status: 503 }));
    const res = await runScheduledBackfill(r.fetch, env, {}, { log: r.log });
    assert.deepEqual(res, { ok: false, status: 503 });
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /503/);
    assert.doesNotMatch(r.errors[0], /tok_123/);
});

test('a thrown handler error is logged, not rethrown', async () => {
    const r = recorder(() => { throw new Error('boom'); });
    const res = await runScheduledBackfill(r.fetch, env, {}, { log: r.log });
    assert.deepEqual(res, { ok: false, status: null });
    assert.match(r.errors[0], /boom/);
});
