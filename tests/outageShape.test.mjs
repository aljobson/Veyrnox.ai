import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseError, rpc } from '../packages/db/supabase-client.js';
import { withOutageShape, noteOutage, outageNoted, serviceUnavailable } from '../lib/outageScope.js';

const gw = (path = '/api/v1/jobs') => new Request(`https://veyrnox.ai${path}`, { headers: { 'cf-ray': 'ray-1' } });
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('a Supabase transport failure behind a 502 becomes 503 service_unavailable with Retry-After and requestId', async () => {
    const res = await withOutageShape(gw(), async () => {
        try { await rpc('ledger_debit', {}, {}); } catch { /* the route's own catch */ }
        return json(502, { error: 'top_up_create_failed', detail: 'password authentication failed' });
    });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('retry-after'), '10');
    const body = await res.json();
    assert.deepEqual(body, { error: 'service_unavailable', requestId: 'ray-1' });
});

test('timeouts (status 0) and 5xx count; a 4xx refusal does not', async () => {
    for (const [status, rewritten] of [[0, true], [500, true], [522, true], [401, false], [409, false]]) {
        const res = await withOutageShape(gw(), async () => {
            new SupabaseError('x', { status, body: null });
            return json(500, { error: 'internal' });
        });
        assert.equal(res.status === 503, rewritten, `status ${status}`);
    }
});

test('an answer that is not a server error is never rewritten, even after an outage was noted', async () => {
    for (const status of [200, 201, 400, 401, 409, 429]) {
        const res = await withOutageShape(gw(), async () => { noteOutage(); return json(status, { ok: true }); });
        assert.equal(res.status, status);
    }
});

test('a 500 with no Supabase failure is a bug and stays a 500', async () => {
    const res = await withOutageShape(gw(), async () => json(500, { error: 'internal' }));
    assert.equal(res.status, 500);
});

test('only /api/v1 is shaped; scopes do not leak between requests', async () => {
    const page = await withOutageShape(gw('/api/status'), async () => { noteOutage(); return json(500, { error: 'x' }); });
    assert.equal(page.status, 500);
    await withOutageShape(gw(), async () => { noteOutage(); return json(200, {}); });
    assert.equal(outageNoted(), false);
    const [a, b] = await Promise.all([
        withOutageShape(gw(), async () => { await Promise.resolve(); noteOutage(); return json(500, {}); }),
        withOutageShape(gw(), async () => { await new Promise((r) => setTimeout(r, 5)); return json(500, {}); }),
    ]);
    assert.equal(a.status, 503);
    assert.equal(b.status, 500, 'a concurrent request is unaffected');
});

test('the body leaks no stack or database text', async () => {
    const res = await withOutageShape(gw(), async () => {
        new SupabaseError('rpc(x) failed', { status: 503, body: { message: 'FATAL: remaining connection slots' } });
        return json(500, { error: 'internal' });
    });
    const text = await res.text();
    assert.ok(!/FATAL|slots|at |stack/.test(text));
});

test('a streamed answer is left alone', async () => {
    const res = await withOutageShape(gw(), async () => {
        noteOutage();
        return new Response('data: x\n\n', { status: 500, headers: { 'content-type': 'text/event-stream' } });
    });
    assert.equal(res.status, 500);
});

test('the same request retried with the same idempotency key reaches the route again, unchanged', async () => {
    const seen = [];
    const route = async (req) => { seen.push(req.headers.get('idempotency-key')); return json(200, { replay: seen.length > 1 }); };
    const req = () => new Request('https://veyrnox.ai/api/v1/generations', { method: 'POST', headers: { 'idempotency-key': 'k1' } });
    await withOutageShape(req(), async (r) => { noteOutage(); await route(r); return json(502, {}); });
    const second = await withOutageShape(req(), route);
    assert.equal(second.status, 200);
    assert.deepEqual(seen, ['k1', 'k1']);
});

test('serviceUnavailable() builds the shape directly for a route', async () => {
    const res = serviceUnavailable(gw());
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'service_unavailable');
});

test('the anonymous public routes outside the gate get the same shape; a saved copy (200) is untouched', async () => {
    const paths = ['/api/catalog', '/api/credit-packs', '/api/presets', '/api/popular-templates',
        '/api/credit-subscription-plans', '/api/cinema-pass-plans', '/api/cinema/titles', '/api/cinema/titles/abc', '/api/cinema/voting'];
    for (const path of paths) {
        const down = await withOutageShape(gw(path), async () => {
            new SupabaseError('x', { status: 0, body: null });
            return json(502, { error: 'internal' });
        });
        assert.equal(down.status, 503, path);
        assert.equal(down.headers.get('retry-after'), '10', path);
        assert.equal((await down.json()).error, 'service_unavailable', path);
        const stale = await withOutageShape(gw(path), async () => { noteOutage(); return json(200, { models: ['saved copy'] }); });
        assert.equal(stale.status, 200, path);
    }
});

test('routes that are not on the list keep their own answers', async () => {
    for (const path of ['/api/status', '/api/webhook/stripe', '/api/auth/session', '/api/catalogue']) {
        const res = await withOutageShape(gw(path), async () => { noteOutage(); return json(502, { error: 'x' }); });
        assert.equal(res.status, 502, path);
    }
});
